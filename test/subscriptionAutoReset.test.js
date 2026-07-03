const test = require('node:test');
const assert = require('node:assert/strict');

async function withMockedSubscriptionRoute(mockDb, fn) {
  const routePath = require.resolve('../src/routes/subscription');
  const dbPath = require.resolve('../src/services/database');
  const notifyPath = require.resolve('../src/services/notify');
  const configEventsPath = require.resolve('../src/services/configEvents');
  const prevRoute = require.cache[routePath];
  const prevDb = require.cache[dbPath];
  const prevNotify = require.cache[notifyPath];
  const prevConfigEvents = require.cache[configEventsPath];

  delete require.cache[routePath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: mockDb };
  require.cache[notifyPath] = {
    id: notifyPath,
    filename: notifyPath,
    loaded: true,
    exports: { notify: { ops() {} } },
  };
  require.cache[configEventsPath] = {
    id: configEventsPath,
    filename: configEventsPath,
    loaded: true,
    exports: { emitSyncAll() {} },
  };

  try {
    const route = require('../src/routes/subscription');
    await fn(route);
  } finally {
    delete require.cache[routePath];
    if (prevRoute) require.cache[routePath] = prevRoute; else delete require.cache[routePath];
    if (prevDb) require.cache[dbPath] = prevDb; else delete require.cache[dbPath];
    if (prevNotify) require.cache[notifyPath] = prevNotify; else delete require.cache[notifyPath];
    if (prevConfigEvents) require.cache[configEventsPath] = prevConfigEvents; else delete require.cache[configEventsPath];
  }
}

test('subscription auto-reset triggers on third distinct UA within 24h', async () => {
  const calls = {
    clearSubAccessWindow: [],
    addAuditLog: [],
  };
  const mockDb = {
    getSetting(key) {
      if (key === 'guard_auto_reset_ua_24h_limit') return '2';
      return null;
    },
    countDistinctSubAccessUas(userId, hours) {
      assert.equal(userId, 11);
      assert.equal(hours, 24);
      return 3;
    },
    resetSubToken(userId) {
      assert.equal(userId, 11);
      return 'new-sub-token';
    },
    rotateUserAllNodeUuids(userId) {
      assert.equal(userId, 11);
      return 6;
    },
    clearSubAccessWindow(userId, hours) {
      calls.clearSubAccessWindow.push({ userId, hours });
    },
    addAuditLog(userId, action, detail, ip) {
      calls.addAuditLog.push({ userId, action, detail, ip });
    },
  };

  await withMockedSubscriptionRoute(mockDb, async (route) => {
    const result = route._test.enforceUaAutoReset(
      { id: 11, username: 'alice', sub_token: 'old-token-123456' },
      'Clash',
      '1.2.3.4'
    );

    assert.equal(result.status, 403);
    assert.equal(result.reason, 'token_auto_reset_ua');
    assert.equal(result.limit, 2);
    assert.equal(result.uaCount, 3);
    assert.equal(result.rotatedUuidCount, 6);
    assert.deepEqual(calls.clearSubAccessWindow, [{ userId: 11, hours: 24 }]);
    assert.equal(calls.addAuditLog.length, 1);
    assert.equal(calls.addAuditLog[0].action, 'sub_token_auto_reset_ua');
    assert.match(calls.addAuditLog[0].detail, /ua=3 limit=2/);
    assert.match(calls.addAuditLog[0].detail, /uuid=6/);
  });
});

test('subscription auto-reset stays disabled when limit is 0', async () => {
  const mockDb = {
    getSetting(key) {
      if (key === 'guard_auto_reset_ua_24h_limit') return '0';
      return null;
    },
    countDistinctSubAccessUas() {
      throw new Error('should not count UAs when feature is off');
    },
  };

  await withMockedSubscriptionRoute(mockDb, async (route) => {
    const result = route._test.enforceUaAutoReset(
      { id: 11, username: 'alice', sub_token: 'old-token-123456' },
      'Clash',
      '1.2.3.4'
    );
    assert.equal(result, null);
  });
});
