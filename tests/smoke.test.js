// Smoke tests for studio-api: boots the real server on a throwaway port with no
// database and asserts the auth gate plus the key-minting flow still behave.
// Run with: npm test   (Node 18+, no extra dependencies)

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let child;
let base;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

before(async () => {
  const port = await freePort();
  base = 'http://127.0.0.1:' + port;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-api-test-'));

  const env = { ...process.env, PORT: String(port), WORK_DIR: workDir, NODE_ENV: 'test', SIGNUP_RATE_LIMIT: '1000' };
  delete env.DATABASE_URL; // keys stay in memory: no external services needed

  child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start within 20s')), 20000);
    child.stdout.on('data', (buf) => {
      if (buf.toString().includes('listening on port')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (buf) => {
      const s = buf.toString();
      if (!/db|database/i.test(s)) process.stderr.write(s);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('server exited early with code ' + code));
    });
  });
});

after(() => {
  if (child && !child.killed) child.kill('SIGKILL');
});

test('landing page is served without auth', async () => {
  const res = await fetch(base + '/');
  assert.strictEqual(res.status, 200);
  const body = await res.text();
  assert.ok(body.toLowerCase().includes('studio'), 'landing page should mention studio');
});

test('/v1/health is behind the API key gate', async () => {
  const res = await fetch(base + '/v1/health');
  assert.strictEqual(res.status, 401);
  const body = await res.json();
  assert.match(body.error, /api key/i);
});

test('image generation rejects unauthenticated calls', async () => {
  const res = await fetch(base + '/v1/image/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'a mosque at sunrise' })
  });
  assert.strictEqual(res.status, 401);
});

test('signup rejects an invalid email', async () => {
  const res = await fetch(base + '/v1/developers/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email' })
  });
  assert.strictEqual(res.status, 400);
});

test('signup mints a key that unlocks /v1/health', async () => {
  const signup = await fetch(base + '/v1/developers/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'smoke-test@example.com' })
  });
  assert.strictEqual(signup.status, 200);
  const { key } = await signup.json();
  assert.match(key, /^studio_[0-9a-f]{48}$/);

  const health = await fetch(base + '/v1/health', { headers: { 'x-api-key': key } });
  assert.strictEqual(health.status, 200);
  const body = await health.json();
  assert.strictEqual(body.status, 'ok');
  assert.strictEqual(body.service, 'studio-api');
});

test('unknown /v1 routes still require a key', async () => {
  const res = await fetch(base + '/v1/does-not-exist');
  assert.strictEqual(res.status, 401);
});

test('health reports provider readiness instead of hiding silent fallbacks', async () => {
  const signup = await fetch(base + '/v1/developers/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'health-probe@example.com' })
  });
  const { key } = await signup.json();

  const res = await fetch(base + '/v1/health', { headers: { 'x-api-key': key } });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.status, 'ok');
  assert.ok(typeof body.uptime_seconds === 'number');

  const p = body.providers;
  assert.ok(['cloudflare', 'pollinations'].includes(p.image));
  assert.ok(Array.isArray(p.image_to_video));
  assert.strictEqual(typeof p.llm, 'boolean');
  assert.strictEqual(typeof p.database, 'boolean');
  // no keys configured in the test environment, so every degradation must be named
  assert.ok(Array.isArray(p.degraded));
  assert.ok(p.degraded.length > 0);
  assert.ok(p.degraded.some((d) => d.startsWith('database:')));
  // never leak key material
  const raw = JSON.stringify(body);
  for (const k of ['CLOUDFLARE_API_TOKEN', 'GROQ_API_KEY', 'DATABASE_URL=', 'FAL_KEY']) {
    assert.ok(!raw.includes(k), 'health payload must not echo ' + k);
  }
});

test('signup is throttled per client address', async () => {
  // Own instance so the limit is deterministic regardless of how many keys the
  // other tests minted (they share one server process).
  const port = await freePort();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-api-throttle-'));
  const env = { ...process.env, PORT: String(port), WORK_DIR: workDir, NODE_ENV: 'test', SIGNUP_RATE_LIMIT: '2' };
  delete env.DATABASE_URL;
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('throttle instance did not start')), 20000);
      proc.stdout.on('data', (buf) => { if (buf.toString().includes('listening on port')) { clearTimeout(timer); resolve(); } });
      proc.once('exit', (code) => { clearTimeout(timer); reject(new Error('throttle instance exited: ' + code)); });
    });

    const url = 'http://127.0.0.1:' + port + '/v1/developers/signup';
    const signup = (email) => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    assert.strictEqual((await signup('throttle-a@example.com')).status, 200);
    assert.strictEqual((await signup('throttle-b@example.com')).status, 200);

    const blocked = await signup('throttle-c@example.com');
    assert.strictEqual(blocked.status, 429);
    const body = await blocked.json();
    assert.match(body.error, /too many signups/i);
    assert.strictEqual(body.limit, 2);
    assert.strictEqual(body.key, undefined, 'a throttled signup must not mint a key');
  } finally {
    if (!proc.killed) proc.kill('SIGKILL');
  }
});

test('image generation rejects a missing prompt without spending a provider call', async () => {
  const signup = await fetch(base + '/v1/developers/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'image-validation@example.com' })
  });
  const { key } = await signup.json();

  const res = await fetch(base + '/v1/image/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({})
  });
  assert.strictEqual(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /prompt/i);
});

test('usage reports the monthly counter shape', async () => {
  const signup = await fetch(base + '/v1/developers/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'usage-shape@example.com' })
  });
  const { key } = await signup.json();

  const res = await fetch(base + '/v1/usage', { headers: { 'x-api-key': key } });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(typeof body.month === 'string');
  assert.strictEqual(typeof body.used, 'number');
  assert.strictEqual(typeof body.limit, 'number');
  assert.strictEqual(typeof body.remaining, 'number');
  assert.ok(body.remaining >= 0);
});
