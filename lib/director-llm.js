// The two Groq calls behind director mode: the film's visual identity first,
// then the shots. Kept out of server.js so the prompt handling, the JSON
// fallback and the guard can be tested without a network or an API key.

const { clampDuration, normalizeDraft, narrationWordBudget } = require('./director');

const DIRECTOR_GUARD = 'NEVER depict prophets, companions of the Prophet, angels, God, or any sacred religious figures - describe such characters only as distant silhouettes with faces obscured, or replace them with calligraphy or landscape visuals.';

/** One Groq call that must return JSON: json_object mode first, plain completion as fallback. */
async function groqChatJson(messages, opts) {
  const o = opts || {};
  const key = o.apiKey || process.env.GROQ_API_KEY;
  if (!key) {
    const e = new Error('GROQ_API_KEY is not configured on the server (needed to draft a shot list)');
    e.status = 503;
    throw e;
  }
  const doFetch = o.fetchImpl || fetch;
  const model = o.model || process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  let lastErr = null;
  for (const useJson of [true, false]) {
    try {
      const body = {
        model,
        messages,
        temperature: o.temperature === undefined ? 0.6 : o.temperature,
        max_tokens: o.maxTokens || 2000
      };
      if (useJson) body.response_format = { type: 'json_object' };
      const r = await doFetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'User-Agent': 'StudioAPI/1.0' },
        body: JSON.stringify(body)
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((d.error && d.error.message) || 'Groq request failed');
      const txt = String((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '');
      let parsed = null;
      try { parsed = JSON.parse(txt); } catch (e) {
        const m = txt.match(/\{[\s\S]*\}/);
        if (m) { try { parsed = JSON.parse(m[0]); } catch (e2) {} }
      }
      if (parsed && typeof parsed === 'object') return parsed;
      throw new Error('LLM reply was not JSON');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('LLM request failed');
}

/**
 * prompt -> shot list. Call 1 fixes the title, logline, style bible and the
 * character block; call 2 writes the shots and is required to open every shot
 * prompt with that same character block, which is what stops the drift.
 */
async function groqMovieDraft(prompt, o) {
  const opts = o || {};
  const moods = Array.isArray(opts.moods) && opts.moods.length ? opts.moods : ['ambient', 'nasheed', 'dramatic', 'calm', 'upbeat'];
  const language = opts.language || 'English';
  const duration = clampDuration(opts.duration, 5);
  const maxScenes = opts.maxScenes || 12;
  const target = Math.min(Math.max(4, opts.scenes || Math.min(maxScenes, 5)), maxScenes);
  const groq = (messages, extra) => groqChatJson(messages, Object.assign({}, opts, extra));

  const bible = await groq([
    {
      role: 'system',
      content: 'You are a film director preparing a shot list before anything is rendered. ' +
        'Reply with ONLY a JSON object: {"title":"...","logline":"...","styleBible":"...","character":"...","musicMood":"..."}. ' +
        'title: under 8 words. logline: one sentence, no spoilers, under 30 words. ' +
        'styleBible: the recurring visual identity in one sentence - palette, light, texture, setting. ' +
        'character: age, build, clothing colours and ONE distinctive feature of the main character, written so it can be pasted into every image prompt. ' +
        'musicMood: exactly one of ' + moods.join(', ') + '. ' + DIRECTOR_GUARD
    },
    {
      role: 'user',
      content: 'Idea: ' + prompt +
        (opts.style ? '\nLook I want: ' + opts.style : '') +
        (opts.character ? '\nThe main character is: ' + opts.character : '') +
        '\nNarration language: ' + language
    }
  ], { temperature: 0.5, maxTokens: 700 });

  const words = narrationWordBudget(duration);
  const shots = await groq([
    {
      role: 'system',
      content: 'You are a film director breaking an approved look into shots. ' +
        'Reply with ONLY a JSON object: {"scenes":[{"id":"s1","shot":"wide establishing","visualPrompt":"...","narrationText":"..."}]} with exactly ' + target + ' scenes. ' +
        'visualPrompt: ONE sentence of action, and every one must begin with this exact character and setting description: "' + String(bible.character || '') + '". ' +
        'Vary the shot (wide establishing, medium, close, over the shoulder, insert) and never use the same framing twice in a row. ' +
        'narrationText: 1-2 sentences in ' + language + ', at most ' + words + ' words so it fits a ' + duration + ' second shot. ' + DIRECTOR_GUARD
    },
    {
      role: 'user',
      content: 'Idea: ' + prompt +
        '\nTitle: ' + String(bible.title || '') +
        '\nLook: ' + String(bible.styleBible || opts.style || '') +
        '\nCharacter: ' + String(bible.character || '')
    }
  ], { temperature: 0.7, maxTokens: 2500 });

  return normalizeDraft({
    title: bible.title,
    logline: bible.logline,
    styleBible: bible.styleBible,
    character: bible.character,
    musicMood: bible.musicMood,
    scenes: shots.scenes
  }, { duration, maxScenes, style: opts.style, character: opts.character });
}

module.exports = { DIRECTOR_GUARD, groqChatJson, groqMovieDraft };
