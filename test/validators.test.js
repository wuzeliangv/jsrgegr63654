const test = require('node:test');
const assert = require('node:assert/strict');
const { USERNAME_MAX_LEN, normalizeUsernameInput } = require('../src/utils/validators');

test('normalizeUsernameInput trims and enforces max length', () => {
  assert.equal(normalizeUsernameInput('  alice  '), 'alice');
  assert.equal(normalizeUsernameInput(''), '');
  assert.equal(normalizeUsernameInput(' '.repeat(5)), '');
  assert.equal(normalizeUsernameInput('a'.repeat(USERNAME_MAX_LEN)), 'a'.repeat(USERNAME_MAX_LEN));
  assert.equal(normalizeUsernameInput('a'.repeat(USERNAME_MAX_LEN + 1)), '');
});
