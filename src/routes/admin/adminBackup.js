const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const db = require('../../services/database');
const { performBackup, BACKUP_DIR } = require('../../services/backup');
const { restoreDatabaseFromBackup } = require('../../services/backupRestore');
const { formatDateTimeInTimeZone } = require('../../utils/time');
const { asyncHandler } = require('../../utils/asyncHandler');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'panel.db');

// 列出备份文件
router.get('/backups', async (req, res) => {
  try {
    await fsp.mkdir(BACKUP_DIR, { recursive: true });
    const names = (await fsp.readdir(BACKUP_DIR))
      .filter(f => f.startsWith('panel-') && f.endsWith('.db'));
    const files = await Promise.all(names.map(async (name) => {
      const stat = await fsp.stat(path.join(BACKUP_DIR, name));
      const mtime = stat.mtime.toISOString();
      return {
        name,
        size: stat.size,
        mtime,
        mtime_display: formatDateTimeInTimeZone(mtime, 'Asia/Shanghai', true),
      };
    }));
    files.sort((a, b) => b.mtime.localeCompare(a.mtime));
    res.json({ ok: true, backups: files });
  } catch (err) {
    res.status(500).json({ ok: false, error: '操作失败' });
  }
});

// 手动触发备份
router.post('/backups/create', async (req, res) => {
  try {
    const result = await performBackup(db.getDb());
    if (!result.ok) {
      return res.status(500).json({ ok: false, error: result.error || '备份失败' });
    }
    db.addAuditLog(req.user.id, 'backup_create', '手动创建备份', req.clientIp || req.ip);
    res.json({ ok: true, backup: path.basename(result.backupPath) });
  } catch (err) {
    res.status(500).json({ ok: false, error: '操作失败' });
  }
});

// 下载备份
router.get('/backups/download/:name', (req, res) => {
  const name = req.params.name;
  if (!/^panel-[\w-]+\.db$/.test(name)) return res.status(400).json({ error: '无效文件名' });
  const filePath = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
  db.addAuditLog(req.user.id, 'backup_download', `下载备份: ${name}`, req.clientIp || req.ip);
  res.download(filePath, name);
});

// 从备份恢复
router.post('/backups/restore', asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!/^panel-[\w-]+\.db$/.test(name)) return res.status(400).json({ error: '无效文件名' });
  const backupPath = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(backupPath)) return res.status(404).json({ error: '备份文件不存在' });

  const result = await restoreDatabaseFromBackup({
    dbModule: db,
    backupPath,
    backupName: name,
    dataDir: DATA_DIR,
    dbPath: DB_PATH,
    allowedBackupDirs: [BACKUP_DIR, DATA_DIR],
    performBackup,
    requesterIp: req.clientIp || req.ip,
  });

  if (!result.ok) return res.status(500).json({ ok: false, error: result.error });
  res.json({ ok: true, message: result.message });
}));

module.exports = router;
