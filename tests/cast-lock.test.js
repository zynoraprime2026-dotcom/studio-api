const test = require('node:test');
const assert = require('node:assert');
const { castNames, normalizeCast, applyCast, castToBible, castFromBible } = require('../lib/cast-lock');

const CAST = [
  { name: 'Kwaaku Ananse', description: 'a slender spider in ochre and deep-red woven robes, golden web markings' },
  { name: 'Ntikuma', description: 'a small round spiderling in a faded green cloth, one chipped eye' }
];

test('cast is read from who actually speaks', () => {
  const scenes = [{ narrationText: 'Kwaaku Ananse: I have it.' }, { narrationText: 'Ntikuma: Careful.' }, { narrationText: 'Ananse: I have it.' }];
  assert.deepStrictEqual(castNames(scenes), ['Kwaaku Ananse', 'Ntikuma', 'Ananse']);
});

test('a shot gets only the people who are in it', () => {
  const scenes = [
    { narrationText: 'Kwaaku Ananse: Mine at last.', visualPrompt: 'a clay pot on a branch' },
    { narrationText: 'Ntikuma: Father, look out.', visualPrompt: 'a tree at dusk' }
  ];
  const out = applyCast(scenes, CAST);
  assert.ok(out[0].visualPrompt.startsWith(CAST[0].description));
  assert.ok(!out[0].visualPrompt.includes('spiderling'));
  assert.ok(out[1].visualPrompt.startsWith(CAST[1].description));
});

test('a descriptive prompt is not described twice', () => {
  const once = applyCast([{ narrationText: 'Ntikuma: go', visualPrompt: 'a tree' }], CAST);
  const twice = applyCast(once, CAST);
  assert.strictEqual(twice[0].visualPrompt, once[0].visualPrompt);
});

test('the cast survives into the bible and back out', () => {
  const line = castToBible(CAST);
  const back = castFromBible('Some look notes\n' + line);
  assert.strictEqual(back.length, 2);
  assert.strictEqual(back[0].name, 'Kwaaku Ananse');
  assert.strictEqual(back[1].description, CAST[1].description);
});

test('a broken cast entry is dropped, not passed through', () => {
  assert.deepStrictEqual(normalizeCast([{ name: 'X' }, null, { description: 'ok look' }]), [{ name: '', description: 'ok look' }]);
});
