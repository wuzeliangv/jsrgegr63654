const express = require('express');
const db = require('../services/database');
const { buildVlessLink, buildSsLink, buildHy2Link } = require('../utils/vless');
const { formatBytes } = require('../utils/formatBytes');
const { requireAuth } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const logger = require('../services/logger');
const { toSqlUtc } = require('../utils/time');
const { formatDateTimeInTimeZone } = require('../utils/time');
const {
  getUserNodeUuidMap,
  buildSubUrl,
  canUserAccessNode,
} = require('../utils/routeHelpers');
const { getGroup, getGroupLabel, getGroupResetConfig } = require('../utils/userGroup');
const { getOnlineCache } = require('../services/health');
const { emitSyncAll } = require('../services/configEvents');

const router = express.Router();

function getNowShanghaiParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const p = Object.fromEntries(fmt.formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return {
    year: parseInt(p.year), month: parseInt(p.month), day: parseInt(p.day),
    hour: parseInt(p.hour), minute: parseInt(p.minute), second: parseInt(p.second)
  };
}

function shanghaiToUtcMs(year, month, day, hour = 0, minute = 0, second = 0) {
  return Date.UTC(year, month - 1, day, hour - 8, minute, second);
}

function nextUuidResetAtMs(now = new Date()) {
  const n = getNowShanghaiParts(now);
  const today3 = shanghaiToUtcMs(n.year, n.month, n.day, 3, 0, 0);
  if (now.getTime() < today3) return today3;
  const t = new Date(shanghaiToUtcMs(n.year, n.month, n.day, 12, 0, 0));
  t.setUTCDate(t.getUTCDate() + 1);
  const y = getNowShanghaiParts(t);
  return shanghaiToUtcMs(y.year, y.month, y.day, 3, 0, 0);
}

function nextTokenResetAtMs(user, subDays, now = new Date()) {
  if (subDays <= 0) return -1;
  const last = user.last_token_reset;
  if (!last || last === '2000-01-01') {
    const n = getNowShanghaiParts(now);
    const todayMs = shanghaiToUtcMs(n.year, n.month, n.day, 3, 0, 0);
    let next = new Date(todayMs);
    next.setUTCDate(next.getUTCDate() + subDays);
    return next.getTime();
  }
  const [y,m,d] = String(last).split('-').map(v => parseInt(v));
  if (!y || !m || !d) return nextUuidResetAtMs(now);
  const last3 = shanghaiToUtcMs(y, m, d, 3, 0, 0);
  let next = new Date(last3);
  next.setUTCDate(next.getUTCDate() + subDays);
  while (next.getTime() < now.getTime()) {
    next.setUTCDate(next.getUTCDate() + subDays);
  }
  return next.getTime();
}

function nextUuidResetAtMsForGroup(user, uuidDays, now = new Date()) {
  if (uuidDays <= 0) return -1;
  if (uuidDays === 1) return nextUuidResetAtMs(now);
  const db = require('../services/database');
  const level = Math.min(Math.max(user.trust_level || 0, 0), 3);
  const lastDate = db.getSetting(`group_${level}_last_uuid_rotate`);
  if (!lastDate) {
    // 没有历史记录，从今天起算
    const n = getNowShanghaiParts(now);
    const todayMs = shanghaiToUtcMs(n.year, n.month, n.day, 3, 0, 0);
    let next = new Date(todayMs);
    next.setUTCDate(next.getUTCDate() + uuidDays);
    return next.getTime();
  }
  const [y,m,d] = String(lastDate).split('-').map(v => parseInt(v));
  if (!y || !m || !d) return nextUuidResetAtMs(now);
  const last3 = shanghaiToUtcMs(y, m, d, 3, 0, 0);
  let next = new Date(last3);
  next.setUTCDate(next.getUTCDate() + uuidDays);
  while (next.getTime() < now.getTime()) {
    next.setUTCDate(next.getUTCDate() + uuidDays);
  }
  return next.getTime();
}

