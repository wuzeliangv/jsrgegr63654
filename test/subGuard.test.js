const test = require('node:test');
const assert = require('node:assert/strict');
const { createSubGuard } = require('../src/services/subGuard');

function buildGuard(mode = 'off', overrides = {}) {
  return createSubGuard({
    mode,
    defaultAllowlist: ['clash', 'v2rayn', 'sing-box'],
    tokenWindowMs: 1000,
    tokenMaxReq: 3,
    tokenBanMs: 5000,
    behaviorWindowMs: 3000,
    behaviorMaxIps: 2,
    behaviorMaxUas: 2,
    unknownUaLogTtlMs: 1000,
    ...overrides,
  });
}

test('subGuard off mode allows unknown UA', () => {
  const g = buildGuard('off');
  const r = g.apply('t1', 'SomeBot/1.0', '1.1.1.1', 1000);
  assert.equal(r.ok, true);
});

test('subGuard observe mode allows unknown UA and throttles unknown log', () => {
  const g = buildGuard('observe');
  const r1 = g.apply('t2', 'SomeBot/1.0', '1.1.1.1', 1000);
  assert.equal(r1.ok, true);
  assert.equal(r1.reason, 'unknown_ua_observe');
  assert.equal(r1.shouldLogUnknownUa, true);

  const r2 = g.apply('t2', 'SomeBot/1.0', '1.1.1.1', 1200);
  assert.equal(r2.ok, true);
  assert.equal(r2.shouldLogUnknownUa, false);
});

test('subGuard enforce mode rejects unknown UA', () => {
  const g = buildGuard('enforce');
  const r = g.apply('t3', 'SomeBot/1.0', '2.2.2.2', 1000);
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test('subGuard token rate limit triggers temporary block', () => {
  const g = buildGuard('off');
  assert.equal(g.apply('t4', 'clash', '3.3.3.3', 1000).ok, true);
  assert.equal(g.apply('t4', 'clash', '3.3.3.3', 1100).ok, true);
  assert.equal(g.apply('t4', 'clash', '3.3.3.3', 1200).ok, true);

  const denied = g.apply('t4', 'clash', '3.3.3.3', 1300);
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 429);

  const blocked = g.apply('t4', 'clash', '3.3.3.3', 2000);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 429);
});

test('subGuard behavior detection blocks fast UA/IP switching', () => {
  const g = buildGuard('off', { tokenMaxReq: 20 });
  assert.equal(g.apply('t5', 'clash', '4.4.4.4', 1000).ok, true);
  assert.equal(g.apply('t5', 'v2rayn', '4.4.4.5', 1100).ok, true);

  const denied = g.apply('t5', 'sing-box', '4.4.4.6', 1200);
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 429);
});
