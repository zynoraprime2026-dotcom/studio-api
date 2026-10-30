const test = require('node:test');
const assert = require('node:assert');
const { verticalPlan, trailerPlan, trailerDuration } = require('../lib/recuts');

test('a 16:9 film is centre-cropped to 9:16, not squashed', () => {
  const p = verticalPlan('16:9');
  assert.match(p.filter, /crop=ih\*9\/16:ih:/);
  assert.ok(p.filter.includes(`scale=${p.W}:${p.H}`));
  assert.strictEqual(p.H, 1080);
});

test('an already-vertical film is only scaled', () => {
  const p = verticalPlan('9:16');
  assert.ok(!p.filter.includes('crop='));
});

test('the trailer skips shots that never got motion', () => {
  const scenes = [
    { clipUrl: 'a', duration: 5 },
    { clipUrl: 'b', clipError: 'failed', duration: 5 },
    { duration: 5 },
    { clipUrl: 'd', duration: 5 }
  ];
  const plan = trailerPlan(scenes, { maxShots: 3 });
  assert.deepStrictEqual(plan.picks.map((p) => p.index), [0, 3]);
});

test('picks are spread across the film, not the first three shots', () => {
  const scenes = Array.from({ length: 9 }, () => ({ clipUrl: 'x', duration: 5 }));
  const picks = trailerPlan(scenes, { maxShots: 3 }).picks;
  assert.deepStrictEqual(picks.map((p) => p.index), [0, 3, 6]);
});

test('each pick comes from the middle of its shot and never runs past it', () => {
  const plan = trailerPlan([{ clipUrl: 'x', duration: 3 }], { seconds: 4 });
  assert.ok(plan.picks[0].seconds <= 3, 'a 3s shot cannot give a 4s trailer cut');
  assert.ok(plan.picks[0].from >= 0);
});

test('a film with no motion clips says so instead of cutting an empty trailer', () => {
  const plan = trailerPlan([{ duration: 5 }, { duration: 5 }]);
  assert.strictEqual(plan.picks.length, 0);
  assert.match(plan.note, /no shots have motion clips/);
});

test('runtime adds up', () => {
  assert.strictEqual(trailerDuration([{ seconds: 2.5 }, { seconds: 2.5 }], true), 6.5);
});