router.get('/', requireAuth, (req, res) => {
  const user = req.user;

  const nodes = db.getAllNodes(true).filter((n) => canUserAccessNode(req.user, n));

  const traffic = db.getUserTraffic(user.id);
  const globalTraffic = db.getGlobalTraffic();
  const uuidMap = getUserNodeUuidMap(user.id, nodes);

  const userNodes = nodes.map(n => {
    const userUuid = uuidMap.get(Number(n.id)) || '';
    let link;
    if (n.protocol === 'hy2') link = buildHy2Link({ ...n, _userId: user.id }, userUuid);
    else if (n.protocol === 'ss') link = buildSsLink(n, userUuid);
    else link = buildVlessLink(n, userUuid);
    return { ...n, link };
  });

  // 每个节点当前在线人数（来自 health 模块的内存缓存）
  const nodeOnlineCount = new Map();
  try {
    const onlineCache = getOnlineCache();
    for (const r of (onlineCache.full?.nodes || [])) {
      nodeOnlineCount.set(r.nodeId, r.count || 0);
    }
  } catch (_) { /* 忽略 */ }

  const nodeAiTags = {};
  try {
    const d = db.getDb();
    const deployNodes = d.prepare("SELECT DISTINCT detail FROM audit_log WHERE action = 'deploy'").all();
    deployNodes.forEach(r => {
      const match = (r.detail || '').match(/节点.*?[:：]\s*(.+)/);
      if (match) nodeAiTags[match[1]] = nodeAiTags[match[1]] || [];
    });
    const sevenDaysAgo = toSqlUtc(new Date(Date.now() - 7 * 86400000));
    const swapNodes = d.prepare(`
      SELECT DISTINCT detail FROM audit_log
      WHERE action IN ('auto_swap_ip','swap_ip','ip_rotated') AND created_at > ?
    `).all(sevenDaysAgo);
    nodes.forEach(n => {
      const tags = [];
      const swapMatch = swapNodes.some(r => (r.detail || '').includes(n.name) || (r.detail || '').includes(n.host));
      if (swapMatch) tags.push('ai_swap');
      if (tags.length) nodeAiTags[n.id] = tags;
    });
  } catch (err) {
    logger.debug({ err, userId: user?.id }, '读取节点 AI 标签失败，已忽略');
  }

  const groupCfg = getGroupResetConfig(db);
  const gl = Math.min(Math.max(user.trust_level || 0, 0), 3);
  const myUuidDays = groupCfg[gl].uuid_days;
  const mySubDays = groupCfg[gl].sub_days;
  const inviteStatus = db.getInviteGenerateStatusByUser(user.id, !!user.is_admin);
  const canUseInviteFeature = gl >= 1;

  res.render('panel', {
    user, userNodes, traffic, globalTraffic, formatBytes,
    trafficLimit: user.traffic_limit,
    nodeAiTags,
    nodeOnlineCount,
    subUrl: buildSubUrl(req, user.sub_token, 'sub'),
    subUrl6: buildSubUrl(req, user.sub_token, 'sub6'),
    subHy2Url: buildSubUrl(req, user.sub_token, 'subhy2'),
    subAllUrl: buildSubUrl(req, user.sub_token, 'suball'),
    subVisibleVless: db.getSetting('sub_visible_vless') !== 'false',
    subVisibleSs: db.getSetting('sub_visible_ss') !== 'false',
    subVisibleHy2: db.getSetting('sub_visible_hy2') !== 'false',
    nextUuidResetAt: nextUuidResetAtMsForGroup(user, myUuidDays),
    nextSubResetAt: nextTokenResetAtMs(user, mySubDays),
    announcement: db.getSetting('announcement') || '',
    expiresAt: user.expires_at || null,
    userGroup: getGroup(user.trust_level),
    userGroupLabel: getGroupLabel(user.trust_level),
    tgBound: !!user.telegram_id,
    tgBotEnabled: !!process.env.TG_BOT_TOKEN,
    tgBindGiftLabel: (() => {
      const b = parseInt(db.getSetting('default_traffic_limit'), 10);
      return (!Number.isFinite(b) || b < 0) ? '超大' : `${Math.round(b / 1073741824)}GB`;
    })(),
    uuidResetLabel: myUuidDays > 0 ? `每${myUuidDays}天` : '不重置',
    subResetLabel: mySubDays > 0 ? `每${mySubDays}天` : '不重置',
    activeInvite: inviteStatus.activeInvite,
    nextInviteGenerateAt: inviteStatus.nextGenerateAt,
    canGenerateInvite: canUseInviteFeature && inviteStatus.canGenerate,
    canUseInviteFeature,
    inviteEnabled: db.getSetting('invite_registration_enabled') !== 'false',
    nodelocPaymentEnabled: !!(process.env.NODELOC_PAYMENT_ID && (process.env.NODELOC_PAYMENT_TOKEN || process.env.NODELOC_PAYMENT_SECRET)),
    formatDateTimeInTimeZone,
  });
});

