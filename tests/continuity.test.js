// Shot continuity: the plan handed to the movie pipeline, and the ffmpeg call
// that grabs the final frame of a clip so the next shot can open on it.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { normalizeContinuity, chainPlan, lastFrameArgs, isAllFallback } = require('../lib/continuity');

test('continuity defaults to chained when the client says nothing', () => {
  assert.strictEqual(normalizeContinuity(undefined), 'chained');
  assert.strictEqual(normalizeContinuity(null), 'chained');
  assert.strictEqual(normalizeContinuity(''), 'chained');
  assert.strictEqual(normalizeContinuity(true), 'chained');
  assert.strictEqual(normalizeContinuity('Seamless'), 'chained');
  assert.strictEqual(normalizeContinuity('nonsense'), 'chained');
});

test('independent shots stay available by name', () => {
  assert.strictEqual(normalizeContinuity(false), 'independent');
  assert.strictEqual(normalizeContinuity(0), 'independent');
  assert.strictEqual(normalizeContinuity('independent'), 'independent');
  assert.strictEqual(normalizeContinuity('OFF'), 'independent');
});

test('every chained scene after the first starts on the previous clip', () => {
  const plan = chainPlan(3, 'chained');
  assert.deepStrictEqual(plan.map((p) => p.startsFrom), ['scene_image', 'previous_clip', 'previous_clip']);
  assert.deepStrictEqual(plan.map((p) => p.index), [0, 1, 2]);
});

test('independent scenes all start on their own still', () => {
  const plan = chainPlan(3, 'independent');
  assert.deepStrictEqual(plan.map((p) => p.startsFrom), ['scene_image', 'scene_image', 'scene_image']);
});

test('a one scene film has nothing to chain from', () => {
  assert.deepStrictEqual(chainPlan(1, 'chained'), [{ index: 0, startsFrom: 'scene_image' }]);
  assert.deepStrictEqual(chainPlan(0, 'chained'), []);
});

test('last frame args scale the frame and keep overwriting one file', () => {
  const args = lastFrameArgs('/tmp/clip.mp4', '/tmp/frame.jpg', 1080, 1920);
  assert.deepStrictEqual(args.slice(0, 4), ['-y', '-sseof', '-1', '-i']);
  assert.ok(args.includes('-vf'));
  assert.ok(args.includes('scale=1080:1920'));
  assert.ok(args.includes('-update'));
  assert.strictEqual(args[args.length - 1], '/tmp/frame.jpg');
});

test('a film whose scenes only got pans is flagged', () => {
  assert.strictEqual(isAllFallback([{ clipSource: 'ken_burns' }, { clipSource: 'ken_burns' }]), true);
  assert.strictEqual(isAllFallback([{ clipSource: 'ken_burns' }, { clipSource: 'replicate:wan-video/wan-2.2-i2v-fast' }]), false);
  assert.strictEqual(isAllFallback([]), false);
});

test('the real ffmpeg call leaves the last frame on disk', (t) => {
  let hasFfmpeg = true;
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch (e) { hasFfmpeg = false; }
  if (!hasFfmpeg) return t.skip('ffmpeg not installed');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'continuity-'));
  const clip = path.join(dir, 'clip.mp4');
  const frame = path.join(dir, 'frame.jpg');
  // 2s of colour bars, so the frame is never a black frame
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=2', '-pix_fmt', 'yuv420p', clip], { stdio: 'ignore' });
  execFileSync('ffmpeg', lastFrameArgs(clip, frame, 160, 120), { stdio: 'ignore' });

  const bytes = fs.statSync(frame).size;
  assert.ok(bytes > 1000, 'frame should contain an image, got ' + bytes + ' bytes');
  // jpeg magic
  assert.strictEqual(fs.readFileSync(frame).subarray(0, 2).toString('hex'), 'ffd8');
  fs.rmSync(dir, { recursive: true, force: true });
});
