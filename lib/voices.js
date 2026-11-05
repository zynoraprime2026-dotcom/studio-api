// Casting for narration lines.
//
// A shot line can be shaped "Ali: We can't sell the dhow." That is dialogue, so
// it should not be read by the narrator's voice - one reader doing every
// character is the thing that makes a film sound like a machine. This module
// picks a different, stable voice per speaker name, and leaves the name out of
// the audio (the caption keeps it, so a viewer still knows who is talking).

const VOICE_RE = /^[a-z]{2,4}-[A-Z]{2}-[A-Za-z]+$/;

// Voices seen working against edge-tts today. en-US-DavisNeural was retired by
// Microsoft and now fails every request, which used to sink a whole film at assembly.
const POOLS = {
  en: ['en-US-GuyNeural', 'en-US-JennyNeural', 'en-GB-RyanNeural', 'en-US-AriaNeural', 'en-GB-SoniaNeural'],
  ar: ['ar-SA-HamedNeural', 'ar-SA-ZariyahNeural', 'ar-EG-ShakirNeural', 'ar-EG-SalmaNeural']
};

function langCode(language) {
  const l = String(language || '').toLowerCase();
  if (/arab|^ar\b/.test(l)) return 'ar';
  return 'en';
}

function poolFor(language, baseVoice) {
  const pool = POOLS[langCode(language)] || POOLS.en;
  // a speaker should never sound like the narrator
  return pool.filter((v) => v !== baseVoice);
}

// FNV-1a: neighbouring short names must not land on the same voice.
function hash(text) {
  let h = 0x811c9dc5;
  for (const c of String(text || 'x').toLowerCase()) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 1000000;
}

/** First free voice from the name's own starting point, so nobody shares. */
function pickVoice(name, pool, taken) {
  if (!pool.length) return null;
  const start = hash(name) % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const v = pool[(start + i) % pool.length];
    if (!taken || !taken.has(v)) return v;
  }
  return pool[start];
}

/**
 * Cast the whole film at once. Voices are handed out name by name in a stable
 * order, never twice, so two characters cannot come out sounding identical.
 * Returns Map(lowercased name -> voice).
 */
function castMap(texts, baseVoice, language) {
  const base = VOICE_RE.test(String(baseVoice || '')) ? String(baseVoice) : 'en-US-GuyNeural';
  const pool = poolFor(language, base);
  const names = [];
  const seen = new Set();
  for (const t of (Array.isArray(texts) ? texts : [])) {
    const { speaker } = speakerOf(t);
    if (!speaker) continue;
    const k = speaker.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    names.push(speaker);
  }
  names.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
  const out = new Map();
  const taken = new Set();
  for (const name of names) {
    const v = pickVoice(name, pool, taken);
    if (v) { out.set(name.toLowerCase(), v); taken.add(v); }
  }
  return out;
}

// "Ali: We can't sell the dhow." -> { speaker: 'Ali', line: "We can't sell the dhow." }
// Anything that is not a short "Name:" prefix stays a narrator line.
function speakerOf(text) {
  const raw = String(text || '');
  const m = raw.match(/^\s*([A-Za-z][A-Za-z'.-]*(?:\s+[A-Z][A-Za-z'.-]*){0,2})\s*[::]\s*([\s\S]+)$/);
  if (!m) return { speaker: null, line: raw.trim() };
  const speaker = m[1].trim();
  let line = m[2].trim();
  // only unwrap when the whole line is quoted, so inner quotes survive intact
  const q = line[0];
  if (q && '"“‘\''.includes(q) && line.length > 1) {
    const closer = q === '“' ? '”' : (q === '‘' ? '’' : q);
    if (line.endsWith(closer)) line = line.slice(1, -1).trim();
  }
  // a short line is still a line: "Ananse: Oops." used to fall through to the
  // narrator, who then read the character's name out loud
  if (!line) return { speaker: null, line: raw.trim() };
  return { speaker, line };
}

// Same name, same voice, every shot - including a re-shoot. Derived from the
// name and the film's narrator voice, so nothing has to be persisted.
function voiceForSpeaker(speaker, baseVoice, language, cast) {
  const base = VOICE_RE.test(String(baseVoice || '')) ? String(baseVoice) : 'en-US-GuyNeural';
  const pool = poolFor(language, base);
  if (!pool.length) return base;
  if (cast && cast.get) {
    const assigned = cast.get(String(speaker || '').toLowerCase());
    if (assigned) return assigned;
  }
  return pickVoice(speaker, pool, null);
}

/**
 * What to say aloud, and in whose voice.
 * Returns { voice, text, speaker }; text drops the name, captions keep the original.
 */
function spokenLine(text, baseVoice, language, cast) {
  const base = VOICE_RE.test(String(baseVoice || '')) ? String(baseVoice) : 'en-US-GuyNeural';
  const parsed = speakerOf(text);
  if (!parsed.speaker) return { voice: base, text: parsed.line, speaker: null };
  return { voice: voiceForSpeaker(parsed.speaker, base, language, cast), text: parsed.line, speaker: parsed.speaker };
}

module.exports = { speakerOf, voiceForSpeaker, spokenLine, castMap, langCode };
