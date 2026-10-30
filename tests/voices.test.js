const test = require('node:test');
const assert = require('node:assert');
const { speakerOf, voiceForSpeaker, spokenLine } = require('../lib/voices');

test('a "Name: line" shot is dialogue, and the name leaves the audio', () => {
  const r = spokenLine("Ali: We can't sell the dhow.", 'en-US-GuyNeural', 'English');
  assert.strictEqual(r.speaker, 'Ali');
  assert.strictEqual(r.text, "We can't sell the dhow.");
});

test('two names get two different voices, and neither is the narrator', () => {
  const ali = voiceForSpeaker('Ali', 'en-US-GuyNeural', 'English');
  const maya = voiceForSpeaker('Maya', 'en-US-GuyNeural', 'English');
  assert.notStrictEqual(ali, maya, 'the same voice for both characters is the bug this fixes');
  assert.notStrictEqual(ali, 'en-US-GuyNeural');
  assert.notStrictEqual(maya, 'en-US-GuyNeural');
});

test('a name keeps its voice across shots, so a re-shoot sounds like the same person', () => {
  const a = voiceForSpeaker('Maya', 'en-US-GuyNeural', 'English');
  const b = voiceForSpeaker('maya', 'en-US-GuyNeural', 'English');
  assert.strictEqual(a, b);
});

test('narration without a name is not treated as dialogue', () => {
  const r = spokenLine('The monsoon arrives three weeks early.', 'en-US-GuyNeural', 'English');
  assert.strictEqual(r.speaker, null);
  assert.strictEqual(r.voice, 'en-US-GuyNeural');
});

test('a sentence with a colon mid-line is not mistaken for a speaker', () => {
  const r = spokenLine('She had one rule: never sail at night.', 'en-US-GuyNeural', 'English');
  assert.strictEqual(r.speaker, null);
});

test('quoted dialogue is unwrapped and empty names rejected', () => {
  const r = spokenLine('Maya: "I get it, but the storm won\'t wait."', 'en-US-GuyNeural', 'English');
  assert.strictEqual(r.text, "I get it, but the storm won't wait.");
  const bad = speakerOf('Ali:');
  assert.strictEqual(bad.speaker, null);
});

test('Arabic films cast from the Arabic pool', () => {
  const v = voiceForSpeaker('Ali', 'ar-SA-HamedNeural', 'Arabic');
  assert.match(v, /^ar-/);
  assert.notStrictEqual(v, 'ar-SA-HamedNeural');
});
