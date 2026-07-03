const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');

const opsRepo = require('../src/services/repos/opsRepo');

async function startServer(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

async function withMockedAdminSettingsRouter(mockDb, fn) {
  const routePath = require.resolve('../src/routes/admin/adminSettings');
  const dbPath = require.resolve('../src/services/database');
  const prevRoute = require.cache[routePath];
  const prevDb = require.cache[dbPath];

  delete require.cache[routePath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: mockDb };

  try {
    const router = require('../src/routes/admin/adminSettings');
    await fn(router);
  } finally {
    delete require.cache[routePath];
    if (prevRoute) require.cache[routePath] = prevRoute;
    else delete require.cache[routePath];
    if (prevDb) require.cache[dbPath] = prevDb;
    else delete require.cache[dbPath];
  }
}

test('opsRepo multi-node observe overview and pagination are correct in hours window', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vless-multi-node-'));
  const dbPath = path.join(dir, 'panel.db');
  const db = new Database(dbPath);

  t.after(async () => {
    try { db.close(); } catch (_) {}
    await fsp.rm(dir, { recursive: true, force: true });
  });

  db.exec(`
    CREATE TABLE user_multi_node_observe_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT DEFAULT '',
      node_count INTEGER NOT NULL DEFAULT 0,
      nodes_sample TEXT DEFAULT '',
      window_seconds INTEGER DEFAULT 0,
      total_traffic_bytes INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  opsRepo.init({ getDb: () => db });

  opsRepo.addUserMultiNodeObserveEvent({
    userId: 101,
    username: 'alice',
    nodeCount: 5,
    nodesSample: ['hk-1', 'sg-1', 'jp-1'],
    windowSeconds: 120,
    totalTrafficBytes: 1073741824,
  });
  opsRepo.addUserMultiNodeObserveEvent({
    userId: 101,
    username: 'alice',
    nodeCount: 3,
    nodesSample: ['hk-1', 'us-1'],
    windowSeconds: 120,
    totalTrafficBytes: 524288000,
  });
  opsRepo.addUserMultiNodeObserveEvent({
    userId: 202,
    username: 'bob',
    nodeCount: 2,
    nodesSample: ['sg-1', 'us-2'],
    windowSeconds: 120,
    totalTrafficBytes: 600000000,
  });

  db.prepare(`
    INSERT INTO user_multi_node_observe_event
      (user_id, username, node_count, nodes_sample, window_seconds, total_traffic_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-48 hours'))
  `).run(303, 'charlie', 4, 'old-1,old-2', 120, 800000000);

  const overview = opsRepo.getUserMultiNodeObserveOverview(24);
  assert.equal(overview.total_events, 3);
  assert.equal(overview.user_count, 2);
  assert.equal(overview.high_count, 1);
  assert.equal(overview.mid_count, 2);
  assert.ok(Number(overview.avg_traffic_bytes) > 0);
  assert.equal(Number(overview.max_traffic_bytes), 1073741824);

  const page1 = opsRepo.getUserMultiNodeObserveEvents(24, 2, 0);
  assert.equal(page1.total, 3);
  assert.equal(page1.rows.length, 2);
  assert.equal(page1.rows[0].id, 3);
  assert.equal(page1.rows[1].id, 2);

  const page2 = opsRepo.getUserMultiNodeObserveEvents(24, 2, 2);
  assert.equal(page2.total, 3);
  assert.equal(page2.rows.length, 1);
  assert.equal(page2.rows[0].id, 1);
});

test('GET /security/multi-node-observe returns full overview and paged rows contract', async (t) => {
  const mockDb = {
    getUserMultiNodeObserveOverview: () => ({
      total_events: 99,
      user_count: 12,
      avg_node_count: 3.75,
      high_count: 60,
      mid_count: 30,
      avg_traffic_bytes: 600000000,
      max_traffic_bytes: 1073741824,
    }),
    getUserMultiNodeObserveEvents: (_hours, _limit, _offset) => ({
      total: 41,
      rows: [{
        id: 88,
        user_id: 7,
        username: 'tester',
        node_count: 4,
        nodes_sample: 'hk-1,sg-2',
        window_seconds: 180,
        total_traffic_bytes: 750000000,
        created_at: '2026-02-27 16:30:45',
      }],
    }),
  };

  await withMockedAdminSettingsRouter(mockDb, async (router) => {
    const app = express();
    app.use('/admin/api', router);

    const { server, baseUrl } = await startServer(app);
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const resp = await fetch(`${baseUrl}/admin/api/security/multi-node-observe?hours=24&page=2`);
    assert.equal(resp.status, 200);

    const data = await resp.json();
    assert.equal(data.total, 41);
    assert.equal(data.page, 2);
    assert.equal(data.limit, 20);
    assert.equal(data.pages, 3);

    assert.equal(data.overview.total_events, 99);
    assert.equal(data.overview.user_count, 12);
    assert.equal(data.overview.avg_node_count, 3.75);

    assert.equal(data.data.length, 1);
    assert.equal(data.data[0].id, 88);
    assert.equal(data.data[0].risk_level, 'high');
    assert.deepEqual(data.data[0].nodes, ['hk-1', 'sg-2']);
    assert.ok(String(data.data[0].time_display).startsWith('2026-02-28 00:30'));
  });
});
