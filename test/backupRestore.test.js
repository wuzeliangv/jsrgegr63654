const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const Database = require('better-sqlite3');
const { restoreDatabaseFromBackup } = require('../src/services/backupRestore');
const { performBackup, BACKUP_DIR } = require('../src/services/backup');

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vless-panel-restore-'));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

function createSimpleDb(filePath, value) {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)');
  db.prepare('DELETE FROM t').run();
  db.prepare('INSERT INTO t (id, v) VALUES (1, ?)').run(value);
  db.close();
}

function readValue(filePath) {
  const db = new Database(filePath, { readonly: true });
  const row = db.prepare('SELECT v FROM t WHERE id = 1').get();
  db.close();
  return row ? row.v : null;
}

test('restoreDatabaseFromBackup replaces db and reconnects', async () => {
  await withTempDir(async (dir) => {
    const dataDir = path.join(dir, 'data');
    await fsp.mkdir(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, 'panel.db');
    const backupPath = path.join(dir, 'panel-backup.db');

    createSimpleDb(dbPath, 'old');
    createSimpleDb(backupPath, 'new');

    let currentDb = new Database(dbPath);
    const auditLogs = [];
    const dbModule = {
      getDb: () => currentDb,
      closeDb: () => { try { currentDb.close(); } catch {} currentDb = null; },
      reopenDb: () => { currentDb = new Database(dbPath); return currentDb; },
      addAuditLog: (...args) => auditLogs.push(args),
    };

    const result = await restoreDatabaseFromBackup({
      dbModule,
      backupPath,
      backupName: 'panel-backup.db',
      dataDir,
      dbPath,
      performBackup: async () => ({ ok: true, backupPath: path.join(dir, 'pre.db') }),
      requesterIp: '127.0.0.1',
    });

    assert.equal(result.ok, true);
    assert.equal(readValue(dbPath), 'new');
    assert.equal(auditLogs.length, 1);
    assert.equal(auditLogs[0][1], 'backup_restore');

    try { currentDb.close(); } catch {}
  });
});

test('restoreDatabaseFromBackup fails for invalid backup file and keeps live db', async () => {
  await withTempDir(async (dir) => {
    const dataDir = path.join(dir, 'data');
    await fsp.mkdir(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, 'panel.db');
    const backupPath = path.join(dir, 'invalid-backup.db');

    createSimpleDb(dbPath, 'old');
    await fsp.writeFile(backupPath, 'not a sqlite db', 'utf8');

    let currentDb = new Database(dbPath);
    const dbModule = {
      getDb: () => currentDb,
      closeDb: () => { try { currentDb.close(); } catch {} currentDb = null; },
      reopenDb: () => { currentDb = new Database(dbPath); return currentDb; },
      addAuditLog: () => {},
    };

    const result = await restoreDatabaseFromBackup({
      dbModule,
      backupPath,
      backupName: 'invalid-backup.db',
      dataDir,
      dbPath,
      performBackup: async () => ({ ok: true, backupPath: path.join(dir, 'pre.db') }),
      requesterIp: '127.0.0.1',
    });

    assert.equal(result.ok, false);
    assert.equal(readValue(dbPath), 'old');
    try { currentDb.close(); } catch {}
  });
});

test('restoreDatabaseFromBackup works with real performBackup (non-mock path)', async () => {
  await withTempDir(async (dir) => {
    const dataDir = path.join(dir, 'data');
    await fsp.mkdir(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, 'panel.db');
    const backupPath = path.join(dir, 'panel-backup.db');

    createSimpleDb(dbPath, 'old');
    createSimpleDb(backupPath, 'new');

    let currentDb = new Database(dbPath);
    const auditLogs = [];
    const dbModule = {
      getDb: () => currentDb,
      closeDb: () => { try { currentDb.close(); } catch {} currentDb = null; },
      reopenDb: () => { currentDb = new Database(dbPath); return currentDb; },
      addAuditLog: (...args) => auditLogs.push(args),
    };

    let preBackupPath = null;
    const result = await restoreDatabaseFromBackup({
      dbModule,
      backupPath,
      backupName: 'panel-backup.db',
      dataDir,
      dbPath,
      performBackup: async (db) => {
        const r = await performBackup(db);
        preBackupPath = r.backupPath || null;
        return r;
      },
      requesterIp: '127.0.0.1',
    });

    assert.equal(result.ok, true);
    assert.equal(readValue(dbPath), 'new');
    assert.equal(auditLogs.length, 1);
    assert.equal(auditLogs[0][1], 'backup_restore');
    assert.ok(preBackupPath);
    assert.ok(preBackupPath.startsWith(BACKUP_DIR + path.sep));
    assert.equal(fs.existsSync(preBackupPath), true);

    try { currentDb.close(); } catch {}
    await fsp.unlink(preBackupPath).catch(() => {});
  });
});
