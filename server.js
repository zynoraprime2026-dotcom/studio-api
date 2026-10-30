// AI Studio API — image generation, video rendering, content creation.
// Companion to the Ilm API. Deployed as a Docker web service (needs ffmpeg).

const express = require('express');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const execFileAsync = promisify(execFile);
const { createSlidingWindowLimiter, clientAddress } = require('./lib/ratelimit');
const { buildReadiness } = require('./lib/readiness');
const { normalizeContinuity, chainPlan, lastFrameArgs, isAllFallback } = require('./lib/continuity');

const app = express();
app.use(express.json({ limit: '2mb' }));

// CORS: the API is public with key auth; allow browser clients on any origin
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-api-key,Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const PORT = process.env.PORT || 5000;
const WORK_DIR = process.env.WORK_DIR || path.join(os.tmpdir(), 'studio-api');
const VIDEOS_DIR = path.join(WORK_DIR, 'videos');
fs.mkdirSync(VIDEOS_DIR, { recursive: true });

// ---------- landing page (no auth) ----------
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Studio API</title><style>
body{font-family:system-ui,sans-serif;background:#0E2A2B;color:#F3ECDA;max-width:720px;margin:0 auto;padding:32px 20px;line-height:1.6}
h1{color:#C9A96A;margin-bottom:4px} p.sub{color:#8FB3B0;margin-top:0}
table{width:100%;border-collapse:collapse;margin:16px 0} th,td{text-align:left;padding:10px;border-bottom:1px solid #1E4344}
code{background:#1E4344;padding:2px 8px;border-radius:4px;color:#C9A96A}
a{color:#C9A96A} .ok{color:#7BC47F;font-weight:bold}
</style></head><body>
<h1>Studio API</h1>
<p class="sub">AI content creation service — images, video, scripts. Companion to the <a href="https://ilm-api.vercel.app">Ilm API</a>.</p>
<p>Status: <span class="ok">Live</span></p>
<h3 style="color:#C9A96A;margin:22px 0 6px">CREATE</h3>
<table>
<tr><th>Flow</th><th>Endpoint</th><th>What it does</th></tr>
<tr><td>Text &rarr; Image</td><td><code>POST /v1/image/generate</code></td><td>AI image from a prompt</td></tr>
<tr><td>Text &rarr; Content</td><td><code>POST /v1/content/generate</code></td><td>Shorts scripts, lessons, posts</td></tr>
<tr><td>Text &rarr; Speech</td><td><code>POST /v1/audio/speak</code></td><td>Natural voice MP3, 300+ voices (en, ar and more), rate control</td></tr>
<tr><td>Text &rarr; PDF</td><td><code>POST /v1/pdf/generate</code></td><td>Lesson PDFs with vocalized Arabic + grammar sections</td></tr>
<tr><td>Prompt Presets</td><td><code>/v1/presets</code></td><td>Versioned style + scene presets for consistent generations</td></tr>
<tr><td>Text &rarr; Video</td><td><code>POST /v1/video/render</code></td><td>Scene-based MP4, Shorts or widescreen, narration voice per scene, auto-subtitles, webhook callback when done</td></tr>
<tr><td>Image &rarr; Video</td><td><code>POST /v1/video/from-image</code></td><td>Ken Burns zoom &amp; pan effects (zoom_in, zoom_out, pan_left, pan_right, static), caption overlay</td></tr>
<tr><td>Real Motion Video</td><td><code>POST /v1/video/image-to-video</code></td><td>True AI footage where subjects move — Kling / Hailuo / Wan via your Replicate or fal.ai key. Styles: <code>GET /v1/video/styles</code></td></tr>
<tr><td>Multi-step Workflows</td><td><code>POST /v1/workflows</code></td><td>Chain steps (image &rarr; speech &rarr; animate); later steps reuse earlier outputs via <code>{{s1.url}}</code></td></tr>
<tr><td>Masjid Answer Service</td><td><code>/v1/masjid/*</code></td><td>Mosque communities: register a mosque, store announcements, AI answers with live prayer times &mdash; <a href="/masjid">full masjid docs</a></td></tr>
<tr><td>Portfolio Service</td><td><code>/v1/portfolios</code></td><td>Artist portfolios with AI-generated or uploaded artworks; publish to a shareable gallery</td></tr>
<tr><td>Game Logic Service</td><td><code>/v1/games</code></td><td>Branching narrative projects: scenes, player choices, AI scene art, story maps</td></tr>
<tr><td>Madrasa Classroom</td><td><code>/v1/classes</code></td><td>Teacher dashboards for the Huruuf game: classes, student rosters, per-letter progress reports</td></tr>
</table>
<h3 style="color:#C9A96A;margin:22px 0 6px">MANAGE RENDERS</h3>
<table>
<tr><th>Method</th><th>Endpoint</th><th>What it does</th></tr>
<tr><td>GET</td><td><code>/v1/video/status/:id</code></td><td>Render progress</td></tr>
<tr><td>GET</td><td><code>/v1/video/file/:id</code></td><td>Download finished MP4</td></tr>
<tr><td>GET</td><td><code>/v1/video/thumbnail/:id</code></td><td>Branded cover image from a finished video</td></tr>
<tr><td>GET</td><td><code>/v1/workflows/:id</code></td><td>Workflow progress &amp; step outputs</td></tr>
<tr><td>GET</td><td><code>/v1/workflows/:id/files/:name</code></td><td>Download step output files</td></tr>
<tr><td>GET</td><td><code>/gallery/:id</code></td><td>Public portfolio gallery (no key needed, published portfolios)</td></tr>
<tr><td>GET</td><td><code>/v1/games/:id/story-map</code></td><td>Branching map with unresolved targets &amp; unreachable scenes</td></tr>
<tr><td>GET</td><td><code>/v1/classes/:id/report</code></td><td>Per-student accuracy, mastered and weak letters</td></tr>
<tr><td>POST</td><td><code>/v1/join</code></td><td>Student joins a class from the Huruuf game (class code + name)</td></tr>
</table>
<h3 style="color:#C9A96A;margin:22px 0 6px">ACCOUNT</h3>
<table>
<tr><th>Method</th><th>Endpoint</th><th>What it does</th></tr>
<tr><td>POST</td><td><code>/v1/developers/signup</code></td><td>Get an API key</td></tr>
<tr><td>GET</td><td><code>/v1/health</code></td><td>Service status (needs key)</td></tr>
<tr><td>GET</td><td><code>/v1/usage</code></td><td>Your monthly usage and limit</td></tr>
<tr><td>GET</td><td><code>/v1/openapi.json</code></td><td>Full machine-readable API documentation</td></tr>
</table>
<p>Send your key as header <code>x-api-key</code>. Full docs on <a href="https://github.com/zynoraprime2026-dotcom/studio-api">GitHub</a>.</p>
<div style="margin-top:28px;padding-top:20px;border-top:1px solid #1E4344">
<h3 style="color:#C9A96A;margin-bottom:6px">Get your API key</h3>
<p style="font-size:.85rem;color:#8FB3B0;margin-bottom:10px">Enter your email — a key is created instantly.</p>
<div style="display:flex;gap:8px;flex-wrap:wrap">
<input id="email" type="email" placeholder="you@example.com" style="flex:1;min-width:180px;padding:11px;border-radius:10px;border:1px solid #2A5556;background:#0E2A2B;color:#F3ECDA;font-size:.95rem">
<button onclick="signup()" style="padding:11px 18px;border:none;border-radius:10px;background:#C9A96A;color:#0E2A2B;font-weight:700;font-size:.95rem;cursor:pointer">Sign up</button>
</div>
<div id="keybox" style="display:none;margin-top:14px;background:#1E4344;border-radius:10px;padding:14px">
<div style="font-size:.8rem;color:#8FB3B0;margin-bottom:6px">Your API key (copy it now, keep it safe):</div>
<div id="keyout" style="font-family:monospace;color:#C9A96A;word-break:break-all"></div>
</div>
<div id="err" style="display:none;margin-top:10px;color:#E57373;font-size:.85rem"></div>
</div>
<script>
async function signup(){
  var em = document.getElementById('email').value.trim();
  if(!em){ return; }
  document.getElementById('err').style.display='none';
  try {
    var r = await fetch('/v1/developers/signup', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em})});
    var d = await r.json();
    if(d.key){ document.getElementById('keybox').style.display='block'; document.getElementById('keyout').textContent = d.key; }
    else { document.getElementById('err').textContent = d.error || 'Signup failed'; document.getElementById('err').style.display='block'; }
  } catch(e){ document.getElementById('err').textContent='Could not reach the server'; document.getElementById('err').style.display='block'; }
}
</script>
</body></html>
</body></html>`);
});


// ---------- Masjid Answer service docs page (no auth) ----------
app.get('/masjid', (req, res) => {
  try { res.send(fs.readFileSync(path.join(__dirname, 'masjid-docs.html'), 'utf8')); }
  catch (e) { res.status(500).send('docs unavailable'); }
});

// ---------- optional Postgres (Supabase) for developer keys ----------
let pg = null;
if (process.env.DATABASE_URL) {
  try {
    pg = require('pg');
  } catch (e) {
    console.warn('pg not installed; developer keys will be memory-only');
  }
}

// Supabase fix: direct db.<ref>.supabase.co hosts are IPv6-only (unreachable from
// hosts without IPv6 egress, like Render), and the pooler region may not match the
// project's actual region. So: extract the project ref from the URL and probe every
// Supabase pooler region (aws-0/aws-1, ports 5432 and 443) in parallel, then
// connect through whichever answers. Falls back to the original URL last.
const POOLER_REGIONS = [
  'aws-1-eu-central-1', 'aws-0-eu-central-1',
  'aws-1-eu-west-1', 'aws-0-eu-west-1', 'aws-1-eu-west-2', 'aws-0-eu-west-2', 'aws-1-eu-west-3', 'aws-0-eu-west-3',
  'aws-1-us-east-1', 'aws-0-us-east-1', 'aws-1-us-east-2', 'aws-0-us-east-2',
  'aws-1-us-west-1', 'aws-0-us-west-1', 'aws-1-us-west-2', 'aws-0-us-west-2',
  'aws-1-ap-southeast-1', 'aws-0-ap-southeast-1', 'aws-1-ap-southeast-2', 'aws-0-ap-southeast-2',
  'aws-1-ap-northeast-1', 'aws-0-ap-northeast-1', 'aws-1-ap-south-1', 'aws-0-ap-south-1',
  'aws-1-ca-central-1', 'aws-0-ca-central-1', 'aws-1-sa-east-1', 'aws-0-sa-east-1',
];

function extractRef(raw) {
  try {
    const u = new URL(raw);
    const m = u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (m) return m[1];
    const um = u.username.match(/^postgres\.([a-z0-9]+)$/i);
    if (um) return um[1];
  } catch (e) {}
  return null;
}

function buildCandidates(raw) {
  const list = [];
  const ref = extractRef(raw);
  if (ref) {
    const pw = new URL(raw).password;
    for (const region of POOLER_REGIONS) list.push('postgresql://postgres.' + ref + ':' + pw + '@' + region + '.pooler.supabase.com:5432/postgres');
    for (const region of POOLER_REGIONS) list.push('postgresql://postgres.' + ref + ':' + pw + '@' + region + '.pooler.supabase.com:443/postgres');
  }
  list.push(raw); // original URL, lowest priority
  return list;
}

async function probe(cand) {
  const c = new pg.Client({ connectionString: cand, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 9000 });
  await c.connect();
  await c.end();
  return cand;
}

let pool = null;
let activeDbUrl = null;
let dbProbeErrors = [];
async function connectDb() {
  if (!pg || !process.env.DATABASE_URL) return false;
  const cands = buildCandidates(process.env.DATABASE_URL);
  const results = await Promise.allSettled(cands.map(c => probe(c)));
  let winner = null;
  dbProbeErrors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && !winner) winner = r.value;
    if (r.status === 'rejected') {
      let host = '?';
      try { host = new URL(cands[i]).hostname; } catch (e) {}
      dbProbeErrors.push(host + ' -> ' + String((r.reason && (r.reason.code || r.reason.message)) || r.reason).slice(0, 80));
    }
  });
  if (winner) {
    activeDbUrl = winner;
    pool = new pg.Pool({ connectionString: winner, ssl: { rejectUnauthorized: false } });
    dbBroken = false;
    lastDbError = null;
    console.log('DB connected via:', new URL(winner).hostname, new URL(winner).port);
    return true;
  }
  dbBroken = true;
  pool = null;
  lastDbError = dbProbeErrors.slice(0, 4).join(' | ');
  console.log('DB unreachable on all ' + cands.length + ' candidates; memory mode');
  return false;
}

const memoryKeys = new Map(); // key -> { email, created_at }

async function initDb() {
  if (!pg || !process.env.DATABASE_URL) return;
  await connectDb();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS developers (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      key TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_usage (
      key TEXT NOT NULL,
      month TEXT NOT NULL,
      count INT NOT NULL DEFAULT 0,
      PRIMARY KEY (key, month)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolios (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      artist TEXT,
      published BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS artworks (
      id TEXT PRIMARY KEY,
      portfolio_id TEXT NOT NULL,
      key TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      image_url TEXT NOT NULL,
      prompt TEXT,
      created_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      key TEXT,
      mime TEXT NOT NULL,
      bytes BYTEA NOT NULL,
      prompt TEXT,
      created_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS masjid_mosques (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      mosque_name TEXT NOT NULL,
      city TEXT NOT NULL,
      whatsapp_admin_phone TEXT,
      created_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS masjid_announcements (
      id TEXT PRIMARY KEY,
      mosque_id TEXT NOT NULL,
      key TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_projects (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      title TEXT NOT NULL,
      genre TEXT,
      description TEXT,
      start_scene TEXT,
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_scenes (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      key TEXT NOT NULL,
      title TEXT NOT NULL,
      narrative TEXT NOT NULL,
      choices JSONB DEFAULT '[]',
      image_url TEXT,
      prompt TEXT,
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS madrasa_classes (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT UNIQUE,
      teacher TEXT,
      created_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS madrasa_students (
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS madrasa_progress (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      key TEXT NOT NULL,
      letter TEXT NOT NULL,
      correct BOOLEAN,
      created_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      name TEXT,
      status TEXT NOT NULL,
      steps JSONB DEFAULT '[]',
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL,
      prompt TEXT NOT NULL,
      params JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ` + `
    CREATE TABLE IF NOT EXISTS movies (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      aspect_ratio TEXT,
      language TEXT,
      style TEXT,
      narrator_voice TEXT,
      duration DOUBLE PRECISION,
      scenes JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS movie_assets (
      movie_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      idx INT NOT NULL DEFAULT 0,
      bytes BYTEA,
      created_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (movie_id, kind, idx)
    );
  `);
}

async function saveDeveloperKey(email, key) {
  if (!pool) return;
  await pool.query('INSERT INTO developers (email, key) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET key = $2', [email, key]);
}

async function isValidKey(key) {
  if (!key) return false;
  if (memoryKeys.has(key)) return true;
  if (pool) {
    const r = await pool.query('SELECT 1 FROM developers WHERE key = $1', [key]);
    return r.rowCount > 0;
  }
  return false;
}

// ---------- usage metering (free tier) ----------
const FREE_MONTHLY_LIMIT = parseInt(process.env.FREE_MONTHLY_LIMIT) || 100;
const memoryUsage = new Map(); // key -> { month, count }
function currentMonth() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

let lastDbError = null;
let dbBroken = false; // flips true after a failed query; usage falls back to memory

function memUsage(key, month) {
  const u = memoryUsage.get(key);
  return u && u.month === month ? u.count : 0;
}

async function getUsage(key) {
  const month = currentMonth();
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT count FROM api_usage WHERE key = $1 AND month = $2', [key, month]);
      return { month, used: r.rowCount ? parseInt(r.rows[0].count) : 0, mode: 'database' };
    } catch (e) { lastDbError = e.message; dbBroken = true; console.error('usage read failed, falling back to memory:', e.message); }
  }
  return { month, used: memUsage(key, month), mode: dbBroken ? 'memory' : 'memory' };
}

async function incrUsage(key) {
  const month = currentMonth();
  if (pool && !dbBroken) {
    try {
      await pool.query('INSERT INTO api_usage (key, month, count) VALUES ($1, $2, 1) ON CONFLICT (key, month) DO UPDATE SET count = api_usage.count + 1', [key, month]);
      return;
    } catch (e) { lastDbError = e.message; dbBroken = true; console.error('usage incr failed, falling back to memory:', e.message); }
  }
  const u = memoryUsage.get(key);
  memoryUsage.set(key, u && u.month === month ? { month, count: u.count + 1 } : { month, count: 1 });
}

// diagnostic: shows whether the DB connection is healthy
app.get('/v1/db-check', async (req, res) => {
  if (!pool) await connectDb(); // self-heal: re-probe candidates if connection was lost at boot
  const out = { db_configured: !!pool, active_host: activeDbUrl ? new URL(activeDbUrl).hostname + ':' + new URL(activeDbUrl).port : null, probe_errors: dbProbeErrors.slice(0, 8), last_error: lastDbError ? String(lastDbError).slice(0, 300) : null, live: null };
  if (pool) {
    try {
      const r = await pool.query('SELECT 1 AS ok');
      out.live = r.rows[0].ok === 1 ? 'connected' : 'unexpected';
      const t = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
      out.tables = t.rows.map(x => x.table_name);
    } catch (e) {
      out.live = 'failed';
      out.last_error = String(e.message).slice(0, 300);
      out.error_dump = JSON.stringify({ name: e.name, code: e.code, errno: e.errno, syscall: e.syscall, hostname: e.hostname, detail: e.detail, hint: e.hint, stack: String(e.stack || '').split('\n').slice(0, 3) }).slice(0, 900);
    }
  }
  res.json(out);
});


// ---------- prompt/parameter presets ----------
const BUILTIN_PRESETS = [
  { id: 'abstract-gold', category: 'artist-style', name: 'abstract-gold', prompt: 'abstract modern islamic art, flowing gold and deep teal, luxurious, museum quality, high detail', params: { width: 1024, height: 1024 } },
  { id: 'arabic-calligraphy', category: 'artist-style', name: 'arabic-calligraphy', prompt: 'elegant arabic calligraphy artwork, gold ink on dark emerald background, ornate, master calligrapher style', params: { width: 1024, height: 1024 } },
  { id: 'geometric-pattern', category: 'artist-style', name: 'geometric-pattern', prompt: 'intricate islamic geometric pattern, girih tiles, gold and midnight blue, symmetrical, crisp vector-like edges', params: { width: 1024, height: 1024 } },
  { id: 'quran-short-card', category: 'scene-style', name: 'quran-short-card', prompt: 'vertical youtube short scene card, deep teal background with subtle geometric pattern, centered arabic calligraphy in gold, cinematic lighting', params: { width: 1080, height: 1920 } },
  { id: 'game-character', category: 'game-asset', name: 'game-character', prompt: 'game character concept art, full body, clean background, stylized, consistent character design sheet', params: { width: 1024, height: 1536 } },
  { id: 'game-scene-bg', category: 'game-asset', name: 'game-scene-bg', prompt: 'game scene background art, wide establishing shot, atmospheric, game-ready composition', params: { width: 1536, height: 864 } },
];
const memoryPresets = new Map(); // id -> { id, name, category, prompt, params }

async function listPresets() {
  let custom = [];
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT id, name, category, prompt, params FROM presets');
      custom = r.rows.map(x => ({ id: x.id, name: x.name, category: x.category, prompt: x.prompt, params: x.params || {} }));
    } catch (e) { lastDbError = e.message; dbBroken = true; console.error('preset list failed, memory mode:', e.message); }
  }
  if (!custom.length) custom = [...memoryPresets.values()];
  return BUILTIN_PRESETS.concat(custom);
}

async function findPreset(ref) {
  const all = await listPresets();
  return all.find(p => p.id === ref || p.name === ref) || null;
}

async function createPreset(name, category, prompt, params) {
  const id = 'p_' + crypto.randomBytes(8).toString('hex');
  if (pool && !dbBroken) {
    try {
      await pool.query('INSERT INTO presets (id, name, category, prompt, params) VALUES ($1,$2,$3,$4,$5)', [id, name, category, prompt, JSON.stringify(params || {})]);
      return { id, name, category, prompt, params: params || {} };
    } catch (e) { lastDbError = e.message; dbBroken = true; console.error('preset save failed, memory mode:', e.message); }
  }
  const p = { id, name, category, prompt, params: params || {} };
  memoryPresets.set(id, p);
  return p;
}

async function deletePreset(id) {
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('DELETE FROM presets WHERE id = $1 AND id NOT LIKE $2', [id, 'builtin%']);
      return r.rowCount > 0 || memoryPresets.delete(id);
    } catch (e) { lastDbError = e.message; dbBroken = true; }
  }
  return memoryPresets.delete(id);
}

// preset endpoints
app.get('/v1/presets', async (req, res) => {
  let all = await listPresets();
  if (req.query.category) all = all.filter(p => p.category === req.query.category);
  res.json({ presets: all, count: all.length });
});

app.post('/v1/presets', async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().toLowerCase().replace(/\s+/g, '-');
  const prompt = String(b.prompt || '').trim();
  if (!name || !prompt) return res.status(400).json({ error: 'name and prompt are required' });
  if (BUILTIN_PRESETS.some(p => p.name === name)) return res.status(409).json({ error: 'that name is reserved by a built-in preset' });
  if ((await findPreset(name))) return res.status(409).json({ error: 'a preset with that name already exists' });
  const p = await createPreset(name, String(b.category || 'custom'), prompt.slice(0, 2000), typeof b.params === 'object' && b.params ? b.params : {});
  res.status(201).json({ message: 'preset created', preset: p });
});

app.get('/v1/presets/:ref', async (req, res) => {
  const p = await findPreset(req.params.ref);
  if (!p) return res.status(404).json({ error: 'preset not found' });
  res.json({ preset: p });
});

app.delete('/v1/presets/:ref', async (req, res) => {
  const p = await findPreset(req.params.ref);
  if (!p) return res.status(404).json({ error: 'preset not found' });
  if (BUILTIN_PRESETS.some(b => b.id === p.id)) return res.status(400).json({ error: 'built-in presets cannot be deleted' });
  const ok = await deletePreset(p.id);
  res.status(ok ? 200 : 404).json(ok ? { deleted: p.id } : { error: 'delete failed' });
});

// ---------- OpenAPI documentation ----------
app.get('/v1/openapi.json', (req, res) => {
  res.json({
    openapi: '3.0.3',
    info: { title: 'Studio API', version: '1.8.0', description: 'AI media engine: images, videos with narration and subtitles, speech, lesson PDFs, prompt presets, multi-step workflows. Companion to the Ilm API. Auth: x-api-key header on every /v1 request. Free tier: metered endpoints count toward a monthly limit.' },
    servers: [{ url: 'https://studio-api-nqpm.onrender.com' }],
    components: {
      securitySchemes: { ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' } },
      schemas: {
        Scene: { type: 'object', properties: { image: { type: 'string', description: 'image URL for the scene' }, text: { type: 'string', description: 'text card content' }, narration: { type: 'string', description: 'spoken audio for the scene (auto-timed)' }, duration: { type: 'number' }, subtitles: { type: 'boolean' } } },
        Preset: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, category: { type: 'string' }, prompt: { type: 'string' }, params: { type: 'object' } } },
      },
    },
    paths: {
      '/v1/developers/signup': { post: { summary: 'Create an API key', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string' } } } } } }, responses: { '200': { description: 'key created' } } } },
      '/v1/usage': { get: { summary: 'Monthly usage and limit', responses: { '200': { description: 'ok' } } } },
      '/v1/masjid/register': { post: { summary: 'Register a mosque (returns mosqueId; owned by your API key)', responses: { '201': { description: 'created' }, '400': { description: 'mosqueName and city required' } } } },
      '/v1/masjid/announce': { post: { summary: "Store a mosque announcement (Jumu'ah times, programs, fundraisers) — owner key only", responses: { '201': { description: 'stored' }, '404': { description: 'mosque not found (or not yours)' } } } },
      '/v1/masjid/answer': { post: { summary: 'Answer a member question using Ilm API prayer times + stored announcements + LLM. Costs 2 monthly uses, max 20/hour per key', responses: { '200': { description: 'ok' }, '404': { description: 'mosque not found (or not yours)' }, '429': { description: 'rate or monthly limit' } } } },
      '/v1/db-check': { get: { summary: 'Database connection diagnostic', responses: { '200': { description: 'ok' } } } },
      '/v1/image/generate': { post: { summary: 'Generate an image from text (or a preset)', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { prompt: { type: 'string' }, preset: { type: 'string', description: 'preset name or id; combined with prompt if both given' }, width: { type: 'integer' }, height: { type: 'integer' }, model: { type: 'string' }, seed: { type: 'integer' } } } } } }, responses: { '200': { description: 'image URL' } } } },
      '/v1/video/render': { post: { summary: 'Render a scene-based MP4 (narration, subtitles, webhook)', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, subtitles: { type: 'boolean' }, webhook: { type: 'string', description: 'https URL called when the render finishes or fails' }, scenes: { type: 'array', items: { '$ref': '#/components/schemas/Scene' } } } } } } }, responses: { '200': { description: 'job_id; poll /v1/video/status/:id' } } } },
      '/v1/video/image-to-video': { post: { summary: 'Real image-to-video: animate a still into true motion footage (needs provider token)', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['image_url'], properties: { image_url: { type: 'string' }, style: { type: 'string', description: 'one of the keys from /v1/video/styles' }, prompt: { type: 'string' }, motion: { type: 'string' }, duration: { type: 'number', minimum: 2, maximum: 10 }, model: { type: 'string', enum: ['kling', 'hailuo', 'wan'] }, provider: { type: 'string', enum: ['replicate', 'fal'] }, webhook: { type: 'string' } } } } } }, responses: { '202': { description: 'job accepted, poll status_url' }, '503': { description: 'provider token not configured' } } } },
      '/v1/video/styles': { get: { summary: 'Available image-to-video styles and configured providers', responses: { '200': { description: 'ok' } } } },
      '/v1/video/status/{id}': { get: { summary: 'Render job status', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'status' } } } },
      '/v1/video/file/{id}': { get: { summary: 'Download finished MP4', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'video bytes' } } } },
      '/v1/video/thumbnail/{id}': { get: { summary: 'Branded cover image from a finished video', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'at', in: 'query', schema: { type: 'number' }, description: 'frame time in seconds' }, { name: 'text', in: 'query', schema: { type: 'string' }, description: 'title overlay' }], responses: { '200': { description: 'jpeg bytes' } } } },
      '/v1/audio/speak': { post: { summary: 'Text to speech MP3', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, voice: { type: 'string', description: 'e.g. en-US-GuyNeural, ar-SA-HamedNeural' }, rate: { type: 'string', description: 'e.g. +10%' } } } } } }, responses: { '200': { description: 'audio/mpeg bytes' } } } },
      '/v1/pdf/generate': { post: { summary: 'Lesson PDF with vocalized Arabic + grammar sections', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['title', 'sections'], properties: { title: { type: 'string' }, subtitle: { type: 'string' }, footer: { type: 'string' }, sections: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, body: { type: 'string' } } } } } } } } }, responses: { '200': { description: 'application/pdf bytes' } } } },
      '/v1/presets': { get: { summary: 'List prompt presets (filter by ?category=)', responses: { '200': { description: 'ok' } } }, post: { summary: 'Create a prompt preset', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'prompt'], properties: { name: { type: 'string' }, category: { type: 'string' }, prompt: { type: 'string' }, params: { type: 'object' } } } } } }, responses: { '201': { description: 'created' } } } },
      '/v1/presets/{ref}': { get: { summary: 'Get one preset', parameters: [{ name: 'ref', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } }, delete: { summary: 'Delete a custom preset', parameters: [{ name: 'ref', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'deleted' } } } },
      '/v1/content/generate': { post: { summary: 'Generate shorts scripts, lessons, or social posts', responses: { '200': { description: 'ok' } } } },
      '/v1/workflows': { post: { summary: 'Run a multi-step generation workflow (image, speech, animate, content steps; outputs chain forward via {{stepId.field}})', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['steps'], properties: { name: { type: 'string' }, webhook: { type: 'string', description: 'https URL called on completion or failure' }, steps: { type: 'array', maxItems: 20, items: { type: 'object', required: ['action'], properties: { id: { type: 'string', description: 'reference id, default s1, s2... used in {{id.field}} templates' }, action: { type: 'string', enum: ['image', 'speech', 'animate', 'content'] }, params: { type: 'object', description: 'action-specific params; strings may embed {{stepId.field}} references to earlier outputs' } } } } } } } } }, responses: { '202': { description: 'workflow queued; poll /v1/workflows/{id}' } } } },
      '/v1/workflows/list': { get: { summary: 'List your recent workflows', responses: { '200': { description: 'ok' } } } },
      '/v1/portfolios': { post: { summary: 'Create an artist portfolio', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, description: { type: 'string' }, artist: { type: 'string' }, published: { type: 'boolean' } } } } } }, responses: { '201': { description: 'created' } } }, get: { summary: 'List your portfolios', responses: { '200': { description: 'ok' } } } },
      '/v1/portfolios/{id}': { get: { summary: 'Portfolio with artworks', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } }, patch: { summary: 'Update portfolio (publish with {"published": true})', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } }, delete: { summary: 'Delete portfolio and its artworks', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'deleted' } } } },
      '/v1/portfolios/{id}/artworks': { post: { summary: 'Add artwork — supply image_url, or generate with {generate: {prompt, preset, width, height, seed}}', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '201': { description: 'created' } } } },
      '/v1/portfolios/{id}/artworks/{aid}': { delete: { summary: 'Remove an artwork', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'aid', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'deleted' } } } },
      '/v1/games': { post: { summary: 'Create a game project', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, genre: { type: 'string' }, description: { type: 'string' } } } } } }, responses: { '201': { description: 'created' } } }, get: { summary: 'List your games', responses: { '200': { description: 'ok' } } } },
      '/v1/games/{id}': { get: { summary: 'Game with all scenes', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } }, patch: { summary: 'Update game (set start_scene)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } }, delete: { summary: 'Delete game and scenes', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'deleted' } } } },
      '/v1/games/{id}/scenes': { post: { summary: 'Add a narrative segment: title, narrative, choices [{label, target, outcome}]', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '201': { description: 'created' } } }, get: { summary: 'List scenes', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } },
      '/v1/games/{id}/scenes/{sid}': { patch: { summary: 'Update scene narrative/choices', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'sid', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } }, delete: { summary: 'Delete scene', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'sid', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'deleted' } } } },
      '/v1/games/{id}/scenes/{sid}/assets': { post: { summary: 'Generate scene art (prompt defaults from the scene narrative; metered)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'sid', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'art generated' } } } },
      '/v1/games/{id}/story-map': { get: { summary: 'Branch graph: nodes, edges, unresolved targets, unreachable scenes', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } },
      '/v1/classes': { post: { summary: 'Create a madrasa class (returns a 6-char join code)', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, teacher: { type: 'string' } } } } } }, responses: { '201': { description: 'created' } } }, get: { summary: 'List your classes with student counts', responses: { '200': { description: 'ok' } } } },
      '/v1/classes/{id}': { get: { summary: 'Class with student roster', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } }, patch: { summary: 'Update class', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } }, delete: { summary: 'Delete class, roster and progress', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'deleted' } } } },
      '/v1/classes/{id}/students': { post: { summary: 'Add a student', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '201': { description: 'created' } } } },
      '/v1/classes/{id}/students/{sid}': { delete: { summary: 'Remove a student and their progress', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'sid', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'deleted' } } } },
      '/v1/join': { post: { summary: 'Student joins a class by code + name (same name rejoins same student)', responses: { '200': { description: 'joined' } } } },
      '/v1/students/{sid}/progress': { post: { summary: 'Log one quiz answer (letter, correct) - free, never metered', parameters: [{ name: 'sid', in: 'path', required: true, schema: { type: 'string' } }], responses: { '201': { description: 'logged' } } } },
      '/v1/classes/{id}/report': { get: { summary: 'Class report: per-student accuracy, mastered/weak letters, per-letter detail', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } },
      '/v1/workflows/{id}': { get: { summary: 'Workflow status with per-step results', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } },
      '/v1/workflows/{id}/files/{name}': { get: { summary: 'Download a step output file', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'name', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'file bytes' } } } },
    },
    security: [{ ApiKeyAuth: [] }],
  });
});

// ---------- developer signup (same pattern as Ilm API) ----------
// Key minting is deliberately unauthenticated so developers can self-serve, but an
// unbounded loop can mint keys forever. Sliding window per client address, kept in
// memory (resets on restart, which is fine for an abuse brake rather than a quota).
const SIGNUP_RATE_LIMIT = parseInt(process.env.SIGNUP_RATE_LIMIT) || 5;
const SIGNUP_RATE_WINDOW_MS = parseInt(process.env.SIGNUP_RATE_WINDOW_MS) || 60 * 60 * 1000;
const signupLimiter = createSlidingWindowLimiter({
  limit: SIGNUP_RATE_LIMIT,
  windowMs: SIGNUP_RATE_WINDOW_MS
});

app.post('/v1/developers/signup', async (req, res) => {
  const email = (req.body && req.body.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (signupLimiter.isLimited(clientAddress(req))) {
    return res.status(429).json({
      error: 'Too many signups from this address. Try again later or email support.',
      limit: SIGNUP_RATE_LIMIT,
      window_ms: SIGNUP_RATE_WINDOW_MS
    });
  }
  const key = 'studio_' + crypto.randomBytes(24).toString('hex');
  memoryKeys.set(key, { email, created_at: new Date().toISOString() });
  try { await saveDeveloperKey(email, key); } catch (e) { console.error('key save failed:', e.message); }
  res.json({ message: 'API key created. Include it as the x-api-key header on every /v1 request.', key, created_at: new Date().toISOString() });
});

// ---------- auth middleware ----------
const METERED = ['/v1/masjid/answer', '/v1/image/generate', '/v1/video/render', '/v1/video/from-image', '/v1/video/image-to-video', '/v1/audio/speak', '/v1/content/generate', '/v1/pdf/generate', '/v1/workflows', '/v1/portfolios', '/v1/games', '/v1/classes'];

app.use('/v1', async (req, res, next) => {
  const key = req.headers['x-api-key'];
  try {
    if (await isValidKey(key)) {
      req.apiKey = key;
      if (req.method === 'POST' && METERED.includes(req.originalUrl.split('?')[0])) {
        const { month, used } = await getUsage(key);
        if (used >= FREE_MONTHLY_LIMIT) {
          return res.status(429).json({ error: 'Free monthly limit reached (' + FREE_MONTHLY_LIMIT + ' operations). Email support to upgrade.', month, limit: FREE_MONTHLY_LIMIT, used });
        }
        await incrUsage(key);
        res.setHeader('X-Usage-Limit', FREE_MONTHLY_LIMIT);
        res.setHeader('X-Usage-Remaining', Math.max(0, FREE_MONTHLY_LIMIT - used - 1));
      }
      return next();
    }
  } catch (e) {
    return res.status(500).json({ error: 'Auth check failed: ' + e.message });
  }
  res.status(401).json({ error: 'Missing or invalid API key (x-api-key header)' });
});

app.get('/v1/usage', async (req, res) => {
  const { month, used } = await getUsage(req.headers['x-api-key'] || '');
  res.json({ month, used, limit: FREE_MONTHLY_LIMIT, remaining: Math.max(0, FREE_MONTHLY_LIMIT - used) });
});

// Providers fail down silently by design, so /v1/health reports readiness.
const providerReadiness = () => buildReadiness({
  imageReady: cfReady,
  imageModel: CF_IMAGE_MODEL,
  replicateReady: !!process.env.REPLICATE_API_TOKEN,
  falReady: !!process.env.FAL_KEY,
  llmReady: !!process.env.GROQ_API_KEY,
  dbReady: !!process.env.DATABASE_URL,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || null
});

app.get('/v1/health', (req, res) => res.json({
  status: 'ok',
  service: 'studio-api',
  time: new Date().toISOString(),
  uptime_seconds: Math.round(process.uptime()),
  providers: providerReadiness()
}));

// ---------- image generation ----------
// Primary provider: Cloudflare Workers AI (set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN).
// Fallback: Pollinations (free, no key) so the service still answers without credentials.
const CF_ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const CF_API_TOKEN = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
const CF_IMAGE_MODEL = (process.env.CLOUDFLARE_IMAGE_MODEL || '@cf/black-forest-labs/flux-1-schnell').trim();
const cfReady = !!(CF_ACCOUNT_ID && CF_API_TOKEN);
let cfSeedAccepted = true; // flipped off the first time Cloudflare rejects the seed property
const memMedia = new Map(); // id -> { mime, bytes } (memory fallback when no DB)

function reqBase(req) {
  if (process.env.PUBLIC_BASE_URL) return String(process.env.PUBLIC_BASE_URL).replace(/\/+$/, '');
  const host = (req && req.get && req.get('host')) || ('localhost:' + PORT);
  return (String(host).indexOf('localhost') === 0 ? 'http://' : 'https://') + host;
}

async function mediaSave(buf, mime, prompt) {
  const id = crypto.randomUUID();
  if (pool && !dbBroken) {
    try {
      await pool.query('INSERT INTO media (id, key, mime, bytes, prompt, created_at) VALUES ($1,$2,$3,$4,$5,NOW())', [id, null, mime, buf, prompt || null]);
      return id;
    } catch (e) { console.error('media persist failed (memory fallback):', e.message); }
  }
  memMedia.set(id, { mime, bytes: buf });
  return id;
}

// Providers fetch images by URL and send no headers, so anything handed to
// them (a scene still, the last frame of a clip) has to be publicly readable.
// /v1/movie/:id/scenes/:idx/image is behind the API key and 401s for them,
// which silently pushed every scene onto the Ken Burns fallback.
async function publishImageForProvider(buf, movieBase, prompt) {
  const id = await mediaSave(buf, 'image/jpeg', prompt || null);
  const base = process.env.PUBLIC_BASE_URL ? String(process.env.PUBLIC_BASE_URL).replace(/\/+$/, '') : String(movieBase || '').replace(/\/+$/, '');
  return base + '/media/' + id;
}

// grabs the final frame of a rendered clip so the next scene can start there
async function lastFrameOfClip(clipPath, W, H) {
  const outPath = path.join(path.dirname(clipPath), 'lastframe-' + crypto.randomBytes(4).toString('hex') + '.jpg');
  await execFileAsync('ffmpeg', lastFrameArgs(clipPath, outPath, W, H), { timeout: 60000 });
  try {
    if (!fs.existsSync(outPath)) throw new Error('ffmpeg produced no frame');
    return fs.readFileSync(outPath);
  } finally {
    try { fs.unlinkSync(outPath); } catch (e) { /* best effort */ }
  }
}

// public media serving (no API key, outside the /v1 auth gate) — galleries embed these URLs directly
app.get('/media/:id', async (req, res) => {
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT mime, bytes FROM media WHERE id = $1', [req.params.id]);
      if (r.rowCount) {
        res.set('Content-Type', r.rows[0].mime || 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        return res.send(r.rows[0].bytes);
      }
    } catch (e) { console.error('media get failed:', e.message); }
  }
  const m = memMedia.get(req.params.id);
  if (m) { res.set('Content-Type', m.mime); res.set('Cache-Control', 'public, max-age=31536000, immutable'); return res.send(m.bytes); }
  res.status(404).json({ error: 'media not found' });
});

// public video serving (no API key) — the browser player needs a plain URL, and the
// finished MP4 already lives in VIDEOS_DIR/<jobId>/output.mp4
app.get('/media/video/:id', (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return res.status(400).json({ error: 'invalid video id' });
  const file = path.join(VIDEOS_DIR, id, 'output.mp4');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'video not ready' });
  const stat = fs.statSync(file);
  res.set('Content-Type', 'video/mp4');
  res.set('Cache-Control', 'public, max-age=3600');
  res.set('Accept-Ranges', 'bytes');
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (start >= stat.size) {
      res.set('Content-Range', `bytes */${stat.size}`);
      return res.status(416).end();
    }
    const stop = Math.min(end, stat.size - 1);
    res.status(206);
    res.set('Content-Range', `bytes ${start}-${stop}/${stat.size}`);
    res.set('Content-Length', String(stop - start + 1));
    return fs.createReadStream(file, { start, end: stop }).pipe(res);
  }
  res.set('Content-Length', String(stat.size));
  return fs.createReadStream(file).pipe(res);
});

