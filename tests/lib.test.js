// Unit tests for the modules extracted out of server.js.

const { test } = require('node:test');
const assert = require('node:assert');
const { buildReadiness } = require('../lib/readiness');
const { clientAddress, createSlidingWindowLimiter } = require('../lib/ratelimit');

test('readiness with nothing configured reports every degradation', () => {
  const r = buildReadiness({});
  assert.strictEqual(r.image, 'pollinations');
  assert.strictEqual(r.image_model, null);
  assert.deepStrictEqual(r.image_to_video, []);
  assert.strictEqual(r.llm, false);
  assert.strictEqual(r.database, false);
  assert.strictEqual(r.public_base_url, null);
  assert.strictEqual(r.degraded.length, 5);
  assert.ok(r.degraded.some((d) => d.startsWith('image:')));
  assert.ok(r.degraded.some((d) => d.startsWith('image_to_video:')));
  assert.ok(r.degraded.some((d) => d.startsWith('llm:')));
  assert.ok(r.degraded.some((d) => d.startsWith('database:')));
  assert.ok(r.degraded.some((d) => d.startsWith('public_base_url:')));
});

test('readiness with everything configured is clean', () => {
  const r = buildReadiness({
    imageReady: true,
    imageModel: '@cf/black-forest-labs/flux-1-schnell',
    replicateReady: true,
    falReady: false,
    llmReady: true,
    dbReady: true,
    publicBaseUrl: 'https://example.test'
  });
  assert.strictEqual(r.image, 'cloudflare');
  assert.strictEqual(r.image_model, '@cf/black-forest-labs/flux-1-schnell');
  assert.deepStrictEqual(r.image_to_video, ['replicate']);
  assert.deepStrictEqual(r.degraded, []);
});

test('both animation providers are listed when both are keyed', () => {
  const r = buildReadiness({ replicateReady: true, falReady: true });
  assert.deepStrictEqual(r.image_to_video, ['replicate', 'fal']);
  assert.ok(!r.degraded.some((d) => d.startsWith('image_to_video:')));
});

test('limiter allows exactly `limit` calls then blocks', () => {
  const limiter = createSlidingWindowLimiter({ limit: 3, windowMs: 1000, now: () => 0 });
  assert.strictEqual(limiter.isLimited('ip'), false);
  assert.strictEqual(limiter.isLimited('ip'), false);
  assert.strictEqual(limiter.isLimited('ip'), false);
  assert.strictEqual(limiter.isLimited('ip'), true);
  assert.strictEqual(limiter.count('ip'), 3);
});

test('limiter forgets calls once the window has passed', () => {
  let t = 0;
  const limiter = createSlidingWindowLimiter({ limit: 1, windowMs: 1000, now: () => t });
  assert.strictEqual(limiter.isLimited('ip'), false);
  assert.strictEqual(limiter.isLimited('ip'), true);
  t = 1500;
  assert.strictEqual(limiter.isLimited('ip'), false);
});

test('limiter tracks addresses independently', () => {
  const limiter = createSlidingWindowLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
  assert.strictEqual(limiter.isLimited('a'), false);
  assert.strictEqual(limiter.isLimited('b'), false);
  assert.strictEqual(limiter.isLimited('a'), true);
});

test('clientAddress prefers the left-most forwarded address', () => {
  assert.strictEqual(clientAddress({ headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }, ip: '10.0.0.1' }), '203.0.113.9');
  assert.strictEqual(clientAddress({ headers: {}, ip: '10.0.0.2' }), '10.0.0.2');
  assert.strictEqual(clientAddress({}), 'unknown');
});