router.post('/api/tg-unbind', requireAuth, csrfProtection, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user || !user.telegram_id) return res.json({ ok: false, error: '当前未绑定 Telegram' });
  db.getDb().prepare('UPDATE users SET telegram_id = NULL WHERE id = ?').run(user.id);
  res.json({ ok: true });
});

router.post('/api/tg-bind-token', requireAuth, csrfProtection, (req, res) => {
  const { generateBindToken, getBotUsername } = require('../services/tgbot');
  const botUsername = getBotUsername();
  if (!botUsername) return res.json({ ok: false, error: 'TG Bot 未配置' });
  const token = generateBindToken(req.user.id);
  res.json({ ok: true, url: `https://t.me/${botUsername}?start=bind_${token}`, command: `/bind ${token}` });
});

// 用户主动重置订阅链接 + 节点 UUID（自助换线，防滥用：每 24 小时限一次，基于审计日志持久判断）
const SUB_RESET_INTERVAL_MS = 24 * 60 * 60 * 1000;
router.post('/api/reset-subscription', requireAuth, csrfProtection, (req, res) => {
  const userId = req.user.id;
  const user = db.getUserById(userId);
  if (!user) return res.json({ ok: false, error: '用户不存在' });

  // 持久冷却：查最近一次用户主动重置的审计记录
  try {
    const last = db.getDb().prepare("SELECT created_at FROM audit_log WHERE user_id = ? AND action = 'sub_self_reset' ORDER BY id DESC LIMIT 1").get(userId);
    if (last && last.created_at) {
      const lastMs = Date.parse(String(last.created_at).replace(' ', 'T') + 'Z');
      const elapsed = Date.now() - lastMs;
      if (Number.isFinite(lastMs) && elapsed >= 0 && elapsed < SUB_RESET_INTERVAL_MS) {
        const waitH = Math.ceil((SUB_RESET_INTERVAL_MS - elapsed) / 3600000);
        return res.json({ ok: false, error: `每天只能重置一次，请约 ${waitH} 小时后再试` });
      }
    }
  } catch (_) { /* 审计查询失败不阻断 */ }

  const clientIp = req.clientIp || req.ip;
  try {
    const newToken = db.resetSubToken(userId);
    const rotated = db.rotateUserAllNodeUuids(userId);
    try { db.clearSubAccessWindow(userId, 24); } catch (_) {}
    db.addAuditLog(userId, 'sub_self_reset', `用户主动重置订阅+UUID: ${user.username} new=${String(newToken).slice(0, 8)} uuid=${rotated} ip=${clientIp}`, clientIp);
    // 立即推送全节点配置，使旧 UUID 失效、新 UUID 生效（与系统自动重置一致）
    try { emitSyncAll(); } catch (_) {}
    return res.json({ ok: true, rotated });
  } catch (err) {
    logger.error({ err, userId }, '用户自助重置订阅失败');
    return res.json({ ok: false, error: '重置失败，请稍后再试' });
  }
});

router.get('/monitor', requireAuth, (req, res) => {
  res.render('monitor', { user: req.user, nonce: res.locals.nonce || '' });
});

module.exports = router;
