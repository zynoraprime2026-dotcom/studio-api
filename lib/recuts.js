// Re-cuts of a finished film: the 9:16 vertical for socials and a trailer.
//
// Both run on the 512MB free instance, so nothing here decodes the whole film at
// once: vertical is a single crop/scale pass and the trailer is a short concat of
// per-shot trims. The planning half is pure so it can be tested without ffmpeg.

/** Centre-crop a 16:9 master into 9:16, at a size the free instance can encode. */
function verticalPlan(aspect) {
  const vertical = aspect === '9:16';
  const W = 608;   // 9:16 at 608x1080 keeps the encode under the free tier's memory
  const H = 1080;
  if (vertical) return { W, H, filter: 'scale=' + W + ':' + H + ',setsar=1', note: 'already vertical' };
  return {
    W, H,
    // crop to a 9:16 window from the middle of the frame, then scale
    filter: 'crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=' + W + ':' + H + ',setsar=1',
    note: null
  };
}

/**
 * Which shots make the trailer, and where to cut each one.
 * Prefers shots that actually have a clip and no error, spreads across the film,
 * and takes the middle of each shot where the motion usually is.
 */
function trailerPlan(scenes, opts) {
  const o = opts || {};
  const maxShots = Math.min(Math.max(parseInt(o.maxShots, 10) || 3, 1), 5);
  const want = Math.min(Math.max(parseFloat(o.seconds) || 2.5, 1), 4);
  const usable = [];
  (Array.isArray(scenes) ? scenes : []).forEach((s, i) => {
    if (!s) return;
    const hasClip = !!s.clipUrl && !s.clipError;
    const dur = Number(s.duration) || 5;
    if (!hasClip) return;
    usable.push({ index: i, from: Math.max(0, dur / 2 - want / 2), seconds: Math.min(want, dur) });
  });
  if (!usable.length) return { picks: [], note: 'no shots have motion clips yet, so there is nothing to cut a trailer from' };
  // spread the picks across the film rather than taking the first three
  const picks = [];
  const step = usable.length / Math.min(maxShots, usable.length);
  for (let k = 0; k < Math.min(maxShots, usable.length); k++) picks.push(usable[Math.floor(k * step)]);
  return { picks, note: null };
}

/** Seconds a trailer will run, given its picks and any title card. */
function trailerDuration(picks, titleCard) {
  const body = (picks || []).reduce((n, p) => n + p.seconds, 0);
  return Math.round((body + (titleCard ? 1.5 : 0)) * 10) / 10;
}

module.exports = { verticalPlan, trailerPlan, trailerDuration };