// Cloudflare Workers AI: returns { buf, mime }
async function cfGenerateImage(basePrompt, seed) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_IMAGE_MODEL}`;
  const seedNum = (seed !== undefined && seed !== null && seed !== '' && Number.isFinite(parseInt(seed))) ? parseInt(seed) : null;
  const call = async (withSeed) => {
    const body = { prompt: String(basePrompt).slice(0, 2048), steps: 4 };
    if (withSeed && seedNum !== null) body.seed = seedNum;
    return fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + CF_API_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  };
  let resp = await call(cfSeedAccepted && seedNum !== null);
  // flux-1-schnell used to take a seed for cross-scene consistency and then
  // started rejecting the property outright ("/seed at '/' not allowed"), which
  // failed every scene image and left whole films `partial`. Probe once, then stop sending it.
  if (!resp.ok && resp.status === 400 && cfSeedAccepted && seedNum !== null) {
    const probe = await resp.clone().text().catch(() => '');
    if (/seed/i.test(probe)) {
      cfSeedAccepted = false;
      resp = await call(false);
    }
  }
  if (!resp.ok) {
    let detail = '';
    try { detail = (await resp.text()).slice(0, 300); } catch (e) {}
    const err = new Error('Cloudflare Workers AI failed: ' + resp.status + ' ' + detail);
    err.status = resp.status;
    throw err;
  }
  const ct = resp.headers.get('content-type') || '';
  if (ct.indexOf('json') !== -1) {
    const data = await resp.json();
    const b64 = data.image || (data.result && data.result.image);
    if (!b64) throw new Error('Cloudflare Workers AI returned no image data');
    return { buf: Buffer.from(b64, 'base64'), mime: 'image/jpeg' };
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  if (!buf.length) throw new Error('Cloudflare Workers AI returned an empty image');
  return { buf, mime: ct || 'image/jpeg' };
}

// unified image generation — used by /v1/image/generate, workflows, portfolios, and games
async function generateImage(opts) {
  let basePrompt = (typeof opts.prompt === 'string') ? opts.prompt : '';
  let resolved = null;
  if (opts.preset) {
    resolved = await findPreset(String(opts.preset));
    if (!resolved) { const e = new Error('preset not found: ' + opts.preset); e.presetNotFound = true; throw e; }
    basePrompt = basePrompt ? resolved.prompt + ', ' + basePrompt : resolved.prompt;
  }
  if (!basePrompt) throw new Error('prompt or preset is required');
  const w = Math.min(Math.max(parseInt(opts.width) || (resolved && resolved.params && resolved.params.width) || 1024, 256), 1920);
  const h = Math.min(Math.max(parseInt(opts.height) || (resolved && resolved.params && resolved.params.height) || 1024, 256), 1920);
  const base = (opts.baseUrl || process.env.PUBLIC_BASE_URL || ('http://localhost:' + PORT)).replace(/\/+$/, '');
  if (cfReady) {
    const { buf, mime } = await cfGenerateImage(basePrompt, opts.seed);
    const id = await mediaSave(buf, mime, basePrompt);
    return { url: base + '/media/' + id, prompt: basePrompt, preset: resolved ? resolved.name : null, width: 1024, height: 1024, provider: 'cloudflare' };
  }
  // fallback (free, no key): Pollinations URL serves the image directly
  const params = new URLSearchParams({ width: String(w), height: String(h), nologo: 'true' });
  if (opts.model) params.set('model', String(opts.model));
  if (opts.seed) params.set('seed', String(opts.seed));
  return { url: `https://image.pollinations.ai/prompt/${encodeURIComponent(basePrompt)}?${params}`, prompt: basePrompt, preset: resolved ? resolved.name : null, width: w, height: h, provider: 'pollinations' };
}

app.post('/v1/image/generate', async (req, res) => {
  const { prompt, preset, width, height, model, seed } = req.body || {};
  try {
    const out = await generateImage({ prompt, preset, width, height, model, seed, baseUrl: reqBase(req) });
    res.json({ ...out, note: out.provider === 'cloudflare' ? 'Generated via Cloudflare Workers AI; URL serves the stored image' : 'URL serves the generated image directly' });
  } catch (e) {
    res.status(e.presetNotFound ? 404 : 400).json({ error: e.message });
  }
});

// ---------- video rendering ----------
// POST /v1/video/render { title?, width?, height?, fps?, scenes: [{image?, text?, duration?}] }
// Renders a Ken Burns-style MP4 from scene images (URLs) and/or text cards.
const jobs = new Map(); // id -> { status, progress, error, videoId }

async function downloadImage(url, dest) {
  // The image provider occasionally 500s under load; retry with backoff.
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 StudioAPI/1.0' } });
      if (!resp.ok) throw new Error('image download failed: ' + resp.status);
      const buf = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(dest, buf);
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise(r => setTimeout(r, (attempt + 1) * 4000));
    }
  }
  throw lastErr;
}

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf';

function escDrawtext(text) {
  // escape for ffmpeg drawtext
  return String(text).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\u2019").replace(/%/g, '\\%').replace(/(\r?\n)/g, ' ');
}

function buildSceneFilter(scene, W, H, FPS) {
  // base: image file or color background
  const dur = Math.max(1, Math.min(parseFloat(scene.duration) || 4, 30));
  const parts = [];
  if (scene.text && scene.text.trim()) {
    const size = Math.max(28, Math.round(W / 18));
    parts.push(`drawtext=fontfile=${FONT}:text='${escDrawtext(scene.text)}':fontcolor=#F3ECDA:fontsize=${size}:line_spacing=${Math.round(size * 0.5)}:x=(w-text_w)/2:y=h*0.72:box=1:boxcolor=#0E2A2B@0.65:boxborderw=24`);
  }
  return { dur, parts };
}

