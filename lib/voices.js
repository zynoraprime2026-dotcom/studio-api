// Casting for narration lines.
//
// A shot line can be shaped "Ali: We can't sell the dhow." That is dialogue, so
// it should not be read by the narrator's voice - one reader doing every
// character is the thing that makes a film sound like a machine. This module
// picks a different, stable voice per speaker name, and leaves the name out of
// the audio (the caption keeps it, so a viewer still knows who is talking).

const VOICE_RE = /^[a-z]{2,4}-[A-Z]{2}-[A-Za-z]+$/;

const POOLS = {
  en: ['en-US-GuyNeural', 'en-US-JennyNeural', 'en-GB-RyanNeural', 'en-US-AriaNeural', 'en-US-DavisNeural', 'en-GB-SoniaNeural'],
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

function hash(text) {
  let h = 7;
  for (const c of String(text || 'x').toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 1000000;
  return h;
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
  if (!line || line.split(/\s+/).length < 2) return { speaker: null, line: raw.trim() };
  return { speaker, line };
}

// Same name, same voice, every shot - including a re-shoot. Derived from the
// name and the film's narrator voice, so nothing has to be persisted.
function voiceForSpeaker(speaker, baseVoice, language) {
  const base = VOICE_RE.test(String(baseVoice || '')) ? String(baseVoice) : 'en-US-GuyNeural';
  const pool = poolFor(language, base);
  if (!pool.length) return base;
  return pool[hash(speaker) % pool.length];
}

/**
 * What to say aloud, and in whose voice.
 * Returns { voice, text, speaker }; text drops the name, captions keep the original.
 */
function spokenLine(text, baseVoice, language) {
  const base = VOICE_RE.test(String(baseVoice || '')) ? String(baseVoice) : 'en-US-GuyNeural';
  const parsed = speakerOf(text);
  if (!parsed.speaker) return { voice: base, text: parsed.line, speaker: null };
  return { voice: voiceForSpeaker(parsed.speaker, base, language), text: parsed.line, speaker: parsed.speaker };
}

module.exports = { speakerOf, voiceForSpeaker, spokenLine, langCode };
