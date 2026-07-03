const test = require('node:test');
const assert = require('node:assert/strict');

function mockDb(nodes) {
  return {
    getAllNodes: () => nodes,
    getNodeById: (id) => nodes.find((node) => node.id === id) || null,
    updateNode: () => {},
    getUsersByIds: () => [],
    getSetting: () => null,
    getUserById: () => null,
    isTrafficExceeded: () => false,
    getUserTraffic: () => ({ total_up: 0, total_down: 0 }),
    freezeUser: () => {},
    unfreezeUser: () => {},
    addAuditLog: () => {},
    addUserMultiNodeObserveEvent: () => {},
    getDb: () => ({
      prepare: () => ({
        run: () => {},
        all: () => [],
        get: () => ({ total: 0 }),
      }),
      transaction: (fn) => fn,
    }),
  };
}

function loadHealthWithMocks({ dbMock, notifyMock }) {
  const healthPath = require.resolve('../src/services/health');
  const dbPath = require.resolve('../src/services/database');
  const notifyPath = require.resolve('../src/services/notify');
  const loggerPath = require.resolve('../src/services/logger');
  const prev = {
    health: require.cache[healthPath],
    db: require.cache[dbPath],
    notify: require.cache[notifyPath],
    logger: require.cache[loggerPath],
  };

  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbMock };
  require.cache[notifyPath] = { id: notifyPath, filename: notifyPath, loaded: true, exports: notifyMock };
  require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
  delete require.cache[healthPath];

  const health = require('../src/services/health');

  return {
    health,
    restore() {
      delete require.cache[healthPath];
      if (prev.health) require.cache[healthPath] = prev.health;
      if (prev.db) require.cache[dbPath] = prev.db;
      else delete require.cache[dbPath];
      if (prev.notify) require.cache[notifyPath] = prev.notify;
      else delete require.cache[notifyPath];
      if (prev.logger) require.cache[loggerPath] = prev.logger;
      else delete require.cache[loggerPath];
    },
  };
}

test('node recovery notification is deduped for same host', () => {
  const nodes = [
    { id: 1, name: 'vless-a', protocol: 'vless', host: '1.1.1.1', ssh_host: '10.0.0.1', is_active: 0, remark: '' },
    { id: 2, name: 'ss-a', protocol: 'ss', host: '1.1.1.2', ssh_host: '10.0.0.1', is_active: 0, remark: '' },
  ];
  const ups = [];
  const loaded = loadHealthWithMocks({
    dbMock: mockDb(nodes),
    notifyMock: {
      notify: {
        nodeUp: (name) => ups.push(name),
        nodeDown: () => {},
        nodeBlocked: () => {},
        ops: () => Promise.resolve(),
        trafficExceed: () => {},
      },
      send: () => Promise.resolve(),
    },
  });

  try {
    loaded.health.updateFromAgentReport(1, { xrayAlive: true, cnReachable: true, ipv6Reachable: true, trafficRecords: [] });
    loaded.health.updateFromAgentReport(2, { xrayAlive: true, cnReachable: true, ipv6Reachable: true, trafficRecords: [] });
    assert.equal(ups.length, 1);
    assert.equal(ups[0], 'vless-a');
  } finally {
    loaded.restore();
  }
});

test('node recovery notification still sends for different hosts', () => {
  const nodes = [
    { id: 1, name: 'vless-a', protocol: 'vless', host: '1.1.1.1', ssh_host: '10.0.0.1', is_active: 0, remark: '' },
    { id: 2, name: 'vless-b', protocol: 'vless', host: '1.1.1.2', ssh_host: '10.0.0.2', is_active: 0, remark: '' },
  ];
  const ups = [];
  const loaded = loadHealthWithMocks({
    dbMock: mockDb(nodes),
    notifyMock: {
      notify: {
        nodeUp: (name) => ups.push(name),
        nodeDown: () => {},
        nodeBlocked: () => {},
        ops: () => Promise.resolve(),
        trafficExceed: () => {},
      },
      send: () => Promise.resolve(),
    },
  });

  try {
    loaded.health.updateFromAgentReport(1, { xrayAlive: true, cnReachable: true, ipv6Reachable: true, trafficRecords: [] });
    loaded.health.updateFromAgentReport(2, { xrayAlive: true, cnReachable: true, ipv6Reachable: true, trafficRecords: [] });
    assert.deepEqual(ups, ['vless-a', 'vless-b']);
  } finally {
    loaded.restore();
  }
});
