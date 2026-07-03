const test = require('node:test');
const assert = require('node:assert/strict');

const requestMetrics = require('../src/services/requestMetrics');

test('request metrics groups top routes by method and path', () => {
  requestMetrics._test.reset();
  const now = 100000;
  requestMetrics.recordRequest({ ts: now - 5000, method: 'GET', path: '/api/stats', statusCode: 200, durationMs: 8 });
  requestMetrics.recordRequest({ ts: now - 4000, method: 'GET', path: '/api/stats', statusCode: 200, durationMs: 10 });
  requestMetrics.recordRequest({ ts: now - 3000, method: 'GET', path: '/admin/api/traffic', statusCode: 200, durationMs: 30 });
  requestMetrics.recordRequest({ ts: now - 2000, method: 'GET', path: '/admin/api/traffic', statusCode: 500, durationMs: 40 });

  const top = requestMetrics.getTopRoutes(60000, 5, now);
  assert.equal(top.length, 2);
  assert.equal(top[0].path, '/admin/api/traffic');
  assert.equal(top[0].count, 2);
  assert.equal(top[0].errors, 1);
  assert.equal(top[0].avgMs, 35);
  assert.equal(top[1].path, '/api/stats');
  assert.equal(top[1].count, 2);
});
