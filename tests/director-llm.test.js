// The two Groq calls behind director mode. No network: fetch is injected.

const { test } = require('node:test');
const assert = require('node:assert');
const { groqChatJson, groqMovieDraft, DIRECTOR_GUARD } = require('../lib/director-llm');

function stub(replies) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const next = replies.shift();
    if (!next) throw new Error('no more stubbed replies');
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: next } }] })
    };
  };
  return { impl, calls };
}

const BIBLE = JSON.stringify({
  title: 'The Compass of Zanj',
  logline: 'A boy follows a brass compass across the monsoon coast.',
  styleBible: 'Coral rag village, monsoon haze, dusty gold light.',
  character: 'Zanj, a 12 year old boy, short cropped hair, faded green kanzu',
  musicMood: 'dramatic'
});

const SHOTS = JSON.stringify({
  scenes: [
    { id: 's1', shot: 'wide establishing', visualPrompt: 'The boy walks the shoreline at dawn', narrationText: 'The sea gave him nothing but a clue.' },
    { id: 's2', shot: 'close', visualPrompt: 'The compass needle swings in his palm', narrationText: 'It pointed inland.' },
    { id: 's3', shot: 'medium', visualPrompt: 'He climbs the coral steps', narrationText: 'The village hummed behind him.' },
    { id: 's4', shot: 'insert', visualPrompt: 'Brass catches the light', narrationText: 'Someone had been here before.' },
    { id: 's5', shot: 'wide', visualPrompt: 'The dhow sets out', narrationText: 'And the compass kept its promise.' }
  ]
});

test('a draft needs a key before it calls anything', async () => {
  await assert.rejects(() => groqChatJson([{ role: 'user', content: 'hi' }], { apiKey: '' }), /GROQ_API_KEY/);
});

test('two calls: identity, then shots that begin with that identity', async () => {
  const { impl, calls } = stub([BIBLE, SHOTS]);
  const draft = await groqMovieDraft('A boy finds a brass compass', {
    apiKey: 'k', model: 'test-model', fetchImpl: impl, duration: 5, scenes: 5
  });

  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].body.model, 'test-model');
  assert.strictEqual(calls[0].body.response_format.type, 'json_object');
  assert.ok(calls[0].body.messages[0].content.includes(DIRECTOR_GUARD), 'the sacred-figure guard reaches the model');
  assert.ok(calls[0].body.messages[0].content.includes('dramatic'), 'moods are offered to the model');

  const shotSystem = calls[1].body.messages[0].content;
  assert.ok(shotSystem.includes('Zanj, a 12 year old boy'), 'the character block is pasted into the shot prompt');
  assert.ok(shotSystem.includes('12 words'), 'the narration budget for a 5s shot is stated');

  assert.strictEqual(draft.title, 'The Compass of Zanj');
  assert.strictEqual(draft.scenes.length, 5);
  assert.strictEqual(draft.musicMood, 'dramatic');
  assert.deepStrictEqual(draft.notes, []);
});

test('a JSON reply wrapped in prose is still read', async () => {
  const { impl } = stub(['Here is the list:\n```json\n' + BIBLE + '\n```', SHOTS]);
  const draft = await groqMovieDraft('Idea', { apiKey: 'k', fetchImpl: impl, duration: 5, scenes: 5 });
  assert.strictEqual(draft.title, 'The Compass of Zanj');
});

test('a failed JSON mode falls back to a plain completion', async () => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    if (calls.length === 1) return { ok: false, status: 400, json: async () => ({ error: { message: 'json mode unsupported' } }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: BIBLE } }] }) };
  };
  const parsed = await groqChatJson([{ role: 'user', content: 'x' }], { apiKey: 'k', fetchImpl: impl });
  assert.strictEqual(parsed.title, 'The Compass of Zanj');
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[1].response_format, undefined, 'the retry drops json mode');
});

test('an unreadable reply is an error, not a silent empty draft', async () => {
  const { impl } = stub(['I cannot help with that.', 'Still no JSON.']);
  await assert.rejects(() => groqChatJson([{ role: 'user', content: 'x' }], { apiKey: 'k', fetchImpl: impl }), /not JSON/);
});
