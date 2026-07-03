const express = require('express');
const db = require('../../services/database');
const { emitSyncAll } = require('../../services/configEvents');
const { dateKeyInTimeZone, dateKeyDaysAgo, formatDateTimeInTimeZone } = require('../../utils/time');
const { parseIntId } = require('../../utils/validators');
const { asyncHandler } = require('../../utils/asyncHandler');

const router = express.Router();
function wantsJson(req) {
  const accept = req.headers.accept || '';
  const contentType = req.headers['content-type'] || '';
  return req.xhr || accept.includes('application/json') || contentType.includes('application/json');
}

router.post('/users/:id/toggle-block', asyncHandler(async (req, res) => {
  const id = parseIntId(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: '参数错误' });
  const user = db.getUserById(id);
  if (!user) return res.status(404).json({ ok: false, error: '用户不存在' });
  const nextBlocked = !user.is_blocked;
  const actionText = nextBlocked ? '封禁' : '解封';
  db.blockUser(user.id, nextBlocked);
  db.addAuditLog(req.user.id, 'user_block', `${actionText} 用户: ${user.username}`, req.clientIp || req.ip);
  emitSyncAll();
  if (wantsJson(req)) {
    return res.json({ ok: true, message: `${actionText}成功`, blocked: nextBlocked });
  }
  res.redirect('/admin#users');
}));

router.post('/users/:id/delete', (req, res) => {
  const id = parseIntId(req.params.id);
  if (!id) return res.status(400).json({ error: '参数错误' });
  const user = db.getUserById(id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.is_admin) return res.status(403).json({ error: '不能删除管理员' });
  const d = db.getDb();
  const deleteUser = d.transaction(() => {
    d.prepare('DELETE FROM audit_log WHERE user_id = ?').run(id);
    d.prepare('DELETE FROM sub_access_log WHERE user_id = ?').run(id);
    d.prepare('DELETE FROM sub_access_event WHERE user_id = ?').run(id);
    d.prepare('DELETE FROM user_multi_node_observe_event WHERE user_id = ?').run(id);
    d.prepare('DELETE FROM user_node_uuid WHERE user_id = ?').run(id);
    d.prepare('DELETE FROM traffic WHERE user_id = ?').run(id);
    d.prepare('DELETE FROM traffic_daily WHERE user_id = ?').run(id);
    d.prepare('DELETE FROM traffic_user_total WHERE user_id = ?').run(id);
    // 游戏/签到相关数据（表可能因版本差异不存在，逐个容错删除）
    for (const t of ['tg_checkin', 'tg_lucky', 'tg_flip_daily', 'tg_rps_daily', 'tg_farm_plots', 'tg_farm_seeds']) {
      try { d.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id); } catch (_) { /* 表不存在则忽略 */ }
    }
    d.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  deleteUser();
  db.addAuditLog(req.user.id, 'user_delete', `删除用户: ${user.username} (ID:${id})`, req.clientIp || req.ip);
  emitSyncAll();
  res.json({ ok: true });
});

router.post('/users/:id/reset-token', (req, res) => {
  const id = parseIntId(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: '参数错误' });
  const user = db.getUserById(id);
  if (!user) return res.status(404).json({ ok: false, error: '用户不存在' });
  db.resetSubToken(user.id);
  db.addAuditLog(req.user.id, 'token_reset', `重置订阅: ${user.username}`, req.clientIp || req.ip);
  if (wantsJson(req)) return res.json({ ok: true, message: '订阅令牌已重置' });
  res.redirect('/admin#users');
});

// 流量限额上限：1 PB（Petabyte），防止数值溢出 Number.MAX_SAFE_INTEGER
const MAX_TRAFFIC_LIMIT_GB = 1024 * 1024; // 1 PB = 1024 * 1024 GB

