const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const logger = require('./logger');

async function restoreDatabaseFromBackup({
  dbModule,
  backupPath,
  backupName,
  dataDir,
  dbPath,
  allowedBackupDirs = null,
  performBackup,
  requesterIp,
  fsPromises = fs.promises,
  DatabaseCtor = Database,
}) {
  // 路径穿越防护：确保 backupPath 始终在预期备份目录内
  const resolvedBackup = path.resolve(backupPath);
  const resolvedDataDir = path.resolve(dataDir);
  if (Array.isArray(allowedBackupDirs) && allowedBackupDirs.length > 0) {
    const safeAllowedDirs = allowedBackupDirs.map((dir) => path.resolve(dir));
    const inAllowedDir = safeAllowedDirs.some((dir) => resolvedBackup === dir || resolvedBackup.startsWith(dir + path.sep));
    if (!inAllowedDir) {
      return { ok: false, error: '备份路径非法：不在允许的目录内' };
    }
  }

  const stagedPath = path.join(dataDir, `panel.restore.${Date.now()}.db`);

  try {
    const preBackup = await performBackup(dbModule.getDb());
    if (!preBackup.ok) {
      return { ok: false, error: '创建恢复前备份失败: ' + (preBackup.error || '') };
    }

    await fsPromises.mkdir(dataDir, { recursive: true });
    await fsPromises.copyFile(backupPath, stagedPath);

    const stagedDb = new DatabaseCtor(stagedPath, { readonly: true });
    const integrity = stagedDb.pragma('integrity_check', { simple: true });
    stagedDb.close();
    if (String(integrity).toLowerCase() !== 'ok') {
      await fsPromises.unlink(stagedPath).catch((err) => {
        logger.debug({ err, stagedPath }, '删除无效恢复暂存文件失败，已忽略');
      });
      return { ok: false, error: `备份完整性校验失败: ${integrity}` };
    }

    try {
      const live = dbModule.getDb();
      live.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      logger.debug({ err }, '恢复前执行 WAL checkpoint 失败，已忽略');
    }
    dbModule.closeDb();

    await fsPromises.rename(stagedPath, dbPath);
    await fsPromises.unlink(`${dbPath}-wal`).catch((err) => {
      logger.debug({ err, path: `${dbPath}-wal` }, '删除 WAL 文件失败，已忽略');
    });
    await fsPromises.unlink(`${dbPath}-shm`).catch((err) => {
      logger.debug({ err, path: `${dbPath}-shm` }, '删除 SHM 文件失败，已忽略');
    });

    const reopened = dbModule.reopenDb();
    const liveIntegrity = reopened.pragma('integrity_check', { simple: true });
    if (String(liveIntegrity).toLowerCase() !== 'ok') {
      return { ok: false, error: `恢复后数据库完整性异常: ${liveIntegrity}` };
    }

    dbModule.addAuditLog(null, 'backup_restore', `从备份恢复: ${backupName}`, requesterIp);
    return { ok: true, message: '恢复成功，已自动重载数据库连接' };
  } catch (err) {
    try { dbModule.reopenDb(); } catch (reopenErr) {
      logger.debug({ err: reopenErr }, '恢复失败后重连数据库失败，已忽略');
    }
    await fsPromises.unlink(stagedPath).catch((unlinkErr) => {
      logger.debug({ err: unlinkErr, stagedPath }, '恢复失败后清理暂存文件失败，已忽略');
    });
    return { ok: false, error: err.message };
  }
}

module.exports = {
  restoreDatabaseFromBackup,
};
