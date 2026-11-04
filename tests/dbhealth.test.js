// A full disk must not be mistaken for a dead database.

const { test } = require('node:test');
const assert = require('node:assert');
const { isFatalDbError } = require('../lib/dbhealth');

test('a full project keeps the connection alive', () => {
  const e = Object.assign(new Error('could not extend file because project size limit (1024 MB) has been exceeded'), { code: '53100' });
  assert.strictEqual(isFatalDbError(e), false, 'reads must keep working so saved keys still validate');
});

test('a missing table keeps the connection alive', () => {
  const e = Object.assign(new Error('relation "brand_settings" does not exist'), { code: '42P01' });
  assert.strictEqual(isFatalDbError(e), false);
});

test('a duplicate row keeps the connection alive', () => {
  assert.strictEqual(isFatalDbError(Object.assign(new Error('duplicate key value'), { code: '23505' })), false);
});

test('a refused or lost connection is fatal', () => {
  assert.strictEqual(isFatalDbError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })), true);
  assert.strictEqual(isFatalDbError(Object.assign(new Error('Connection terminated unexpectedly'), {})), true);
  assert.strictEqual(isFatalDbError(Object.assign(new Error('cannot connect now'), { code: '57P03' })), true);
  assert.strictEqual(isFatalDbError(Object.assign(new Error('too many clients'), { code: '53300' })), true);
});

test('nothing at all is not a fatal error', () => {
  assert.strictEqual(isFatalDbError(null), false);
  assert.strictEqual(isFatalDbError({}), false);
});
