const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../src/utils/password');

test('hashPassword generates scrypt format and verifyPassword validates it', () => {
  const encoded = hashPassword('abcDEF123!');
  assert.ok(typeof encoded === 'string');
  assert.ok(encoded.startsWith('scrypt$'));
  assert.equal(verifyPassword('abcDEF123!', encoded), true);
  assert.equal(verifyPassword('wrong-pass', encoded), false);
});

test('verifyPassword returns false for invalid stored format', () => {
  assert.equal(verifyPassword('abcDEF123!', ''), false);
  assert.equal(verifyPassword('abcDEF123!', 'plain-text'), false);
});
