// Director mode: the shot-list normalizer and the suggestion rules.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  countWords,
  narrationWordBudget,
  normalizeDraft,
  buildSuggestions
} = require('../lib/director');

test('word budget scales with shot length', () => {
  assert.strictEqual(narrationWordBudget(5), 12);
  assert.strictEqual(narrationWordBudget(10), 24);
  assert.ok(narrationWordBudget(0) >= 6);
  assert.ok(narrationWordBudget('nonsense') >= 6);
});

test('a draft keeps every scene and reports long narration as a note', () => {
  const long = 'word '.repeat(40).trim();
  const draft = normalizeDraft({
    title: 'The Compass of Zanj',
    logline: 'A boy follows a brass compass.',
    style_bible: 'Coral rag village, monsoon haze.',
    musicMood: 'dramatic',
    scenes: [
      { id: 's1', shot: 'wide', visualPrompt: 'The boy on the beach at dawn', narrationText: 'Two words', duration: 5 },
      { id: 's2', shot: 'close', visualPrompt: 'Brass compass turning in his hand', narrationText: long, duration: 5 },
      { id: 's3', visualPrompt: 'The village square', narrationText: 'A short line.' },
      { id: 's4', visualPrompt: 'A dhow on the water', narrationText: 'Another line.' }
    ]
  }, { prompt: 'A boy finds a compass', duration: 5, maxScenes: 12 });

  assert.strictEqual(draft.title, 'The Compass of Zanj');
  assert.strictEqual(draft.styleBible, 'Coral rag village, monsoon haze.');
  assert.strictEqual(draft.scenes.length, 4);
  assert.strictEqual(draft.scenes[2].duration, 5, 'missing duration falls back to the requested one');
  assert.ok(draft.notes.some((n) => /Scene 2 narration is 40 words/.test(n)), JSON.stringify(draft.notes));
});

test('drafts drop empty scenes and flag a film too short to read as a film', () => {
  const draft = normalizeDraft({
    scenes: [
      { visualPrompt: 'one' },
      { narrationText: '   ' },
      { visualPrompt: 'three' }
    ]
  }, { duration: 5, maxScenes: 12 });
  assert.strictEqual(draft.scenes.length, 2);
  assert.ok(draft.notes.some((n) => /slideshow/.test(n)));
});

test('draft duration and image are clamped, not trusted', () => {
  const draft = normalizeDraft({
    scenes: [
      { visualPrompt: 'a', duration: 90 },
      { visualPrompt: 'b', duration: 0.2 },
      { visualPrompt: 'c', image: 'javascript:alert(1)' },
      { visualPrompt: 'd', image: 'https://example.com/still.jpg' }
    ]
  }, { duration: 5, maxScenes: 12 });
  assert.strictEqual(draft.scenes[0].duration, 10);
  assert.strictEqual(draft.scenes[1].duration, 3);
  assert.strictEqual(draft.scenes[2].image, null);
  assert.strictEqual(draft.scenes[3].image, 'https://example.com/still.jpg');
});

test('countWords ignores padding', () => {
  assert.strictEqual(countWords('  one   two  '), 2);
  assert.strictEqual(countWords(''), 0);
});

test('a clean finished film has nothing to suggest', () => {
  const suggestions = buildSuggestions({
    id: 'mov_1', status: 'done', continuity: 'chained',
    scenes: [
      { clipUrl: '/clip', clipSource: 'replicate:kling', startsFrom: 'scene_image', duration: 5, narrationDuration: 4.2 },
      { clipUrl: '/clip', clipSource: 'replicate:kling', startsFrom: 'previous_clip', duration: 5, narrationDuration: 4.4 }
    ]
  });
  assert.deepStrictEqual(suggestions, []);
});

test('failed shots come first and carry a callable action', () => {
  const suggestions = buildSuggestions({
    id: 'mov_1', status: 'partial', continuity: 'chained',
    scenes: [
      { clipUrl: '/clip', clipSource: 'replicate:kling', startsFrom: 'scene_image', duration: 5 },
      { imageError: 'Cloudflare rejected the prompt' },
      { clipSource: 'ken_burns', startsFrom: null, duration: 5 }
    ]
  });
  assert.ok(suggestions.length >= 3);
  const first = suggestions[0];
  assert.strictEqual(first.severity, 'high');
  assert.strictEqual(first.scene, 2);
  assert.strictEqual(first.action.path, '/v1/movie/mov_1/re-shoot');
  assert.deepStrictEqual(first.action.body, { scene: 2 });
  assert.ok(suggestions.some((s) => /still pan, not motion/.test(s.title)));
  assert.ok(suggestions.some((s) => /did not inherit/.test(s.title)));
});

test('narration overrun suggests the slower read, not a blind re-shoot', () => {
  const suggestions = buildSuggestions({
    id: 'mov_2', status: 'done', continuity: 'chained',
    scenes: [{ clipSource: 'replicate:kling', startsFrom: 'scene_image', duration: 5, narrationDuration: 6.8 }]
  });
  const overrun = suggestions.find((s) => s.kind === 'narration');
  assert.ok(overrun);
  assert.deepStrictEqual(overrun.action.body, { scene: 1, narrationRate: '-8%' });
});

test('a stale cut and a missing music bed both offer assemble', () => {
  const suggestions = buildSuggestions({
    id: 'mov_3', status: 'done', continuity: 'chained', assemblyStale: true,
    musicNote: 'music download failed', scenes: [{ clipSource: 'x', startsFrom: 'scene_image', duration: 5 }]
  });
  const assemble = suggestions.filter((s) => s.kind === 'assemble');
  assert.strictEqual(assemble.length, 2);
  assemble.forEach((s) => assert.strictEqual(s.action.path, '/v1/movie/mov_3/assemble'));
});

test('a film that is still rendering gets no advice yet', () => {
  const suggestions = buildSuggestions({
    id: 'mov_5', status: 'processing', continuity: 'chained',
    scenes: [{}, {}, {}]
  });
  assert.deepStrictEqual(suggestions, []);
});

test('a scene with no clip yet is not reported as a broken chain', () => {
  const suggestions = buildSuggestions({
    id: 'mov_6', status: 'partial', continuity: 'chained',
    scenes: [{ clipSource: 'replicate:kling', startsFrom: 'scene_image' }, { startsFrom: null }]
  });
  assert.deepStrictEqual(suggestions.filter((s) => /inherit/.test(s.title)), []);
});

test('suggestions are capped so the list stays usable', () => {
  const scenes = [];
  for (let i = 0; i < 40; i++) scenes.push({ imageError: 'failed' });
  const suggestions = buildSuggestions({ id: 'mov_4', status: 'partial', scenes });
  assert.ok(suggestions.length <= 12);
});
