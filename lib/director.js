// Director mode: the pure parts.
//
// A prompt becomes a shot list a human can fix, a shot list becomes a render,
// and a finished film becomes specific advice. Everything in here is
// deterministic and network-free so it can be tested without Groq, Replicate or
// ffmpeg. The routes in server.js only do I/O around these functions.

const MIN_SCENES = 4;
const MAX_SUGGESTIONS = 12;
const WORDS_PER_SECOND = 2.4; // measured on the default narrator at +0%

function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/** How many words a shot of this length can hold before the narration runs over. */
function narrationWordBudget(duration, wordsPerSecond) {
  const d = Number(duration) > 0 ? Number(duration) : 5;
  const wps = Number(wordsPerSecond) > 0 ? Number(wordsPerSecond) : WORDS_PER_SECOND;
  return Math.max(6, Math.round(d * wps));
}

function clampDuration(value, fallback) {
  const n = Number(value);
  if (!isFinite(n) || n <= 0) return fallback;
  return Math.min(10, Math.max(3, Math.round(n * 10) / 10));
}

function httpUrl(value) {
  const s = String(value || '').trim();
  return /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1))/.test(s) ? s : null;
}

/**
 * Turns whatever the model (or a caller) produced into the draft shape the
 * studio renders: every scene has a prompt, a narration, a duration and a shot
 * name, and anything a human should look at lands in `notes` instead of being
 * silently trimmed.
 */
function normalizeDraft(raw, opts) {
  const o = opts || {};
  const maxScenes = o.maxScenes || 12;
  const defaultDuration = clampDuration(o.duration, 5);
  const src = (raw && (raw.scenes || raw.shots)) || [];
  const list = (Array.isArray(src) ? src : []).slice(0, maxScenes);

  const scenes = list.map((s, i) => {
    const scene = s || {};
    return {
      id: String(scene.id || ('s' + (i + 1))).slice(0, 12),
      shot: String(scene.shot || '').trim().slice(0, 40) || null,
      visualPrompt: String(scene.visualPrompt || scene.visual_prompt || scene.prompt || '').trim().slice(0, 600),
      narrationText: String(scene.narrationText || scene.narration_text || scene.narration || '').trim()
        .split(/\s+/).filter(Boolean).slice(0, 120).join(' ').slice(0, 600),
      duration: clampDuration(scene.duration, defaultDuration),
      imagePrompt: String(scene.imagePrompt || scene.image_prompt || '').trim().slice(0, 600) || null,
      image: httpUrl(scene.image)
    };
  }).filter((s) => s.visualPrompt || s.narrationText || s.image);

  const notes = [];
  if (scenes.length < MIN_SCENES) {
    notes.push('Only ' + scenes.length + ' usable scene(s): a film under ' + MIN_SCENES + ' scenes reads as a slideshow.');
  }
  scenes.forEach((s, i) => {
    const budget = narrationWordBudget(s.duration);
    const words = countWords(s.narrationText);
    if (words > Math.round(budget * 1.15)) {
      notes.push('Scene ' + (i + 1) + ' narration is ' + words + ' words; a ' + s.duration + 's shot holds about ' + budget + '.');
    }
    if (!s.visualPrompt) notes.push('Scene ' + (i + 1) + ' has no visual prompt and cannot be rendered.');
  });

  return {
    title: String((raw && (raw.title || raw.filmTitle)) || o.title || '').trim().slice(0, 160) || 'Untitled film',
    logline: String((raw && raw.logline) || '').trim().slice(0, 300) || null,
    styleBible: String((raw && (raw.styleBible || raw.style_bible)) || o.style || '').trim().slice(0, 400) || null,
    character: String((raw && (raw.character || raw.cast)) || o.character || '').trim().slice(0, 400) || null,
    musicMood: String((raw && raw.musicMood) || '').trim().toLowerCase() || null,
    scenes,
    notes
  };
}

function action(movieId, kind, body) {
  const base = '/v1/movie/' + movieId;
  if (kind === 're-shoot') return { method: 'POST', path: base + '/re-shoot', body: body || {} };
  if (kind === 'assemble') return { method: 'POST', path: base + '/assemble', body: body || {} };
  return null;
}

/**
 * What to fix next, from what the pipeline already recorded. Every suggestion
 * carries a call the caller can actually make; advice nobody can act on in one
 * request is noise.
 */
