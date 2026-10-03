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
<tr><td>Text &rarr; Video</td><td><code>POST /v1/video/render</code></td><td>Scene-based MP4, Shorts or widescreen, optional narration voice per scene</td></tr>
<tr><td>Image &rarr; Video</td><td><code>POST /v1/video/from-image</code></td><td>Ken Burns zoom &amp; pan effects (zoom_in, zoom_out, pan_left, pan_right, static), caption overlay</td></tr>
</table>
<h3 style="color:#C9A96A;margin:22px 0 6px">MANAGE RENDERS</h3>
<table>
<tr><th>Method</th><th>Endpoint</th><th>What it does</th></tr>
<tr><td>GET</td><td><code>/v1/video/status/:id</code></td><td>Render progress</td></tr>
<tr><td>GET</td><td><code>/v1/video/file/:id</code></td><td>Download finished MP4</td></tr>
</table>
<h3 style="color:#C9A96A;margin:22px 0 6px">ACCOUNT</h3>
<table>
<tr><th>Method</th><th>Endpoint</th><th>What it does</th></tr>
<tr><td>POST</td><td><code>/v1/developers/signup</code></td><td>Get an API key</td></tr>
<tr><td>GET</td><td><code>/v1/health</code></td><td>Service status (needs key)</td></tr>
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

  const hasNarration = scenes.some(sc => sc.narration && String(sc.narration).trim());

  // async render
  (async () => {
    const jobDir = path.join(VIDEOS_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    try {
      // ---- narrated build: one audio-muxed segment per scene, then concat ----
      if (hasNarration) {
        const segFiles = [];
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
          parts.push("zoompan=z='min(1+0.0006*in,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=" + W + 'x' + H + ':fps=' + FPS, 'format=yuv420p');
          const seg = path.join(jobDir, 'seg' + i + '.mp4');
          const args = ['-y', ...baseInput];
          const vfFull = (sc.image ? vf.join(',') + ',' : '') + parts.join(',');
          if (narrPath) {
            args.push('-i', narrPath, '-vf', vfFull, '-t', String(dur), '-af', 'apad', '-c:v', 'libx264', '-preset', 'fast', '-c:a', 'aac', '-b:a', '128k', '-shortest', seg);
          } else {
            args.push('-vf', vfFull, '-t', String(dur), '-c:v', 'libx264', '-preset', 'fast', seg);
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
  jobs.set(jobId, { status: 'queued', progress: 10, error: null, videoId: null, createdAt: Date.now() });
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
      const args = ['-y', '-loop', '1', '-framerate', String(FPS), '-t', String(duration), '-i', imgPath,
        '-vf', parts.join(','), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p',
        path.join(jobDir, 'output.mp4')];
      await execFileAsync('ffmpeg', args, { maxBuffer: 1024 * 1024 * 10, timeout: 10 * 60 * 1000 });
      jobs.get(jobId).status = 'done';
      jobs.get(jobId).progress = 100;
      jobs.get(jobId).videoId = jobId;
    } catch (e) {
      jobs.get(jobId).status = 'failed';
      jobs.get(jobId).error = e.message;
    }
  })();
  res.status(202).json({ job_id: jobId, effect, duration, status_url: '/v1/video/status/' + jobId, video_url: '/v1/video/file/' + jobId });
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
