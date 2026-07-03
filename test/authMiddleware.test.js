const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';
const { requireAdmin } = require('../src/middleware/auth');

test('requireAdmin rejects blocked admin user', () => {
  let nextCalled = false;
  let statusCode = null;
  let payload = null;

  const req = {
    user: { id: 1, is_admin: 1, is_blocked: 1 },
    isAuthenticated: () => true,
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
  };

  requireAdmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
  assert.deepEqual(payload, { error: '需要管理员权限' });
});

test('requireAdmin allows active admin user', () => {
  let nextCalled = false;
  let statusCode = null;

  const req = {
    user: { id: 2, is_admin: 1, is_blocked: 0 },
    isAuthenticated: () => true,
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  };

  requireAdmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(statusCode, null);
});

test('requireAdmin rejects unauthenticated request', () => {
  let nextCalled = false;
  let statusCode = null;

  const req = {
    user: { id: 3, is_admin: 1, is_blocked: 0 },
    isAuthenticated: () => false,
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  };

  requireAdmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
});