router.post('/users/:id/traffic-limit', (req, res) => {
  const id = parseIntId(req.params.id);
  if (!id) return res.status(400).json({ error: '参数错误' });
  const user = db.getUserById(id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  let limitGB = parseFloat(req.body.limit);
  if (Number.isFinite(limitGB) && limitGB > MAX_TRAFFIC_LIMIT_GB) limitGB = MAX_TRAFFIC_LIMIT_GB;
  const limitBytes = (isNaN(limitGB) || limitGB < 0) ? -1 : Math.round(limitGB * 1073741824);
  db.setUserTrafficLimit(user.id, limitBytes);
  db.addAuditLog(req.user.id, 'traffic_limit', `设置 ${user.username} 流量限额: ${limitBytes < 0 ? '无限' : limitGB + ' GB'}`, req.clientIp || req.ip);
  res.json({ ok: true });
});

router.post('/default-traffic-limit', (req, res) => {
  let limitGB = parseFloat(req.body.limit);
  if (Number.isFinite(limitGB) && limitGB > MAX_TRAFFIC_LIMIT_GB) limitGB = MAX_TRAFFIC_LIMIT_GB;
  const limitBytes = (isNaN(limitGB) || limitGB < 0) ? -1 : Math.round(limitGB * 1073741824);
  db.setSetting('default_traffic_limit', String(limitBytes));
  db.addAuditLog(req.user.id, 'default_traffic_limit', `设置默认流量限额: ${limitBytes < 0 ? '无限' : limitGB + ' GB'}`, req.clientIp || req.ip);
  res.json({ ok: true });
});

router.post('/default-traffic-limit/apply', (req, res) => {
  const raw = parseInt(db.getSetting('default_traffic_limit'));
  const limitBytes = isNaN(raw) ? -1 : raw;
  const r = db.getDb().prepare('UPDATE users SET traffic_limit = ?').run(limitBytes);
  db.addAuditLog(req.user.id, 'default_traffic_limit_apply', `批量应用默认流量限额到全部用户: ${r.changes} 个`, req.clientIp || req.ip);
  res.json({ ok: true, updated: r.changes });
});

router.post('/default-user-group', (req, res) => {
  const level = Math.max(0, Math.min(3, parseInt(req.body.level, 10) || 0));
  db.setSetting('default_user_group', String(level));
  const { getGroupLabel } = require('../../utils/userGroup');
  db.addAuditLog(req.user.id, 'default_user_group', `设置默认用户分组: ${getGroupLabel(level)}`, req.clientIp || req.ip);
  res.json({ ok: true, level });
});

router.get('/users', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const search = (req.query.search || '').trim();
  const ALLOWED_SORT = ['id', 'total_traffic', 'username', 'last_login', 'trust_level', 'expires_at'];
  const sortBy = ALLOWED_SORT.includes(req.query.sortBy) ? req.query.sortBy : 'total_traffic';
  const sortDir = req.query.sortDir === 'ASC' ? 'ASC' : 'DESC';
  const limit = 20;
  const offset = (page - 1) * limit;
  const data = db.getAllUsersPaged(limit, offset, search, sortBy, sortDir);
  res.json({ ...data, page });
});

