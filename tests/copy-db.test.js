const test = require('node:test');
const assert = require('node:assert');
const { buildInsert } = require('../lib/copy-db');

test('buildInsert numbers every placeholder and quotes every identifier', () => {
  const { sql } = buildInsert('movies', ['id', 'key'], 2);
  assert.match(sql, /^insert into "movies" \("id", "key"\) values \(\$1, \$2\), \(\$3, \$4\)/);
  assert.ok(sql.endsWith('on conflict do nothing'));
});

test('buildInsert keeps a single row working and quotes awkward names', () => {
  const { sql } = buildInsert('we"ird', ['a b'], 1);
  assert.match(sql, /insert into "we""ird" \("a b"\) values \(\$1\)/);
});
