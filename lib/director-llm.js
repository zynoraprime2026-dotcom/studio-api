// The two Groq calls behind director mode: the film's visual identity first,
// then the shots. Kept out of server.js so the prompt handling, the JSON
// fallback and the guard can be tested without a network or an API key.

const { clampDuration, normalizeDraft, narrationWordBudget } = require('./director');

/** Speech that sounds like a person, shared by both script writers. */
const NATURAL_SPEECH =
  'narrationText is SPOKEN, read aloud by a voice actor: write it the way people talk, with contractions ' +
  '(she\'s, don\'t, I\'m), plain everyday words, and sentences of wildly different lengths - a three word line is good. ' +
  'When a character speaks, put their name first and let them talk directly, like "Ali: I know that boat. It sank years ago." ' +
  'One speaker per line. Never use narrator cliches ("little did they know", "in a world where"), never stack adjectives, ' +
  'never describe what the picture already shows, and never add stage directions or emotion tags.';

const DIRECTOR_GUARD = 'NEVER depict prophets, companions of the Prophet, angels, God, or any sacred religious figures - describe such characters only as distant silhouettes with faces obscured, or replace them with calligraphy or landscape visuals.';

/** A reply that is only one short JSON shot list does not need a trailer-sized budget.
 *  Reserving less output per call is what keeps a free daily token quota alive. */
function shotBudget(scenes) {
  return Math.min(2400, 600 + Math.max(1, scenes || 5) * 180);
}

/** Groq answers a spent quota with 429; retrying the same key without json mode just
 *  burns another round trip, so that error goes straight to the next provider. */
function isQuotaError(e) {
  const m = String((e && e.message) || '');
  return /\b429\b|rate limit|quota|tokens per day|too many requests/i.test(m);
}

/** Pull the first JSON object out of a model reply (models sometimes wrap it in prose). */
function parseJsonLoose(txt) {
  const raw = String(txt || '');
  try { return JSON.parse(raw); } catch (e) {}
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
  return null;
}

/** Second provider: same contract as the Groq call, so a spent Groq quota cannot stop a draft. */
function geminiKey(o) {
  return o.geminiKey || process.env.GEMINI_API_KEY || '';
}

function geminiBody(messages, o) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content) }]
  }));
  const body = {
    contents,
    generationConfig: {
      temperature: o.temperature === undefined ? 0.6 : o.temperature,
      maxOutputTokens: o.maxTokens || 2000,
      responseMimeType: 'application/json'
    }
  };
  if (sys) body.systemInstruction = { parts: [{ text: sys }] };
  return body;
}

async function geminiChatJson(messages, o) {
  const key = geminiKey(o);
  if (!key) return null;
  const doFetch = o.fetchImpl || fetch;
  const model = o.geminiModel || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const r = await doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, 'User-Agent': 'StudioAPI/1.0' },
    body: JSON.stringify(geminiBody(messages, o))
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.error && d.error.message) || 'Gemini request failed');
  const parts = (d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [];
  const txt = parts.map((p) => p.text || '').join('');
  const parsed = parseJsonLoose(txt);
  if (parsed && typeof parsed === 'object') return parsed;
  throw new Error('Gemini reply was not JSON');
}

/** One Groq call that must return JSON: json_object mode first, plain completion as fallback. */
async function groqChatJson(messages, opts) {
  const o = opts || {};
  const key = o.apiKey || process.env.GROQ_API_KEY;
  const hasGemini = !!geminiKey(o);
  if (!key && !hasGemini) {
    const e = new Error('No LLM provider configured on the server (set GROQ_API_KEY, or GEMINI_API_KEY to draft a shot list)');
    e.status = 503;
    throw e;
  }
  const doFetch = o.fetchImpl || fetch;
  const model = o.model || process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  let lastErr = null;

  // Groq first: it is the fastest of the two. A spent daily token quota lands here as a
  // 429, which is exactly when the Gemini fallback earns its keep.
  for (const useJson of key ? [true, false] : []) {
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
      const parsed = parseJsonLoose(txt);
      if (parsed && typeof parsed === 'object') return parsed;
      throw new Error('LLM reply was not JSON');
    } catch (e) {
      lastErr = e;
      if (isQuotaError(e)) break; // no point asking the same key again
    }
  }

  if (hasGemini) {
    try {
      const viaGemini = await geminiChatJson(messages, o);
      if (viaGemini) return viaGemini;
    } catch (e) {
      lastErr = new Error('Groq: ' + (lastErr ? lastErr.message : 'skipped') + ' | Gemini: ' + e.message);
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
  ], { temperature: 0.5, maxTokens: 600 });

  const words = narrationWordBudget(duration);
  const shots = await groq([
    {
      role: 'system',
      content: 'You are a film director breaking an approved look into shots. ' +
        'Reply with ONLY a JSON object: {"scenes":[{"id":"s1","shot":"wide establishing","visualPrompt":"...","narrationText":"..."}]} with exactly ' + target + ' scenes. ' +
        'visualPrompt: ONE sentence of action, and every one must begin with this exact character and setting description: "' + String(bible.character || '') + '". ' +
        'Vary the shot (wide establishing, medium, close, over the shoulder, insert) and never use the same framing twice in a row. ' +
        NATURAL_SPEECH + ' ' +
        'Write it in ' + language + ', at most ' + words + ' words so it fits a ' + duration + ' second shot. ' + DIRECTOR_GUARD
    },
    {
      role: 'user',
      content: 'Idea: ' + prompt +
        '\nTitle: ' + String(bible.title || '') +
        '\nLook: ' + String(bible.styleBible || opts.style || '') +
        '\nCharacter: ' + String(bible.character || '')
    }
  ], { temperature: 0.7, maxTokens: shotBudget(target) });

  return normalizeDraft({
    title: bible.title,
    logline: bible.logline,
    styleBible: bible.styleBible,
    character: bible.character,
    musicMood: bible.musicMood,
    scenes: shots.scenes
  }, { duration, maxScenes, style: opts.style, character: opts.character });
}

module.exports = { DIRECTOR_GUARD, NATURAL_SPEECH, groqChatJson, groqMovieDraft };
