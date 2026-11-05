const test = require('node:test');
const assert = require('node:assert');
const { parseLooseJson } = require('../lib/loose-json');

test('json wrapped in fences, prose or trailing commas still parses', () => {
  const want = [{ visualPrompt: 'a', narrationText: 'b' }];
  assert.deepStrictEqual(parseLooseJson('```json\n{"scenes":[{"visualPrompt":"a","narrationText":"b"}]}\n```').scenes, want);
  assert.deepStrictEqual(parseLooseJson('Here you go:\n{"scenes":[{"visualPrompt":"a","narrationText":"b"}]}\nDone.').scenes, want);
  assert.deepStrictEqual(parseLooseJson('{"scenes":[{"visualPrompt":"a","narrationText":"b"},]}').scenes, want);
});

test('a bare array of shots is accepted', () => {
  assert.deepStrictEqual(parseLooseJson('[{"visualPrompt":"a","narrationText":"b"}]'), [{ visualPrompt: 'a', narrationText: 'b' }]);
});

test('a truncated answer returns null instead of throwing', () => {
  assert.strictEqual(parseLooseJson('{"scenes":[{"visualPrompt":"a"'), null);
  assert.strictEqual(parseLooseJson(''), null);
});