app.post('/v1/video/render', async (req, res) => {
  const { title, width, height, fps } = req.body || {};
  const scenes = Array.isArray(req.body && req.body.scenes) ? req.body.scenes : null;
  if (!scenes || scenes.length === 0) return res.status(400).json({ error: 'scenes array with at least one scene is required' });
  if (scenes.length > 60) return res.status(400).json({ error: 'too many scenes (max 60)' });

  // Orientation: default vertical 1080x1920 (Shorts/WhatsApp). width 1920 or 1280 -> widescreen 1280x720.
  const isWidescreen = width === 1920 || width === 1280;
  const W = isWidescreen ? 1280 : 1080;
  const H = isWidescreen ? 720 : 1920;
  const FPS = Math.min(Math.max(parseInt(fps) || 30, 12), 30);
  const jobId = crypto.randomUUID();
  const hook = (req.body && /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1))/.test(String(req.body.webhook || ''))) ? String(req.body.webhook) : null;
  jobs.set(jobId, { status: 'queued', progress: 0, error: null, videoId: null, createdAt: Date.now(), webhook: hook, baseUrl: 'https://' + req.get('host') });

  const hasNarration = scenes.some(sc => sc.narration && String(sc.narration).trim());
  const reqSubtitles = !!(req.body && req.body.subtitles);

  // async render
  (async () => {
    const jobDir = path.join(VIDEOS_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    try {
      // ---- narrated build: one audio-muxed segment per scene, then concat ----
      if (hasNarration) {
        const segFiles = [];
        const CAP_FONT = fs.existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf') ? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' : FONT;
        const captionFilters = (narrText) => {
          const size = Math.max(30, Math.round(W / 22));
          const maxChars = Math.floor((W - 140) / (size * 0.55));
          const words = String(narrText).trim().split(/\s+/);
          const lines = [];
          let cur = '';
          for (const w of words) {
            const t = cur ? cur + ' ' + w : w;
            if (t.length > maxChars && cur) { lines.push(cur); cur = w; } else cur = t;
          }
          if (cur) lines.push(cur);
          const shown = lines.slice(0, 3).map(l => escDrawtext(l));
          const out = [];
          shown.forEach((ln, idx) => {
            const y = 'h*0.88-' + Math.round((shown.length - 1 - idx) * size * 1.4);
            out.push('drawtext=fontfile=' + CAP_FONT + ':text=\'' + ln + '\':fontcolor=white:fontsize=' + size + ':x=(w-text_w)/2:y=' + y + ':box=1:boxcolor=black@0.55:boxborderw=14');
          });
          return out;
        };
        for (let i = 0; i < scenes.length; i++) {
          const sc = scenes[i];
          if (!sc.image && !sc.text) throw new Error('scene ' + (i + 1) + ': needs image or text');
          let dur = Math.max(1, Math.min(parseFloat(sc.duration) || 4, 30));
          let narrPath = null;
          if (sc.narration && String(sc.narration).trim()) {
            narrPath = path.join(jobDir, 'narr' + i + '.mp3');
            await speakText(sc.narration, sc.voice, sc.rate, narrPath);
            const ad = await mediaDuration(narrPath);
            dur = Math.max(dur, Math.min(ad + 0.8, 60));
          }
          const parts = [];
          const vf = ['scale=' + W * 1.5 + ':' + H * 1.5 + ':force_original_aspect_ratio=increase', 'crop=' + W * 1.5 + ':' + H * 1.5];
          let baseInput;
          if (sc.image) {
            const imgPath = path.join(jobDir, 'scene' + i + '.img');
            await downloadImage(sc.image, imgPath);
            baseInput = ['-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', imgPath];
          } else {
            baseInput = ['-f', 'lavfi', '-t', String(dur), '-i', 'color=c=0x0E2A2B:s=' + W + 'x' + H + ':r=' + FPS];
          }
          if (sc.text && String(sc.text).trim()) {
            const size = Math.max(28, Math.round(W / 18));
            parts.push('drawtext=fontfile=' + FONT + ":text='" + escDrawtext(sc.text) + "':fontcolor=#F3ECDA:fontsize=" + size + ':line_spacing=' + Math.round(size * 0.5) + ':x=(w-text_w)/2:y=h*0.72:box=1:boxcolor=#0E2A2B@0.65:boxborderw=24');
          }
          if (narrPath && (sc.subtitles !== undefined ? !!sc.subtitles : reqSubtitles)) {
            parts.push(...captionFilters(sc.narration));
          }
          parts.push("zoompan=z='min(1+0.0006*in,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=" + W + 'x' + H + ':fps=' + FPS, 'format=yuv420p');
          const seg = path.join(jobDir, 'seg' + i + '.mp4');
          const args = ['-y', ...baseInput];
          const vfFull = (sc.image ? vf.join(',') + ',' : '') + parts.join(',');
          if (narrPath) {
            args.push('-i', narrPath, '-vf', vfFull, '-t', String(dur), '-af', 'apad', '-threads', '1', '-filter_threads', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-x264-params', 'rc-lookahead=0:ref=1', '-c:a', 'aac', '-b:a', '128k', '-shortest', seg);
          } else {
            args.push('-vf', vfFull, '-t', String(dur), '-threads', '1', '-filter_threads', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-x264-params', 'rc-lookahead=0:ref=1', seg);
          }
          await execFileAsync('ffmpeg', args, { maxBuffer: 1024 * 1024 * 10, timeout: 10 * 60 * 1000 });
          segFiles.push(seg);
          jobs.get(jobId).progress = Math.round(((i + 1) / scenes.length) * 85);
        }
        const listPath = path.join(jobDir, 'list.txt');
        fs.writeFileSync(listPath, segFiles.map(f => "file '" + f.replace(/'/g, "'\''") + "'").join('\n'));
        const outPath = path.join(jobDir, 'output.mp4');
        const hasAudio = segFiles.length > 0 && scenes.some(sc => sc.narration && String(sc.narration).trim());
        await execFileAsync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath], { maxBuffer: 1024 * 1024 * 10, timeout: 10 * 60 * 1000 });
        jobs.get(jobId).status = 'done';
        jobs.get(jobId).progress = 100;
        jobs.get(jobId).videoId = jobId;
        fireWebhook(jobs.get(jobId));
        return;
      }
      const inputs = [];
      const filters = [];
      const concatLabels = [];
      for (let i = 0; i < scenes.length; i++) {
        const sc = scenes[i];
        if (!sc.image && !sc.text) throw new Error(`scene ${i + 1}: needs image or text`);
        const { dur, parts } = buildSceneFilter(sc, W, H, FPS);
        const ext = [];
        if (sc.image) {
          const imgPath = path.join(jobDir, `scene${i}.img`);
          await downloadImage(sc.image, imgPath);
          inputs.push('-loop', '1', '-t', String(dur), '-i', imgPath);
          ext.push('scale=' + W * 1.1 + ':' + H * 1.1 + ':force_original_aspect_ratio=increase', 'crop=' + W + ':' + H);
        } else {
          inputs.push('-f', 'lavfi', '-t', String(dur), '-i', `color=c=0x0E2A2B:s=${W}x${H}:r=${FPS}`);
        }
        ext.push(...parts);
        ext.push(`zoompan=z='1+0.0005*in':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}`, 'format=yuv420p', `trim=duration=${dur}`, 'setpts=PTS-STARTPTS');
        filters.push(`[${i}:v]${ext.join(',')}[v${i}]`);
        concatLabels.push(`[v${i}]`);
        jobs.get(jobId).progress = Math.round(((i + 1) / scenes.length) * 80);
      }
      const fc = filters.join(';') + ';' + concatLabels.join('') + `concat=n=${scenes.length}:v=1:a=0[outv]`;
      const outPath = path.join(jobDir, 'output.mp4');
      const inputArgs = [];
      for (let i = 0; i < inputs.length; i += 2) inputArgs.push(inputs[i], inputs[i + 1]);
      const args = ['-y'];
      args.push(...inputArgs, '-filter_complex', fc, '-map', '[outv]', '-threads', '1', '-filter_threads', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-x264-params', 'rc-lookahead=0:ref=1', '-pix_fmt', 'yuv420p', '-r', String(FPS), outPath);
      await execFileAsync('ffmpeg', args, { maxBuffer: 1024 * 1024 * 10, timeout: 10 * 60 * 1000 });
      const videoId = jobId;
      jobs.get(jobId).status = 'done';
      jobs.get(jobId).progress = 100;
      jobs.get(jobId).videoId = videoId;
      fireWebhook(jobs.get(jobId));
    } catch (e) {
      jobs.get(jobId).status = 'failed';
      jobs.get(jobId).error = e.message;
      fireWebhook(jobs.get(jobId));
    }
  })();

  res.status(202).json({ job_id: jobId, status_url: `/v1/video/status/${jobId}`, video_url: `/v1/video/file/${jobId}` });
});

// ---------- image -> video (Ken Burns) ----------
const KB_EFFECTS = ['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'static'];
app.post('/v1/video/from-image', async (req, res) => {
  const b = req.body || {};
  const imageUrl = b.image_url || b.image;
  if (!imageUrl || !/^https:\/\//.test(String(imageUrl))) return res.status(400).json({ error: 'https image_url is required' });
  const duration = Math.min(Math.max(parseFloat(b.duration) || 8, 2), 30);
  const effect = KB_EFFECTS.includes(b.effect) ? b.effect : 'zoom_in';
  const isWide = b.aspect === 'wide' || b.aspect === 'landscape';
  const W = isWide ? 1280 : 1080, H = isWide ? 720 : 1920;
  const FPS = 30;
  const caption = (b.text && String(b.text).trim()) ? String(b.text).trim() : null;
  const jobId = crypto.randomUUID();
  const hook = (req.body && /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1))/.test(String(req.body.webhook || ''))) ? String(req.body.webhook) : null;
  jobs.set(jobId, { status: 'queued', progress: 10, error: null, videoId: null, createdAt: Date.now(), webhook: hook, baseUrl: 'https://' + req.get('host') });
  (async () => {
    const jobDir = path.join(VIDEOS_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    try {
      const imgPath = path.join(jobDir, 'source.img');
      await downloadImage(imageUrl, imgPath);
      jobs.get(jobId).progress = 40;
      const N = Math.round(duration * FPS);
      let z, x, y;
      switch (effect) {
        case 'zoom_out': z = 'max(1.25-' + (0.25 / N).toFixed(6) + '*in,1.0)'; x = 'iw/2-(iw/zoom/2)'; y = 'ih/2-(ih/zoom/2)'; break;
        case 'pan_left': z = '1.25'; x = '(iw-iw/zoom)*max(1-in/' + N + ',0)'; y = 'ih/2-(ih/zoom/2)'; break;
        case 'pan_right': z = '1.25'; x = '(iw-iw/zoom)*min(in/' + N + ',1)'; y = 'ih/2-(ih/zoom/2)'; break;
        case 'static': z = '1'; x = '0'; y = '0'; break;
        default: z = 'min(1+' + (0.25 / N).toFixed(6) + '*in,1.25)'; x = 'iw/2-(iw/zoom/2)'; y = 'ih/2-(ih/zoom/2)';
      }
      const parts = [
        'scale=' + Math.round(W * 1.5) + ':' + Math.round(H * 1.5) + ':force_original_aspect_ratio=increase',
        'crop=' + Math.round(W * 1.5) + ':' + Math.round(H * 1.5)
      ];
      if (effect === 'static') {
        parts.push('scale=' + W + ':' + H);
      } else {
        parts.push("zoompan=z='" + z + "':x='" + x + "':y='" + y + "':d=1:s=" + W + 'x' + H + ':fps=' + FPS);
      }
      if (caption) {
        const size = Math.max(28, Math.round(W / 18));
        parts.push('drawtext=fontfile=' + FONT + ":text='" + escDrawtext(caption) + "':fontcolor=#F3ECDA:fontsize=" + size + ':line_spacing=' + Math.round(size * 0.5) + ':x=(w-text_w)/2:y=h*0.72:box=1:boxcolor=#0E2A2B@0.65:boxborderw=24');
      }
      parts.push('format=yuv420p');
      const args = ['-y', '-threads', '1', '-filter_threads', '1', '-loop', '1', '-framerate', String(FPS), '-t', String(duration), '-i', imgPath,
        '-vf', parts.join(','), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-x264-params', 'rc-lookahead=0:ref=1', '-pix_fmt', 'yuv420p',
        path.join(jobDir, 'output.mp4')];
      await execFileAsync('ffmpeg', args, { maxBuffer: 1024 * 1024 * 10, timeout: 10 * 60 * 1000 });
      jobs.get(jobId).status = 'done';
      jobs.get(jobId).progress = 100;
      jobs.get(jobId).videoId = jobId;
    } catch (e) {
      jobs.get(jobId).status = 'failed';
      jobs.get(jobId).error = e.message;
      fireWebhook(jobs.get(jobId));
    }
  })();
  res.status(202).json({ job_id: jobId, effect, duration, status_url: '/v1/video/status/' + jobId, video_url: '/v1/video/file/' + jobId });
});

function fireWebhook(job) {
  if (!job || !job.webhook) return;
  const payload = { event: job.status === 'done' ? 'render.completed' : 'render.failed', job_id: job.videoId || job.jobId, status: job.status, error: job.error || null, video_url: job.status === 'done' ? job.baseUrl + '/v1/video/file/' + job.videoId : null };
  fetch(job.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    .catch(e => console.error('webhook delivery failed:', e.message));
}

// ---------- Phase E: real image-to-video (true motion footage) ----------
// Unlike /v1/video/from-image (Ken Burns pans over stills), these models
// generate REAL motion: characters walk, cloth moves, smoke drifts.
// Requires REPLICATE_API_TOKEN or FAL_KEY (set in Render dashboard env).
// Premium provider costs are paid on YOUR provider account, not metered here
// beyond the normal 1-op free-tier metering.

const I2V_STYLES = {
  dark_fantasy_african: { label: 'African dark fantasy epic (Maker-of-Zulu style)', suffix: 'epic African dark fantasy movie scene, godly scale, dramatic moody lighting, drifting smoke and embers, deep shadows, ultra detailed, cinematic', negative: 'cartoon, anime, flat lighting, text, watermark' },
  cinematic_epic: { label: 'Photoreal cinematic epic', suffix: 'photorealistic cinematic film shot, shot on 70mm, shallow depth of field, dramatic lighting, subtle camera drift, film grain', negative: 'cartoon, anime, illustration, text, watermark' },
  anime: { label: 'Anime', suffix: 'anime film scene, hand-drawn cinematic animation, expressive motion, vivid colors, studio quality', negative: 'photorealistic, live action, text, watermark' },
  ghanaian_folktale: { label: 'Ghanaian folktale', suffix: 'West African village folktale scene, warm firelight, kente patterns, dust motes, gentle mystical atmosphere, cinematic', negative: 'text, watermark, modern city' },
  documentary: { label: 'Documentary realism', suffix: 'observational documentary footage, handheld camera, natural light, realistic everyday motion', negative: 'fantasy, stylized, text, watermark' },
  cartoon_3d: { label: '3D cartoon (Pixar-like)', suffix: 'polished 3D animated movie still brought to life, soft rim lighting, squash-and-stretch motion, vibrant', negative: 'photorealistic, horror, text, watermark' },
  horror: { label: 'Horror', suffix: 'dark horror movie scene, dread atmosphere, flickering light, slow creeping motion, fog', negative: 'cute, bright, cheerful, text, watermark' },
  action: { label: 'Action blockbuster', suffix: 'high-energy action movie shot, dynamic camera move, motion blur, explosive atmosphere', negative: 'static, slow, dull, text, watermark' },
  nature: { label: 'Nature / wildlife', suffix: 'breathtaking wildlife documentary shot, golden hour, animals moving naturally, 4K nature film', negative: 'text, watermark, cartoon' },
  dreamlike: { label: 'Dreamlike / spiritual', suffix: 'ethereal dreamlike scene, floating particles, soft glow, slow graceful motion, otherworldly', negative: 'harsh, gritty, text, watermark' }
};

// Model registry: tried in order until one accepts the job (some model ids
// change over time; 404/410/422 on one falls through to the next).
// Slugs and input shapes are checked against each model's published Replicate
// schema. Three things break a model silently, so get them right:
//   1. the slug must exist (a stale slug answers 404, not 400)
//   2. duration is an INTEGER enum, not a string
//   3. the first frame field is named differently by every model
const I2V_MODELS = [
  { key: 'kling', provider: 'replicate', model: 'kwaivgi/kling-v2.5-turbo-pro', build: (image, prompt, dur) => ({ prompt, start_image: image, duration: dur >= 10 ? 10 : 5 }) },
  { key: 'hailuo', provider: 'replicate', model: 'minimax/hailuo-02', build: (image, prompt, dur) => ({ prompt, first_frame_image: image, duration: dur >= 10 ? 10 : 6, resolution: dur >= 10 ? '768p' : '1080p' }) },
  // wan has no duration input: it renders num_frames at frames_per_second (16 by default), max 121 frames
  { key: 'wan', provider: 'replicate', model: 'wan-video/wan-2.2-i2v-fast', build: (image, prompt, dur) => ({ prompt, image, resolution: '720p', num_frames: dur >= 10 ? 121 : 81 }) },
  { key: 'kling', provider: 'fal', model: 'fal-ai/kling-video/v2.5-master/image-to-video', build: (image, prompt, dur) => ({ image_url: image, prompt, duration: dur >= 10 ? '10' : '5' }) },
  { key: 'hailuo', provider: 'fal', model: 'fal-ai/minimax/hailuo-02/standard/image-to-video', build: (image, prompt, dur) => ({ image_url: image, prompt }) },
  { key: 'wan', provider: 'fal', model: 'fal-ai/wan-i2i', build: (image, prompt, dur) => ({ image_url: image, prompt }) }
];
const I2V_DEFAULT_ORDER = process.env.I2V_MODEL ? [process.env.I2V_MODEL] : ['kling', 'hailuo', 'wan'];

function i2vProviderKey(provider) {
  return provider === 'fal' ? process.env.FAL_KEY : process.env.REPLICATE_API_TOKEN;
}

// An account holding less than $5 of Replicate credit is throttled to 6
// prediction creates per minute with a burst of 1, so the second model in a
// fallback chain is answered with a 429 that says nothing about the model
// itself. Back off and retry the same model instead of blaming it.
async function replicateStart(entry, input, attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    const resp = await fetch('https://api.replicate.com/v1/models/' + entry.model + '/predictions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.REPLICATE_API_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input })
    });
    const body = await resp.json().catch(() => ({}));
    if (resp.ok) return body;
    const e = new Error('replicate start failed ' + resp.status + ': ' + (body.detail || body.error || ''));
    e.status = resp.status;
    lastErr = e;
    if (resp.status !== 429 || i === attempts - 1) throw e;
    const detail = String(body.detail || '');
    const reset = detail.match(/resets? in ~?(\d+)s/i);
    const waitMs = Math.min(((reset ? parseInt(reset[1], 10) : 10) + 2) * 1000, 65000);
    console.log('replicate throttled creating a prediction, retry ' + (i + 1) + '/' + (attempts - 1) + ' in ' + Math.round(waitMs / 1000) + 's');
    await new Promise(r => setTimeout(r, waitMs));
  }
  throw lastErr;
}

async function replicatePoll(pred) {
  const r = await fetch(pred.urls.get, { headers: { Authorization: 'Bearer ' + process.env.REPLICATE_API_TOKEN } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error('replicate poll failed ' + r.status); e.status = r.status; throw e; }
  return body;
}

async function falStart(entry, input) {
  const resp = await fetch('https://queue.fal.run/' + entry.model, {
    method: 'POST',
    headers: { Authorization: 'Key ' + process.env.FAL_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) { const e = new Error('fal start failed ' + resp.status + ': ' + (body.detail || body.error || '')); e.status = resp.status; throw e; }
  return body;
}

async function falResult(q) {
  // poll queue status then fetch response
  for (let i = 0; i < 140; i++) {
    const r = await fetch(q.status_url, { headers: { Authorization: 'Key ' + process.env.FAL_KEY } });
    const st = await r.json().catch(() => ({}));
    if (st.status === 'COMPLETED') break;
    if (st.status === 'FAILED') throw new Error('fal job failed');
    await new Promise(rs => setTimeout(rs, 5000));
  }
  const r2 = await fetch(q.response_url, { headers: { Authorization: 'Key ' + process.env.FAL_KEY } });
  return r2.json();
}

function extractVideoUrl(output) {
  if (!output) return null;
  if (typeof output === 'string' && /^https?:\/\//.test(output)) return output;
  if (Array.isArray(output)) { for (const o of output) { const u = extractVideoUrl(o); if (u) return u; } return null; }
  if (typeof output === 'object') return extractVideoUrl(output.url || output.video || (output.output && output.output.url));
  return null;
}

async function downloadVideoToDisk(url, dest) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('video download failed: ' + resp.status);
  const ws = fs.createWriteStream(dest);
  const reader = resp.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      ws.write(Buffer.from(value));
    }
  } finally { ws.end(); }
  await new Promise((res, rej) => { ws.on('finish', res); ws.on('error', rej); });
}

app.get('/v1/video/styles', (req, res) => {
  const styles = {};
  for (const [k, v] of Object.entries(I2V_STYLES)) styles[k] = v.label;
  res.json({ styles, models: I2V_DEFAULT_ORDER, custom_prompt: 'pass any style as free text in `prompt`', providers: { replicate: !!process.env.REPLICATE_API_TOKEN, fal: !!process.env.FAL_KEY } });
});

app.post('/v1/video/image-to-video', async (req, res) => {
  const b = req.body || {};
  const imageUrl = b.image_url || b.image;
  if (!imageUrl || !/^https:\/\//.test(String(imageUrl))) return res.status(400).json({ error: 'https image_url is required' });
  const duration = Math.min(Math.max(parseFloat(b.duration) || 5, 2), 10);
  const styleKey = b.style ? String(b.style) : (b.preset ? String(b.preset) : null);
  let style = null;
  if (styleKey) {
    if (!I2V_STYLES[styleKey]) return res.status(400).json({ error: 'unknown style: ' + styleKey, available: Object.keys(I2V_STYLES) });
    style = I2V_STYLES[styleKey];
  }
  const userPrompt = (typeof b.prompt === 'string') ? b.prompt.trim() : '';
  if (!styleKey && !userPrompt) return res.status(400).json({ error: 'style or prompt is required', available_styles: Object.keys(I2V_STYLES) });
  let motion = (typeof b.motion === 'string') ? b.motion.trim() : ''; // optional camera/subject direction
  let prompt = userPrompt;
  if (style) prompt = prompt ? prompt + ', ' + style.suffix : style.suffix;
  if (motion) prompt += '. ' + motion;

  const providers = [];
  if (process.env.REPLICATE_API_TOKEN) providers.push('replicate');
  if (process.env.FAL_KEY) providers.push('fal');
  if (!providers.length) return res.status(503).json({
    error: 'Image-to-video is not configured yet. Add REPLICATE_API_TOKEN (replicate.com/account/api-tokens) or FAL_KEY (fal.ai) as an environment variable in your Render dashboard, then redeploy.',
    how_to: ['Render Dashboard -> studio-api -> Environment -> Add Environment Variable REPLICATE_API_TOKEN', 'Manual Deploy -> Deploy latest commit', 'Provider credit is pre-paid on your replicate/fal.ai account (roughly $0.03-0.30 per second of video)']
  });

  // model preference: b.model (key), b.provider, then default order filtered to configured providers
  let candidates = I2V_MODELS.filter(m => providers.includes(m.provider));
  if (b.model || b.provider) {
    const want = String(b.model || '').toLowerCase();
    const pref = String(b.provider || '').toLowerCase();
    candidates = I2V_MODELS.filter(m =>
      (!pref || m.provider === pref) && (!want || m.key === want) && providers.includes(m.provider));
    if (!candidates.length) return res.status(400).json({ error: 'no configured model matches model/provider', configured_providers: providers });
  }
  if (!candidates.length) return res.status(503).json({ error: 'no image-to-video model available for configured providers', configured_providers: providers });

  const jobId = crypto.randomUUID();
  const hook = (req.body && /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1))/.test(String(req.body.webhook || ''))) ? String(req.body.webhook) : null;
  jobs.set(jobId, { status: 'queued', progress: 10, error: null, videoId: null, createdAt: Date.now(), webhook: hook, baseUrl: 'https://' + req.get('host'), i2v: true });
  (async () => {
    const jobDir = path.join(VIDEOS_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    const job = jobs.get(jobId);
    try {
      let videoUrl = null, usedModel = null, lastErr = null;
      for (const entry of candidates) {
        try {
          job.progress = 30; job.status = 'processing';
          if (entry.provider === 'replicate') {
            const pred = await replicateStart(entry, entry.build(imageUrl, prompt, duration));
            for (let i = 0; i < 150; i++) {
              const st = await replicatePoll(pred);
              if (st.status === 'succeeded') { videoUrl = extractVideoUrl(st.output); break; }
              if (st.status === 'failed' || st.status === 'canceled') throw new Error('prediction failed: ' + (st.error || 'unknown'));
              job.progress = Math.min(90, 30 + Math.round(60 * (i / 100)));
              await new Promise(rs => setTimeout(rs, 5000));
            }
          } else {
            const q = await falStart(entry, entry.build(imageUrl, prompt, duration));
            const result = await falResult(q);
            videoUrl = extractVideoUrl(result);
          }
          if (!videoUrl) throw new Error('provider returned no video URL');
          usedModel = entry.provider + ':' + entry.model;
          break;
        } catch (e) {
          lastErr = e;
          console.error('i2v attempt failed (' + entry.provider + '/' + entry.model + '):', e.message);
          const retryable = ![401, 402, 403].includes(e.status); // auth/billing errors won't fix by switching model
          if (!retryable) break;
        }
      }
      if (!videoUrl) throw new Error(lastErr ? lastErr.message : 'all models failed');
      job.progress = 95;
      await downloadVideoToDisk(videoUrl, path.join(jobDir, 'output.mp4'));
      job.status = 'done'; job.progress = 100; job.videoId = jobId; job.model = usedModel;
    } catch (e) {
      job.status = 'failed'; job.error = e.message;
    }
    fireWebhook(jobs.get(jobId));
  })();
  res.status(202).json({ job_id: jobId, style: styleKey, prompt, duration, models_tried: candidates.map(c => c.provider + ':' + c.model), status_url: '/v1/video/status/' + jobId, video_url: '/v1/video/file/' + jobId });
});

// ---------- text -> pdf (lesson sheets with Arabic + grammar) ----------
app.post('/v1/pdf/generate', async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const sections = Array.isArray(b.sections) ? b.sections : [];
  if (!title) return res.status(400).json({ error: 'title is required' });
  if (!sections.length) return res.status(400).json({ error: 'sections array with at least one section is required' });
  if (sections.length > 40) return res.status(400).json({ error: 'too many sections (max 40)' });
  const clean = sections.map(s => ({ heading: String((s && s.heading) || '').slice(0, 200), body: String((s && s.body) || '').slice(0, 8000) }));
  const spec = { title: title.slice(0, 200), subtitle: String(b.subtitle || '').slice(0, 200), footer: String(b.footer || '').slice(0, 200), sections: clean };
  const specPath = path.join(os.tmpdir(), 'pdf-' + crypto.randomUUID() + '.json');
  const outPath = path.join(os.tmpdir(), 'pdf-' + crypto.randomUUID() + '.pdf');
  try {
    fs.writeFileSync(specPath, JSON.stringify(spec));
    await execFileAsync('python3', [path.join(__dirname, 'scripts', 'make_pdf.py'), specPath, outPath], { timeout: 120000, maxBuffer: 1024 * 1024 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="lesson.pdf"');
    const stream = fs.createReadStream(outPath);
    stream.on('close', () => { try { fs.unlinkSync(specPath); fs.unlinkSync(outPath); } catch (e) {} });
    stream.pipe(res);
  } catch (e) {
    try { fs.unlinkSync(specPath); fs.unlinkSync(outPath); } catch (e2) {}
    res.status(500).json({ error: 'PDF generation failed: ' + e.message });
  }
});

// ---------- text -> speech ----------
const VOICE_RE = /^[a-z]{2,4}-[A-Z]{2}-[A-Za-z]+$/;
const DEFAULT_VOICE = 'en-US-GuyNeural';

async function speakText(text, voice, rate, outPath) {
  const v = VOICE_RE.test(String(voice || '')) ? String(voice) : DEFAULT_VOICE;
  const r = /^-?\d+%$/.test(String(rate || '')) ? String(rate) : '+0%';
  await execFileAsync('edge-tts', ['--voice', v, '--rate=' + r, '--text', String(text).slice(0, 2000), '--write-media', outPath], { timeout: 120000, maxBuffer: 1024 * 1024 });
}

async function mediaDuration(p) {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], { timeout: 60000 });
  return parseFloat(stdout.trim()) || 0;
}

app.post('/v1/audio/speak', async (req, res) => {
  const b = req.body || {};
  const text = String(b.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (text.length > 2000) return res.status(400).json({ error: 'text too long (max 2000 chars)' });
  const voice = VOICE_RE.test(String(b.voice || '')) ? String(b.voice) : DEFAULT_VOICE;
  const tmp = path.join(os.tmpdir(), 'speak-' + crypto.randomUUID() + '.mp3');
  try {
    await speakText(text, b.voice, b.rate, tmp);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="speech.mp3"');
    const stream = fs.createReadStream(tmp);
    stream.on('close', () => { try { fs.unlinkSync(tmp); } catch (e) {} });
    stream.pipe(res);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) {}
    res.status(500).json({ error: 'speech generation failed: ' + e.message });
  }
});

app.get('/v1/video/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json({ status: job.status, progress: job.progress, error: job.error, model: job.model || null, video_url: job.status === 'done' ? `/v1/video/file/${job.videoId}` : null });
});

app.get('/v1/video/file/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'done') return res.status(404).json({ error: 'video not ready or not found' });
  const p = path.join(VIDEOS_DIR, req.params.id, 'output.mp4');
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'video file missing' });
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="studio-${req.params.id.slice(0, 8)}.mp4"`);
  fs.createReadStream(p).pipe(res);
});
app.get('/v1/video/thumbnail/:id', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'done') return res.status(404).json({ error: 'video not ready or not found' });
  const p = path.join(VIDEOS_DIR, req.params.id, 'output.mp4');
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'video file missing' });
  const at = Math.min(Math.max(parseFloat(req.query.at) || 1, 0), 600);
  const title = String(req.query.text || '').slice(0, 80);
  const outPath = path.join(VIDEOS_DIR, req.params.id, 'thumb.jpg');
  try {
    const vf = title ? ["drawtext=fontfile=" + FONT + ":text='" + escDrawtext(title) + "':fontcolor=#F3ECDA:fontsize=72:x=(w-text_w)/2:y=h*0.3:box=1:boxcolor=#0E2A2B@0.7:boxborderw=28"] : [];
    await execFileAsync('ffmpeg', ['-y', '-ss', String(at), '-i', p, '-frames:v', '1', '-vf', (vf.length ? vf.join(',') + ',' : '') + 'scale=1080:-2', '-q:v', '3', outPath], { timeout: 60000 });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="thumbnail.jpg"');
    fs.createReadStream(outPath).pipe(res);
  } catch (e) {
    res.status(500).json({ error: 'thumbnail failed: ' + e.message });
  }
});

// ---------- content creation ----------
// POST /v1/content/generate { type: 'shorts_script'|'lesson'|'social_post', topic, tone? }
function buildContent(t, topic, a) {
  if (!topic) return null;
  const title = topic.replace(/\b\w/g, (c) => c.toUpperCase());

  if (t === 'shorts_script') {
    return {
      type: 'shorts_script', topic,
      hook: `Stop scrolling. ${title} — explained in 60 seconds.`,
      scenes: [
        { text: `Assalamu alaikum. Today: ${topic}`, duration: 4 },
        { text: 'Point 1 — the core idea, simply stated', duration: 6 },
        { text: 'Point 2 — the evidence (Quran / authentic hadith)', duration: 6 },
        { text: 'Point 3 — what it means for your daily life', duration: 6 },
        { text: 'Follow for daily Islamic knowledge.', duration: 4 },
      ],
      caption: `${title} explained. #islam #islamic #muslim #quran #shorts`,
      note: 'Pair with GET /v1/quran/* and /v1/hadith/* on the Ilm API to fill in authentic evidence.',
    };
  }
  if (t === 'lesson') {
    return {
      type: 'lesson', topic,
      outline: {
        objectives: [`Understand the meaning of ${topic}`, 'Memorize key Arabic terms with harakaat', 'Apply the lesson practically'],
        sections: ['Introduction and relevance', 'Arabic text with full vocalization', 'Translation and explanation', 'Grammar rules (Qawaa\'id Nahwiyyah)', 'Review questions'],
        homework: [`Write the Arabic text of ${topic} from memory`, 'Prepare 3 questions for the next class'],
      },
      note: 'Enrich with Ilm API: /v1/quran, /v1/tafsir, /v1/hadith, /v1/duas.',
    };
  }
  if (t === 'social_post') {
    return {
      type: 'social_post', topic,
      posts: {
        whatsapp: `${title}\n\nA short, beneficial reminder about ${topic} for ${a}. Keep it sincere and sourced.`,
        x_twitter: `${title} — a thread. 1/`,
        instagram_caption: `${title} ✨ Swipe for the full reminder. #islamicreminder #deen`,
      },
    };
  }
  return null;
}

