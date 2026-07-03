const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';

const authRoutes = require('../src/routes/auth');
const {
  consumeTempLoginTokenIfNeeded,
  usedTempLoginTokens,
} = authRoutes._test;

test('temp login used token is blocked within ttl window', () => {
  const oldOneTime = process.env.TEMP_LOGIN_ONE_TIME;
  const oldTtl = process.env.TEMP_LOGIN_USED_TOKEN_TTL_MS;
  const oldMax = process.env.TEMP_LOGIN_USED_TOKEN_MAX_ENTRIES;
  try {
    process.env.TEMP_LOGIN_ONE_TIME = 'true';
    process.env.TEMP_LOGIN_USED_TOKEN_TTL_MS = '60000';
    process.env.TEMP_LOGIN_USED_TOKEN_MAX_ENTRIES = '100';
    usedTempLoginTokens.clear();

    const first = consumeTempLoginTokenIfNeeded('token-a');
    const second = consumeTempLoginTokenIfNeeded('token-a');
    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
  } finally {
    usedTempLoginTokens.clear();
    if (oldOneTime == null) delete process.env.TEMP_LOGIN_ONE_TIME;
    else process.env.TEMP_LOGIN_ONE_TIME = oldOneTime;
    if (oldTtl == null) delete process.env.TEMP_LOGIN_USED_TOKEN_TTL_MS;
    else process.env.TEMP_LOGIN_USED_TOKEN_TTL_MS = oldTtl;
    if (oldMax == null) delete process.env.TEMP_LOGIN_USED_TOKEN_MAX_ENTRIES;
    else process.env.TEMP_LOGIN_USED_TOKEN_MAX_ENTRIES = oldMax;
  }
});

test('temp login used token can be reused after ttl expiration', () => {
  const oldOneTime = process.env.TEMP_LOGIN_ONE_TIME;
  const oldTtl = process.env.TEMP_LOGIN_USED_TOKEN_TTL_MS;
  const oldNow = Date.now;
  try {
    process.env.TEMP_LOGIN_ONE_TIME = 'true';
    process.env.TEMP_LOGIN_USED_TOKEN_TTL_MS = '1000';
    usedTempLoginTokens.clear();

    const base = 1700000000000;
    Date.now = () => base;
    const first = consumeTempLoginTokenIfNeeded('token-b');
    Date.now = () => base + 2000;
    const second = consumeTempLoginTokenIfNeeded('token-b');

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
  } finally {
    Date.now = oldNow;
    usedTempLoginTokens.clear();
    if (oldOneTime == null) delete process.env.TEMP_LOGIN_ONE_TIME;
    else process.env.TEMP_LOGIN_ONE_TIME = oldOneTime;
    if (oldTtl == null) delete process.env.TEMP_LOGIN_USED_TOKEN_TTL_MS;
    else process.env.TEMP_LOGIN_USED_TOKEN_TTL_MS = oldTtl;
  }
});

test('temp login used token cache respects max entries limit', () => {
  const oldOneTime = process.env.TEMP_LOGIN_ONE_TIME;
  const oldTtl = process.env.TEMP_LOGIN_USED_TOKEN_TTL_MS;
  const oldMax = process.env.TEMP_LOGIN_USED_TOKEN_MAX_ENTRIES;
  try {
    process.env.TEMP_LOGIN_ONE_TIME = 'true';
    process.env.TEMP_LOGIN_USED_TOKEN_TTL_MS = '86400000';
    process.env.TEMP_LOGIN_USED_TOKEN_MAX_ENTRIES = '3';
    usedTempLoginTokens.clear();

    consumeTempLoginTokenIfNeeded('token-1');
    consumeTempLoginTokenIfNeeded('token-2');
    consumeTempLoginTokenIfNeeded('token-3');
    consumeTempLoginTokenIfNeeded('token-4');

    assert.equal(usedTempLoginTokens.size <= 3, true);
  } finally {
    usedTempLoginTokens.clear();
    if (oldOneTime == null) delete process.env.TEMP_LOGIN_ONE_TIME;
    else process.env.TEMP_LOGIN_ONE_TIME = oldOneTime;
    if (oldTtl == null) delete process.env.TEMP_LOGIN_USED_TOKEN_TTL_MS;
    else process.env.TEMP_LOGIN_USED_TOKEN_TTL_MS = oldTtl;
    if (oldMax == null) delete process.env.TEMP_LOGIN_USED_TOKEN_MAX_ENTRIES;
    else process.env.TEMP_LOGIN_USED_TOKEN_MAX_ENTRIES = oldMax;
  }
});
