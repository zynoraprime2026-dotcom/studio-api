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
<tr><td>Multi-step Workflows</td><td><code>POST /v1/workflows</code></td><td>Chain steps (image &rarr; speech &rarr; animate); later steps reuse earlier outputs via <code>{{s1.url}}</code></td></tr>
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
    info: { title: 'Studio API', version: '1.7.0', description: 'AI media engine: images, videos with narration and subtitles, speech, lesson PDFs, prompt presets, multi-step workflows. Companion to the Ilm API. Auth: x-api-key header on every /v1 request. Free tier: metered endpoints count toward a monthly limit.' },
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
      '/v1/db-check': { get: { summary: 'Database connection diagnostic', responses: { '200': { description: 'ok' } } } },
      '/v1/image/generate': { post: { summary: 'Generate an image from text (or a preset)', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { prompt: { type: 'string' }, preset: { type: 'string', description: 'preset name or id; combined with prompt if both given' }, width: { type: 'integer' }, height: { type: 'integer' }, model: { type: 'string' }, seed: { type: 'integer' } } } } } }, responses: { '200': { description: 'image URL' } } } },
      '/v1/video/render': { post: { summary: 'Render a scene-based MP4 (narration, subtitles, webhook)', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, subtitles: { type: 'boolean' }, webhook: { type: 'string', description: 'https URL called when the render finishes or fails' }, scenes: { type: 'array', items: { '$ref': '#/components/schemas/Scene' } } } } } } }, responses: { '200': { description: 'job_id; poll /v1/video/status/:id' } } } },
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
app.post('/v1/developers/signup', async (req, res) => {
  const email = (req.body && req.body.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  const key = 'studio_' + crypto.randomBytes(24).toString('hex');
  memoryKeys.set(key, { email, created_at: new Date().toISOString() });
  try { await saveDeveloperKey(email, key); } catch (e) { console.error('key save failed:', e.message); }
  res.json({ message: 'API key created. Include it as the x-api-key header on every /v1 request.', key, created_at: new Date().toISOString() });
});

// ---------- auth middleware ----------
const METERED = ['/v1/image/generate', '/v1/video/render', '/v1/video/from-image', '/v1/audio/speak', '/v1/content/generate', '/v1/pdf/generate', '/v1/workflows', '/v1/portfolios', '/v1/games', '/v1/classes'];

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

app.get('/v1/health', (req, res) => res.json({ status: 'ok', service: 'studio-api', time: new Date().toISOString() }));

// ---------- image generation (free provider: Pollinations, no key needed) ----------
app.post('/v1/image/generate', async (req, res) => {
  const { prompt, preset, width, height, model, seed } = req.body || {};
  let basePrompt = (typeof prompt === 'string') ? prompt : '';
  let resolved = null;
  if (preset) {
    resolved = await findPreset(String(preset));
    if (!resolved) return res.status(404).json({ error: 'preset not found: ' + preset });
    basePrompt = basePrompt ? resolved.prompt + ', ' + basePrompt : resolved.prompt;
  }
  if (!basePrompt) return res.status(400).json({ error: 'prompt or preset is required' });
  const w = Math.min(Math.max(parseInt(width) || (resolved && resolved.params && resolved.params.width) || 1024, 256), 1920);
  const h = Math.min(Math.max(parseInt(height) || (resolved && resolved.params && resolved.params.height) || 1024, 256), 1920);
  const params = new URLSearchParams({ width: String(w), height: String(h), nologo: 'true' });
  if (model) params.set('model', model);
  if (seed) params.set('seed', String(seed));
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(basePrompt)}?${params}`;
  res.json({ url, prompt: basePrompt, preset: resolved ? resolved.name : null, width: w, height: h, note: 'URL serves the generated image directly' });
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
  res.json({ status: job.status, progress: job.progress, error: job.error, video_url: job.status === 'done' ? `/v1/video/file/${job.videoId}` : null });
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
  let basePrompt = (typeof p.prompt === 'string') ? p.prompt : '';
  let resolved = null;
  if (p.preset) {
    resolved = await findPreset(String(p.preset));
    if (!resolved) throw new Error('preset not found: ' + p.preset);
    basePrompt = basePrompt ? resolved.prompt + ', ' + basePrompt : resolved.prompt;
  }
  if (!basePrompt) throw new Error('image step needs prompt or preset');
  const w = Math.min(Math.max(parseInt(p.width) || (resolved && resolved.params && resolved.params.width) || 1024, 256), 1920);
  const h = Math.min(Math.max(parseInt(p.height) || (resolved && resolved.params && resolved.params.height) || 1024, 256), 1920);
  const qs = new URLSearchParams({ width: String(w), height: String(h), nologo: 'true' });
  if (p.model) qs.set('model', String(p.model));
  if (p.seed) qs.set('seed', String(p.seed));
  const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(basePrompt) + '?' + qs;
  return { url, prompt: basePrompt, preset: resolved ? resolved.name : null, width: w, height: h };
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
app.get('/gallery/:id', async (req, res) => {
  const p = await pfGet(req.params.id);
  if (!p || !p.published) return res.status(404).send('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui;background:#0E2A2B;color:#F3ECDA;text-align:center;padding:60px 20px"><h2>Gallery not found</h2><p style="color:#8FB3B0">This portfolio is private or does not exist.</p></body></html>');
  const artworks = await awList(p.id);
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
    const out = await wfImage({ prompt, preset: b.preset || null, width: b.width, height: b.height, model: b.model || null, seed: b.seed || null });
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

// ---------- start ----------
initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`studio-api listening on port ${PORT}`));
  })
  .catch((e) => {
    console.error('DB init failed, starting without DB keys:', e.message);
    app.listen(PORT, () => console.log(`studio-api listening on port ${PORT} (no DB)`));
  });