// ---------- content creation ----------
app.post('/v1/content/generate', (req, res) => {
  const { type, topic, audience } = req.body || {};
  if (!topic) return res.status(400).json({ error: 'topic is required' });
  const result = buildContent(String(type || 'shorts_script').toLowerCase(), String(topic).trim(), audience || 'general Muslim audience');
  if (!result) return res.status(400).json({ error: 'type must be shorts_script, lesson, or social_post' });
  res.json(result);
});

// ---------- workflow engine (chained multi-step generation) ----------
// POST /v1/workflows { name?, steps: [{ id?, action: 'image'|'speech'|'animate'|'content', params: {...} }], webhook? }
// Later steps reference earlier outputs with {{stepId.field}} template strings.
const WF_ACTIONS = ['image', 'speech', 'animate', 'content'];
const wfJobs = new Map(); // id -> job object

function resolveTemplates(value, results) {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([A-Za-z][\w-]*(?:\.[\w-]+)*)\s*\}\}/g, (m, ref) => {
      const parts = ref.split('.');
      const out = results[parts.shift()];
      let v = out;
      for (const p of parts) v = (v && typeof v === 'object') ? v[p] : undefined;
      return (v === undefined || v === null) ? m : String(v);
    });
  }
  if (Array.isArray(value)) return value.map(v => resolveTemplates(v, results));
  if (value && typeof value === 'object') { const o = {}; for (const k of Object.keys(value)) o[k] = resolveTemplates(value[k], results); return o; }
  return value;
}

async function wfSaveDb(job) {
  if (!pool || dbBroken) return;
  try {
    await pool.query(
      'INSERT INTO workflows (id, key, name, status, steps, error) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET status=$4, steps=$5, error=$6, updated_at=NOW()',
      [job.id, job.key, job.name || null, job.status, JSON.stringify(job.steps), job.error || null]
    );
  } catch (e) { console.error('workflow persist failed:', e.message); }
}

async function wfImage(p) {
  return generateImage({
    prompt: p.prompt, preset: p.preset, width: p.width, height: p.height,
    model: p.model, seed: p.seed, baseUrl: p.baseUrl || null
  });
}

async function wfSpeech(p, job, dir, idx) {
  const text = String(p.text || '').trim();
  if (!text) throw new Error('speech step needs text');
  const voice = VOICE_RE.test(String(p.voice || '')) ? p.voice : DEFAULT_VOICE;
  const fname = 's' + idx + '.mp3';
  await speakText(text, voice, p.rate, path.join(dir, fname));
  return { url: job.baseUrl + '/v1/workflows/' + job.id + '/files/' + fname, text, voice, file: fname };
}

async function wfAnimate(p, job, dir, idx) {
  const imageUrl = p.image_url || p.image;
  if (!imageUrl || !/^https:\/\//.test(String(imageUrl))) throw new Error('animate step needs an https image_url');
  const duration = Math.min(Math.max(parseFloat(p.duration) || 8, 2), 30);
  const effect = KB_EFFECTS.includes(p.effect) ? p.effect : 'zoom_in';
  const isWide = p.aspect === 'wide' || p.aspect === 'landscape';
  const W = isWide ? 1280 : 1080, H = isWide ? 720 : 1920, FPS = 30;
  const caption = (p.text && String(p.text).trim()) ? String(p.text).trim() : null;
  const imgPath = path.join(dir, 'anim' + idx + '.img');
  await downloadImage(String(imageUrl), imgPath);
  const fname = 's' + idx + '.mp4';
  const outPath = path.join(dir, fname);
  const N = Math.round(duration * FPS);
  let z, x, y;
  switch (effect) {
    case 'zoom_out': z = 'max(1.25-' + (0.25 / N).toFixed(6) + '*in,1.0)'; x = 'iw/2-(iw/zoom/2)'; y = 'ih/2-(ih/zoom/2)'; break;
    case 'pan_left': z = '1.25'; x = '(iw-iw/zoom)*max(1-in/' + N + ',0)'; y = 'ih/2-(ih/zoom/2)'; break;
    case 'pan_right': z = '1.25'; x = '(iw-iw/zoom)*min(in/' + N + ',1)'; y = 'ih/2-(ih/zoom/2)'; break;
    case 'static': z = '1'; x = '0'; y = '0'; break;
    default: z = 'min(1+' + (0.25 / N).toFixed(6) + '*in,1.25)'; x = 'iw/2-(iw/zoom/2)'; y = 'ih/2-(ih/zoom/2)';
  }
  const parts = ['scale=' + Math.round(W * 1.3) + ':' + Math.round(H * 1.3) + ':force_original_aspect_ratio=increase', 'crop=' + Math.round(W * 1.3) + ':' + Math.round(H * 1.3)];
  if (effect === 'static') parts.push('scale=' + W + ':' + H);
  else parts.push("zoompan=z='" + z + "':x='" + x + "':y='" + y + "':d=1:s=" + W + 'x' + H + ':fps=' + FPS);
  if (caption) {
    const size = Math.max(28, Math.round(W / 18));
    parts.push('drawtext=fontfile=' + FONT + ":text='" + escDrawtext(caption) + "':fontcolor=#F3ECDA:fontsize=" + size + ':line_spacing=' + Math.round(size * 0.5) + ':x=(w-text_w)/2:y=h*0.72:box=1:boxcolor=#0E2A2B@0.65:boxborderw=24');
  }
  parts.push('format=yuv420p');
  // memory-lean encode for small containers (Render free tier is 512MB)
  await execFileAsync('ffmpeg', ['-y', '-threads', '1', '-filter_threads', '1', '-loop', '1', '-framerate', String(FPS), '-t', String(duration), '-i', imgPath, '-vf', parts.join(','), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-x264-params', 'rc-lookahead=0:ref=1', '-pix_fmt', 'yuv420p', outPath], { maxBuffer: 1024 * 1024 * 10, timeout: 10 * 60 * 1000 });
  return { url: job.baseUrl + '/v1/workflows/' + job.id + '/files/' + fname, duration, effect, image: String(imageUrl), file: fname };
}

function wfContent(p) {
  const r = buildContent(String(p.type || 'shorts_script').toLowerCase(), String(p.topic || '').trim(), String(p.audience || 'general Muslim audience'));
  if (!r) throw new Error('content step: type must be shorts_script, lesson, or social_post');
  if (!r.topic) throw new Error('content step needs a topic');
  return r;
}

const WF_RUNNERS = { image: wfImage, speech: wfSpeech, animate: wfAnimate, content: wfContent };

async function runWorkflow(job, rawSteps) {
  const results = {};
  const dir = path.join(WORK_DIR, 'workflows', job.id);
  fs.mkdirSync(dir, { recursive: true });
  job.status = 'running';
  try {
    for (let i = 0; i < rawSteps.length; i++) {
      const step = job.steps[i];
      const p = resolveTemplates(rawSteps[i].params || {}, results);
      const output = await WF_RUNNERS[step.action](p, job, dir, i);
      step.status = 'done';
      step.output = output;
      results[step.id] = output;
      job.progress = Math.round(((i + 1) / rawSteps.length) * 100);
      wfSaveDb(job);
    }
    job.status = 'done';
    job.progress = 100;
  } catch (e) {
    job.status = 'failed';
    job.error = e.message;
    const failed = job.steps.find(s => s.status === 'pending');
    if (failed) { failed.status = 'failed'; failed.error = e.message; }
  }
  wfSaveDb(job);
  if (job.webhook) {
    fetch(job.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: job.status === 'done' ? 'workflow.completed' : 'workflow.failed', workflow_id: job.id, status: job.status, error: job.error || null, steps: job.steps.map(s => ({ id: s.id, action: s.action, status: s.status, output: s.output || null })) }) })
      .catch(e => console.error('workflow webhook failed:', e.message));
  }
}

app.post('/v1/workflows', async (req, res) => {
  const b = req.body || {};
  const rawSteps = Array.isArray(b.steps) ? b.steps : null;
  if (!rawSteps || rawSteps.length === 0) return res.status(400).json({ error: 'steps array with at least one step is required' });
  if (rawSteps.length > 20) return res.status(400).json({ error: 'too many steps (max 20)' });
  const seen = new Set();
  for (let i = 0; i < rawSteps.length; i++) {
    const st = rawSteps[i] || {};
    if (!WF_ACTIONS.includes(st.action)) return res.status(400).json({ error: 'step ' + (i + 1) + ': action must be one of ' + WF_ACTIONS.join(', ') });
    let id = st.id ? String(st.id) : 's' + (i + 1);
    if (!/^[a-zA-Z][\w-]{0,39}$/.test(id)) return res.status(400).json({ error: 'step ' + (i + 1) + ': invalid id (letters, digits, - _)' });
    if (seen.has(id)) return res.status(400).json({ error: 'step ' + (i + 1) + ': duplicate id ' + id });
    seen.add(id);
    rawSteps[i].id = id;
  }
  const hook = /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1))/.test(String(b.webhook || '')) ? String(b.webhook) : null;
  const id = crypto.randomUUID();
  const job = {
    id, key: req.apiKey, name: b.name ? String(b.name).slice(0, 120) : null,
    status: 'queued', progress: 0, error: null, webhook: hook,
    baseUrl: 'https://' + req.get('host'),
    createdAt: Date.now(),
    steps: rawSteps.map(st => ({ id: st.id, action: st.action, status: 'pending', output: null, error: null })),
  };
  wfJobs.set(id, job);
  wfSaveDb(job);
  runWorkflow(job, rawSteps).catch(e => console.error('workflow crashed:', e.message));
  res.status(202).json({ id, name: job.name, status: 'queued', steps: job.steps.length, poll: '/v1/workflows/' + id, docs: 'later steps can use earlier outputs via {{stepId.field}}' });
});

app.get('/v1/workflows/list', (req, res) => {
  const mine = [...wfJobs.values()].filter(j => j.key === req.apiKey).sort((a, b2) => b2.createdAt - a.createdAt).slice(0, 50);
  res.json({ workflows: mine.map(j => ({ id: j.id, name: j.name, status: j.status, steps: j.steps.length, created_at: new Date(j.createdAt).toISOString() })) });
});

app.get('/v1/workflows/:id', async (req, res) => {
  const job = wfJobs.get(req.params.id);
  if (job) {
    if (job.key !== req.apiKey) return res.status(404).json({ error: 'workflow not found' });
    return res.json({ id: job.id, name: job.name, status: job.status, progress: job.progress, error: job.error, steps: job.steps, created_at: new Date(job.createdAt).toISOString() });
  }
  // server may have restarted; the database keeps the last persisted state
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT * FROM workflows WHERE id = $1', [req.params.id]);
      if (r.rowCount) {
        const row = r.rows[0];
        if (row.key !== req.apiKey) return res.status(404).json({ error: 'workflow not found' });
        return res.json({ id: row.id, name: row.name, status: row.status, progress: row.status === 'done' ? 100 : null, error: row.error, steps: row.steps || [], created_at: row.created_at, note: 'state restored from database (service restarted)' });
      }
    } catch (e) { console.error('workflow restore failed:', e.message); }
  }
  res.status(404).json({ error: 'workflow not found' });
});

app.get('/v1/workflows/:id/files/:name', (req, res) => {
  const job = wfJobs.get(req.params.id);
  if (!job || job.key !== req.apiKey) return res.status(404).json({ error: 'workflow not found' });
  const name = String(req.params.name);
  if (!/^[\w.-]+$/.test(name)) return res.status(400).json({ error: 'invalid file name' });
  const p = path.join(WORK_DIR, 'workflows', job.id, name);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'file not found' });
  res.setHeader('Content-Type', name.endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4');
  res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
  fs.createReadStream(p).pipe(res);
});


// ---------- portfolio management service (Phase B) ----------
// Serves the AI-powered Portfolio Builder for generative artists.
// Resilient storage: writes hit the database when available and always keep
// an in-memory mirror; reads prefer the database and fall back to memory.
const memPortfolios = new Map(); // id -> portfolio row
const memArtworks = new Map();   // id -> artwork row

async function pfSave(p) {
  memPortfolios.set(p.id, p);
  if (!pool || dbBroken) return;
  try {
    await pool.query(
      'INSERT INTO portfolios (id, key, title, description, artist, published, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET title=$3, description=$4, artist=$5, published=$6, updated_at=$8',
      [p.id, p.key, p.title, p.description || null, p.artist || null, p.published, p.created_at, p.updated_at]
    );
  } catch (e) { console.error('portfolio persist failed:', e.message); }
}

async function pfList(key) {
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT * FROM portfolios WHERE key = $1 ORDER BY created_at DESC', [key]);
      if (r.rowCount) return r.rows;
    } catch (e) { console.error('portfolio list failed:', e.message); }
  }
  return [...memPortfolios.values()].filter(p => p.key === key).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

async function pfGet(id) {
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT * FROM portfolios WHERE id = $1', [id]);
      if (r.rowCount) return r.rows[0];
    } catch (e) { console.error('portfolio get failed:', e.message); }
  }
  return memPortfolios.get(id) || null;
}

async function pfDelete(id) {
  memPortfolios.delete(id);
  for (const [aid, a] of [...memArtworks]) if (a.portfolio_id === id) memArtworks.delete(aid);
  if (pool && !dbBroken) {
    try { await pool.query('DELETE FROM artworks WHERE portfolio_id = $1', [id]); await pool.query('DELETE FROM portfolios WHERE id = $1', [id]); }
    catch (e) { console.error('portfolio delete failed:', e.message); }
  }
}

async function awSave(a) {
  memArtworks.set(a.id, a);
  if (!pool || dbBroken) return;
  try {
    await pool.query(
      'INSERT INTO artworks (id, portfolio_id, key, title, description, image_url, prompt, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET title=$4, description=$5, image_url=$6',
      [a.id, a.portfolio_id, a.key, a.title, a.description || null, a.image_url, a.prompt || null, a.created_at]
    );
  } catch (e) { console.error('artwork persist failed:', e.message); }
}

async function awList(portfolioId) {
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT * FROM artworks WHERE portfolio_id = $1 ORDER BY created_at DESC', [portfolioId]);
      if (r.rowCount) return r.rows;
    } catch (e) { console.error('artwork list failed:', e.message); }
  }
  return [...memArtworks.values()].filter(a => a.portfolio_id === portfolioId).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

async function awGet(id) {
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT * FROM artworks WHERE id = $1', [id]);
      if (r.rowCount) return r.rows[0];
    } catch (e) { console.error('artwork get failed:', e.message); }
  }
  return memArtworks.get(id) || null;
}

async function awDelete(id) {
  memArtworks.delete(id);
  if (pool && !dbBroken) {
    try { await pool.query('DELETE FROM artworks WHERE id = $1', [id]); }
    catch (e) { console.error('artwork delete failed:', e.message); }
  }
}

app.post('/v1/portfolios', async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: 'title is required' });
  const now = new Date().toISOString();
  const p = {
    id: crypto.randomUUID(), key: req.apiKey, title,
    description: String(b.description || '').slice(0, 2000),
    artist: String(b.artist || '').slice(0, 120) || null,
    published: !!b.published, created_at: now, updated_at: now,
  };
  await pfSave(p);
  res.status(201).json({ ...p, artworks_url: '/v1/portfolios/' + p.id + '/artworks', gallery_hint: 'PATCH with {"published": true} then share /gallery/' + p.id });
});

app.get('/v1/portfolios', async (req, res) => {
  res.json({ portfolios: await pfList(req.apiKey) });
});

app.get('/v1/portfolios/:id', async (req, res) => {
  const p = await pfGet(req.params.id);
  if (!p || p.key !== req.apiKey) return res.status(404).json({ error: 'portfolio not found' });
  const artworks = await awList(p.id);
  res.json({ ...p, artworks: artworks.map(a => ({ id: a.id, title: a.title, description: a.description, image_url: a.image_url, prompt: a.prompt, created_at: a.created_at })) });
});

app.patch('/v1/portfolios/:id', async (req, res) => {
  const p = await pfGet(req.params.id);
  if (!p || p.key !== req.apiKey) return res.status(404).json({ error: 'portfolio not found' });
  const b = req.body || {};
  if (b.title !== undefined) p.title = String(b.title).trim().slice(0, 120) || p.title;
  if (b.description !== undefined) p.description = String(b.description).slice(0, 2000);
  if (b.artist !== undefined) p.artist = String(b.artist).slice(0, 120) || null;
  if (b.published !== undefined) p.published = !!b.published;
  p.updated_at = new Date().toISOString();
  await pfSave(p);
  res.json({ ...p, gallery_url: p.published ? '/gallery/' + p.id : null });
});

app.delete('/v1/portfolios/:id', async (req, res) => {
  const p = await pfGet(req.params.id);
  if (!p || p.key !== req.apiKey) return res.status(404).json({ error: 'portfolio not found' });
  await pfDelete(p.id);
  res.json({ deleted: true, id: p.id });
});

