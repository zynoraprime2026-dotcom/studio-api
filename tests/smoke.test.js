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

  const env = { ...process.env, PORT: String(port), WORK_DIR: workDir, NODE_ENV: 'test' };
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
