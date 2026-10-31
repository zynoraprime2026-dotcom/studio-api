'use strict';
// One-way, idempotent copy of every public table from an old database into the
// one this service now points at. Used to leave a free Postgres plan before it
// expires, without losing films, series or API keys.
//
// Design notes:
// - the destination schema already exists: initDb() creates it on every boot
// - tables are copied in name order, 100 rows at a time, conflicts ignored
// - a table whose destination already holds at least as many rows as the source
//   is skipped, so a second boot costs almost nothing
// - nothing is ever written to the source, and nothing is dropped

const pg = require('pg');

const quote = (identifier) => '"' + String(identifier).replace(/"/g, '""') + '"';

/** Builds one parameterised multi-row insert. Exported so it can be tested. */
function buildInsert(table, columns, rowCount, offset = 0) {
  const placeholders = [];
  let n = offset;
  for (let row = 0; row < rowCount; row++) {
    const cells = [];
    for (let col = 0; col < columns.length; col++) cells.push('$' + ++n);
    placeholders.push('(' + cells.join(', ') + ')');
  }
  const sql = 'insert into ' + quote(table) + ' (' + columns.map(quote).join(', ') + ') values ' +
    placeholders.join(', ') + ' on conflict do nothing';
  return { sql, params: n };
}

async function copyDatabase({ pool, sourceUrl, log = console.log, budgetMs = 180000 }) {
  if (!pool || !sourceUrl) return { skipped: true, reason: 'no pool or no MIGRATE_FROM' };
  const started = Date.now();
  const source = new pg.Client({
    connectionString: sourceUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await source.connect();
  const summary = [];
  try {
    const tables = (await source.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name"
    )).rows.map((row) => row.table_name);

    for (const table of tables) {
      if (Date.now() - started > budgetMs) {
        summary.push({ table, skipped: 'refused to exceed the boot time budget' });
        break;
      }
      const destCols = new Set((await pool.query(
        'select column_name from information_schema.columns where table_schema = $1 and table_name = $2',
        ['public', table]
      )).rows.map((row) => row.column_name));
      if (!destCols.size) {
        summary.push({ table, skipped: 'the new database has not created this table' });
        continue;
      }
      const columns = (await source.query(
        'select column_name from information_schema.columns where table_schema = $1 and table_name = $2 order by ordinal_position',
        ['public', table]
      )).rows.map((row) => row.column_name).filter((name) => destCols.has(name));

      const sourceRows = await source.query('select ' + columns.map(quote).join(', ') + ' from ' + quote(table));
      const destCount = Number((await pool.query('select count(*) as n from ' + quote(table))).rows[0].n);
      if (destCount >= sourceRows.rows.length) {
        summary.push({ table, rows: sourceRows.rows.length, skipped: 'already at least as full' });
        continue;
      }

      let copied = 0;
      let existed = 0;
      const size = 100;
      for (let i = 0; i < sourceRows.rows.length; i += size) {
        const part = sourceRows.rows.slice(i, i + size);
        const params = [];
        for (const row of part) for (const name of columns) params.push(row[name]);
        const { sql } = buildInsert(table, columns, part.length);
        const result = await pool.query(sql, params);
        copied += result.rowCount;
        existed += part.length - result.rowCount;
      }
      summary.push({ table, rows: sourceRows.rows.length, copied, existed });
      log('[db-copy] ' + table + ': ' + copied + ' copied, ' + existed + ' already there');
    }
    return { summary, ms: Date.now() - started };
  } finally {
    await source.end().catch(() => {});
  }
}

module.exports = { copyDatabase, buildInsert };