app.post('/v1/portfolios/:id/artworks', async (req, res) => {
  const p = await pfGet(req.params.id);
  if (!p || p.key !== req.apiKey) return res.status(404).json({ error: 'portfolio not found' });
  const b = req.body || {};
  const title = String(b.title || '').trim().slice(0, 160);
  if (!title) return res.status(400).json({ error: 'title is required' });
  let imageUrl = null, prompt = null;
  if (b.image_url) {
    if (!/^https:\/\//.test(String(b.image_url))) return res.status(400).json({ error: 'image_url must be https' });
    imageUrl = String(b.image_url);
  } else {
    // generate via the media engine (metered inline: the path is dynamic)
    const { used } = await getUsage(req.apiKey);
    if (used >= FREE_MONTHLY_LIMIT) return res.status(429).json({ error: 'Free monthly limit reached (' + FREE_MONTHLY_LIMIT + ' operations). Email support to upgrade.', limit: FREE_MONTHLY_LIMIT, used });
    const gen = b.generate && typeof b.generate === 'object' ? b.generate : {};
    const gp = {
      prompt: gen.prompt || b.prompt || String(title),
      preset: gen.preset || b.preset || null,
      width: gen.width || b.width, height: gen.height || b.height,
      model: gen.model || null, seed: gen.seed || b.seed || null,
      baseUrl: reqBase(req),
    };
    try { const out = await wfImage(gp); imageUrl = out.url; prompt = out.prompt; }
    catch (e) { return res.status(400).json({ error: e.message }); }
    await incrUsage(req.apiKey);
    res.setHeader('X-Usage-Remaining', Math.max(0, FREE_MONTHLY_LIMIT - used - 1));
  }
  const a = {
    id: crypto.randomUUID(), portfolio_id: p.id, key: req.apiKey, title,
    description: String(b.description || '').slice(0, 1000),
    image_url: imageUrl, prompt, created_at: new Date().toISOString(),
  };
  await awSave(a);
  res.status(201).json(a);
});

app.delete('/v1/portfolios/:id/artworks/:aid', async (req, res) => {
  const p = await pfGet(req.params.id);
  if (!p || p.key !== req.apiKey) return res.status(404).json({ error: 'portfolio not found' });
  const a = await awGet(req.params.aid);
  if (!a || a.portfolio_id !== p.id) return res.status(404).json({ error: 'artwork not found' });
  await awDelete(a.id);
  res.json({ deleted: true, id: a.id });
});

// public shareable gallery — no API key required, published portfolios only
// self-heal: when a published gallery is visited, any artwork still pointing at the
// retired free provider is regenerated in the background (needs Cloudflare config).
const galleryRepair = new Map(); // artwork id -> true while queued/in flight
async function repairGalleryImages(artworks, req) {
  if (!cfReady) return;
  const todo = artworks.filter(a => a.image_url && a.image_url.indexOf('pollinations.ai') !== -1 && !galleryRepair.has(a.id));
  if (!todo.length) return;
  todo.forEach(a => galleryRepair.set(a.id, true));
  const base = reqBase(req);
  (async () => {
    for (const a of todo) {
      try {
        const out = await generateImage({ prompt: a.prompt || a.title, baseUrl: base });
        await awSave({ ...a, image_url: out.url });
        console.log('gallery repair: regenerated artwork ' + a.id);
      } catch (e) {
        console.error('gallery repair failed for artwork ' + a.id + ':', e.message);
        galleryRepair.delete(a.id); // allow retry on the next visit
      }
    }
  })();
}

app.get('/gallery/:id', async (req, res) => {
  const p = await pfGet(req.params.id);
  if (!p || !p.published) return res.status(404).send('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui;background:#0E2A2B;color:#F3ECDA;text-align:center;padding:60px 20px"><h2>Gallery not found</h2><p style="color:#8FB3B0">This portfolio is private or does not exist.</p></body></html>');
  const artworks = await awList(p.id);
  repairGalleryImages(artworks, req);
  const cards = artworks.map(a => `<figure style="margin:0;background:#143B3C;border:1px solid #1E4344;border-radius:12px;overflow:hidden"><img src="${a.image_url}" alt="${a.title.replace(/"/g, '&quot;')}" loading="lazy" style="width:100%;display:block;aspect-ratio:1;object-fit:cover"><figcaption style="padding:12px"><strong style="color:#F3ECDA;font-size:.95rem">${a.title}</strong>${a.description ? `<div style="color:#8FB3B0;font-size:.8rem;margin-top:4px">${a.description}</div>` : ''}</figcaption></figure>`).join('\n') || '<p style="color:#8FB3B0">No artworks yet.</p>';
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${p.title} — Portfolio</title>
<meta property="og:title" content="${p.title}">
<meta property="og:description" content="${p.artist ? p.artist + ' — ' : ''}${p.title}">
<style>
body{margin:0;font-family:system-ui,sans-serif;background:#0E2A2B;color:#F3ECDA}
.wrap{max-width:1080px;margin:0 auto;padding:40px 20px}
h1{color:#C9A96A;margin:0 0 6px;font-size:2rem}
.artist{color:#8FB3B0;margin:0 0 8px}
.desc{color:#D8CBAF;max-width:640px;margin:0 auto 28px;line-height:1.6}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px}
.foot{margin-top:40px;color:#5E8280;font-size:.8rem}
.foot a{color:#C9A96A;text-decoration:none}
</style></head><body><div class="wrap">
<h1>${p.title}</h1>
${p.artist ? `<p class="artist">by ${p.artist}</p>` : ''}
${p.description ? `<p class="desc">${p.description}</p>` : ''}
<div class="grid">${cards}</div>
<p class="foot">Powered by <a href="/">Studio API</a> — Al-Haqq Digital</p>
</div></body></html>`);
});

// ---------- game logic service (Phase C) ----------
// Serves the Game Prototype Builder: branching narrative projects with
// scenes, player choices, and AI-generated scene art. Same resilient
// storage pattern as portfolios (database + in-memory mirror).
const memGames = new Map();  // id -> game row
const memScenes = new Map(); // id -> scene row

function gmCleanChoices(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const c of raw.slice(0, 6)) {
    if (!c || typeof c !== 'object') continue;
    const label = String(c.label || '').trim().slice(0, 120);
    if (!label) continue;
    out.push({ label, target: c.target ? String(c.target).slice(0, 80) : null, outcome: String(c.outcome || '').slice(0, 300) });
  }
  return out;
}

async function gmSave(g) {
  memGames.set(g.id, g);
  if (!pool || dbBroken) return;
  try {
    await pool.query(
      'INSERT INTO game_projects (id, key, title, genre, description, start_scene, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET title=$3, genre=$4, description=$5, start_scene=$6, updated_at=$8',
      [g.id, g.key, g.title, g.genre || null, g.description || null, g.start_scene || null, g.created_at, g.updated_at]
    );
  } catch (e) { console.error('game persist failed:', e.message); }
}

async function gmList(key) {
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT * FROM game_projects WHERE key = $1 ORDER BY created_at DESC', [key]);
      if (r.rowCount) return r.rows;
    } catch (e) { console.error('game list failed:', e.message); }
  }
  return [...memGames.values()].filter(g => g.key === key).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

async function gmGet(id) {
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT * FROM game_projects WHERE id = $1', [id]);
      if (r.rowCount) return r.rows[0];
    } catch (e) { console.error('game get failed:', e.message); }
  }
  return memGames.get(id) || null;
}

async function gmDelete(id) {
  memGames.delete(id);
  for (const [sid, s] of [...memScenes]) if (s.game_id === id) memScenes.delete(sid);
  if (pool && !dbBroken) {
    try { await pool.query('DELETE FROM game_scenes WHERE game_id = $1', [id]); await pool.query('DELETE FROM game_projects WHERE id = $1', [id]); }
    catch (e) { console.error('game delete failed:', e.message); }
  }
}

async function scSave(s) {
  memScenes.set(s.id, s);
  if (!pool || dbBroken) return;
  try {
    await pool.query(
      'INSERT INTO game_scenes (id, game_id, key, title, narrative, choices, image_url, prompt, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO UPDATE SET title=$4, narrative=$5, choices=$6, image_url=$7, prompt=$8, updated_at=$10',
      [s.id, s.game_id, s.key, s.title, s.narrative, JSON.stringify(s.choices || []), s.image_url || null, s.prompt || null, s.created_at, s.updated_at]
    );
  } catch (e) { console.error('scene persist failed:', e.message); }
}

async function scList(gameId) {
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT * FROM game_scenes WHERE game_id = $1 ORDER BY created_at', [gameId]);
      if (r.rowCount) return r.rows.map(row => ({ ...row, choices: row.choices || [] }));
    } catch (e) { console.error('scene list failed:', e.message); }
  }
  return [...memScenes.values()].filter(s => s.game_id === gameId).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
}

async function scGet(id) {
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT * FROM game_scenes WHERE id = $1', [id]);
      if (r.rowCount) return { ...r.rows[0], choices: r.rows[0].choices || [] };
    } catch (e) { console.error('scene get failed:', e.message); }
  }
  const s = memScenes.get(id);
  return s ? { ...s, choices: s.choices || [] } : null;
}

async function scDelete(id) {
  memScenes.delete(id);
  if (pool && !dbBroken) {
    try { await pool.query('DELETE FROM game_scenes WHERE id = $1', [id]); }
    catch (e) { console.error('scene delete failed:', e.message); }
  }
}

app.post('/v1/games', async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: 'title is required' });
  const now = new Date().toISOString();
  const g = {
    id: crypto.randomUUID(), key: req.apiKey, title,
    genre: String(b.genre || '').slice(0, 60) || null,
    description: String(b.description || '').slice(0, 2000),
    start_scene: null, created_at: now, updated_at: now,
  };
  await gmSave(g);
  res.status(201).json({ ...g, scenes_url: '/v1/games/' + g.id + '/scenes', story_map_url: '/v1/games/' + g.id + '/story-map' });
});

app.get('/v1/games', async (req, res) => {
  res.json({ games: await gmList(req.apiKey) });
});

app.get('/v1/games/:id', async (req, res) => {
  const g = await gmGet(req.params.id);
  if (!g || g.key !== req.apiKey) return res.status(404).json({ error: 'game not found' });
  res.json({ ...g, scenes: await scList(g.id) });
});

app.patch('/v1/games/:id', async (req, res) => {
  const g = await gmGet(req.params.id);
  if (!g || g.key !== req.apiKey) return res.status(404).json({ error: 'game not found' });
  const b = req.body || {};
  if (b.title !== undefined) g.title = String(b.title).trim().slice(0, 120) || g.title;
  if (b.genre !== undefined) g.genre = String(b.genre).slice(0, 60) || null;
  if (b.description !== undefined) g.description = String(b.description).slice(0, 2000);
  if (b.start_scene !== undefined) {
    if (b.start_scene === null) g.start_scene = null;
    else {
      const s = await scGet(String(b.start_scene));
      if (!s || s.game_id !== g.id) return res.status(400).json({ error: 'start_scene must be a scene id in this game' });
      g.start_scene = s.id;
    }
  }
  g.updated_at = new Date().toISOString();
  await gmSave(g);
  res.json(g);
});

app.delete('/v1/games/:id', async (req, res) => {
  const g = await gmGet(req.params.id);
  if (!g || g.key !== req.apiKey) return res.status(404).json({ error: 'game not found' });
  await gmDelete(g.id);
  res.json({ deleted: true, id: g.id });
});

app.post('/v1/games/:id/scenes', async (req, res) => {
  const g = await gmGet(req.params.id);
  if (!g || g.key !== req.apiKey) return res.status(404).json({ error: 'game not found' });
  const b = req.body || {};
  const title = String(b.title || '').trim().slice(0, 160);
  const narrative = String(b.narrative || '').trim().slice(0, 4000);
  if (!title) return res.status(400).json({ error: 'title is required' });
  if (!narrative) return res.status(400).json({ error: 'narrative is required' });
  const now = new Date().toISOString();
  const s = {
    id: crypto.randomUUID(), game_id: g.id, key: req.apiKey, title, narrative,
    choices: gmCleanChoices(b.choices), image_url: null, prompt: null,
    created_at: now, updated_at: now,
  };
  await scSave(s);
  if (!g.start_scene) { g.start_scene = s.id; g.updated_at = now; await gmSave(g); }
  res.status(201).json({ ...s, note: g.start_scene === s.id ? 'this is the start scene' : undefined });
});

app.get('/v1/games/:id/scenes', async (req, res) => {
  const g = await gmGet(req.params.id);
  if (!g || g.key !== req.apiKey) return res.status(404).json({ error: 'game not found' });
  res.json({ scenes: await scList(g.id) });
});

app.patch('/v1/games/:id/scenes/:sid', async (req, res) => {
  const g = await gmGet(req.params.id);
  if (!g || g.key !== req.apiKey) return res.status(404).json({ error: 'game not found' });
  const s = await scGet(req.params.sid);
  if (!s || s.game_id !== g.id) return res.status(404).json({ error: 'scene not found' });
  const b = req.body || {};
  if (b.title !== undefined) s.title = String(b.title).trim().slice(0, 160) || s.title;
  if (b.narrative !== undefined) s.narrative = String(b.narrative).trim().slice(0, 4000) || s.narrative;
  if (b.choices !== undefined) s.choices = gmCleanChoices(b.choices);
  s.updated_at = new Date().toISOString();
  await scSave(s);
  res.json(s);
});

app.delete('/v1/games/:id/scenes/:sid', async (req, res) => {
  const g = await gmGet(req.params.id);
  if (!g || g.key !== req.apiKey) return res.status(404).json({ error: 'game not found' });
  const s = await scGet(req.params.sid);
  if (!s || s.game_id !== g.id) return res.status(404).json({ error: 'scene not found' });
  await scDelete(s.id);
  if (g.start_scene === s.id) {
    const remaining = await scList(g.id);
    g.start_scene = remaining.length ? remaining[0].id : null;
    g.updated_at = new Date().toISOString();
    await gmSave(g);
  }
  res.json({ deleted: true, id: s.id, start_scene_now: g.start_scene });
});

// generate a visual asset for a scene; the scene narrative feeds the prompt
app.post('/v1/games/:id/scenes/:sid/assets', async (req, res) => {
  const g = await gmGet(req.params.id);
  if (!g || g.key !== req.apiKey) return res.status(404).json({ error: 'game not found' });
  const s = await scGet(req.params.sid);
  if (!s || s.game_id !== g.id) return res.status(404).json({ error: 'scene not found' });
  const b = req.body || {};
  const { used } = await getUsage(req.apiKey);
  if (used >= FREE_MONTHLY_LIMIT) return res.status(429).json({ error: 'Free monthly limit reached (' + FREE_MONTHLY_LIMIT + ' operations). Email support to upgrade.', limit: FREE_MONTHLY_LIMIT, used });
  const prompt = String(b.prompt || s.title + (s.narrative ? ' — ' + s.narrative.slice(0, 200) : ''));
  try {
    const out = await wfImage({ prompt, preset: b.preset || null, width: b.width, height: b.height, model: b.model || null, seed: b.seed || null, baseUrl: reqBase(req) });
    s.image_url = out.url;
    s.prompt = out.prompt;
    s.updated_at = new Date().toISOString();
    await scSave(s);
    await incrUsage(req.apiKey);
    res.setHeader('X-Usage-Remaining', Math.max(0, FREE_MONTHLY_LIMIT - used - 1));
    res.json({ scene_id: s.id, title: s.title, image_url: s.image_url, prompt: s.prompt, width: out.width, height: out.height });
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// branching map: nodes, edges, unresolved choice targets, unreachable scenes
app.get('/v1/games/:id/story-map', async (req, res) => {
  const g = await gmGet(req.params.id);
  if (!g || g.key !== req.apiKey) return res.status(404).json({ error: 'game not found' });
  const scenes = await scList(g.id);
  const byId = new Map(scenes.map(s => [s.id, s]));
  const nodes = scenes.map(s => ({ id: s.id, title: s.title, start: s.id === g.start_scene, has_art: !!s.image_url }));
  const edges = [];
  const unresolved = [];
  for (const s of scenes) {
    for (const c of s.choices || []) {
      if (!c.target) { edges.push({ from: s.id, label: c.label, to: null }); continue; }
      if (!byId.has(c.target)) { unresolved.push({ scene: s.id, choice: c.label, target: c.target }); continue; }
      edges.push({ from: s.id, label: c.label, to: c.target });
    }
  }
  // reachability from the start scene
  const reachable = new Set();
  const walk = (id) => {
    if (reachable.has(id) || !byId.has(id)) return;
    reachable.add(id);
    for (const c of (byId.get(id).choices || [])) if (c.target) walk(c.target);
  };
  if (g.start_scene) walk(g.start_scene);
  const unreachable = scenes.filter(s => !reachable.has(s.id)).map(s => ({ id: s.id, title: s.title }));
  res.json({ game_id: g.id, start_scene: g.start_scene, nodes, edges, unresolved_targets: unresolved, unreachable_scenes: unreachable });
});

// ---------- madrasa classroom service (Phase D) ----------
// Teacher dashboards for the Huruuf game: classes, students, and
// per-letter progress. Teachers own their class; students join with
// a class code and every quiz answer is logged. Reports power the
// parent WhatsApp progress cards.
const memClasses = new Map();  // id -> class
const memStudents = new Map(); // id -> student
const memProgress = [];       // {id, student_id, key, letter, correct, ts}

function mdCode() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no confusables (I,L,O,0,1)
  let c = '';
  for (let i = 0; i < 6; i++) c += abc[Math.random() * abc.length | 0];
  return c;
}

async function mdSaveClass(c) {
  memClasses.set(c.id, c);
  if (!pool || dbBroken) return;
  try {
    await pool.query(
      'INSERT INTO madrasa_classes (id, key, name, code, teacher, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET name=$3, teacher=$5',
      [c.id, c.key, c.name, c.code, c.teacher || null, c.created_at]
    );
  } catch (e) { console.error('class persist failed:', e.message); }
}

async function mdClassById(id) {
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT * FROM madrasa_classes WHERE id = $1', [id]);
      if (r.rowCount) return r.rows[0];
    } catch (e) { console.error('class get failed:', e.message); }
  }
  return memClasses.get(id) || null;
}

async function mdClassByCode(code) {
  const up = String(code || '').trim().toUpperCase();
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT * FROM madrasa_classes WHERE code = $1', [up]);
      if (r.rowCount) return r.rows[0];
    } catch (e) { console.error('code lookup failed:', e.message); }
  }
  return [...memClasses.values()].find(c => c.code === up) || null;
}

async function mdClassesFor(key) {
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT * FROM madrasa_classes WHERE key = $1 ORDER BY created_at DESC', [key]);
      if (r.rowCount) return r.rows;
    } catch (e) { console.error('class list failed:', e.message); }
  }
  return [...memClasses.values()].filter(c => c.key === key);
}

async function mdDeleteClass(id) {
  memClasses.delete(id);
  for (const [sid, s] of [...memStudents]) if (s.class_id === id) { memStudents.delete(sid); }
  for (let i = memProgress.length - 1; i >= 0; i--) { /* keep rows; students gone */ }
  if (pool && !dbBroken) {
    try {
      await pool.query('DELETE FROM madrasa_progress WHERE student_id IN (SELECT id FROM madrasa_students WHERE class_id = $1)', [id]);
      await pool.query('DELETE FROM madrasa_students WHERE class_id = $1', [id]);
      await pool.query('DELETE FROM madrasa_classes WHERE id = $1', [id]);
    } catch (e) { console.error('class delete failed:', e.message); }
  }
}

async function mdSaveStudent(s) {
  memStudents.set(s.id, s);
  if (!pool || dbBroken) return;
  try {
    await pool.query(
      'INSERT INTO madrasa_students (id, class_id, key, name, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET name=$4',
      [s.id, s.class_id, s.key, s.name, s.created_at]
    );
  } catch (e) { console.error('student persist failed:', e.message); }
}

async function mdStudentsOfClass(classId) {
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT * FROM madrasa_students WHERE class_id = $1 ORDER BY name', [classId]);
      if (r.rowCount) return r.rows;
    } catch (e) { console.error('student list failed:', e.message); }
  }
  return [...memStudents.values()].filter(s => s.class_id === classId).sort((a, b) => a.name.localeCompare(b.name));
}

async function mdStudentById(id) {
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT * FROM madrasa_students WHERE id = $1', [id]);
      if (r.rowCount) return r.rows[0];
    } catch (e) { console.error('student get failed:', e.message); }
  }
  return memStudents.get(id) || null;
}

async function mdDeleteStudent(id) {
  memStudents.delete(id);
  if (pool && !dbBroken) {
    try { await pool.query('DELETE FROM madrasa_progress WHERE student_id = $1', [id]); await pool.query('DELETE FROM madrasa_students WHERE id = $1', [id]); }
    catch (e) { console.error('student delete failed:', e.message); }
  }
}

async function mdLogProgress(studentId, key, letter, correct) {
  const row = { id: crypto.randomUUID(), student_id: studentId, key, letter, correct, ts: new Date().toISOString() };
  memProgress.push(row);
  if (!pool || dbBroken) return row;
  try {
    await pool.query('INSERT INTO madrasa_progress (id, student_id, key, letter, correct, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [row.id, row.student_id, row.key, row.letter, row.correct, row.ts]);
  } catch (e) { console.error('progress persist failed:', e.message); }
  return row;
}

async function mdProgressOfStudents(studentIds) {
  if (!studentIds.length) return [];
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT student_id, letter, correct, created_at FROM madrasa_progress WHERE student_id = ANY($1) ORDER BY created_at', [studentIds]);
      if (r.rowCount) return r.rows;
    } catch (e) { console.error('progress read failed:', e.message); }
  }
  return memProgress.filter(p => studentIds.includes(p.student_id));
}

// create a class (teacher)
app.post('/v1/classes', async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 100);
  if (!name) return res.status(400).json({ error: 'name is required' });
  const now = new Date().toISOString();
  let c = { id: crypto.randomUUID(), key: req.apiKey, name, code: mdCode(), teacher: String(b.teacher || '').trim().slice(0, 80) || null, created_at: now };
  // avoid code collisions
  for (let i = 0; i < 5 && await mdClassByCode(c.code); i++) c.code = mdCode();
  await mdSaveClass(c);
  res.status(201).json({ ...c, students_url: '/v1/classes/' + c.id, report_url: '/v1/classes/' + c.id + '/report', join_hint: 'Students enter this code in the Huruuf game: ' + c.code });
});

app.get('/v1/classes', async (req, res) => {
  const classes = await mdClassesFor(req.apiKey);
  const out = [];
  for (const c of classes) out.push({ ...c, student_count: (await mdStudentsOfClass(c.id)).length });
  res.json({ classes: out });
});

app.get('/v1/classes/:id', async (req, res) => {
  const c = await mdClassById(req.params.id);
  if (!c || c.key !== req.apiKey) return res.status(404).json({ error: 'class not found' });
  res.json({ ...c, students: await mdStudentsOfClass(c.id) });
});

app.patch('/v1/classes/:id', async (req, res) => {
  const c = await mdClassById(req.params.id);
  if (!c || c.key !== req.apiKey) return res.status(404).json({ error: 'class not found' });
  const b = req.body || {};
  if (b.name !== undefined) c.name = String(b.name).trim().slice(0, 100) || c.name;
  if (b.teacher !== undefined) c.teacher = String(b.teacher).trim().slice(0, 80) || null;
  await mdSaveClass(c);
  res.json(c);
});

app.delete('/v1/classes/:id', async (req, res) => {
  const c = await mdClassById(req.params.id);
  if (!c || c.key !== req.apiKey) return res.status(404).json({ error: 'class not found' });
  await mdDeleteClass(c.id);
  res.json({ deleted: true, id: c.id });
});

// add a student (teacher)
app.post('/v1/classes/:id/students', async (req, res) => {
  const c = await mdClassById(req.params.id);
  if (!c || c.key !== req.apiKey) return res.status(404).json({ error: 'class not found' });
  const name = String((req.body || {}).name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'name is required' });
  const s = { id: crypto.randomUUID(), class_id: c.id, key: req.apiKey, name, created_at: new Date().toISOString() };
  await mdSaveStudent(s);
  res.status(201).json(s);
});

app.delete('/v1/classes/:id/students/:sid', async (req, res) => {
  const c = await mdClassById(req.params.id);
  if (!c || c.key !== req.apiKey) return res.status(404).json({ error: 'class not found' });
  const s = await mdStudentById(req.params.sid);
  if (!s || s.class_id !== c.id) return res.status(404).json({ error: 'student not found' });
  await mdDeleteStudent(s.id);
  res.json({ deleted: true, id: s.id });
});

// student joins from the Huruuf game with the class code + their name.
// re-joining with the same name returns the same student (case-insensitive).
app.post('/v1/join', async (req, res) => {
  const b = req.body || {};
  const c = await mdClassByCode(b.code);
  if (!c) return res.status(404).json({ error: 'class code not found — ask your teacher' });
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'name is required' });
  const students = await mdStudentsOfClass(c.id);
  let s = students.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!s) {
    s = { id: crypto.randomUUID(), class_id: c.id, key: req.apiKey, name, created_at: new Date().toISOString() };
    await mdSaveStudent(s);
  }
  res.json({ student_id: s.id, student_name: s.name, class_id: c.id, class_name: c.name, teacher: c.teacher });
});

// log one quiz answer (student browser, high volume — never metered)
app.post('/v1/students/:sid/progress', async (req, res) => {
  const s = await mdStudentById(req.params.sid);
  if (!s) return res.status(404).json({ error: 'student not found — rejoin with your class code' });
  const b = req.body || {};
  const letter = String(b.letter || '').trim().slice(0, 4);
  if (!letter) return res.status(400).json({ error: 'letter is required' });
  const correct = !!b.correct;
  const row = await mdLogProgress(s.id, req.apiKey, letter, correct);
  res.status(201).json({ logged: true, student_id: s.id, letter, correct, ts: row.ts });
});

// teacher report: per-student and per-letter stats for the whole class
app.get('/v1/classes/:id/report', async (req, res) => {
  const c = await mdClassById(req.params.id);
  if (!c || c.key !== req.apiKey) return res.status(404).json({ error: 'class not found' });
  const students = await mdStudentsOfClass(c.id);
  const progress = await mdProgressOfStudents(students.map(s => s.id));
  const byStudent = new Map(students.map(s => [s.id, { c: 0, w: 0, letters: new Map(), last: null }]));
  for (const p of progress) {
    const st = byStudent.get(p.student_id);
    if (!st) continue;
    if (p.correct) st.c++; else st.w++;
    const L = st.letters.get(p.letter) || { c: 0, w: 0 };
    if (p.correct) L.c++; else L.w++;
    st.letters.set(p.letter, L);
    st.last = p.created_at || p.ts;
  }
  const report = students.map(s => {
    const st = byStudent.get(s.id);
    const attempts = st.c + st.w;
    const accuracy = attempts ? Math.round(st.c * 100 / attempts) : null;
    const letters = {};
    let mastered = 0, weak = [];
    for (const [ch, L] of st.letters) {
      const a = L.c + L.w, acc = Math.round(L.c * 100 / a);
      letters[ch] = { attempts: a, correct: L.c, wrong: L.w, accuracy: acc };
      if (a >= 2 && acc >= 75) mastered++;
      else if (a >= 2 && acc < 50) weak.push(ch);
    }
    return { id: s.id, name: s.name, attempts, correct: st.c, wrong: st.w, accuracy, mastered, weak_letters: weak.slice(0, 5), letters, last_active: st.last };
  });
  const totals = report.reduce((t, r) => ({ attempts: t.attempts + r.attempts, correct: t.correct + r.correct }), { attempts: 0, correct: 0 });
  res.json({ class: { id: c.id, name: c.name, code: c.code, teacher: c.teacher }, student_count: students.length, totals: { ...totals, accuracy: totals.attempts ? Math.round(totals.correct * 100 / totals.attempts) : null }, students: report });
});


// ---------- Masjid Answer service ----------
// Multi-developer: every mosque is owned by the x-api-key that registered it.
// Isolation: a key can only see/touch mosques it created (foreign keys get 404, not 403,
// so the very existence of another developer's mosque is never revealed).

const memoryMosques = new Map();        // id -> mosque (used when DB is unreachable)
const memoryAnnouncements = [];         // {id, mosque_id, key, text, created_at}

async function mSave(mosque) {
  if (pool && !dbBroken) {
    try { await pool.query('INSERT INTO masjid_mosques (id, key, mosque_name, city, whatsapp_admin_phone, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [mosque.id, mosque.key, mosque.mosqueName, mosque.city, mosque.whatsappAdminPhone || null, mosque.created_at]); return; }
    catch (e) { lastDbError = e.message; console.error('mosque save failed:', e.message); }
  }
  memoryMosques.set(mosque.id, mosque);
}

async function mGet(id) {
  if (pool && !dbBroken) {
    try { const r = await pool.query('SELECT * FROM masjid_mosques WHERE id = $1', [id]); if (r.rowCount) return r.rows[0]; }
    catch (e) { lastDbError = e.message; console.error('mosque read failed:', e.message); }
  }
  return memoryMosques.get(id) || null;
}

async function annSave(a) {
  if (pool && !dbBroken) {
    try { await pool.query('INSERT INTO masjid_announcements (id, mosque_id, key, text, created_at) VALUES ($1,$2,$3,$4,$5)', [a.id, a.mosque_id, a.key, a.text, a.created_at]); return; }
    catch (e) { lastDbError = e.message; console.error('announcement save failed:', e.message); }
  }
  memoryAnnouncements.push(a);
}

async function annList(mosqueId) {
  if (pool && !dbBroken) {
    try { const r = await pool.query('SELECT id, text, created_at FROM masjid_announcements WHERE mosque_id = $1 ORDER BY created_at DESC LIMIT 10', [mosqueId]); return r.rows; }
    catch (e) { lastDbError = e.message; console.error('announcement read failed:', e.message); }
  }
  return memoryAnnouncements.filter(a => a.mosque_id === mosqueId).slice(-10).reverse().map(a => ({ id: a.id, text: a.text, created_at: a.created_at }));
}

// owner check: mosque must exist AND belong to the calling key; otherwise uniform 404
async function ownMosque(id, key) {
  const m = await mGet(id);
  if (!m || m.key !== key) return null;
  return m;
}

// hourly rate limit for /v1/masjid/answer: 20 per key per hour
const MASJID_ANSWER_HOURLY = 20;
const masjidAnswerRate = new Map(); // key -> { hour, count }
function masjidRate(key) {
  const hour = new Date().toISOString().slice(0, 13);
  const r = masjidAnswerRate.get(key);
  if (!r || r.hour !== hour) { masjidAnswerRate.set(key, { hour, count: 1 }); return { ok: true, count: 1, limit: MASJID_ANSWER_HOURLY }; }
  r.count += 1;
  return { ok: r.count <= MASJID_ANSWER_HOURLY, count: r.count, limit: MASJID_ANSWER_HOURLY };
}

const ILM_API_URL = (process.env.ILM_API_URL || 'https://ilm-api.vercel.app').replace(/\/$/, '');
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const MASJID_SYSTEM_PROMPT = "You are a mosque community assistant. Answer briefly and warmly in simple Ghanaian English. Use only the provided prayer times and announcements as facts. Never issue religious rulings or fatwas — refer fiqh questions to a qualified scholar.";

app.post('/v1/masjid/register', async (req, res) => {
  const b = req.body || {};
  const mosqueName = String(b.mosqueName || '').trim().slice(0, 160);
  const city = String(b.city || '').trim().slice(0, 80);
  const whatsappAdminPhone = String(b.whatsappAdminPhone || '').trim().slice(0, 32) || null;
  if (!mosqueName || !city) return res.status(400).json({ error: 'mosqueName and city are required' });
  const mosque = {
    id: 'msj_' + crypto.randomUUID(), key: req.apiKey,
    mosqueName, city, whatsappAdminPhone,
    created_at: new Date().toISOString(),
  };
  await mSave(mosque);
  res.status(201).json({ mosqueId: mosque.id, mosqueName, city, whatsappAdminPhone, created_at: mosque.created_at, notice: 'Keep this mosqueId. Only this API key can announce or answer for it.' });
});

app.post('/v1/masjid/announce', async (req, res) => {
  const b = req.body || {};
  const mosqueId = String(b.mosqueId || '').trim();
  const text = String(b.text || '').trim().slice(0, 1000);
  if (!mosqueId || !text) return res.status(400).json({ error: 'mosqueId and text are required' });
  const m = await ownMosque(mosqueId, req.apiKey);
  if (!m) return res.status(404).json({ error: 'mosque not found' });
  const a = { id: 'ann_' + crypto.randomUUID(), mosque_id: mosqueId, key: req.apiKey, text, created_at: new Date().toISOString() };
  await annSave(a);
  res.status(201).json({ announcementId: a.id, mosqueId, text, created_at: a.created_at });
});

app.post('/v1/masjid/answer', async (req, res) => {
  const b = req.body || {};
  const mosqueId = String(b.mosqueId || '').trim();
  const question = String(b.question || '').trim().slice(0, 1000);
  if (!mosqueId || !question) return res.status(400).json({ error: 'mosqueId and question are required' });
  const m = await ownMosque(mosqueId, req.apiKey);
  if (!m) return res.status(404).json({ error: 'mosque not found' });

  const rate = masjidRate(req.apiKey);
  if (!rate.ok) return res.status(429).json({ error: 'Rate limit: ' + MASJID_ANSWER_HOURLY + ' answer calls per hour per key. Try again next hour.', used_this_hour: rate.count, limit: rate.limit });

  // a. prayer times from the Ilm API (keyless endpoint; ILM_API_KEY sent when present)
  let prayerTimes = null;
  const ilmHeaders = { 'User-Agent': 'StudioAPI/1.0' };
  if (process.env.ILM_API_KEY) ilmHeaders['x-api-key'] = process.env.ILM_API_KEY;
  try {
    const r = await fetch(ILM_API_URL + '/v1/prayer-times?city=' + encodeURIComponent(m.city) + '&method=MuslimWorldLeague', { headers: ilmHeaders });
    const d = await r.json().catch(() => ({}));
    if (r.ok) prayerTimes = d;
  } catch (e) { console.error('ilm prayer-times failed:', e.message); }

  // b. this mosque's stored announcements
  const anns = await annList(mosqueId);

  // c. Groq LLM — note: gpt-oss models reject a top-level "system" param; pass it as a system-role message
  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(503).json({ error: 'Server not configured: GROQ_API_KEY env var missing on the server. Contact the operator.' });
  // this endpoint counts as 2 uses: the auth middleware already added 1 (METERED), add the second here —
  // but only once we know the LLM will actually be attempted
  await incrUsage(req.apiKey);
  const factBlock =
    'Mosque: ' + m.mosqueName + ', ' + m.city + '\n' +
    'Prayer times for today (from the Ilm API): ' + JSON.stringify(prayerTimes) + '\n' +
    'Recent announcements from this mosque (newest first): ' + (anns.length ? anns.map(a => a.text).join(' | ') : 'none yet') + '\n\n' +
    'Community member question: ' + question;
  let answer = null, groqErr = null;
  for (let attempt = 0; attempt < 2 && !answer; attempt++) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'User-Agent': 'StudioAPI/1.0' },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [{ role: 'system', content: MASJID_SYSTEM_PROMPT }, { role: 'user', content: factBlock }],
          temperature: 0.5, max_tokens: 500,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((d.error && d.error.message) || 'Groq request failed');
      answer = d.choices[0].message.content;
    } catch (e) { groqErr = e.message; }
  }
  if (!answer) return res.status(502).json({ error: 'Answer generation failed: ' + groqErr });

  res.json({ answer, sources: { prayerTimes, announcementsUsed: anns.map(a => ({ id: a.id, text: a.text, created_at: a.created_at })) } });
});

// ---------- AI Movie orchestrator (Phase F) ----------
// POST /v1/movie/create — one pipeline that chains the API's own capabilities:
//   1. Script  — Groq LLM splits the story into scenes (or accepts caller scenes)
//   2. Images  — Pollinations, one still per scene, shared seed for consistency
//   3. Animate — real image-to-video (Replicate/fal) per scene, Ken Burns fallback
//   4. Narrate — edge-tts narration per scene
//   5. Subs    — WebVTT timed to actual narration lengths
//   6. Assemble— ffmpeg: scene clips + narration + soft subtitles -> one MP4
// Heavy pipeline: counts as MOVIE_USAGE_COST uses against the monthly limit and
// is rate-limited to MOVIE_DAILY_LIMIT creates per key per day. Movies are
// owned by the key that created them; only that key can fetch them.
// New endpoints only — existing endpoints are untouched.

const MOVIE_USAGE_COST = parseInt(process.env.MOVIE_USAGE_COST) || 20;
const MOVIE_DAILY_LIMIT = parseInt(process.env.MOVIE_DAILY_LIMIT) || 3;
const MOVIE_MAX_SCENES = parseInt(process.env.MOVIE_MAX_SCENES) || 12;
const MOVIE_DIR = path.join(WORK_DIR, 'movies'); // WORK_DIR=/data on Render (persistent disk)
fs.mkdirSync(MOVIE_DIR, { recursive: true });

const memoryMovies = new Map(); // id -> movie (mirror; primary store when DB is unreachable)
const movieDayRate = new Map(); // key -> { day, count } (memory fallback for the daily limit)

// bulk usage increment for heavy endpoints (the auth middleware charges 1 per
// METERED route; /v1/movie/create is not METERED — the whole cost is charged here,
// only after validation and rate checks pass)
async function addUsage(key, n) {
  const month = currentMonth();
  if (pool && !dbBroken) {
    try {
      await pool.query('INSERT INTO api_usage (key, month, count) VALUES ($1, $2, $3) ON CONFLICT (key, month) DO UPDATE SET count = api_usage.count + $3', [key, month, n]);
      return;
    } catch (e) { lastDbError = e.message; dbBroken = true; console.error('usage bulk incr failed, falling back to memory:', e.message); }
  }
  const u = memoryUsage.get(key);
  const base = u && u.month === month ? u.count : 0;
  memoryUsage.set(key, { month, count: base + n });
}

// daily create limit: 3 movies per key per day (counts DB rows when available)
function movieToday() { return new Date().toISOString().slice(0, 10); }
async function movieDailyUsed(key) {
  const day = movieToday();
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT COUNT(*)::int AS n FROM movies WHERE key = $1 AND created_at >= $2', [key, day + 'T00:00:00Z']);
      return { day, count: r.rows[0].n };
    } catch (e) { lastDbError = e.message; console.error('movie daily count failed:', e.message); }
  }
  const mr = movieDayRate.get(key);
  return { day, count: mr && mr.day === day ? mr.count : 0 };
}
function movieDailyIncr(key) {
  const day = movieToday();
  const mr = movieDayRate.get(key);
  movieDayRate.set(key, mr && mr.day === day ? { day, count: mr.count + 1 } : { day, count: 1 });
}

// persistent storage: DB row (same resilient pattern as portfolios/workflows) + memory mirror
async function mvSave(m) {
  memoryMovies.set(m.id, m);
  if (pool && !dbBroken) {
    try {
      await pool.query(
        `INSERT INTO movies (id, key, title, status, error, aspect_ratio, language, style, narrator_voice, duration, scenes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
         ON CONFLICT (id) DO UPDATE SET status=$4, error=$5, duration=$10, scenes=$11, updated_at=NOW()`,
        [m.id, m.key, m.title, m.status, m.error || null, m.aspect, m.language, m.style || null,
         m.narratorVoice || null, m.duration || null, JSON.stringify(m.scenes || []), m.createdAt]);
      return;
    } catch (e) { lastDbError = e.message; console.error('movie save failed:', e.message); }
  }
}

async function mvGetDb(id) {
  if (!pool || dbBroken) return null;
  try {
    const r = await pool.query('SELECT * FROM movies WHERE id = $1', [id]);
    if (!r.rowCount) return null;
    const row = r.rows[0];
    return {
      id: row.id, key: row.key, title: row.title, status: row.status, error: row.error,
      aspect: row.aspect_ratio, language: row.language, style: row.style,
      narratorVoice: row.narrator_voice, duration: row.duration, scenes: row.scenes || [],
      createdAt: row.created_at, restored: true
    };
  } catch (e) { console.error('movie db read failed:', e.message); }
  return null;
}

// owner check: movie must exist AND belong to the calling key; uniform 404 otherwise
async function mvOwn(id, key) {
  const m = memoryMovies.get(id) || await mvGetDb(id);
  if (!m || m.key !== key) return null;
  return m;
}

// generic retry-once helper (each pipeline step retries once on failure)
async function retryOnce(fn, waitMs) {
  try { return await fn(); } catch (e) {
    await new Promise(r => setTimeout(r, waitMs || 2000));
    return await fn();
  }
}

// ---------- content guard: respectful Islamic content standard ----------
// Never depict prophets, companions of the Prophet, angels, God, or other sacred
// figures. Matched prompts are replaced with silhouette visuals (and calligraphy
// is the preset alternative) so the pipeline keeps running without depicting them.
const SACRED_FIGURE_RE = /\b(prophets?|muhammad|mohammed|mohamed|mahomet|rasul|rasool|messenger\s+of\s+(?:allah|god)|nabi|isa|jesus|christ|musa|moses|ibrahim|abraham|nuh|noah|yusuf|joseph|yunus|jonah|dawud|david|sulaiman|solomon|maryam|mary|sahaba|sahabah|companions?\s+of\s+the\s+prophet|companions|abu\s+bakr|umar|uthman|ali|aisha|fatimah?|khadijah?|bilal|hamza|hasan|hussein|husayn|jibril|gabriel|malaikah?|angels?|god(?:s|dess)?|deity|divine\s+(?:figure|being))\b/gi;

function contentGuard(prompt) {
  const hits = String(prompt).match(SACRED_FIGURE_RE);
  if (!hits) return { prompt: String(prompt), applied: false };
  const cleaned = String(prompt).replace(SACRED_FIGURE_RE, 'distant silhouetted figures, faces obscured, backlit');
  return { prompt: cleaned + ', respectful depiction, no faces of sacred figures', applied: true, replaced: [...new Set(hits.map(h => h.toLowerCase()))] };
}

// ---------- step 1: script (Groq LLM, same client as the Masjid service) ----------
async function groqMovieScenes(story, style, language, maxScenes) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is not configured on the server (needed when scenes are not provided)');
  const target = Math.min(Math.max(4, Math.ceil(story.length / 400)), maxScenes);
  const sys =
    'You are a film director and script writer. Split the given story into about ' + target + ' cinematic scenes (never more than ' + maxScenes + '). ' +
    'Reply with ONLY a JSON object of the form {"scenes":[{"id":"s1","visualPrompt":"...","narrationText":"..."}]}. ' +
    'visualPrompt: one sentence describing the action, PLUS a consistent visual description of the main characters (appearance, clothing) and the setting that is repeated in every scene so all scenes look consistent. ' +
    'NEVER depict prophets, companions of the Prophet, angels, God, or any sacred religious figures — describe such characters only as distant silhouettes with faces obscured, or replace them with calligraphy or landscape visuals. ' +
    'narrationText: 1-2 sentences of film narration written in ' + language + '.';
  const messages = [{ role: 'system', content: sys }, { role: 'user', content: 'Story: ' + story + (style ? '\nOverall visual style: ' + style : '') }];
  let parsed = null, lastErr = null;
  // attempt 1: JSON mode; attempt 2 (fallback): plain completion (in case JSON mode is rejected)
  for (const useJson of [true, false]) {
    try {
      const body = { model: GROQ_MODEL, messages, temperature: 0.6, max_tokens: 2500 };
      if (useJson) body.response_format = { type: 'json_object' };
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'User-Agent': 'StudioAPI/1.0' },
        body: JSON.stringify(body)
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((d.error && d.error.message) || 'Groq request failed');
      const txt = d.choices[0].message.content;
      try { parsed = JSON.parse(txt); } catch (e) {
        const m = txt.match(/\{[\s\S]*\}/);
        if (m) { try { parsed = JSON.parse(m[0]); } catch (e2) {} }
      }
      if (parsed && Array.isArray(parsed.scenes) && parsed.scenes.length) return parsed;
      throw new Error('script JSON could not be parsed');
    } catch (e) { lastErr = e; }
  }
  throw new Error(lastErr ? lastErr.message : 'script generation failed');
}

function normalizeScriptScenes(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, MOVIE_MAX_SCENES).map((s, i) => ({
    id: String((s && (s.id || s.ID)) || ('s' + (i + 1))).slice(0, 12),
    visualPrompt: String((s && (s.visualPrompt || s.visual_prompt || s.prompt)) || '').trim().slice(0, 600),
    narrationText: String((s && (s.narrationText || s.narration_text || s.narration || s.text)) || '').trim().split(/\s+/).slice(0, 120).join(' ').slice(0, 600),
    imageUrl: (s && s.image && /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1))/.test(String(s.image))) ? String(s.image) : null
  })).filter(s => s.visualPrompt || s.narrationText || s.imageUrl);
}

// ---------- step 2: scene images (Pollinations, shared seed for consistency) ----------
async function mvFetchImage(url, dest) {
  const attempt = async () => {
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 StudioAPI/1.0' } });
    if (!resp.ok) {
      const e = new Error('image fetch failed: ' + resp.status);
      e.status = resp.status;
      if (resp.status === 402 || resp.status === 429) {
        // Pollinations rate-limit body: "Retry after 11s" — honor it (fallback 5s)
        let ms = 5000;
        try {
          const body = await resp.clone().json();
          const m = String((body.error && body.error.message) || body.message || '').match(/retry after (\d+)s/i);
          if (m) ms = (parseInt(m[1]) + 1) * 1000;
        } catch (e2) {}
        e.waitMs = Math.min(ms, 60000);
      }
      throw e;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length) throw new Error('image fetch returned an empty body');
    fs.writeFileSync(dest, buf);
  };
  let tries = 0;
  for (;;) {
    try { return await attempt(); } catch (e) {
      tries++;
      const rateLimited = e.status === 402 || e.status === 429;
      const serverError = e.status >= 500;
      // rate limit: up to 4 tries honoring the provider's retry-after;
      // transient 5xx: 3 tries 5s apart; other failures: retry once
      const maxTries = rateLimited ? 4 : (serverError ? 3 : 2);
      if (tries >= maxTries) throw e;
      const wait = e.waitMs || (rateLimited ? 5000 : (serverError ? 5000 : 2000));
      console.log('movie image fetch failed (' + e.status + '), retry ' + tries + '/' + (maxTries - 1) + ' in ' + Math.round(wait / 1000) + 's: ' + e.message);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

// ---------- step 3: animate (real i2v with the same model registry; Ken Burns fallback) ----------
function movieI2VProviders() {
  const p = [];
  if (process.env.REPLICATE_API_TOKEN) p.push('replicate');
  if (process.env.FAL_KEY) p.push('fal');
  return p;
}

async function movieI2VClip(imageUrl, prompt, duration, onTick) {
  const providers = movieI2VProviders();
  let candidates = I2V_MODELS.filter(m => providers.includes(m.provider));
  if (I2V_DEFAULT_ORDER.length === 1) {
    const pref = I2V_DEFAULT_ORDER[0];
    candidates.sort((a, b) => (a.key === pref ? -1 : 0) - (b.key === pref ? -1 : 0));
  }
  let videoUrl = null, usedModel = null, lastErr = null;
  for (const entry of candidates) {
    try {
      if (entry.provider === 'replicate') {
        const pred = await replicateStart(entry, entry.build(imageUrl, prompt, duration));
        for (let i = 0; i < 150; i++) {
          const st = await replicatePoll(pred);
          if (st.status === 'succeeded') { videoUrl = extractVideoUrl(st.output); break; }
          if (st.status === 'failed' || st.status === 'canceled') throw new Error('prediction failed: ' + (st.error || 'unknown'));
          if (onTick) onTick();
          await new Promise(rs => setTimeout(rs, 5000));
        }
      } else {
        const q = await falStart(entry, entry.build(imageUrl, prompt, duration));
        const result = await falResult(q);
        videoUrl = extractVideoUrl(result);
      }
      if (!videoUrl) throw new Error('provider returned no video URL');
      usedModel = entry.provider + ':' + entry.model;
      break;
    } catch (e) {
      lastErr = e;
      console.error('movie i2v attempt failed (' + entry.provider + '/' + entry.model + '):', e.message);
      if ([401, 402, 403].includes(e.status)) break; // auth/billing errors won't fix by switching model
    }
  }
  if (!videoUrl) throw new Error(lastErr ? lastErr.message : 'all i2v models failed');
  return { videoUrl, model: usedModel };
}

async function movieKenBurns(imgPath, outPath, duration, W, H) {
  const FPS = 30;
  const N = Math.round(duration * FPS);
  const z = 'min(1+' + (0.22 / N).toFixed(6) + '*in,1.22)';
  const vf = [
    'scale=' + Math.round(W * 1.3) + ':' + Math.round(H * 1.3) + ':force_original_aspect_ratio=increase',
    'crop=' + Math.round(W * 1.3) + ':' + Math.round(H * 1.3),
    "zoompan=z='" + z + "':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=" + W + 'x' + H + ':fps=' + FPS,
    'format=yuv420p'
  ];
  await execFileAsync('ffmpeg', ['-y', '-threads', '1', '-filter_threads', '1', '-loop', '1', '-framerate', String(FPS),
    '-t', String(duration), '-i', imgPath, '-vf', vf.join(','), '-r', String(FPS),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-x264-params', 'rc-lookahead=0:ref=1', '-pix_fmt', 'yuv420p', outPath],
    { maxBuffer: 1024 * 1024 * 10, timeout: 10 * 60 * 1000 });
}

// ---------- step 5: subtitles (WebVTT timed to narration length) ----------
function vttTimestamp(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60), ms = Math.round((s - Math.floor(s)) * 1000);
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return p(h) + ':' + p(m) + ':' + p(sec) + '.' + p(ms, 3);
}
function buildVtt(cues) {
  return 'WEBVTT\n\n' + cues.map((c, i) =>
    (i + 1) + '\n' + vttTimestamp(c.start) + ' --> ' + vttTimestamp(c.end) + '\n' + String(c.text).replace(/\r?\n/g, ' ')
  ).join('\n\n') + '\n';
}

function movieLangCode(language) {
  const l = String(language || '').toLowerCase();
  if (/arab|^ar\b/.test(l)) return 'ar';
  if (/fran|french|^fr\b/.test(l)) return 'fr';
  return 'en';
}
function movieDefaultVoice(language) {
  return movieLangCode(language) === 'ar' ? 'ar-SA-HamedNeural' : 'en-US-GuyNeural';
}

// ---------- spec upgrades: retries, character seeds, mood music, job queue, boot resume ----------
// retry up to N attempts with a wait between (Pollinations-friendly)
async function retryAsync(fn, attempts, waitMs) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

// deterministic seed from text (character block -> same seed every scene)
function movieSeedFromText(t) {
  let h = 7;
  for (const c of String(t || 'x')) h = (h * 31 + c.charCodeAt(0)) % 1000000;
  return h;
}

// extract one fixed CHARACTER & SETTING block from the story (age, build,
// clothing colors, one distinctive feature, setting) for visual consistency
async function groqCharacterBlock(story, title) {
  const key = process.env.GROQ_API_KEY;
  if (!key || !story) return null;
  try {
    const sys = 'Extract the visual identity of this film for consistent AI image generation. ' +
      'Describe the main character(s): age, build, clothing colors, ONE distinctive feature, plus the setting. ' +
      'One short paragraph, max 60 words, no names of real or sacred figures. Reply with ONLY the paragraph.';
    const body = { model: GROQ_MODEL, messages: [{ role: 'system', content: sys }, { role: 'user', content: (title ? 'Title: ' + title + '. ' : '') + 'Story: ' + String(story).slice(0, 4000) }], temperature: 0.4, max_tokens: 200 };
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'User-Agent': 'StudioAPI/1.0' }, body: JSON.stringify(body)
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return null;
    const t = String((d.choices && d.choices[0] && d.choices[0].message.content) || '').trim();
    return t ? t.slice(0, 400) : null;
  } catch (e) { return null; }
}

// ---------- bundled mood music (royalty-free by construction: synthesized) ----------
// 5 royalty-free beds in <WORK_DIR>/movies/assets/music/<mood>.mp3, generated
// on demand with ffmpeg. Replace the files with any royalty-free track of the
// same name to use real music instead.
const MOVIE_MOODS = ['ambient', 'nasheed', 'dramatic', 'calm', 'upbeat'];
const musicTrackCache = new Map(); // mood -> {promise}
function ensureMusicTracks(mood) {
  const m = MOVIE_MOODS.includes(String(mood || '')) ? String(mood) : 'calm';
  const dir = path.join(MOVIE_DIR, 'assets', 'music');
  const p = path.join(dir, m + '.mp3');
  if (fs.existsSync(p)) return Promise.resolve(p);
  if (!musicTrackCache.has(m)) {
    musicTrackCache.set(m, (async () => {
      fs.mkdirSync(dir, { recursive: true });
      const synth = {
        ambient: ['-f','lavfi','-t','40','-i','sine=frequency=110:sample_rate=44100','-f','lavfi','-t','40','-i','sine=frequency=165:sample_rate=44100','-f','lavfi','-t','40','-i','sine=frequency=220:sample_rate=44100','-filter_complex','[0:a][1:a][2:a]amix=inputs=3:normalize=0,tremolo=f=0.25:d=0.35,volume=0.25,afade=t=in:st=0:d=3,afade=t=out:st=37:d=3[a]','-map','[a]'],
        nasheed: ['-f','lavfi','-t','40','-i','sine=frequency=196:sample_rate=44100','-f','lavfi','-t','40','-i','sine=frequency=294:sample_rate=44100','-f','lavfi','-t','40','-i','anoisesrc=color=brown:sample_rate=44100:amplitude=0.5','-filter_complex','[2:a]lowpass=f=180,tremolo=f=2:d=1,volume=0.7[drum];[0:a][1:a]amix=inputs=2:normalize=0,tremolo=f=0.5:d=0.3,volume=0.16[hum];[hum][drum]amix=inputs=2:normalize=0,alimiter=limit=0.9,afade=t=in:st=0:d=3,afade=t=out:st=37:d=3[a]','-map','[a]'],
        dramatic: ['-f','lavfi','-t','40','-i','sine=frequency=55:sample_rate=44100','-f','lavfi','-t','40','-i','sine=frequency=65.41:sample_rate=44100','-f','lavfi','-t','40','-i','anoisesrc=color=pink:sample_rate=44100:amplitude=0.4','-filter_complex','[2:a]lowpass=f=300,tremolo=f=1.5:d=1,volume=0.5[pulse];[0:a][1:a]amix=inputs=2:normalize=0,tremolo=f=0.2:d=0.5,volume=0.35[drone];[drone][pulse]amix=inputs=2:normalize=0,alimiter=limit=0.9,afade=t=in:st=0:d=2,afade=t=out:st=38:d=2[a]','-map','[a]'],
        calm: ['-f','lavfi','-t','40','-i','sine=frequency=261.63:sample_rate=44100','-f','lavfi','-t','40','-i','sine=frequency=329.63:sample_rate=44100','-filter_complex','[0:a][1:a]amix=inputs=2:normalize=0,tremolo=f=0.15:d=0.25,volume=0.2,lowpass=f=2000,afade=t=in:st=0:d=4,afade=t=out:st=36:d=4[a]','-map','[a]'],
        upbeat: ['-f','lavfi','-t','40','-i','sine=frequency=220:sample_rate=44100','-f','lavfi','-t','40','-i','sine=frequency=277.18:sample_rate=44100','-f','lavfi','-t','40','-i','sine=frequency=329.63:sample_rate=44100','-f','lavfi','-t','40','-i','anoisesrc=color=white:sample_rate=44100:amplitude=0.25','-filter_complex','[3:a]highpass=f=2000,tremolo=f=4:d=1,volume=0.25[tick];[0:a][1:a][2:a]amix=inputs=3:normalize=0,tremolo=f=5:d=0.4,volume=0.22[chord];[chord][tick]amix=inputs=2:normalize=0,alimiter=limit=0.9,afade=t=in:st=0:d=2,afade=t=out:st=38:d=2[a]','-map','[a]']
      }[m];
      await execFileAsync('ffmpeg', ['-y', '-v', 'error'].concat(synth, ['-c:a', 'libmp3lame', '-b:a', '128k', p]), { maxBuffer: 1024 * 1024 * 10, timeout: 120000 });
      return p;
    })().catch(e => { musicTrackCache.delete(m); throw e; }));
  }
  return musicTrackCache.get(m);
}

// ---------- sequential background worker: one movie job at a time ----------
// protects free-tier quotas (Pollinations 1 image/45s per IP, ffmpeg CPU)
const movieQueue = [];
let movieBusy = false;
function movieEnqueue(name, fn) {
  return new Promise(resolve => {
    movieQueue.push({ name, fn, resolve });
    movieQueueDrain();
  });
}
async function movieQueueDrain() {
  if (movieBusy) return;
  movieBusy = true;
  try {
    while (movieQueue.length) {
      const job = movieQueue.shift();
      try { await job.fn(); } catch (e) { console.error('movie job failed (' + job.name + '):', e.message); }
      job.resolve();
    }
  } finally { movieBusy = false; }
}

// boot resume: re-queue unfinished movies; per-step files on disk are reused
async function resumeUnfinishedMovies() {
  if (!pool || dbBroken) return;
  try {
    const r = await pool.query("SELECT id FROM movies WHERE status IN ('queued','scripting','processing','dubbing','assembling') AND created_at > NOW() - INTERVAL '2 days' ORDER BY created_at ASC");
    if (!r.rowCount) return;
    console.log('movie resume: ' + r.rowCount + ' unfinished job(s), re-queueing');
    for (const row of r.rows) {
      const m = await mvGetDb(row.id);
      if (!m || !Array.isArray(m.scenes) || !m.scenes.length) continue;
      m.baseUrl = process.env.PUBLIC_BASE_URL || ('http://localhost:' + PORT);
      // a film that keeps dying on the platform must stop re-queueing forever
      m.resumeCount = (m.resumeCount || 0) + 1;
      if (m.resumeCount > 3) {
        m.status = 'failed';
        m.error = 'render kept being interrupted (the instance restarted ' + (m.resumeCount - 1) + ' times); nothing was lost, retry the film';
        await mvSave(m);
        console.error('movie ' + m.id + ' gave up after ' + m.resumeCount + ' resumes');
        continue;
      }
      m.status = 'queued'; m.step = 'images'; m.currentScene = 0; m.totalScenes = m.scenes.length; m.progress = 5;
      await mvSave(m);
      movieEnqueue('resume:' + m.id, async () => {
        try {
          // reuse the stills that already rendered (imageSourceUrl is public and
          // still fetchable) and replay the original render options, so a resumed
          // film keeps its music, captions and chained shots instead of quietly
          // coming back plainer than the one that was ordered.
          const ro = m.render || {};
          await runMoviePipeline(m, {
            story: null,
            providedScenes: m.scenes.map(s => ({ ...s, image: s.imageSourceUrl || null, imageUrl: null })),
            language: m.language, style: m.style, rate: ro.rate || '+0%',
            W: m.aspect === '16:9' ? 1280 : 1080, H: m.aspect === '16:9' ? 720 : 1920,
            musicUrl: ro.musicUrl || null, musicVolume: ro.musicVolume, burnSubtitles: !!ro.burnSubtitles,
            titleCard: !!ro.titleCard, musicMood: ro.musicMood || null, crossfade: ro.crossfade !== false,
            continuity: m.continuity || 'chained',
            resume: true
          });
        } catch (e) { console.error('movie resume failed (' + m.id + '):', e.message); }
      });
    }
  } catch (e) { console.error('movie resume scan failed:', e.message); }
}

// ---------- stage 5-6 (shared by the pipeline and the retry endpoint) ----------
const MOVIE_CAP_FONT = fs.existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf') ? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' : FONT;

function movieSceneFiles(dir, i) {
  return { clip: path.join(dir, 'clip' + i + '.mp4'), narr: path.join(dir, 'narr' + i + '.mp3'), img: path.join(dir, 'scene' + i + '.jpg') };
}

// recompute per-scene segment durations from the assets on disk (scene length =
// max(clip, narration) + small beat); returns the VTT cues
async function computeSceneDurations(movie, dir, included, overlap, titleShift) {
  const ov = overlap || 0; // seconds trimmed at every boundary (crossfade)
  const shift = titleShift ? (2.5 - ov) : 0; // title card plays before the first scene
  const durs = [], cues = [], starts = [];
  let cursor = shift;
  for (const i of included) {
    const sc = movie.scenes[i];
    const f = movieSceneFiles(dir, i);
    const clipDur = await mediaDuration(f.clip);
    const narrDur = fs.existsSync(f.narr) ? await mediaDuration(f.narr) : 0;
    const segDur = Math.max(clipDur, narrDur) + (narrDur ? 0.3 : 0);
    sc.duration = Math.round(segDur * 100) / 100;
    sc.assembled = true;
    starts.push(cursor);
    if (sc.narration) cues.push({ start: cursor, end: cursor + segDur - ov, text: sc.narration });
    cursor += segDur - ov;
  }
  return { cues, starts, total: cursor + ov };
}

// hard-sub captions for players that ignore soft subtitle tracks (e.g. WhatsApp)
// Note: DejaVu has no Arabic glyphs — use the soft mov_text track + VTT for Arabic.
function burnedCaptionFilters(text, W) {
  const size = Math.max(30, Math.round(W / 22));
  const maxChars = Math.floor((W - 140) / (size * 0.55));
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (t.length > maxChars && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  const shown = lines.slice(0, 3).map(l => escDrawtext(l));
  const out = [];
  shown.forEach((ln, idx) => {
    const y = 'h*0.88-' + Math.round((shown.length - 1 - idx) * size * 1.4);
    out.push('drawtext=fontfile=' + MOVIE_CAP_FONT + ":text='" + ln + "':fontcolor=white:fontsize=" + size + ":x=(w-text_w)/2:y=" + y + ":box=1:boxcolor=black@0.55:boxborderw=14");
  });
  return out;
}

// assemble: optional title card -> per-scene segments (clip + narration, video
// padded to audio, optional burned captions) -> concat -> optional music bed
// with narration ducking -> soft mov_text subtitles -> final.mp4
async function assembleMovie(movie, dir, opts) {
  const W = opts.W, H = opts.H;
  const included = [];
  for (let i = 0; i < movie.scenes.length; i++) if (fs.existsSync(movieSceneFiles(dir, i).clip)) included.push(i);
  if (!included.length) throw new Error('no scene clips on disk to assemble (assets were not generated for this movie)');
  for (const sc of movie.scenes) sc.assembled = false;
  const overlap = (opts.crossfade && included.length + (opts.titleCard ? 1 : 0) > 1) ? 0.5 : 0;
  const { cues, starts } = await computeSceneDurations(movie, dir, included, overlap, opts.titleCard);
  fs.writeFileSync(path.join(dir, 'subtitles.vtt'), buildVtt(cues));

  const totalSegs = included.length + (opts.titleCard ? 1 : 0);
  const segFiles = [];

  // optional opening title card
  if (opts.titleCard) {
    const tPath = path.join(dir, 'title.mp4');
    const size = Math.max(36, Math.round(W / 14));
    const vf = "drawtext=fontfile=" + FONT + ":text='" + escDrawtext(movie.title) + "':fontcolor=#F3ECDA:fontsize=" + size +
      ":x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=#0E2A2B@0.75:boxborderw=40" +
      ',fade=t=in:st=0:d=0.5,fade=t=out:st=2.0:d=0.5,format=yuv420p';
    await execFileAsync('ffmpeg', ['-y', '-f', 'lavfi', '-t', '2.5', '-i', 'color=c=0x0E2A2B:s=' + W + 'x' + H + ':r=30',
      '-f', 'lavfi', '-t', '2.5', '-i', 'anullsrc=r=44100:cl=mono',
      '-vf', vf, '-r', '30', '-threads', '1', '-filter_threads', '1',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-x264-params', 'rc-lookahead=0:ref=1',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-pix_fmt', 'yuv420p', tPath],
      { maxBuffer: 1024 * 1024 * 10, timeout: 5 * 60 * 1000 });
    segFiles.push(tPath);
    if (opts.onProgress) opts.onProgress(segFiles.length / totalSegs);
  }

  for (const i of included) {
    const sc = movie.scenes[i];
    const f = movieSceneFiles(dir, i);
    const hasNarr = fs.existsSync(f.narr);
    const clipDur = await mediaDuration(f.clip);
    const padDur = Math.max(0, sc.duration - clipDur);
    const args = ['-y', '-i', f.clip];
    if (hasNarr) args.push('-i', f.narr); else args.push('-f', 'lavfi', '-t', sc.duration.toFixed(3), '-i', 'anullsrc=r=44100:cl=mono');
    let vchain = 'tpad=stop_mode=clone:stop_duration=' + padDur.toFixed(3) +
      ',scale=' + W + ':' + H + ':force_original_aspect_ratio=increase,crop=' + W + ':' + H;
    if (opts.burnSubtitles && sc.narration) vchain += ',' + burnedCaptionFilters(sc.narration, W).join(',');
    vchain += ',format=yuv420p';
    const fc = '[0:v]' + vchain + '[v]' + (hasNarr ? ';[1:a]apad[a]' : '');
    args.push('-filter_complex', fc, '-map', '[v]', '-map', hasNarr ? '[a]' : '1:a',
      '-t', sc.duration.toFixed(3), '-r', '30', '-threads', '1', '-filter_threads', '1',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-x264-params', 'rc-lookahead=0:ref=1',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', path.join(dir, 'seg' + i + '.mp4'));
    await execFileAsync('ffmpeg', args, { maxBuffer: 1024 * 1024 * 10, timeout: 10 * 60 * 1000 });
    segFiles.push(path.join(dir, 'seg' + i + '.mp4'));
    if (opts.onProgress) opts.onProgress(segFiles.length / totalSegs);
  }

  let concatPath = path.join(dir, 'concat.mp4');
  if (overlap) {
    // 0.5s crossfades between segments (video xfade + audio acrossfade).
    // Folded pairwise: one xfade at a time, so only two streams are ever decoded.
    // The single graph that took every segment at once needed all of them decoded
    // simultaneously, which restarted the whole free Render instance mid-assembly
    // on a five scene film and left it looping resume -> OOM -> resume.
    const segDurs = (opts.titleCard ? [2.5] : []).concat(included.map(i => movie.scenes[i].duration || 5));
    const enc = ['-r', '30', '-threads', '1', '-filter_threads', '1',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-x264-params', 'rc-lookahead=0:ref=1',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100'];
    let cur = segFiles[0];
    let curDur = segDurs[0];
    let prevTmp = null;
    for (let k = 1; k < segFiles.length; k++) {
      const outPath = path.join(dir, 'xf' + k + '.mp4');
      const off = Math.max(0, curDur - overlap);
      const fc = '[0:v][1:v]xfade=transition=fade:duration=' + overlap + ':offset=' + off.toFixed(3) + '[v];' +
        '[0:a][1:a]acrossfade=d=' + overlap + '[a]';
      await execFileAsync('ffmpeg', ['-y', '-i', cur, '-i', segFiles[k], '-filter_complex', fc,
        '-map', '[v]', '-map', '[a]'].concat(enc, [outPath]),
        { maxBuffer: 1024 * 1024 * 10, timeout: 10 * 60 * 1000 });
      curDur = curDur + segDurs[k] - overlap;
      if (prevTmp) { try { fs.unlinkSync(prevTmp); } catch (e) {} }
      prevTmp = outPath;
      cur = outPath;
      if (opts.onProgress) opts.onProgress(0.75 + 0.2 * (k / Math.max(1, segFiles.length - 1)));
    }
    fs.copyFileSync(cur, concatPath);
    try { fs.unlinkSync(cur); } catch (e) {}
  } else {
    const listPath = path.join(dir, 'list.txt');
    fs.writeFileSync(listPath, segFiles.map(f => "file '" + f.replace(/'/g, "'\\''") + "'").join('\n'));
    await execFileAsync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', concatPath], { maxBuffer: 1024 * 1024 * 10, timeout: 10 * 60 * 1000 });
  }

  // optional music bed: looped under the movie, automatically ducked by narration
  let bodyPath = concatPath;
  if (opts.musicFile && fs.existsSync(opts.musicFile)) {
    const mixedPath = path.join(dir, 'mixed.mp4');
    const vol = Math.min(Math.max(parseFloat(opts.musicVolume) || 0.3, 0.05), 1);
    const fc = '[1:a]volume=' + vol.toFixed(2) + '[m];[m][0:a]sidechaincompress=threshold=0.02:ratio=6:attack=200:release=1000[duck];' +
      '[duck][0:a]amix=inputs=2:duration=first:dropout_transition=2,volume=2.0,alimiter=limit=0.95[a]';
    await execFileAsync('ffmpeg', ['-y', '-i', concatPath, '-stream_loop', '-1', '-i', opts.musicFile,
      '-filter_complex', fc, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-shortest', mixedPath],
      { maxBuffer: 1024 * 1024 * 10, timeout: 10 * 60 * 1000 });
    bodyPath = mixedPath;
  }

  const finalPath = path.join(dir, 'final.mp4');
  try {
    await execFileAsync('ffmpeg', ['-y', '-i', bodyPath, '-i', path.join(dir, 'subtitles.vtt'),
      '-map', '0', '-map', '1', '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text',
      '-metadata:s:s:0', 'language=' + movieLangCode(movie.language), finalPath],
      { maxBuffer: 1024 * 1024 * 10, timeout: 5 * 60 * 1000 });
  } catch (e) {
    console.error('movie subtitle mux failed, shipping without embedded subs:', e.message);
    fs.copyFileSync(bodyPath, finalPath);
    movie.subtitleNote = 'subtitles available at /v1/movie/' + movie.id + '/subtitles (embedding failed: ' + e.message + ')';
  }
  for (const f of segFiles) { try { fs.unlinkSync(f); } catch (e) {} }
  if (opts.titleCard) { try { fs.unlinkSync(path.join(dir, 'title.mp4')); } catch (e) {} }
  for (const f of [path.join(dir, 'list.txt'), concatPath, path.join(dir, 'mixed.mp4')]) { try { fs.unlinkSync(f); } catch (e) {} }
  return Math.round((await mediaDuration(finalPath)) * 100) / 100;
}

// light metering for the companion endpoints (script preview, assembly retry)
async function chargeUse(key, n) {
  const { used } = await getUsage(key);
  if (used + n > FREE_MONTHLY_LIMIT) return false;
  await addUsage(key, n);
  return true;
}

// ---------- the pipeline ----------
async function runMoviePipeline(movie, opts) {
  const dir = path.join(MOVIE_DIR, movie.id);
  fs.mkdirSync(dir, { recursive: true });
  const W = opts.W, H = opts.H;
  const continuity = normalizeContinuity(opts.continuity === undefined ? movie.continuity : opts.continuity);
  movie.continuity = continuity;
  try {
    movie.status = 'scripting';
    movie.step = 'script';
    movie.progress = 3;
    await mvSave(movie);

    // 1. script
    let rawScenes;
    if (opts.providedScenes) rawScenes = opts.providedScenes;
    else rawScenes = await retryOnce(() => groqMovieScenes(opts.story, opts.style, opts.language, MOVIE_MAX_SCENES), 3000);
    const scenes = normalizeScriptScenes(rawScenes);
    if (!scenes.length) throw new Error('script produced no usable scenes');
    // character consistency: one fixed character/setting block (age, build,
    // clothing colors, distinctive feature) prepended to EVERY scene prompt, and
    // a seed derived from that block so all scenes share the same visual identity.
    // On resume the block is already baked into the stored prompts.
    if (!opts.resume) {
      const characterBlock = await groqCharacterBlock(opts.story, movie.title);
      if (characterBlock) {
        movie.characterBlock = characterBlock;
        for (const sc of scenes) if (sc.visualPrompt) sc.visualPrompt = (characterBlock + ', ' + sc.visualPrompt).slice(0, 700);
      }
    }
    const movieSeed = movieSeedFromText(movie.characterBlock || movie.title || movie.id);
    for (const sc of scenes) {
      if (sc.visualPrompt) {
        const g = contentGuard(sc.visualPrompt);
        sc.visualPrompt = g.prompt;
        sc.contentGuard = g.applied ? { applied: true, replaced: g.replaced } : undefined;
      }
    }
    // storyboard is visible right away; per-scene outputs are filled in as they finish
    movie.scenes = scenes.map((sc, idx) => {
      const prev = (opts.resume && opts.providedScenes && opts.providedScenes[idx]) || null;
      return {
        id: sc.id, visualPrompt: sc.visualPrompt || (prev && prev.visualPrompt) || null,
        narration: sc.narrationText || (prev && prev.narration) || null,
        contentGuard: sc.contentGuard || (prev && prev.contentGuard) || null,
        imageUrl: (prev && prev.imageUrl) || null, imageSourceUrl: (prev && prev.imageSourceUrl) || null,
        clipUrl: (prev && prev.clipUrl) || null, narrationUrl: (prev && prev.narrationUrl) || null,
        clipSource: (prev && prev.clipSource) || null, duration: (prev && prev.duration) || null,
        narrationError: (prev && prev.narrationError) || null
      };
    });
    movie.status = 'processing';
    movie.totalScenes = movie.scenes.length;
    const scenePlan = chainPlan(movie.scenes.length, continuity);
    const publishedSceneImages = new Map(); // scene index -> public URL
    let prevEndFrame = null; // public URL of the previous clip's final frame
    movie.currentScene = 0;
    movie.progress = 6;
    await mvSave(movie);

    // 2-4. per scene: image -> animate -> narration (sequential, retry each step once)
    const per = 74 / scenes.length; // progress 6 -> 80
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      const out = movie.scenes[i]; // storyboard object created above, enriched per step
      const assetBase = movie.baseUrl + '/v1/movie/' + movie.id + '/scenes/' + i + '/';

      // image (idempotent: a file from a previous run is reused; 3 attempts, 5s apart)
      let imageUrl = sc.imageUrl;
      let cfPrompt = null;
      if (!imageUrl) {
        const fullPrompt = [sc.visualPrompt, opts.style, 'cinematic film still, consistent characters and setting across all scenes'].filter(Boolean).join(', ');
        if (cfReady) {
          cfPrompt = fullPrompt; // Cloudflare Workers AI: bytes written directly below
        } else {
          const params = new URLSearchParams({ width: String(W), height: String(H), nologo: 'true', seed: String(movieSeed) });
          imageUrl = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(fullPrompt) + '?' + params;
        }
      }
      const imgPath = path.join(dir, 'scene' + i + '.jpg');
      movie.step = 'images';
      await mvSave(movie);
      if (!fs.existsSync(imgPath) && !(await mvRestoreAsset(movie.id, 'scene' + i + '.jpg'))) {
        try {
          if (cfPrompt) {
            await retryAsync(async () => {
              const { buf } = await cfGenerateImage(cfPrompt, movieSeed);
              fs.writeFileSync(imgPath, buf);
            }, 3, 5000);
            out.imageSourceUrl = assetBase + 'image';
          } else {
            await retryAsync(() => mvFetchImage(imageUrl, imgPath), 3, 5000);
            out.imageSourceUrl = imageUrl;
          }
        } catch (e) {
          // one bad still should cost one scene, not the whole film
          out.imageError = e.message;
          console.error('movie scene ' + i + ' image failed, dropping the scene:', e.message);
          movie.currentScene = i + 1;
          movie.progress = Math.round(6 + per * (i + 1));
          await mvSave(movie);
          continue;
        }
      }
      await mvSaveAsset(movie.id, 'scene' + i + '.jpg');
      out.imageUrl = assetBase + 'image';
      movie.progress = Math.round(6 + per * (i + 0.4));
      await mvSave(movie);

      // animate (real motion; Ken Burns fallback so the movie still completes; idempotent)
      const clipPath = path.join(dir, 'clip' + i + '.mp4');
      const animPrompt = [sc.visualPrompt, opts.style].filter(Boolean).join(', ') || 'slow cinematic camera drift, subtle motion';
      if (!fs.existsSync(clipPath)) await mvRestoreAsset(movie.id, 'clip' + i + '.mp4');
      // which still opens this shot: the previous clip's last frame when the
      // film is chained, otherwise this scene's own image
      let startImageUrl = null;
      out.startsFrom = scenePlan[i] ? scenePlan[i].startsFrom : 'scene_image';
      if (out.startsFrom === 'previous_clip' && prevEndFrame) startImageUrl = prevEndFrame;
      if (!startImageUrl) {
        if (!publishedSceneImages.has(i)) {
          try {
            publishedSceneImages.set(i, await publishImageForProvider(fs.readFileSync(imgPath), movie.baseUrl, sc.visualPrompt));
          } catch (e) {
            publishedSceneImages.set(i, null);
            console.error('movie scene ' + i + ' could not publish its still:', e.message);
          }
        }
        startImageUrl = publishedSceneImages.get(i) || out.imageSourceUrl || imageUrl;
        out.startsFrom = 'scene_image';
      }
      if (!fs.existsSync(clipPath)) {
        movie.step = 'animate';
        await mvSave(movie);
        if (movieI2VProviders().length) {
          try {
            const r = await retryOnce(() => movieI2VClip(startImageUrl, animPrompt, 5), 3000);
            await downloadVideoToDisk(r.videoUrl, clipPath);
            out.clipSource = r.model;
            out.clipError = null;
          } catch (e) {
            out.clipError = e.message; // surfaced in the scene, not just the log
            console.error('movie scene ' + i + ' i2v failed, using Ken Burns fallback:', e.message);
          }
        }
        if (!out.clipSource) {
          await retryOnce(() => movieKenBurns(imgPath, clipPath, 5, W, H), 2000);
          out.clipSource = 'ken_burns';
        }
        await mvSaveAsset(movie.id, 'clip' + i + '.mp4');
      } else if (!out.clipSource) {
        out.clipSource = 'restored'; // came from the DB mirror
      }

      // hand this shot's final frame to the next scene
      prevEndFrame = null;
      if (continuity === 'chained' && i < movie.scenes.length - 1) {
        try {
          prevEndFrame = await publishImageForProvider(await lastFrameOfClip(clipPath, W, H), movie.baseUrl, 'continuity frame');
        } catch (e) {
          console.error('movie scene ' + i + ' continuity frame failed:', e.message);
        }
      }
      out.clipUrl = assetBase + 'clip';
      movie.progress = Math.round(6 + per * (i + 0.8));
      await mvSave(movie);

      // narration (silent-scene fallback; idempotent)
      if (sc.narrationText) {
        const narrPath = path.join(dir, 'narr' + i + '.mp3');
        movie.step = 'narration';
        await mvSave(movie);
        if (!fs.existsSync(narrPath)) await mvRestoreAsset(movie.id, 'narr' + i + '.mp3');
        if (!fs.existsSync(narrPath)) {
          try {
            await retryOnce(() => speakText(sc.narrationText, movie.narratorVoice, opts.rate, narrPath), 2000);
            await mvSaveAsset(movie.id, 'narr' + i + '.mp3');
          } catch (e) {
            out.narrationError = 'narration failed: ' + e.message; // scene continues silently
          }
        }
        if (fs.existsSync(narrPath)) out.narrationUrl = assetBase + 'narration';
      }
      movie.currentScene = i + 1;
      movie.progress = Math.round(6 + per * (i + 1));
      await mvSave(movie);
    }

    if (isAllFallback(movie.scenes)) {
      movie.motionNote = 'no scene got provider motion (image-to-video unconfigured or failing); Ken Burns pans were used instead';
    }
    await mvSave(movie);

    // 5+6. subtitles + assembly (shared with POST /v1/movie/:id/assemble)
    movie.status = 'assembling';
    movie.step = 'subtitles';
    movie.progress = 82;
    await mvSave(movie);
    let musicFile = null;
    if (opts.musicUrl) {
      musicFile = path.join(dir, 'music.mp3');
      try {
        await retryOnce(() => downloadVideoToDisk(opts.musicUrl, musicFile), 2000);
      } catch (e) {
        musicFile = null; // music is optional: finish the movie without it
        movie.musicNote = 'music download failed, rendered without music: ' + e.message;
      }
    } else if (fs.existsSync(path.join(dir, 'music.mp3'))) {
      musicFile = path.join(dir, 'music.mp3'); // resumed run: keep the bed already on disk
    } else if (opts.musicMood && opts.musicMood !== 'none') {
      try { musicFile = await ensureMusicTracks(opts.musicMood); }
      catch (e) { movie.musicNote = 'music bed unavailable: ' + e.message; }
    }
    movie.step = 'assembly';
    await mvSave(movie);
    movie.duration = await assembleMovie(movie, dir, {
      W, H, musicFile, musicVolume: opts.musicVolume,
      burnSubtitles: opts.burnSubtitles, titleCard: opts.titleCard, crossfade: opts.crossfade,
      onProgress: (f) => { movie.progress = Math.round(82 + 13 * f); }
    });
    await mvSaveAsset(movie.id, 'final.mp4');
    await mvSaveAsset(movie.id, 'subtitles.vtt');
    movie.status = 'done';
    movie.progress = 100;
    movie.error = null;
    await mvSave(movie);
    fireMovieWebhook(movie);
  } catch (e) {
    // assembly/pipeline failure: per-scene assets are preserved and still fetchable
    movie.status = movie.scenes && movie.scenes.length && movie.scenes.some(s => s.clipUrl) ? 'partial' : 'failed';
    movie.error = e.message;
    await mvSave(movie);
    fireMovieWebhook(movie);
  }
}

function fireMovieWebhook(movie) {
  if (!movie.webhook) return;
  fetch(movie.webhook, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: movie.status === 'done' ? 'movie.completed' : 'movie.failed',
      movie_id: movie.id, status: movie.status, error: movie.error || null,
      videoUrl: movie.status === 'done' ? '/v1/movie/' + movie.id + '/file' : null,
      duration: movie.duration || null, scenes: movie.scenes || []
    })
  }).catch(e => console.error('movie webhook failed:', e.message));
}

// ---------- endpoints ----------
app.post('/v1/movie/create', async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim().slice(0, 160);
  const story = String(b.story || '').trim().slice(0, 4000);
  const providedScenes = Array.isArray(b.scenes) && b.scenes.length ? b.scenes : null;
  if (!title) return res.status(400).json({ error: 'title is required' });
  if (!story && !providedScenes) return res.status(400).json({ error: 'story or scenes is required' });
  if (providedScenes && providedScenes.length > MOVIE_MAX_SCENES) return res.status(400).json({ error: 'too many scenes (max ' + MOVIE_MAX_SCENES + ')' });

  const language = String(b.language || 'English').trim().slice(0, 40);
  const style = String(b.style || '').trim().slice(0, 300);
  const rate = /^-?\d+%$/.test(String(b.narrationRate || '')) ? String(b.narrationRate) : '+0%';
  const ar = String(b.aspectRatio || b.aspect || '9:16').toLowerCase();
  const aspect = (ar === '16:9' || ar === 'wide' || ar === 'landscape' || ar === 'widescreen') ? '16:9' : '9:16';
  const W = aspect === '16:9' ? 1280 : 1080;
  const H = aspect === '16:9' ? 720 : 1920;
  const narratorVoice = VOICE_RE.test(String(b.narratorVoice || '')) ? String(b.narratorVoice) : movieDefaultVoice(language);
  const hook = /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1))/.test(String(b.webhook || '')) ? String(b.webhook) : null;
  const musicUrl = /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1))/.test(String(b.musicUrl || '')) ? String(b.musicUrl) : null;
  const musicVolume = Math.min(Math.max(parseFloat(b.musicVolume) || 0.3, 0.05), 1);
  const burnSubtitles = !!(b.burnSubtitles || b.burnSubs);
  const titleCard = b.titleCard === undefined ? false : !!b.titleCard;
  const musicMood = MOVIE_MOODS.concat('none').includes(String(b.musicMood || '').trim().toLowerCase()) ? String(b.musicMood).trim().toLowerCase() : null;
  const crossfade = b.crossfade === undefined ? true : !!b.crossfade; // 0.5s crossfades between scenes
  const continuity = normalizeContinuity(b.continuity === undefined ? 'chained' : b.continuity); // chained shots by default

  // daily rate limit: 3 movie creates per key per day
  const daily = await movieDailyUsed(req.apiKey);
  if (daily.count >= MOVIE_DAILY_LIMIT) {
    return res.status(429).json({ error: 'Rate limit: ' + MOVIE_DAILY_LIMIT + ' movie creations per key per day. Try again tomorrow.', used_today: daily.count, limit: MOVIE_DAILY_LIMIT });
  }

  // heavy pipeline: the whole call counts as 20 uses against the monthly limit
  const { month, used } = await getUsage(req.apiKey);
  if (used + MOVIE_USAGE_COST > FREE_MONTHLY_LIMIT) {
    return res.status(429).json({ error: 'Free monthly limit too low for a movie render (needs ' + MOVIE_USAGE_COST + ' uses). Email support to upgrade.', month, limit: FREE_MONTHLY_LIMIT, used, needed: MOVIE_USAGE_COST });
  }
  await addUsage(req.apiKey, MOVIE_USAGE_COST);
  res.setHeader('X-Usage-Limit', FREE_MONTHLY_LIMIT);
  res.setHeader('X-Usage-Remaining', Math.max(0, FREE_MONTHLY_LIMIT - used - MOVIE_USAGE_COST));

  const id = 'mov_' + crypto.randomUUID();
  const movie = {
    id, key: req.apiKey, title, status: 'queued', progress: 0, error: null,
    aspect, language, style, narratorVoice, duration: null, scenes: [], continuity,
    render: { musicUrl, musicVolume, burnSubtitles, titleCard, musicMood, crossfade, style, rate },
    createdAt: new Date().toISOString(),
    webhook: hook, baseUrl: 'https://' + req.get('host')
  };
  await mvSave(movie);
  movieDailyIncr(req.apiKey);
  // sequential background worker: one movie renders at a time, the rest queue
  movieEnqueue('create:' + id, async () => {
    try { await runMoviePipeline(movie, { story, providedScenes, language, style, rate, W, H, musicUrl, musicVolume, burnSubtitles, titleCard, musicMood, crossfade, continuity }); }
    catch (e) { console.error('movie pipeline crashed:', e.message); }
  });
  res.status(202).json({
    movie_id: id, jobId: id, status: 'queued',
    poll: '/v1/movie/' + id, status_url: '/v1/movie/' + id,
    video_url: '/v1/movie/' + id + '/file', subtitles_url: '/v1/movie/' + id + '/subtitles',
    scene_count_planned: providedScenes ? providedScenes.length : null,
    continuity,
    cost: MOVIE_USAGE_COST + ' uses', daily_limit: MOVIE_DAILY_LIMIT, webhook: !!hook
  });
});

// spec-shaped job status: GET /v1/movie/status/:jobId
app.get('/v1/movie/status/:jobId', async (req, res) => {
  const m = await mvOwn(req.params.jobId, req.apiKey);
  if (!m) return res.status(404).json({ error: 'movie not found' });
  const state = m.status === 'done' ? 'done'
    : ['partial', 'failed'].includes(m.status) ? 'failed'
    : m.status === 'queued' ? 'queued' : 'rendering';
  const done = state === 'done';
  res.json({
    jobId: m.id, state,
    progress: { currentScene: m.currentScene || null, totalScenes: m.totalScenes || (Array.isArray(m.scenes) ? m.scenes.length : null), step: m.step || null, percent: m.progress },
    videoUrl: done ? '/v1/movie/' + m.id + '/file' : null,
    continuity: m.continuity || 'independent',
    scenes: done ? (m.scenes || []).map(s => ({ imageUrl: s.imageUrl, clipUrl: s.clipUrl, narration: s.narration, clipSource: s.clipSource || null, startsFrom: s.startsFrom || null })) : null,
    error: m.error || null
  });
});

app.get('/v1/movie/list', async (req, res) => {
  if (pool && !dbBroken) {
    try {
      const r = await pool.query('SELECT id, title, status, aspect_ratio, duration, created_at FROM movies WHERE key = $1 ORDER BY created_at DESC LIMIT 50', [req.apiKey]);
      return res.json({ movies: r.rows.map(x => ({ id: x.id, title: x.title, status: x.status, aspectRatio: x.aspect_ratio, duration: x.duration, created_at: x.created_at })) });
    } catch (e) { console.error('movie list db failed:', e.message); }
  }
  const mine = [...memoryMovies.values()].filter(m => m.key === req.apiKey).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 50);
  res.json({ movies: mine.map(m => ({ id: m.id, title: m.title, status: m.status, aspectRatio: m.aspect, duration: m.duration, created_at: m.createdAt })) });
});

app.get('/v1/movie/:id', async (req, res) => {
  const m = await mvOwn(req.params.id, req.apiKey);
  if (!m) return res.status(404).json({ error: 'movie not found' });
  const done = m.status === 'done';
  const partial = m.status === 'partial';
  res.json({
    id: m.id, title: m.title, status: m.status, progress: m.progress !== undefined ? m.progress : (done ? 100 : null),
    error: m.error || null,
    videoUrl: (done || partial) && (m.status === 'done') ? '/v1/movie/' + m.id + '/file' : null,
    subtitlesUrl: '/v1/movie/' + m.id + '/subtitles',
    duration: m.duration || null,
    language: m.language, style: m.style, aspectRatio: m.aspect, narratorVoice: m.narratorVoice,
    continuity: m.continuity || 'independent',
    scenes: (m.scenes || []).map(s => ({
      id: s.id, imageUrl: s.imageUrl, clipUrl: s.clipUrl, narration: s.narration,
      narrationUrl: s.narrationUrl, visualPrompt: s.visualPrompt, contentGuard: s.contentGuard || null,
      clipSource: s.clipSource, clipError: s.clipError || null, startsFrom: s.startsFrom || null, imageError: s.imageError || null,
      duration: s.duration, narrationError: s.narrationError || null
    })),
    motionNote: m.motionNote || null,
    subtitleNote: m.subtitleNote || null,
    musicNote: m.musicNote || null,
    step: m.step || null, currentScene: m.currentScene || null, totalScenes: m.totalScenes || (Array.isArray(m.scenes) ? m.scenes.length : null),
    created_at: m.createdAt,
    note: m.restored ? 'state restored from database (service restarted)' : undefined
  });
});

// ---------- DB-backed asset persistence (survives restarts even without a disk) ----------
// Every generated asset is mirrored into Postgres and restored to disk on
// demand. Makes movie files durable on any plan (free tier included).
const MOVIE_ASSET_MAX_BYTES = parseInt(process.env.MOVIE_ASSET_MAX_BYTES) || (64 * 1024 * 1024); // 64MB per asset
function mvAssetKind(file) {
  let m = /^scene(\d+)\.jpg$/.exec(file); if (m) return { kind: 'image', idx: parseInt(m[1]) };
  m = /^clip(\d+)\.mp4$/.exec(file); if (m) return { kind: 'clip', idx: parseInt(m[1]) };
  m = /^narr(\d+)\.mp3$/.exec(file); if (m) return { kind: 'narration', idx: parseInt(m[1]) };
  if (file === 'final.mp4') return { kind: 'final', idx: 0 };
  if (file === 'subtitles.vtt') return { kind: 'subtitles', idx: 0 };
  return null;
}
async function mvSaveAsset(movieId, file) {
  const k = mvAssetKind(file);
  if (!k || !pool || dbBroken) return false;
  try {
    const p = path.join(MOVIE_DIR, movieId, file);
    if (!fs.existsSync(p)) return false;
    const st = fs.statSync(p);
    if (st.size > MOVIE_ASSET_MAX_BYTES) { console.error('movie asset too large for DB mirror: ' + movieId + '/' + file); return false; }
    const buf = fs.readFileSync(p);
    await pool.query('INSERT INTO movie_assets (movie_id, kind, idx, bytes) VALUES ($1,$2,$3,$4) ON CONFLICT (movie_id, kind, idx) DO UPDATE SET bytes = EXCLUDED.bytes', [movieId, k.kind, k.idx, buf]);
    return true;
  } catch (e) { console.error('movie asset mirror failed (' + movieId + '/' + file + '):', e.message); return false; }
}
// restore an asset from the DB to disk (true if restored, false if not present)
async function mvRestoreAsset(movieId, file) {
  const k = mvAssetKind(file);
  if (!k || !pool || dbBroken) return false;
  try {
    const r = await pool.query('SELECT bytes FROM movie_assets WHERE movie_id = $1 AND kind = $2 AND idx = $3', [movieId, k.kind, k.idx]);
    if (!r.rowCount || !r.rows[0].bytes) return false;
    const dir = path.join(MOVIE_DIR, movieId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), r.rows[0].bytes);
    return true;
  } catch (e) { console.error('movie asset restore failed (' + movieId + '/' + file + '):', e.message); return false; }
}
// ensure an asset is on disk: returns the path, restoring from the DB mirror if needed
async function movieAssetOnDisk(movieId, file) {
  const p = path.join(MOVIE_DIR, movieId, file);
  if (fs.existsSync(p)) return p;
  if (await mvRestoreAsset(movieId, file)) return p;
  return null;
}

function movieFilePath(m, name) {
  if (!/^[\w.-]+$/.test(name)) return null;
  const p = path.join(MOVIE_DIR, m.id, name);
  if (!fs.existsSync(p)) return null;
  return p;
}

app.get('/v1/movie/:id/file', async (req, res) => {
  const m = await mvOwn(req.params.id, req.apiKey);
  if (!m) return res.status(404).json({ error: 'movie not found' });
  if (m.status !== 'done') return res.status(404).json({ error: 'movie not ready (status: ' + m.status + ')' });
  const p = await movieAssetOnDisk(m.id, 'final.mp4');
  if (!p) return res.status(404).json({ error: 'movie file missing (disk may have been recycled — rebuild from scene assets)' });
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', 'attachment; filename="' + m.title.replace(/[^\w.-]+/g, '_').slice(0, 60) + '.mp4"');
  fs.createReadStream(p).pipe(res);
});

app.get('/v1/movie/:id/subtitles', async (req, res) => {
  const m = await mvOwn(req.params.id, req.apiKey);
  if (!m) return res.status(404).json({ error: 'movie not found' });
  const p = await movieAssetOnDisk(m.id, 'subtitles.vtt');
  if (!p) return res.status(404).json({ error: 'subtitles not ready or not found' });
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  fs.createReadStream(p).pipe(res);
});

app.get('/v1/movie/:id/scenes/:idx/:asset', async (req, res) => {
  const m = await mvOwn(req.params.id, req.apiKey);
  if (!m) return res.status(404).json({ error: 'movie not found' });
  const idx = parseInt(req.params.idx);
  if (!(idx >= 0) || idx >= (m.scenes || []).length) return res.status(404).json({ error: 'scene not found' });
  const asset = String(req.params.asset);
  const map = { image: { file: 'scene' + idx + '.jpg', type: 'image/jpeg' }, clip: { file: 'clip' + idx + '.mp4', type: 'video/mp4' }, narration: { file: 'narr' + idx + '.mp3', type: 'audio/mpeg' } };
  const spec = map[asset];
  if (!spec) return res.status(400).json({ error: 'asset must be image, clip, or narration' });
  const p = await movieAssetOnDisk(m.id, spec.file);
  if (!p) return res.status(404).json({ error: spec.file + ' not found' });
  res.setHeader('Content-Type', spec.type);
  res.setHeader('Content-Disposition', 'attachment; filename="movie-' + m.id.slice(4, 12) + '-scene' + idx + '-' + asset + '.' + spec.file.split('.').pop() + '"');
  fs.createReadStream(p).pipe(res);
});


// ---------- storyboard preview: review scenes before paying for the render ----------
// POST /v1/movie/script { story, style?, language?, sceneCount? } -> 1 use
app.post('/v1/movie/script', async (req, res) => {
  const b = req.body || {};
  const story = String(b.story || '').trim().slice(0, 4000);
  if (!story) return res.status(400).json({ error: 'story is required' });
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: 'Script generation needs GROQ_API_KEY configured on the server' });
  const language = String(b.language || 'English').trim().slice(0, 40);
  const style = String(b.style || '').trim().slice(0, 300);
  const sceneCount = Math.min(Math.max(parseInt(b.sceneCount) || MOVIE_MAX_SCENES, 3), MOVIE_MAX_SCENES);
  const { used } = await getUsage(req.apiKey);
  if (used + 1 > FREE_MONTHLY_LIMIT) return res.status(429).json({ error: 'Free monthly limit reached (' + FREE_MONTHLY_LIMIT + ' operations). Email support to upgrade.', limit: FREE_MONTHLY_LIMIT, used });
  let norm;
  try {
    const scenes = await retryOnce(() => groqMovieScenes(story, style, language, sceneCount), 3000);
    norm = normalizeScriptScenes(scenes);
  } catch (e) {
    return res.status(502).json({ error: 'script generation failed: ' + e.message });
  }
  if (!norm.length) return res.status(502).json({ error: 'script generation produced no usable scenes' });
  for (const sc of norm) {
    if (sc.visualPrompt) {
      const g = contentGuard(sc.visualPrompt);
      sc.visualPrompt = g.prompt;
      if (g.applied) sc.contentGuard = { applied: true, replaced: g.replaced };
    }
  }
  await addUsage(req.apiKey, 1);
  res.setHeader('X-Usage-Remaining', Math.max(0, FREE_MONTHLY_LIMIT - used - 1));
  res.json({
    scenes: norm.map(sc => ({ id: sc.id, visualPrompt: sc.visualPrompt, narrationText: sc.narrationText, contentGuard: sc.contentGuard || null })),
    language, suggestedVoice: movieDefaultVoice(language),
    note: 'Storyboard preview (1 use). Edit these scenes, then pass them as "scenes" to POST /v1/movie/create to render (20 uses).'
  });
});

// ---------- assembly retry: re-assemble from preserved assets (no regeneration) ----------
// POST /v1/movie/:id/assemble { musicUrl?, musicVolume?, burnSubtitles?, titleCard? } -> 1 use
app.post('/v1/movie/:id/assemble', async (req, res) => {
  const m = await mvOwn(req.params.id, req.apiKey);
  if (!m) return res.status(404).json({ error: 'movie not found' });
  if (['queued', 'scripting', 'processing', 'assembling'].includes(m.status)) {
    return res.status(409).json({ error: 'movie is still processing (' + m.status + ') — wait for it to finish first' });
  }
  const dir = path.join(MOVIE_DIR, m.id);
  let clipCount = 0;
  if (Array.isArray(m.scenes)) for (let i = 0; i < m.scenes.length; i++) if (fs.existsSync(movieSceneFiles(dir, i).clip)) clipCount++;
  if (!clipCount) return res.status(400).json({ error: 'no scene clips on disk for this movie — create a new movie instead' });
  const b = req.body || {};
  const musicUrl = /^(https:\/\/|http:\/(localhost|127\.0\.0\.1))/.test(String(b.musicUrl || '')) ? String(b.musicUrl) : null;
  const musicVolume = Math.min(Math.max(parseFloat(b.musicVolume) || 0.3, 0.05), 1);
  const burnSubtitles = !!(b.burnSubtitles || b.burnSubs);
  const titleCard = !!b.titleCard;
  const crossfade = b.crossfade === undefined ? true : !!b.crossfade;
  const W = m.aspect === '16:9' ? 1280 : 1080;
  const H = m.aspect === '16:9' ? 720 : 1920;
  const { used } = await getUsage(req.apiKey);
  if (used + 1 > FREE_MONTHLY_LIMIT) return res.status(429).json({ error: 'Free monthly limit reached (' + FREE_MONTHLY_LIMIT + ' operations). Email support to upgrade.', limit: FREE_MONTHLY_LIMIT, used });
  await addUsage(req.apiKey, 1);
  m.status = 'assembling'; m.progress = 50; m.error = null;
  await mvSave(m);
  movieEnqueue('assemble:' + m.id, async () => {
    try {
      let musicFile = null;
      if (musicUrl) {
        musicFile = path.join(dir, 'music.mp3');
        try { await retryOnce(() => downloadVideoToDisk(musicUrl, musicFile), 2000); }
        catch (e) { musicFile = null; m.musicNote = 'music download failed, rendered without music: ' + e.message; }
      } else if (fs.existsSync(path.join(dir, 'music.mp3'))) {
        musicFile = path.join(dir, 'music.mp3');
      }
      m.step = 'assembly';
      m.duration = await assembleMovie(m, dir, { W, H, musicFile, musicVolume, burnSubtitles, titleCard, crossfade, onProgress: (f) => { m.progress = Math.round(50 + 45 * f); } });
      m.status = 'done'; m.progress = 100; m.error = null;
      await mvSave(m);
      fireMovieWebhook(m);
    } catch (e) {
      m.status = 'partial'; m.error = 're-assembly failed: ' + e.message;
      await mvSave(m);
      fireMovieWebhook(m);
    }
  });
  res.status(202).json({ movie_id: m.id, status: 'assembling', poll: '/v1/movie/' + m.id, note: 're-assembling from preserved scene assets (no regeneration, 1 use)' });
});

// ---------- cleanup: free the persistent disk ----------
app.delete('/v1/movie/:id', async (req, res) => {
  const m = await mvOwn(req.params.id, req.apiKey);
  if (!m) return res.status(404).json({ error: 'movie not found' });
  memoryMovies.delete(m.id);
  if (pool && !dbBroken) {
    try { await pool.query('DELETE FROM movies WHERE id = $1', [m.id]); await pool.query('DELETE FROM movie_assets WHERE movie_id = $1', [m.id]); }
    catch (e) { console.error('movie db delete failed:', e.message); }
  }
  try { fs.rmSync(path.join(MOVIE_DIR, m.id), { recursive: true, force: true }); } catch (e) {}
  res.json({ deleted: true, id: m.id });
});


// ---------- movie dubbing: re-narrate a finished movie in another language ----------
// POST /v1/movie/:id/dub { language, narratorVoice?, narrationRate?, scenes?, musicVolume?, titleCard?, burnSubtitles?, webhook? } -> 10 uses
// Reuses the source movie's scene clips (no re-generation). Narration is
// translated by the LLM unless explicit "scenes":[{narrationText}] lines are
// given, then re-spoken with an edge-tts voice for the target language and
// re-assembled with subtitles in the new language.
const DUB_USAGE_COST = parseInt(process.env.DUB_USAGE_COST) || 10;
const DUB_VOICES = {
  arabic: 'ar-SA-HamedNeural', ar: 'ar-SA-HamedNeural',
  french: 'fr-FR-HenriNeural', fr: 'fr-FR-HenriNeural',
  spanish: 'es-ES-AlvaroNeural', es: 'es-ES-AlvaroNeural',
  german: 'de-DE-KillianNeural', de: 'de-DE-KillianNeural',
  swahili: 'sw-KE-RafiqNeural', sw: 'sw-KE-RafiqNeural',
  english: 'en-US-GuyNeural', en: 'en-US-GuyNeural'
};
function dubVoice(language) { return DUB_VOICES[String(language || '').trim().toLowerCase()] || 'en-US-GuyNeural'; }

async function groqTranslateNarrations(narrations, language) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is not configured on the server (needed when explicit scenes are not provided)');
  const sys = 'You are a professional film narration translator. Translate each numbered narration line into ' + language + '. ' +
    'Keep the meaning, tone and length close to the original so each line still fits its scene as spoken narration. ' +
    'Reply with ONLY a JSON object: {"lines":["...","..."]} with exactly ' + narrations.length + ' strings in the same order. No commentary.';
  const body = { model: GROQ_MODEL, messages: [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify({ lines: narrations }) }], temperature: 0.3, max_tokens: 2500, response_format: { type: 'json_object' } };
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'User-Agent': 'StudioAPI/1.0' },
    body: JSON.stringify(body)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.error && d.error.message) || 'Groq request failed');
  const txt = d.choices[0].message.content;
  let parsed = null;
  try { parsed = JSON.parse(txt); } catch (e) {
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch (e2) {} }
  }
  const lines = parsed && (Array.isArray(parsed.lines) ? parsed.lines : null);
  if (!lines || lines.length !== narrations.length) throw new Error('translation count mismatch (expected ' + narrations.length + ' lines)');
  return lines.map(l => String(l || '').trim().slice(0, 400));
}

app.post('/v1/movie/:id/dub', async (req, res) => {
  const m = await mvOwn(req.params.id, req.apiKey);
  if (!m) return res.status(404).json({ error: 'movie not found' });
  if (['queued', 'scripting', 'processing', 'assembling'].includes(m.status)) {
    return res.status(409).json({ error: 'movie is still processing (' + m.status + ') — wait for it to finish first' });
  }
  const srcDir = path.join(MOVIE_DIR, m.id);
  const idxs = (m.scenes || []).map((s, i) => i).filter(i => fs.existsSync(movieSceneFiles(srcDir, i).clip));
  if (!idxs.length) return res.status(400).json({ error: 'source movie has no scene clips on disk — nothing to dub (create a new movie instead)' });

  const b = req.body || {};
  const language = String(b.language || '').trim().slice(0, 40);
  if (!language) return res.status(400).json({ error: 'language is required (e.g. "Arabic", "French")' });
  const voice = VOICE_RE.test(String(b.narratorVoice || '')) ? String(b.narratorVoice) : dubVoice(language);
  const rate = /^-?\d+%$/.test(String(b.narrationRate || '')) ? String(b.narrationRate) : '+0%';
  const hook = /^(https:\/\/|http:\/(localhost|127\.0\.0\.1))/.test(String(b.webhook || '')) ? String(b.webhook) : null;
  const musicVolume = Math.min(Math.max(parseFloat(b.musicVolume) || 0.3, 0.05), 1);
  const burnSubtitles = !!(b.burnSubtitles || b.burnSubs);
  const titleCard = b.titleCard === undefined ? false : !!b.titleCard;
  const crossfade = b.crossfade === undefined ? true : !!b.crossfade;

  // explicit translations skip the LLM entirely (offline/localized workflows)
  const explicit = Array.isArray(b.scenes) ? b.scenes : null;
  if (explicit && explicit.length && !explicit.some(s => s && String((s.narrationText || '')).trim())) {
    return res.status(400).json({ error: 'scenes provided but no narrationText found — pass one narrationText per scene' });
  }
  if (!explicit && !process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: 'Dubbing without explicit "scenes" translations needs GROQ_API_KEY configured on the server' });
  }

  // dubs share the daily creation limit: heavy TTS + assembly work
  const daily = await movieDailyUsed(req.apiKey);
  if (daily.count >= MOVIE_DAILY_LIMIT) {
    return res.status(429).json({ error: 'Rate limit: ' + MOVIE_DAILY_LIMIT + ' movie creations/dubs per key per day. Try again tomorrow.', used_today: daily.count, limit: MOVIE_DAILY_LIMIT });
  }
  const { used } = await getUsage(req.apiKey);
  if (used + DUB_USAGE_COST > FREE_MONTHLY_LIMIT) return res.status(429).json({ error: 'Free monthly limit reached (' + FREE_MONTHLY_LIMIT + ' operations). Email support to upgrade.', limit: FREE_MONTHLY_LIMIT, used });

  let translations = null;
  if (explicit && explicit.length) {
    translations = idxs.map((i, k) => (explicit[k] && String((explicit[k].narrationText || '')).trim()) || null);
  } else {
    try {
      translations = await retryOnce(() => groqTranslateNarrations(idxs.map(i => m.scenes[i].narration || ''), language), 3000);
    } catch (e) {
      return res.status(502).json({ error: 'translation failed: ' + e.message });
    }
  }

  await addUsage(req.apiKey, DUB_USAGE_COST);
  const id = 'mov_' + crypto.randomUUID();
  const dubBaseUrl = 'https://' + req.get('host');
  const dub = {
    id, key: m.key, title: String(m.title).slice(0, 140) + ' [' + language + ']',
    status: 'dubbing', progress: 0, error: null, language, style: m.style,
    aspect: m.aspect, narratorVoice: voice, webhook: hook, dubOf: m.id,
    duration: null, createdAt: new Date().toISOString(), baseUrl: dubBaseUrl,
    // storyboard visible right away; narration filled per scene below; asset
    // URLs point at the dub's own copied files
    scenes: idxs.map((i, k) => ({ ...m.scenes[i], narration: null, duration: null, narrationError: null,
      imageUrl: dubBaseUrl + '/v1/movie/' + id + '/scenes/' + k + '/image',
      clipUrl: dubBaseUrl + '/v1/movie/' + id + '/scenes/' + k + '/clip',
      narrationUrl: dubBaseUrl + '/v1/movie/' + id + '/scenes/' + k + '/narration' }))
  };
  await mvSave(dub);
  res.setHeader('X-Usage-Remaining', Math.max(0, FREE_MONTHLY_LIMIT - used - DUB_USAGE_COST));
  res.status(202).json({ movie_id: id, status: 'dubbing', poll: '/v1/movie/' + id, dub_of: m.id, language, narratorVoice: voice, cost: DUB_USAGE_COST + ' uses' });

  movieEnqueue('dub:' + id, async () => {
    try {
      const dir = path.join(MOVIE_DIR, id);
      fs.mkdirSync(dir, { recursive: true });
      const W = dub.aspect === '16:9' ? 1280 : 1080;
      const H = dub.aspect === '16:9' ? 720 : 1920;
      const per = 74 / dub.scenes.length;
      dub.totalScenes = dub.scenes.length; dub.currentScene = 0; dub.step = 'narration';
      for (let k = 0; k < idxs.length; k++) {
        const i = idxs[k];
        dub.currentScene = k + 1;
        const src = movieSceneFiles(srcDir, i), dst = movieSceneFiles(dir, k);
        fs.copyFileSync(src.clip, dst.clip)
        await mvSaveAsset(dub.id, 'clip' + k + '.mp4');
        if (fs.existsSync(src.img)) fs.copyFileSync(src.img, dst.img);
        const text = (translations[k] || m.scenes[i].narration || '').trim();
        dub.scenes[k].narration = text;
        if (text) {
          try { await speakText(text, voice, rate, dst.narr); await mvSaveAsset(dub.id, 'narr' + k + '.mp3'); }
          catch (e) { dub.scenes[k].narrationError = e.message; }
        }
        dub.progress = Math.round(6 + per * (k + 1));
        await mvSave(dub);
      }
      // keep the source movie's music bed if it has one on disk
      let musicFile = null;
      const srcMusic = path.join(srcDir, 'music.mp3');
      if (fs.existsSync(srcMusic)) { musicFile = path.join(dir, 'music.mp3'); try { fs.copyFileSync(srcMusic, musicFile); } catch (e) { musicFile = null; } }
      dub.status = 'assembling'; dub.step = 'assembly'; dub.progress = 82;
      await mvSave(dub);
      dub.duration = await assembleMovie(dub, dir, {
        W, H, musicFile, musicVolume, burnSubtitles, titleCard, crossfade,
        onProgress: (f) => { dub.progress = Math.round(82 + 13 * f); }
      });
      await mvSaveAsset(dub.id, 'final.mp4');
      await mvSaveAsset(dub.id, 'subtitles.vtt');
      dub.status = 'done'; dub.progress = 100; dub.error = null;
      await mvSave(dub);
      fireMovieWebhook(dub);
    } catch (e) {
      dub.status = 'partial'; dub.error = 'dub failed: ' + e.message;
      await mvSave(dub);
      fireMovieWebhook(dub);
    }
  });
});

// ---------- start ----------
initDb()
  .then(() => {
    app.listen(PORT, () => { console.log(`studio-api listening on port ${PORT}`); resumeUnfinishedMovies(); });
  })
  .catch((e) => {
    console.error('DB init failed, starting without DB keys:', e.message);
    app.listen(PORT, () => { console.log(`studio-api listening on port ${PORT} (no DB)`); resumeUnfinishedMovies(); });
  });