// Sprint 6: 设置用户到期时间
router.post('/users/:id/set-expiry', (req, res) => {
  const id = parseIntId(req.params.id);
  if (!id) return res.status(400).json({ error: '参数错误' });
  const user = db.getUserById(id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const { expires_at } = req.body;
  db.setUserExpiry(user.id, expires_at || null);
  db.addAuditLog(req.user.id, 'set_expiry', `设置 ${user.username} 到期时间: ${expires_at || '永不过期'}`, req.clientIp || req.ip);
  res.json({ ok: true });
});

router.post('/users/:id/set-group', (req, res) => {
  const id = parseIntId(req.params.id);
  if (!id) return res.status(400).json({ error: '参数错误' });
  const user = db.getUserById(id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const level = Math.max(0, Math.min(3, parseInt(req.body.level) || 0));
  db.getDb().prepare('UPDATE users SET trust_level = ? WHERE id = ?').run(level, user.id);
  const { getGroupLabel } = require('../../utils/userGroup');
  db.addAuditLog(req.user.id, 'set_group', `设置 ${user.username} 用户组: ${getGroupLabel(level)}`, req.clientIp || req.ip);
  res.json({ ok: true });
});

// 用户综合详情（流量排行点击查看）
router.get('/users/:id/detail', (req, res) => {
  const id = parseIntId(req.params.id);
  if (!id) return res.status(400).json({ error: '参数错误' });
  const user = db.getUserById(id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const d = db.getDb();

  // 基本信息
  const info = {
    id: user.id, username: user.username, name: user.name,
    trust_level: user.trust_level, is_admin: user.is_admin,
    is_blocked: user.is_blocked, is_frozen: user.is_frozen,
    last_login: user.last_login, created_at: user.created_at,
    expires_at: user.expires_at, traffic_limit: user.traffic_limit,
    sub_token: undefined,
    last_login_display: formatDateTimeInTimeZone(user.last_login, 'Asia/Shanghai'),
    created_at_display: formatDateTimeInTimeZone(user.created_at, 'Asia/Shanghai'),
    expires_at_display: formatDateTimeInTimeZone(user.expires_at, 'Asia/Shanghai'),
  };

  const inviteRelation = d.prepare(`
    SELECT
      ic.code,
      ic.created_at,
      inviter.id AS inviter_id,
      inviter.username AS inviter_username,
      inviter.email AS inviter_email
    FROM invite_codes ic
    LEFT JOIN users inviter ON inviter.id = ic.inviter_user_id
    WHERE ic.used_by_user_id = ?
    ORDER BY ic.used_at DESC, ic.id DESC
    LIMIT 1
  `).get(id) || null;
  if (inviteRelation) {
    info.invited_by = {
      code: inviteRelation.code,
      inviter_id: inviteRelation.inviter_id,
      inviter_username: inviteRelation.inviter_username,
      inviter_email: inviteRelation.inviter_email,
      created_at_display: formatDateTimeInTimeZone(inviteRelation.created_at, 'Asia/Shanghai', true),
    };
  } else {
    info.invited_by = null;
  }

  // 流量统计
  const today = dateKeyInTimeZone(new Date(), 'Asia/Shanghai');
  const todayTraffic = d.prepare('SELECT COALESCE(SUM(uplink),0) as up, COALESCE(SUM(downlink),0) as down FROM traffic_daily WHERE user_id = ? AND date = ?').get(id, today);
  const totalTraffic = d.prepare(`
    SELECT COALESCE(total_up,0) as up, COALESCE(total_down,0) as down
    FROM traffic_user_total
    WHERE user_id = ?
  `).get(id) || { up: 0, down: 0 };

  // 订阅拉取记录（最近24h）
  const subAccessRaw = db.getSubAccessUserDetail(id, 24);
  const subAccess = {
    ips: (subAccessRaw.ips || []).map((ip) => ({
      ...ip,
      last_access_display: formatDateTimeInTimeZone(ip.last_access, 'Asia/Shanghai'),
    })),
    uas: subAccessRaw.uas || [],
    timeline: (subAccessRaw.timeline || []).map((t) => ({
      ...t,
      time_display: formatDateTimeInTimeZone(t.time, 'Asia/Shanghai'),
    })),
  };

  // 最近7天流量趋势
  const weekAgo = dateKeyDaysAgo(6, 'Asia/Shanghai');
  const dailyTraffic = d.prepare('SELECT date, COALESCE(SUM(uplink),0) as up, COALESCE(SUM(downlink),0) as down FROM traffic_daily WHERE user_id = ? AND date >= ? GROUP BY date ORDER BY date').all(id, weekAgo);

  // 风险观察：优先读取结构化事件，兼容历史版本回退到审计日志
  let multiNodeEvents = [];
  try {
    multiNodeEvents = d.prepare(`
      SELECT created_at as time,
             ('用户#' || user_id || ' user=' || COALESCE(username, '-') || ' window=' ||
              COALESCE(window_seconds, 0) || 's nodes=' || COALESCE(node_count, 0) ||
              ' sample=[' || COALESCE(nodes_sample, '') || ']') as detail
      FROM user_multi_node_observe_event
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 20
    `).all(id);
  } catch (_) {
    multiNodeEvents = d.prepare(`
      SELECT created_at as time, detail
      FROM audit_log
      WHERE action = 'user_multi_node_observe'
        AND detail LIKE ?
      ORDER BY id DESC
      LIMIT 20
    `).all(`用户#${id} %`);
  }
  multiNodeEvents = multiNodeEvents.map((r) => ({
    ...r,
    time_display: formatDateTimeInTimeZone(r.time, 'Asia/Shanghai', true),
  }));

  // 流量来源
  const checkinTotal = d.prepare('SELECT COALESCE(SUM(amount),0) as v FROM tg_checkin WHERE user_id = ?').get(id).v;
  const luckyTotal = d.prepare('SELECT COALESCE(SUM(amount),0) as v FROM tg_lucky WHERE user_id = ?').get(id).v;
  const defaultLimit = Number(db.getSetting('default_traffic_limit') || 0);
  const trafficSources = { checkin: checkinTotal, lucky: luckyTotal, default: defaultLimit < 0 ? 0 : defaultLimit };

  res.json({ info, todayTraffic, totalTraffic, subAccess, dailyTraffic, risk: { multiNodeEvents }, trafficSources });
});

module.exports = router;
