const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const trafficRepo = require('../src/services/repos/trafficRepo');
const userRepo = require('../src/services/repos/userRepo');

test('traffic_user_total is updated incrementally and used by user list queries', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vless-traffic-total-'));
  const dbPath = path.join(dir, 'panel.db');
  const db = new Database(dbPath);

  t.after(async () => {
    try { db.close(); } catch (_) {}
    await fsp.rm(dir, { recursive: true, force: true });
  });

  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      name TEXT,
      sub_token TEXT NOT NULL,
      traffic_limit INTEGER DEFAULT 0,
      is_admin INTEGER DEFAULT 0,
      is_blocked INTEGER DEFAULT 0,
      is_frozen INTEGER DEFAULT 0,
      trust_level INTEGER DEFAULT 0,
      last_login TEXT
    );
    CREATE TABLE traffic (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      node_id INTEGER NOT NULL,
      uplink INTEGER DEFAULT 0,
      downlink INTEGER DEFAULT 0,
      recorded_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE traffic_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      node_id INTEGER,
      date TEXT NOT NULL,
      uplink INTEGER DEFAULT 0,
      downlink INTEGER DEFAULT 0,
      UNIQUE(user_id, node_id, date)
    );
    CREATE TABLE traffic_user_total (
      user_id INTEGER PRIMARY KEY,
      total_up INTEGER DEFAULT 0,
      total_down INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.prepare(`
    INSERT INTO users (id, username, name, sub_token, traffic_limit)
    VALUES (1, 'u1', 'U1', 't1', 100), (2, 'u2', 'U2', 't2', 0)
  `).run();

  trafficRepo.init({
    getDb: () => db,
    getUserById: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
  });
  userRepo.init({
    getDb: () => db,
    getSetting: () => '0',
    addAuditLog: () => {},
    ensureUserHasAllNodeUuids: () => {},
    removeFromRegisterWhitelist: () => {},
  });

  trafficRepo.recordTraffic(1, 10, 30, 40);
  trafficRepo.recordTraffic(1, 10, 20, 10);

  const total = db.prepare('SELECT total_up, total_down FROM traffic_user_total WHERE user_id = 1').get();
  assert.deepEqual(total, { total_up: 50, total_down: 50 });

  const list = userRepo.getAllUsersPaged(20, 0, '', 'total_traffic', 'DESC');
  assert.equal(list.total, 2);
  assert.equal(list.rows[0].id, 1);
  assert.equal(list.rows[0].total_traffic, 100);

  assert.equal(userRepo.isTrafficExceeded(1), true);
  assert.equal(userRepo.isTrafficExceeded(2), false);
});
