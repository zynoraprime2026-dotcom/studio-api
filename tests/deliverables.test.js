const test = require('node:test');
const assert = require('node:assert');
const { castOf, vttToSrt, scriptCsv, scriptMarkdown, packageFor } = require('../lib/deliverables');

const movie = {
  id: 'mov_1', title: 'Monsoon Dhow', status: 'done', language: 'English', aspect: '16:9', style: 'warm amber', narrationVoice: 'en-US-GuyNeural',
  scenes: [
    { id: 's1', shot: 'wide establishing', duration: 5, narration: "Ali: We can't sell the dhow.", clipUrl: 'x', visualPrompt: 'dhow at dawn' },
    { id: 's2', shot: 'close', duration: 5, narration: 'The monsoon arrives early.', clipUrl: 'x', visualPrompt: 'rain on water' },
    { id: 's3', shot: 'medium', duration: 5, narration: 'Maya: The storm won\'t wait.', clipError: 'clip failed', visualPrompt: 'girl on deck' }
  ]
};

test('the cast list only counts real named dialogue', () => {
  const cast = castOf(movie.scenes);
  assert.deepStrictEqual(cast.map((c) => c.speaker).sort(), ['Ali', 'Maya']);
  assert.strictEqual(cast.find((c) => c.speaker === 'Ali').shots[0], 's1');
});

test('SRT keeps cue indexes and swaps the decimal comma', () => {
  const vtt = 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:05.000\nHello there\n\n2\n00:00:05.000 --> 00:00:10.000\nSecond line\n';
  const srt = vttToSrt(vtt);
  assert.ok(srt.startsWith('1\n00:00:00,000 --> 00:00:05,000'), 'blocks keep their index and use commas');
  assert.ok(srt.includes('2\n00:00:05,000 --> 00:00:10,000'));
  assert.ok(!srt.includes('WEBVTT'));
});

test('the shot list CSV escapes commas and quotes', () => {
  const csv = scriptCsv({ ...movie, scenes: [{ id: 's1', narration: 'Ali: We can\'t, "really"', shot: 'wide, low' }] });
  assert.ok(csv.split('\n')[0].startsWith('shot,id,framing'));
  assert.ok(csv.includes('"wide, low"'));
  assert.ok(csv.includes('""really""'));
});

test('the script marks a failed shot instead of pretending it rendered', () => {
  const md = scriptMarkdown(movie);
  assert.ok(md.includes('**3. medium** (5s · clip failed)'));
  assert.ok(md.includes('> ALI: We can\'t sell the dhow.'));
  assert.ok(md.includes('The monsoon arrives early.'), 'narration stays narration');
});

test('the package lists every deliverable and asks for a poster when missing', () => {
  const p = packageFor(movie, 'https://api.test', false);
  assert.strictEqual(p.shots, 3);
  assert.strictEqual(p.cast.length, 2);
  assert.strictEqual(p.deliverables.subtitlesSrt, 'https://api.test/v1/movie/mov_1/subtitles?format=srt');
  assert.strictEqual(p.deliverables.poster, null);
  assert.match(p.deliverables.posterAction, /POST/);
  assert.strictEqual(packageFor(movie, 'https://api.test', true).deliverables.poster, 'https://api.test/v1/movie/mov_1/poster');
});