function buildSuggestions(movie) {
  const m = movie || {};
  const id = m.id || '';
  const scenes = Array.isArray(m.scenes) ? m.scenes : [];
  const out = [];
  const push = (s) => { if (s && out.length < MAX_SUGGESTIONS) out.push(Object.assign({ id: 'sug_' + (out.length + 1) }, s)); };
  const short = (text, n) => String(text || '').slice(0, n || 200);

  if (m.error) {
    push({
      kind: 'info', scene: null, severity: 'high',
      title: 'The last run reported an error',
      message: short(m.error, 300),
      action: null
    });
  }

  // mid-render every scene looks broken (no clip yet, no inherited frame yet).
  // Advice is only worth giving on a film that has stopped moving.
  const rendering = ['queued', 'scripting', 'processing', 'assembling'].includes(m.status);
  if (rendering) return out;

  scenes.forEach((s, i) => {
    const n = i + 1;
    if (s.imageError) {
      push({
        kind: 're-shoot', scene: n, severity: 'high',
        title: 'Scene ' + n + ' has no still',
        message: 'The still never rendered, so the shot was dropped from the cut: ' + short(s.imageError, 160),
        action: action(id, 're-shoot', { scene: n })
      });
      return;
    }
    if (s.clipError) {
      push({
        kind: 're-shoot', scene: n, severity: 'high',
        title: 'Scene ' + n + ' fell back instead of animating',
        message: short(s.clipError, 160),
        action: action(id, 're-shoot', { scene: n })
      });
    } else if (s.clipSource === 'ken_burns') {
      push({
        kind: 're-shoot', scene: n, severity: 'medium',
        title: 'Scene ' + n + ' is a still pan, not motion',
        message: 'No image-to-video provider produced a clip for this shot, so it pans across the still.',
        action: action(id, 're-shoot', { scene: n })
      });
    }

    const hasClip = !!(s.clipUrl || s.clipSource);
    if (hasClip && m.continuity === 'chained' && i > 0 && !s.startsFrom) {
      push({
        kind: 're-shoot', scene: n, severity: 'low',
        title: 'Scene ' + n + ' did not inherit the previous frame',
        message: 'The chain broke here, which is where a cut is most likely to feel like a jump.',
        action: action(id, 're-shoot', { scene: n })
      });
    }

    const narrDur = Number(s.narrationDuration);
    const sceneDur = Number(s.duration);
    if (isFinite(narrDur) && isFinite(sceneDur) && sceneDur > 0 && narrDur > sceneDur + 0.4) {
      push({
        kind: 'narration', scene: n, severity: 'medium',
        title: 'Scene ' + n + ' narration overruns the shot',
        message: 'Narration runs ' + narrDur.toFixed(1) + 's against a ' + sceneDur + 's shot, so it gets cut off.',
        action: action(id, 're-shoot', { scene: n, narrationRate: '-8%' })
      });
    }

    if (s.narrationError) {
      push({
        kind: 'narration', scene: n, severity: 'medium',
        title: 'Scene ' + n + ' is silent',
        message: short(s.narrationError, 160),
        action: action(id, 're-shoot', { scene: n })
      });
    }
  });

  if (m.assemblyStale) {
    push({
      kind: 'assemble', scene: null, severity: 'medium',
      title: 'The cut is older than the shots',
      message: 'A scene was re-shot after the last assembly, so the film you can watch is out of date.',
      action: action(id, 'assemble', {})
    });
  }

  if (m.musicNote) {
    push({
      kind: 'assemble', scene: null, severity: 'low',
      title: 'Shipped without its music bed',
      message: short(m.musicNote, 200),
      action: action(id, 'assemble', {})
    });
  }

  const hardCuts = scenes.filter((s) => s.crossfadeError).length;
  if (hardCuts) {
    push({
      kind: 'assemble', scene: null, severity: 'low',
      title: 'The cut is hard-cut, not dissolved',
      message: 'The dissolve pass failed on this instance, so the scenes were joined with straight cuts.',
      action: action(id, 'assemble', {})
    });
  }

  if (m.status === 'partial' && !m.error) {
    push({
      kind: scenes.some((s) => s.clipUrl || s.clipSource) ? 'assemble' : 'info',
      scene: null, severity: 'high',
      title: 'The film is incomplete',
      message: 'Some scenes did not finish. Re-shoot the ones listed above, then assemble again.',
      action: scenes.some((s) => s.clipUrl || s.clipSource) ? action(id, 'assemble', {}) : null
    });
  }

  // most serious first, and inside a severity a named scene beats a film-wide
  // note: "scene 2 never animated" is something you can fix, "the film is
  // incomplete" is what you already knew
  const rank = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) ||
    ((a.scene ? 0 : 1) - (b.scene ? 0 : 1)) ||
    ((a.scene || 0) - (b.scene || 0)));
  return out;
}

module.exports = {
  MIN_SCENES,
  MAX_SUGGESTIONS,
  WORDS_PER_SECOND,
  countWords,
  narrationWordBudget,
  clampDuration,
  normalizeDraft,
  buildSuggestions
};
