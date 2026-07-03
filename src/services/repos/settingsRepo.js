let _getDb;

function init(deps) {
  _getDb = deps.getDb;
}

function addAuditLog(userId, action, detail, ip) {
  _getDb().prepare("INSERT INTO audit_log (user_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, datetime('now'))").run(userId, action, detail, ip);
}

function getAuditLogs(limit = 50, offset = 0, type = 'all') {
  const where = type === 'system' ? "WHERE a.ip = 'system'" : type === 'user' ? "WHERE a.ip != 'system'" : '';
  const rows = _getDb().prepare(`
    SELECT a.*, u.username FROM audit_log a
    LEFT JOIN users u ON a.user_id = u.id
    ${where}
    ORDER BY a.created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
  const total = _getDb().prepare(`SELECT COUNT(*) as c FROM audit_log a ${where}`).get().c;
  return { rows, total };
}

function clearAuditLogs() {
  _getDb().prepare('DELETE FROM audit_log').run();
}

function getSetting(key) {
  const row = _getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  _getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// 白名单操作（节点访问白名单）
function isInWhitelist(userId) {
  return !!_getDb().prepare('SELECT 1 FROM whitelist WHERE user_id = ?').get(userId);
}

function getWhitelistPaged(limit = 20, offset = 0, search = '') {
  const l = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const o = Math.max(0, parseInt(offset, 10) || 0);
  const q = String(search || '').trim();
  const where = q ? `
    WHERE (
      u.username LIKE @like
      OR CAST(w.user_id AS TEXT) = @exact
    )
  ` : '';
  const rows = _getDb().prepare(`
    SELECT w.*, u.username, u.name
    FROM whitelist w
    LEFT JOIN users u ON w.user_id = u.id
    ${where}
    ORDER BY w.added_at DESC, w.id DESC
    LIMIT @limit OFFSET @offset
  `).all(q ? { like: `%${q}%`, exact: q, limit: l, offset: o } : { limit: l, offset: o });
  const total = _getDb().prepare(`
    SELECT COUNT(*) as c
    FROM whitelist w
    LEFT JOIN users u ON w.user_id = u.id
    ${where}
  `).get(q ? { like: `%${q}%`, exact: q } : {}).c;
  return { rows, total };
}

function addToWhitelist(userId) {
  return _getDb().prepare('INSERT OR IGNORE INTO whitelist (user_id) VALUES (?)').run(userId);
}

function removeFromWhitelist(userId) {
  return _getDb().prepare('DELETE FROM whitelist WHERE user_id = ?').run(userId);
}

// 注册白名单
function isInRegisterWhitelist(username) {
  return !!_getDb().prepare('SELECT 1 FROM register_whitelist WHERE username = ?').get(username);
}

function getRegisterWhitelistPaged(limit = 20, offset = 0, search = '') {
  const l = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const o = Math.max(0, parseInt(offset, 10) || 0);
  const q = String(search || '').trim();
  const where = q ? 'WHERE username LIKE @like' : '';
  const rows = _getDb().prepare(`
    SELECT *
    FROM register_whitelist
    ${where}
    ORDER BY added_at DESC, id DESC
    LIMIT @limit OFFSET @offset
  `).all(q ? { like: `%${q}%`, limit: l, offset: o } : { limit: l, offset: o });
  const total = _getDb().prepare(`
    SELECT COUNT(*) as c
    FROM register_whitelist
    ${where}
  `).get(q ? { like: `%${q}%` } : {}).c;
  return { rows, total };
}

function addToRegisterWhitelist(username) {
  return _getDb().prepare('INSERT OR IGNORE INTO register_whitelist (username) VALUES (?)').run(username.trim());
}

function removeFromRegisterWhitelist(username) {
  return _getDb().prepare('DELETE FROM register_whitelist WHERE username = ?').run(username.trim());
}

// 节点定向白名单
function getNodeAccessWhitelistPaged(limit = 20, offset = 0, search = '') {
  const l = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const o = Math.max(0, parseInt(offset, 10) || 0);
  const q = String(search || '').trim();
  const where = q ? `
    WHERE (
      u.username LIKE @like
      OR n.name LIKE @like
      OR CAST(n.id AS TEXT) = @exact
      OR CAST(u.id AS TEXT) = @exact
    )
  ` : '';
  const params = q ? { like: `%${q}%`, exact: q, limit: l, offset: o } : { limit: l, offset: o };
  const rows = _getDb().prepare(`
    SELECT naw.*, u.username, n.name AS node_name, n.host AS node_host, n.port AS node_port
    FROM node_access_whitelist naw
    JOIN users u ON naw.user_id = u.id
    JOIN nodes n ON naw.node_id = n.id
    ${where}
    ORDER BY naw.created_at DESC, naw.id DESC
    LIMIT @limit OFFSET @offset
  `).all(params);
  const total = _getDb().prepare(`
    SELECT COUNT(*) as c
    FROM node_access_whitelist naw
    JOIN users u ON naw.user_id = u.id
    JOIN nodes n ON naw.node_id = n.id
    ${where}
  `).get(q ? { like: `%${q}%`, exact: q } : {}).c;
  return { rows, total };
}

function getNodeAccessWhitelistNodeIdsForUser(userId) {
  const uid = parseInt(userId, 10) || 0;
  if (!uid) return [];
  const rows = _getDb().prepare('SELECT node_id FROM node_access_whitelist WHERE user_id = ?').all(uid);
  return rows.map((r) => Number(r.node_id)).filter((x) => Number.isFinite(x) && x > 0);
}

function addNodeAccessWhitelist(userId, nodeId) {
  const uid = parseInt(userId, 10) || 0;
  const nid = parseInt(nodeId, 10) || 0;
  if (!uid || !nid) return { changes: 0 };
  return _getDb().prepare('INSERT OR IGNORE INTO node_access_whitelist (user_id, node_id) VALUES (?, ?)').run(uid, nid);
}

function removeNodeAccessWhitelist(userId, nodeId) {
  const uid = parseInt(userId, 10) || 0;
  const nid = parseInt(nodeId, 10) || 0;
  if (!uid || !nid) return { changes: 0 };
  return _getDb().prepare('DELETE FROM node_access_whitelist WHERE user_id = ? AND node_id = ?').run(uid, nid);
}

module.exports = {
  init,
  addAuditLog, getAuditLogs, clearAuditLogs,
  getSetting, setSetting,
  isInWhitelist, getWhitelistPaged, addToWhitelist, removeFromWhitelist,
  isInRegisterWhitelist, getRegisterWhitelistPaged, addToRegisterWhitelist, removeFromRegisterWhitelist,
  getNodeAccessWhitelistPaged, getNodeAccessWhitelistNodeIdsForUser, addNodeAccessWhitelist, removeNodeAccessWhitelist
};
