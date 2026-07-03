/**
 * SQLite 数据库自动备份服务
 * 备份到 /root/vless-panel/backups/，保留最近7天
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'backups');
const RETENTION_DAYS = 7;

/**
 * 执行一次备份（使用 better-sqlite3 的 backup API）
 */
async function performBackup(db) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  // 确保目录权限（mkdirSync 在已存在时不会更新权限）
  try { fs.chmodSync(BACKUP_DIR, 0o700); } catch (_) { /* 忽略 */ }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `panel-${timestamp}.db`);

  try {
    await db.backup(backupPath);
    // 设置 0600 仅 root 可读写，防止备份文件被同主机其他用户读取
    try { fs.chmodSync(backupPath, 0o600); } catch (_) { /* 忽略 */ }
    logger.info({ backupPath }, '数据库备份完成');
    cleanOldBackups();
    return { ok: true, backupPath };
  } catch (err) {
    logger.error({ err, backupPath }, '数据库备份失败');
    return { ok: false, error: err.message || '数据库备份失败' };
  }
}

/**
 * 清理超过保留天数的备份文件
 */
function cleanOldBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  try {
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('panel-') && f.endsWith('.db'));
    for (const file of files) {
      const filePath = path.join(BACKUP_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        logger.info({ file }, '清理过期备份');
      }
    }
  } catch (err) {
    logger.error({ err }, '清理备份失败');
  }
}

module.exports = { performBackup, BACKUP_DIR };
