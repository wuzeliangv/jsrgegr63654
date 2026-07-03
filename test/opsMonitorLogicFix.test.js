const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'test-session-secret';
}

async function startServer(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

async function withMockedModule(modulePath, mocks, fn) {
  const routePath = require.resolve(modulePath);
  const prev = { route: require.cache[routePath] };
  const touched = [];

  for (const [target, exportsObj] of Object.entries(mocks)) {
    const resolved = require.resolve(target);
    touched.push([resolved, require.cache[resolved]]);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
  }
  delete require.cache[routePath];

  try {
    const router = require(modulePath);
    await fn(router);
  } finally {
    delete require.cache[routePath];
    if (prev.route) require.cache[routePath] = prev.route;
    for (const [resolved, old] of touched) {
      if (old) require.cache[resolved] = old;
      else delete require.cache[resolved];
    }
  }
}

test('monitor api requires admin role', async (t) => {
  await withMockedModule('../src/routes/monitorApi', {
    '../src/middleware/auth': {
      requireAuth: (req, _res, next) => {
        req.isAuthenticated = () => true;
        req.user = { id: 2, username: 'u', is_admin: 0, is_blocked: 0 };
        next();
      },
      requireAdmin: (req, res, next) => {
        if (req.isAuthenticated() && req.user?.is_admin) return next();
        return res.status(403).json({ error: '需要管理员权限' });
      },
    },
  }, async (router) => {
    const app = express();
    app.use('/', router);
    const { server, baseUrl } = await startServer(app);
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const resp = await fetch(`${baseUrl}/api/monitor/overview`);
    assert.equal(resp.status, 403);
  });
});

test('ops api users pagination passes limit+offset in correct order', async (t) => {
  const calls = [];
  await withMockedModule('../src/routes/opsApi', {
    '../src/services/database': {
      getAllUsersPaged: (...args) => {
        calls.push(args);
        return { rows: [], total: 0 };
      },
    },
    '../src/services/agent-ws': {},
    '../src/services/health': {},
    '../src/services/backup': { performBackup: async () => ({ ok: true }) },
    '../src/services/rotate': {},
    '../src/services/deploy': {},
    '../src/services/logger': { error: () => {} },
    '../src/middleware/opsAuth': { opsAuth: (_req, _res, next) => next() },
  }, async (router) => {
    const app = express();
    app.use('/ops/api', router);
    const { server, baseUrl } = await startServer(app);
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const resp = await fetch(`${baseUrl}/ops/api/users?page=2&limit=50`);
    assert.equal(resp.status, 200);
    assert.deepEqual(calls[0], [50, 50]);
  });
});

test('ops api restart route uses hysteria command for hy2 nodes', async (t) => {
  const sent = [];
  await withMockedModule('../src/routes/opsApi', {
    '../src/services/database': {
      getNodeById: () => ({ id: 1, name: 'hy2-node', protocol: 'hy2' }),
      addAuditLog: () => {},
    },
    '../src/services/agent-ws': {
      isAgentOnline: () => true,
      sendCommand: async (_id, cmd) => {
        sent.push(cmd);
        return { success: true };
      },
    },
    '../src/services/health': {},
    '../src/services/backup': { performBackup: async () => ({ ok: true }) },
    '../src/services/rotate': {},
    '../src/services/deploy': {},
    '../src/services/logger': { error: () => {} },
    '../src/middleware/opsAuth': { opsAuth: (_req, _res, next) => next() },
  }, async (router) => {
    const app = express();
    app.use('/ops/api', router);
    const { server, baseUrl } = await startServer(app);
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const resp = await fetch(`${baseUrl}/ops/api/nodes/1/restart-xray`, { method: 'POST' });
    assert.equal(resp.status, 200);
    assert.equal(sent[0].type, 'restart_hysteria');
  });
});

test('ops api deploy maps ssh_host into deploy host', async (t) => {
  const payloads = [];
  await withMockedModule('../src/routes/opsApi', {
    '../src/services/database': { addAuditLog: () => {} },
    '../src/services/agent-ws': {},
    '../src/services/health': {},
    '../src/services/backup': { performBackup: async () => ({ ok: true }) },
    '../src/services/rotate': {},
    '../src/services/deploy': {
      deployNode: async (payload) => {
        payloads.push(payload);
        return { ok: true };
      },
    },
    '../src/services/logger': { error: () => {} },
    '../src/middleware/opsAuth': { opsAuth: (_req, _res, next) => next() },
  }, async (router) => {
    const app = express();
    app.use(express.json());
    app.use('/ops/api', router);
    const { server, baseUrl } = await startServer(app);
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const resp = await fetch(`${baseUrl}/ops/api/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'n1', ssh_host: '1.2.3.4', ssh_port: 22 }),
    });
    assert.equal(resp.status, 200);
    assert.equal(payloads[0].host, '1.2.3.4');
  });
});

test('ops api health-summary uses usagePercent for memory/disk alerts', async (t) => {
  await withMockedModule('../src/routes/opsApi', {
    '../src/services/database': {
      getAllNodes: () => [{ id: 1, name: 'n1', host: '1.1.1.1', is_active: 1, remark: '', region: '', protocol: 'vless' }],
      getTodayTraffic: () => ({ total_up: 0, total_down: 0 }),
    },
    '../src/services/agent-ws': {
      getConnectedAgents: () => [{ nodeId: 1, reportData: { diskUsage: { usagePercent: 95 }, memUsage: { usagePercent: 96 } } }],
    },
    '../src/services/health': { getOnlineCache: () => ({ summary: { online: 0 } }) },
    '../src/services/backup': { performBackup: async () => ({ ok: true }) },
    '../src/services/rotate': {},
    '../src/services/deploy': {},
    '../src/services/logger': { error: () => {} },
    '../src/middleware/opsAuth': { opsAuth: (_req, _res, next) => next() },
  }, async (router) => {
    const app = express();
    app.use('/ops/api', router);
    const { server, baseUrl } = await startServer(app);
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const resp = await fetch(`${baseUrl}/ops/api/health-summary`);
    assert.equal(resp.status, 200);
    const data = await resp.json();
    const types = data.alerts.map((a) => a.type);
    assert.ok(types.includes('disk_high'));
    assert.ok(types.includes('mem_high'));
  });
});

test('ops api nodes returns summarized agent report payload', async (t) => {
  await withMockedModule('../src/routes/opsApi', {
    '../src/services/database': {
      getAllNodes: () => [{ id: 1, name: 'n1', host: '1.1.1.1', port: 443, protocol: 'vless', network: 'tcp', security: 'tls', is_active: 1, region: '', remark: '' }],
    },
    '../src/services/agent-ws': {
      getConnectedAgents: () => [{
        nodeId: 1,
        ip: '127.0.0.1',
        connectedAt: '2026-03-16T00:00:00.000Z',
        lastReport: '2026-03-16T00:00:05.000Z',
        version: '1.2.3',
        reportData: {
          reportedAt: '2026-03-16T00:00:05.000Z',
          cpuUsage: 50,
          loadAvg: [1, 0.5, 0.25],
          memUsage: { usagePercent: 60 },
          diskUsage: { usagePercent: 70 },
          netBandwidth: { rxRate: 1, txRate: 2, rxBytes: 3, txBytes: 4 },
          trafficRecords: [{ userId: 1, value: 999999 }],
          hugeBlob: 'should-not-leak',
        },
      }],
    },
    '../src/services/health': {},
    '../src/services/backup': { performBackup: async () => ({ ok: true }) },
    '../src/services/rotate': {},
    '../src/services/deploy': {},
    '../src/services/logger': { error: () => {} },
    '../src/middleware/opsAuth': { opsAuth: (_req, _res, next) => next() },
  }, async (router) => {
    const app = express();
    app.use('/ops/api', router);
    const { server, baseUrl } = await startServer(app);
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const resp = await fetch(`${baseUrl}/ops/api/nodes`);
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.equal(data.nodes[0].agent.reportData.cpuUsage, 50);
    assert.equal(data.nodes[0].agent.reportData.netBandwidth.rxBytes, 3);
    assert.equal(data.nodes[0].agent.reportData.hugeBlob, undefined);
    assert.equal(data.nodes[0].agent.reportData.trafficRecords, undefined);
  });
});
