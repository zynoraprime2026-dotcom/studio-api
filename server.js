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

const PORT = process.env.PORT || 5000;
const WORK_DIR = process.env.WORK_DIR || path.join(os.tmpdir(), 'studio-api');
const VIDEOS_DIR = path.join(WORK_DIR, 'videos');
fs.mkdirSync(VIDEOS_DIR, { recursive: true });

// ---------- landing page (no auth) ----------
app.get('/', (req, res) => {
  res.send(\`<!DOCTYPE html>
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
<table><tr><th>Method</th><th>Endpoint</th><th>What it does</th></tr>
<tr><td>POST</td><td><code>/v1/developers/signup</code></td><td>Get an API key</td></tr>
<tr><td>GET</td><td><code>/v1/health</code></td><td>Service status (needs key)</td></tr>
<tr><td>POST</td><td><code>/v1/image/generate</code></td><td>AI image from a prompt</td></tr>
<tr><td>POST</td><td><code>/v1/video/render</code></td><td>Render MP4 (Shorts/YouTube)</td></tr>
<tr><td>GET</td><td><code>/v1/video/status/:id</code></td><td>Render progress</td></tr>
<tr><td>GET</td><td><code>/v1/video/file/:id</code></td><td>Download finished MP4</td></tr>
<tr><td>POST</td><td><code>/v1/content/generate</code></td><td>Shorts scripts, lessons, posts</td></tr>
</table>
<p>Send your key as header <code>x-api-key</code>. Full docs on <a href="https://github.com/zynoraprime2026-dotcom/studio-api">GitHub</a>.</p>
</body></html>\`);
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

const pool = pg ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;
const memoryKeys = new Map(); // key -> { email, created_at }

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS developers (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      key TEXT UNIQUE NOT NULL,
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
app.use('/v1', async (req, res, next) => {
  const key = req.headers['x-api-key'];
  try {
    if (await isValidKey(key)) return next();
  } catch (e) {
    return res.status(500).json({ error: 'Auth check failed: ' + e.message });
  }
  res.status(401).json({ error: 'Missing or invalid API key (x-api-key header)' });
});

app.get('/v1/health', (req, res) => res.json({ status: 'ok', service: 'studio-api', time: new Date().toISOString() }));

// ---------- image generation (free provider: Pollinations, no key needed) ----------
app.post('/v1/image/generate', async (req, res) => {
  const { prompt, width, height, model, seed } = req.body || {};
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt is required' });
  const w = Math.min(Math.max(parseInt(width) || 1024, 256), 1920);
  const h = Math.min(Math.max(parseInt(height) || 1024, 256), 1920);
  const params = new URLSearchParams({ width: String(w), height: String(h), nologo: 'true' });
  if (model) params.set('model', model);
  if (seed) params.set('seed', String(seed));
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
  res.json({ url, prompt, width: w, height: h, note: 'URL serves the generated image directly' });
});

// ---------- video rendering ----------
// POST /v1/video/render { title?, width?, height?, fps?, scenes: [{image?, text?, duration?}] }
// Renders a Ken Burns-style MP4 from scene images (URLs) and/or text cards.
const jobs = new Map(); // id -> { status, progress, error, videoId }

async function downloadImage(url, dest) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('image download failed: ' + resp.status);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(dest, buf);
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
  jobs.set(jobId, { status: 'queued', progress: 0, error: null, videoId: null, createdAt: Date.now() });

  // async render
  (async () => {
    const jobDir = path.join(VIDEOS_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    try {
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
      args.push(...inputArgs, '-filter_complex', fc, '-map', '[outv]', '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-r', String(FPS), outPath);
      await execFileAsync('ffmpeg', args, { maxBuffer: 1024 * 1024 * 10, timeout: 10 * 60 * 1000 });
      const videoId = jobId;
      jobs.get(jobId).status = 'done';
      jobs.get(jobId).progress = 100;
      jobs.get(jobId).videoId = videoId;
    } catch (e) {
      jobs.get(jobId).status = 'failed';
      jobs.get(jobId).error = e.message;
    }
  })();

  res.status(202).json({ job_id: jobId, status_url: `/v1/video/status/${jobId}`, video_url: `/v1/video/file/${jobId}` });
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

// ---------- content creation ----------
// POST /v1/content/generate { type: 'shorts_script'|'lesson'|'social_post', topic, tone? }
app.post('/v1/content/generate', (req, res) => {
  const { type, topic, audience } = req.body || {};
  if (!topic) return res.status(400).json({ error: 'topic is required' });
  const t = (type || 'shorts_script').toLowerCase();
  const a = audience || 'general Muslim audience';
  const title = topic.replace(/\b\w/g, (c) => c.toUpperCase());

  if (t === 'shorts_script') {
    return res.json({
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
    });
  }
  if (t === 'lesson') {
    return res.json({
      type: 'lesson', topic,
      outline: {
        objectives: [`Understand the meaning of ${topic}`, 'Memorize key Arabic terms with harakaat', 'Apply the lesson practically'],
        sections: ['Introduction and relevance', 'Arabic text with full vocalization', 'Translation and explanation', 'Grammar rules (Qawaa\'id Nahwiyyah)', 'Review questions'],
        homework: [`Write the Arabic text of ${topic} from memory`, 'Prepare 3 questions for the next class'],
      },
      note: 'Enrich with Ilm API: /v1/quran, /v1/tafsir, /v1/hadith, /v1/duas.',
    });
  }
  if (t === 'social_post') {
    return res.json({
      type: 'social_post', topic,
      posts: {
        whatsapp: `${title}\n\nA short, beneficial reminder about ${topic} for ${a}. Keep it sincere and sourced.`,
        x_twitter: `${title} — a thread. 1/`,
        instagram_caption: `${title} ✨ Swipe for the full reminder. #islamicreminder #deen`,
      },
    });
  }
  res.status(400).json({ error: 'type must be shorts_script, lesson, or social_post' });
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
