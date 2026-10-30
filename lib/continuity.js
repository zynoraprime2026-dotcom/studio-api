// Shot continuity for the movie pipeline.
//
// Scenes used to be rendered independently: every clip opened on its own
// generated still, so a film cut from one shot to a visually unrelated one
// every five seconds. Chained mode carries the last frame of the previous clip
// into the next scene as its start image, so the shots flow into each other.

const CHAINED = 'chained';
const INDEPENDENT = 'independent';

const TRUTHY = new Set(['chained', 'chain', 'seamless', 'continuous', 'flow', 'true', 'on', 'yes', '1']);
const FALSY = new Set(['independent', 'off', 'false', 'no', 'cut', '0']);

/** Normalizes the `continuity` request option. Films flow unless asked not to. */
function normalizeContinuity(value) {
  if (value === undefined || value === null || value === '') return CHAINED;
  if (value === true || value === 1) return CHAINED;
  if (value === false || value === 0) return INDEPENDENT;
  const v = String(value).trim().toLowerCase();
  if (TRUTHY.has(v)) return CHAINED;
  if (FALSY.has(v)) return INDEPENDENT;
  return CHAINED;
}

/**
 * Which image opens each scene's clip.
 * previous_clip: start on the last frame of the shot before it (continuity)
 * scene_image:   start on the scene's own still (independent shots)
 */
function chainPlan(sceneCount, mode) {
  const chained = normalizeContinuity(mode) === CHAINED;
  const count = Math.max(0, parseInt(sceneCount, 10) || 0);
  const plan = [];
  for (let i = 0; i < count; i++) {
    plan.push({ index: i, startsFrom: chained && i > 0 ? 'previous_clip' : 'scene_image' });
  }
  return plan;
}

/**
 * ffmpeg args that leave the final frame of a clip in outPath, scaled to WxH.
 * -sseof -1 decodes from one second before the end and -update 1 keeps
 * overwriting the same file, so the frame left behind is the last one.
 */
function lastFrameArgs(clipPath, outPath, W, H) {
  const args = ['-y', '-sseof', '-1', '-i', String(clipPath)];
  if (W && H) args.push('-vf', 'scale=' + parseInt(W, 10) + ':' + parseInt(H, 10));
  args.push('-update', '1', '-q:v', '2', String(outPath));
  return args;
}

/** True when the clip set contains no real provider render. */
function isAllFallback(sceneList) {
  const scenes = Array.isArray(sceneList) ? sceneList : [];
  if (!scenes.length) return false;
  return scenes.every((s) => !s || !s.clipSource || s.clipSource === 'ken_burns');
}

module.exports = { normalizeContinuity, chainPlan, lastFrameArgs, isAllFallback, CHAINED, INDEPENDENT };
