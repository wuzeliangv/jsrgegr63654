const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const db = require('./database');
const logger = require('./logger');
const { formatBytes } = require('../utils/formatBytes');
const { getGroupLabel } = require('../utils/userGroup');
const { getRegionEmoji } = require('../utils/regions');
const { getTzDateParts, shiftIsoDate, today, weekKey, TG_TIMEZONE } = require('../utils/tgGame');
const farm = require('./farm');

const TOKEN = process.env.TG_BOT_TOKEN;
let bot = null;
const DOMAIN = process.env.PANEL_DOMAIN || 'vip.sd';
let _botUsername = null;

const MENU = {
  checkin: '📌 签到',
  farm: '🌾 农场',
  me: '👤 我的',
  sub: '🔗 订阅',
  bind: '🔐 绑定账号',
  help: 'ℹ️ 功能介绍',
  support: '🧭 面板入口',
};

const MY_ACTIONS = {
  traffic: 'tg:my:traffic',
  nodes: 'tg:my:nodes',
  sub: 'tg:my:sub',
  admin: 'tg:my:admin',
};

function getNodeEmoji(name) {
  return getRegionEmoji(normalizeNodeName(name));
}

function getBotUsername() { return _botUsername; }

// ─── 签到配置 ───
const CHECKIN_MIN_GB = 1;
const CHECKIN_MAX_GB = 5;

// ─── 工具函数 ───
function getUserByTgId(tgId) {
  return db.getDb().prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(tgId));
}

function getActorId(msg) {
  return msg?.actor?.id ?? msg?.from?.id ?? null;
}

function countCurrentStreak(userId, endDate = today()) {
  if (!db.getDb().prepare('SELECT 1 FROM tg_checkin WHERE user_id = ? AND date = ?').get(userId, endDate)) {
    return 0;
  }
  let streak = 1;
  for (let i = 1; i <= 365; i++) {
    const prev = shiftIsoDate(endDate, -i);
    const has = db.getDb().prepare('SELECT 1 FROM tg_checkin WHERE user_id = ? AND date = ?').get(userId, prev);
    if (!has) break;
    streak += 1;
  }
  return streak;
}

function isPrivateChat(msg) {
  return msg.chat.type === 'private';
}

// 小游戏维护开关：设置 games_maintenance='true' 时，大转盘/翻卡/猜拳暂停（签到不受影响）
function isGamesMaintenance() {
  return db.getSetting('games_maintenance') === 'true';
}

// 维护期间统一回复文案
function sendGamesMaintenance(msg) {
  const text = [
    '🛠 <b>小游戏维护中</b>',
    '',
    '大转盘 / 翻卡 / 猜拳正在临时维护调整，暂时无法使用。',
    '（签到不受影响，可正常使用）',
    '',
    '维护结束后会第一时间恢复，感谢你的理解与支持～',
  ].join('\n');
  return bot.sendMessage(msg.chat.id, text, chatOptions(msg, { parse_mode: 'HTML' }));
}

function sendPrivateOnly(msg) {
  return bot.sendMessage(
    msg.chat.id,
    '🔒 该功能仅限私聊使用，请私聊我获取敏感信息。',
    { reply_to_message_id: msg.message_id }
  );
}

function chatOptions(msg, extra = {}) {
  return { ...extra };
}

function clearKeyboardOptions(extra = {}) {
  return {
    ...extra,
    reply_markup: { remove_keyboard: true },
  };
}

function isAdminUser(user) {
  return !!(user && Number(user.is_admin) === 1);
}

function myInlineKeyboard(user) {
  const rows = [
    [{ text: '📊 7天流量', callback_data: MY_ACTIONS.traffic }, { text: '📡 节点状态', callback_data: MY_ACTIONS.nodes }],
    [{ text: '🔗 我的订阅', callback_data: MY_ACTIONS.sub }],
  ];
  if (isAdminUser(user)) {
    rows.push([{ text: '🛠 管理总览', callback_data: MY_ACTIONS.admin }]);
  }
  return { inline_keyboard: rows };
}

function getPanelUrl() {
  return `https://${DOMAIN}`;
}

function normalizeNodeName(name) {
  return String(name || '')
    .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, '')
    .replace(/🏠/g, '')
    .trim();
}

function sendWelcome(msg, bound = !!getUserByTgId(getActorId(msg))) {
  const user = bound ? getUserByTgId(getActorId(msg)) : null;
  const base = bound
    ? '🍑 欢迎来到大姨子的诱惑！\n\n每天来逛逛，签到领种子、农场收流量：\n📌 签到 — 每日领取农场种子\n🌾 农场 — 种下种子，成熟收获流量\n👤 我的 — 查看个人信息与流量\n🔗 订阅 — 获取你的订阅链接'
    : '🍑 欢迎来到大姨子的诱惑！\n\n先完成账号绑定，即可开始签到领种子、农场种菜收流量。';
  const hint = bound
    ? '\n\n💡 点击左下角菜单，或直接发送 /checkin、/farm 开始～'
    : '\n\n💡 点击左下角菜单，或从面板点击 Telegram 图标完成绑定。';
  const adminHint = isAdminUser(user) ? '\n🛠 你是管理员，发送 /adminstats 查看今日运营总览。' : '';
  return bot.sendMessage(msg.chat.id, `${base}${hint}${adminHint}`, clearKeyboardOptions());
}

function getAdminDailyStats() {
  const d = db.getDb();
  const day = today();

  // 签到人数 + 当日发放种子数（种子=地块数，按用户组映射）
  const checkin = d.prepare(`
    SELECT
      COUNT(*) AS users,
      COALESCE(SUM(
        CASE
          WHEN u.trust_level >= 3 THEN 6
          WHEN u.trust_level >= 2 THEN 4
          WHEN u.trust_level >= 1 THEN 2
          ELSE 1
        END
      ), 0) AS seeds
    FROM tg_checkin c
    JOIN users u ON u.id = c.user_id
    WHERE c.date = ?
  `).get(day);

  // 注册用户（总数 + 今日新增，created_at 为 UTC，按 +8 小时换算到 Asia/Shanghai 自然日）
  const totalUsers = d.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const newUsers = d.prepare("SELECT COUNT(*) AS c FROM users WHERE date(created_at, '+8 hours') = ?").get(day).c;

  // TG 绑定人数
  const bind = d.prepare("SELECT COUNT(*) AS users FROM users WHERE telegram_id IS NOT NULL AND telegram_id != ''").get();

  // 整站流量（今日 + 累计）
  const todayT = db.getTodayTraffic() || { total_up: 0, total_down: 0 };
  const globalT = db.getGlobalTraffic() || { total_up: 0, total_down: 0 };

  return {
    day,
    totalUsers,
    newUsers,
    bindUsers: bind?.users || 0,
    checkinUsers: checkin?.users || 0,
    checkinSeeds: checkin?.seeds || 0,
    todayTrafficBytes: (todayT.total_up || 0) + (todayT.total_down || 0),
    globalTrafficBytes: (globalT.total_up || 0) + (globalT.total_down || 0),
  };
}

function handleAdminStats(msg) {
  const user = getUserByTgId(getActorId(msg));
  if (!user) return sendBindPrompt(msg);
  if (!isAdminUser(user)) return bot.sendMessage(msg.chat.id, '⛔ 仅管理员可查看这个入口', chatOptions(msg));

  const stats = getAdminDailyStats();
  return bot.sendMessage(
    msg.chat.id,
    `🛠 <b>管理总览</b>\n📅 日期：${stats.day}\n\n` +
    `👥 注册用户：${stats.totalUsers} 人（今日 +${stats.newUsers}）\n` +
    `🔗 TG 已绑定：${stats.bindUsers} 人\n` +
    `📌 今日签到：${stats.checkinUsers} 人 · 发放 ${stats.checkinSeeds} 颗种子\n\n` +
    `🌐 今日整站流量：${formatBytes(stats.todayTrafficBytes)}\n` +
    `📦 累计整站流量：${formatBytes(stats.globalTrafficBytes)}`,
    chatOptions(msg, { parse_mode: 'HTML' })
  );
}

function sendBindPrompt(msg) {
  const panelUrl = getPanelUrl();
  return bot.sendMessage(
    msg.chat.id,
    `🔐 请先绑定账号\n\n1. 登录面板：${panelUrl}\n2. 点击个人页里的 Telegram 图标\n3. 跳转机器人后完成绑定`,
    clearKeyboardOptions()
  );
}

function _tryUnfreezeAfterTraffic(userId) {
  const user = db.getUserById(userId);
  if (user && user.is_frozen && user.freeze_reason === 'traffic_limit' && !db.isTrafficExceeded(userId)) {
    db.unfreezeUser(userId);
    db.addAuditLog(null, 'traffic_limit_unfreeze', `签到/游戏增加流量后自动解冻: ${user.username}`, 'system');
    try { require('./configEvents').emitSyncAll(); } catch (_) {}
  }
}

// 签到时若用户因长期未签到被冻结，自动解冻
function _tryUnfreezeAfterCheckin(userId) {
  const user = db.getUserById(userId);
  if (user && user.is_frozen && user.freeze_reason === 'tg_inactive') {
    db.unfreezeUser(userId);
    db.addAuditLog(null, 'tg_inactive_unfreeze', `签到后自动解冻: ${user.username}`, 'system');
    try { require('./configEvents').emitSyncAll(); } catch (_) {}
  }
}

function runCheckin(userId, d, bytes) {
  const stmtInsert = db.getDb().prepare('INSERT OR IGNORE INTO tg_checkin (user_id, date, amount) VALUES (?, ?, ?)');
  const stmtUser = db.getDb().prepare('SELECT id, username, trust_level, traffic_limit FROM users WHERE id = ?');
  const stmtTraffic = db.getDb().prepare('UPDATE users SET traffic_limit = ? WHERE id = ?');
  const stmtCheckins = db.getDb().prepare('SELECT COUNT(*) as c FROM tg_checkin WHERE user_id = ?');
  const stmtSetGroup = db.getDb().prepare('UPDATE users SET trust_level = ? WHERE id = ?');
  const stmtAudit = db.getDb().prepare("INSERT INTO audit_log (user_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, datetime('now'))");

  return db.getDb().transaction(() => {
    const user = stmtUser.get(userId);
    if (!user) return { ok: false, reason: 'missing_user' };
    const inserted = stmtInsert.run(userId, d, bytes);
    if (!inserted.changes) return { ok: false, reason: 'already_checked_in' };

    if (user.traffic_limit >= 0) {
      stmtTraffic.run(Math.max(0, user.traffic_limit + bytes), userId);
    }

    const totalCheckins = stmtCheckins.get(userId).c;
    const currentLevel = user.trust_level || 0;
    let newLevel = currentLevel;
    if (totalCheckins >= 30 && currentLevel < 3) newLevel = 3;
    else if (totalCheckins >= 15 && currentLevel < 2) newLevel = 2;
    else if (totalCheckins >= 7 && currentLevel < 1) newLevel = 1;

    if (newLevel > currentLevel) {
      const groupLabel = getGroupLabel(newLevel);
      stmtSetGroup.run(newLevel, userId);
      stmtAudit.run(userId, 'set_group', `累计签到${totalCheckins}天自动升级: ${groupLabel}`, 'tg_checkin');
    }

    return { ok: true, totalCheckins, currentLevel, newLevel };
  })();
}

function handleCheckin(msg) {
  const user = getUserByTgId(getActorId(msg));
  if (!user) return sendBindPrompt(msg);

  const d = today();
  const totalCheckinsBefore = db.getDb().prepare('SELECT COUNT(*) as c FROM tg_checkin WHERE user_id = ?').get(user.id).c;
  const streakBefore = countCurrentStreak(user.id, d);
  // 签到不再发流量：传 0，只记录签到 + 累计升级
  const result = runCheckin(user.id, d, 0);
  if (result.ok) { _tryUnfreezeAfterCheckin(user.id); }
  if (!result.ok) {
    return bot.sendMessage(
      msg.chat.id,
      `📌 今天已经签到过了\n\n🔥 连续签到：${streakBefore} 天\n📦 累计签到：${totalCheckinsBefore} 天\n🌾 去农场把种子种下，成熟后可收获流量～`,
      chatOptions(msg)
    );
  }

  // 发放种子（按升级后的等级）
  const updatedUser = db.getUserById(user.id);
  const seedRes = farm.grantDailySeeds(updatedUser);
  const streak = countCurrentStreak(user.id, d);
  const upgradeMsg = result.newLevel > result.currentLevel ? `\n🎊 用户组升级：${getGroupLabel(result.newLevel)}` : '';

  let progressLine = '';
  const effectiveLevel = result.newLevel > result.currentLevel ? result.newLevel : result.currentLevel;
  if (effectiveLevel < 1) progressLine = `📈 距离升级 🌿 VIP 还需签到 ${Math.max(0, 7 - result.totalCheckins)} 天`;
  else if (effectiveLevel < 2) progressLine = `📈 距离升级 👑 SVIP 还需签到 ${Math.max(0, 15 - result.totalCheckins)} 天`;
  else if (effectiveLevel < 3) progressLine = `📈 距离升级 💎 SSVIP 还需签到 ${Math.max(0, 30 - result.totalCheckins)} 天`;
  else progressLine = '🏆 已达最高等级 💎 SSVIP';
  const broadbandLine = result.totalCheckins >= 7 ? '🏠 家宽：已解锁' : `🏠 家宽：再签到 ${Math.max(0, 7 - result.totalCheckins)} 天解锁`;

  let seedLine;
  if (seedRes.full) {
    seedLine = `🌾 你的仓库还有 ${seedRes.seeds} 颗种子（已满），本次不再赠送。\n快去农场把种子种下吧，成熟后可收获流量～ 🌱`;
  } else {
    seedLine = `🎁 获得种子：${seedRes.granted} 颗　（仓库 ${seedRes.seeds}/${seedRes.cap}）`;
  }

  return bot.sendMessage(
    msg.chat.id,
    `📌 今日签到成功\n\n${seedLine}\n🔥 连续签到：${streak} 天\n📦 累计签到：${result.totalCheckins} 天${upgradeMsg}\n\n${progressLine}\n${broadbandLine}\n\n🌾 发送 /farm 进入农场种菜收流量`,
    chatOptions(msg)
  );
}

function handleMe(msg) {
  const user = getUserByTgId(getActorId(msg));
  if (!user) return sendBindPrompt(msg);

  const traffic = db.getUserTraffic(user.id);
  const used = (traffic.total_up || 0) + (traffic.total_down || 0);
  const limit = user.traffic_limit;
  const remaining = limit < 0 ? -1 : Math.max(0, limit - used);
  const status = user.is_frozen ? '❄️ 已冻结' : user.is_blocked ? '🚫 已封禁' : '✅ 正常';
  const expiry = user.expires_at ? user.expires_at.slice(0, 10) : '永不过期';
  const group = getGroupLabel(user.trust_level);
  const totalCheckins = db.getDb().prepare('SELECT COUNT(*) as c FROM tg_checkin WHERE user_id = ?').get(user.id).c;
  const totalCheckinGB = db.getDb().prepare('SELECT COALESCE(SUM(amount), 0) as s FROM tg_checkin WHERE user_id = ?').get(user.id).s;
  const streak = countCurrentStreak(user.id, today());

  let nextGoal = '';
  const level = user.trust_level || 0;
  if (level < 1) nextGoal = `\n🏠 累计签到满 7 天可解锁家宽\n📅 再签 ${Math.max(0, 7 - totalCheckins)} 天升 🌿 VIP`;
  else if (level < 2) nextGoal = `\n📅 再签 ${Math.max(0, 15 - totalCheckins)} 天升 👑 SVIP`;
  else if (level < 3) nextGoal = `\n📅 再签 ${Math.max(0, 30 - totalCheckins)} 天升 💎 SSVIP`;

  return bot.sendMessage(
    msg.chat.id,
    `👤 <b>${user.username}</b>\n🏷️ 用户组: ${group}\n\n📊 状态: ${status}\n📅 到期: ${expiry}\n\n📈 已用流量: ${formatBytes(used)}\n💰 剩余流量: ${remaining < 0 ? '∞' : formatBytes(remaining)}\n\n📌 累计签到: ${totalCheckins} 次 · 连续 ${streak} 天\n🎁 签到获得: ${formatBytes(totalCheckinGB)}${nextGoal}`,
    chatOptions(msg, { parse_mode: 'HTML', reply_markup: myInlineKeyboard(user) })
  );
}

function handleLucky(msg) {
  if (isGamesMaintenance()) return sendGamesMaintenance(msg);
  const user = getUserByTgId(getActorId(msg));
  if (!user) return sendBindPrompt(msg);

  return bot.sendMessage(
    msg.chat.id,
    '🎰 <b>每周大转盘</b>\n\n每周只有 1 次机会，指针停下的那一格就是本周奖励。\n最高可抽中 50GB。',
    chatOptions(msg, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{
          text: '🎰 开始转盘',
          web_app: { url: `${getPanelUrl()}/lucky-wheel` },
        }]],
      },
    })
  );
}

function handleTraffic(msg) {
  const user = getUserByTgId(getActorId(msg));
  if (!user) return sendBindPrompt(msg);

  const days = db.getUserTrafficDailyAgg(user.id, 7);
  if (!days || days.length === 0) return bot.sendMessage(msg.chat.id, '📊 最近 7 天没有流量记录', chatOptions(msg));

  const maxBytes = Math.max(...days.map((d) => d.total_up + d.total_down), 1);
  const BAR_LEN = 12;
  const lines = days.map((d) => {
    const total = d.total_up + d.total_down;
    const len = Math.round((total / maxBytes) * BAR_LEN);
    const bar = '█'.repeat(len) + '░'.repeat(BAR_LEN - len);
    return `${d.date.slice(5)} ${bar} ${formatBytes(total)}`;
  });

  return bot.sendMessage(msg.chat.id, `📊 <b>最近 7 天流量</b>\n\n<code>${lines.join('\n')}</code>`, chatOptions(msg, { parse_mode: 'HTML' }));
}

function handleNodes(msg) {
  const user = getUserByTgId(getActorId(msg));
  if (!user) return sendBindPrompt(msg);

  const nodes = db.getAllNodes(true);
  if (!nodes.length) return bot.sendMessage(msg.chat.id, '暂无可用节点', chatOptions(msg));

  const fmtNode = (n) => {
    const icon = n.is_active ? '🟢' : '🔴';
    const emoji = getNodeEmoji(n.name);
    const name = normalizeNodeName(n.name);
    return `${icon} ${emoji} ${name}`;
  };

  const vlessNodes = nodes.filter((n) => n.protocol === 'vless');
  const hy2Nodes = nodes.filter((n) => n.protocol === 'hy2');

  const sections = [];
  if (vlessNodes.length) sections.push(`🌐 <b>VLESS</b>\n${vlessNodes.map(fmtNode).join('\n')}`);
  if (hy2Nodes.length) sections.push(`⚡ <b>Hysteria2</b>\n${hy2Nodes.map(fmtNode).join('\n')}`);

  if (!sections.length) return bot.sendMessage(msg.chat.id, '暂无可用节点', chatOptions(msg));

  return bot.sendMessage(msg.chat.id, `📡 <b>节点状态</b>\n\n${sections.join('\n\n')}`, chatOptions(msg, { parse_mode: 'HTML' }));
}

function handleSub(msg) {
  if (!isPrivateChat(msg)) return sendPrivateOnly(msg);
  const user = getUserByTgId(getActorId(msg));
  if (!user) return sendBindPrompt(msg);

  const token = user.sub_token;
  if (!token) return bot.sendMessage(msg.chat.id, '❌ 订阅令牌不存在，请联系管理员', chatOptions(msg));

  const { appendSignature } = require('../utils/subSignature');
  const base = getPanelUrl();
  const vlessUrl = appendSignature(`${base}/sub/${token}`, token, 'sub');
  const sub6Url = appendSignature(`${base}/sub6/${token}`, token, 'sub6');
  const hy2Url = appendSignature(`${base}/subhy2/${token}`, token, 'subhy2');
  const allUrl = appendSignature(`${base}/suball/${token}`, token, 'suball');

  // 仅当后台开启 IPv6 订阅可见时，才显示 IPv6 链接
  const showIpv6 = db.getSetting('sub_visible_ss') !== 'false';
  const ipv6Section = showIpv6 ? `\n\n🌐 IPv6: <code>${sub6Url}</code>` : '';

  return bot.sendMessage(
    msg.chat.id,
    `🔗 <b>订阅链接</b>\n\n🎯 组合: <code>${allUrl}</code>\n\n🌐 VLESS: <code>${vlessUrl}</code>${ipv6Section}\n\n⚡ Hysteria2: <code>${hy2Url}</code>\n\n⚠️ 请勿泄露，客户端会自动识别格式`,
    chatOptions(msg, { parse_mode: 'HTML' })
  );
}

function handleRps(msg) {
  if (isGamesMaintenance()) return sendGamesMaintenance(msg);
  const user = getUserByTgId(getActorId(msg));
  if (!user) return sendBindPrompt(msg);

  return bot.sendMessage(
    msg.chat.id,
    '✊✌️✋ <b>猜拳赢流量</b>\n\n赢 +1GB · 平 0 · 输 -0.5GB\n点击下方按钮开始！',
    chatOptions(msg, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{
          text: '🎮 开始猜拳',
          web_app: { url: `${getPanelUrl()}/rps-game` },
        }]],
      },
    })
  );
}

function handleFlip(msg) {
  if (isGamesMaintenance()) return sendGamesMaintenance(msg);
  const user = getUserByTgId(getActorId(msg));
  if (!user) return sendBindPrompt(msg);

  return bot.sendMessage(
    msg.chat.id,
    '🃏 <b>每日翻卡赢流量</b>\n\n每天 3 次机会，9 张卡任选 1 张翻开。\n可能翻出加流量，也可能只是谢谢参与。',
    chatOptions(msg, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{
          text: '🃏 开始翻卡',
          web_app: { url: `${getPanelUrl()}/flip-game` },
        }]],
      },
    })
  );
}

// ─── 命令处理 ───

if (!TOKEN) {
  module.exports = {
    init() {},
    generateBindToken,
    getBotUsername,
    probeAndUnbindBlockers: async () => ({ checked: 0, blocked: 0 }),
    _test: { today, weekKey, shiftIsoDate, countCurrentStreak, getTzDateParts },
  };
  return;
}

bot = new TelegramBot(TOKEN, {
  polling: {
    interval: 1000,
    autoStart: true,
    params: { timeout: 30 },
  },
});

// 绑定 TG 后发放注册赠送流量（仅未发放过的账号），并触发节点同步；返回提示文案后缀
function _afterTgBindGrant(userId) {
  try {
    const res = db.grantTgBindGift(userId);
    if (res && res.granted) {
      try { require('./configEvents').emitSyncAll(); } catch (_) {}
      try { db.addAuditLog(userId, 'tg_bind_gift', '绑定 TG 发放注册赠送流量', 'tg_bind'); } catch (_) {}
      const label = res.bytes < 0 ? '超大流量' : `${Math.round(res.bytes / 1073741824)}GB 流量`;
      return `\n🎁 已到账 ${label}！`;
    }
  } catch (_) { /* 忽略发放失败，不影响绑定 */ }
  return '';
}

// /start (含深度链接绑定)
bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
  if (!isPrivateChat(msg)) return;
  const param = (match[1] || '').trim();
  if (param.startsWith('bind_')) {
    // 深度链接绑定
    const token = param.slice(5);
    const tgId = String(msg.from.id);
    const existing = getUserByTgId(tgId);
    if (existing) return bot.sendMessage(msg.chat.id, `✅ 已绑定账号: ${existing.username}`, chatOptions(msg));
    const user = db.getDb().prepare('SELECT * FROM users WHERE tg_bind_token = ?').get(token);
    if (!user) return bot.sendMessage(msg.chat.id, '❌ 无效的绑定令牌，请从面板重新获取', chatOptions(msg));
    if (user.telegram_id) return bot.sendMessage(msg.chat.id, '❌ 该账号已绑定其他 Telegram', chatOptions(msg));
    db.getDb().prepare('UPDATE users SET telegram_id = ?, tg_bind_token = NULL WHERE id = ?').run(tgId, user.id);
    const giftLine = _afterTgBindGrant(user.id);
    return bot.sendMessage(msg.chat.id, `✅ 绑定成功！\n账号: ${user.username}${giftLine}\n\n发送 /checkin 每日签到领种子，/farm 进农场种菜收流量。`, chatOptions(msg));
  }

  return sendWelcome(msg);
});

// /bind <token>
bot.onText(/\/bind(?:\s+(.+))?/, (msg, match) => {
  if (!isPrivateChat(msg)) return;
  const tgId = String(msg.from.id);
  const existing = getUserByTgId(tgId);
  if (existing) return bot.sendMessage(msg.chat.id, `✅ 已绑定账号: ${existing.username}`, chatOptions(msg));

  const token = (match[1] || '').trim();
  if (!token) return sendBindPrompt(msg);

  const user = db.getDb().prepare('SELECT * FROM users WHERE tg_bind_token = ?').get(token);
  if (!user) return bot.sendMessage(msg.chat.id, '❌ 无效的绑定令牌', chatOptions(msg));
  if (user.telegram_id) return bot.sendMessage(msg.chat.id, '❌ 该账号已绑定其他 Telegram', chatOptions(msg));

  db.getDb().prepare('UPDATE users SET telegram_id = ?, tg_bind_token = NULL WHERE id = ?').run(tgId, user.id);
  const giftLine = _afterTgBindGrant(user.id);
  return bot.sendMessage(msg.chat.id, `✅ 绑定成功！\n账号: ${user.username}${giftLine}`, chatOptions(msg));
});

// /checkin
bot.onText(/\/checkin/, (msg) => { if (!isPrivateChat(msg)) return; return handleCheckin(msg); });
bot.onText(/\/farm/, (msg) => { if (!isPrivateChat(msg)) return; return sendFarm(msg); });

// /me
bot.onText(/\/me/, (msg) => { if (!isPrivateChat(msg)) return; return handleMe(msg); });

bot.onText(/\/adminstats/, (msg) => { if (!isPrivateChat(msg)) return; return handleAdminStats(msg); });

// /lucky


// /traffic
bot.onText(/\/traffic/, (msg) => { if (!isPrivateChat(msg)) return; return handleTraffic(msg); });

// /nodes
bot.onText(/\/nodes/, (msg) => { if (!isPrivateChat(msg)) return; return handleNodes(msg); });

// /sub
bot.onText(/\/sub/, (msg) => { if (!isPrivateChat(msg)) return; return handleSub(msg); });

// /rps 猜拳赢流量 (Web App)

bot.on('message', (msg) => {
  if (!isPrivateChat(msg)) return; // 仅响应私聊，群聊静默
  const text = String(msg.text || '').trim();
  if (!text || text.startsWith('/')) return;

  if (text === MENU.checkin) return void handleCheckin(msg);
  if (text === MENU.farm) return void sendFarm(msg);
  if (text === MENU.me) return void handleMe(msg);
  if (text === MENU.sub) return void handleSub(msg);
  if (text === MENU.bind) return void sendBindPrompt(msg);
  if (text === MENU.help) return void sendWelcome(msg);
  if (text === MENU.support) {
    return void bot.sendMessage(msg.chat.id, `🧭 面板入口：${getPanelUrl()}`, chatOptions(msg));
  }
});

// ===== 农场：种菜收流量 =====
function fmtRemain(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}小时${m}分`;
  if (m > 0) return `${m}分钟`;
  return '即将成熟';
}

function renderFarm(user) {
  const st = farm.getState(user);
  const lines = [`🌾 <b>我的农场</b>`];
  lines.push(`今日已收 <b>${st.harvestedGb}</b> / ${st.capGb} GB　（剩余可收 ${st.remainingCapGb} GB）`);
  lines.push(`已解锁地块 ${st.unlocked}/${farm.TOTAL_PLOTS}　·　成熟待收 ${st.matureCount} 块`);
  lines.push('');
  st.plots.forEach((p, i) => {
    const tag = `${i + 1}.`;
    if (p.locked) { lines.push(`${tag} 🔒 未解锁（升级会员可开通）`); return; }
    if (!p.crop) { lines.push(`${tag} 🟫 空地`); return; }
    if (p.mature) lines.push(`${tag} ${p.crop.emoji} ${p.crop.name}　✅ 已成熟（约 +${p.expectedGb}GB）`);
    else lines.push(`${tag} ${p.crop.emoji} ${p.crop.name}　⏳ ${fmtRemain(p.remainingSec)}`);
  });
  return { text: lines.join('\n'), state: st };
}

function farmKeyboard(st) {
  const rows = [];
  if (st.matureCount > 0) rows.push([{ text: `🌾 一键收获(${st.matureCount})`, callback_data: 'farm:ha' }]);
  // 每块地一个操作按钮
  st.plots.forEach((p, i) => {
    if (p.locked) return;
    if (!p.crop) rows.push([{ text: `${i + 1}. 🌱 播种`, callback_data: `farm:p:${i}` }]);
    else if (p.mature) rows.push([{ text: `${i + 1}. ✅ 收获 ${p.crop.emoji}`, callback_data: `farm:h:${i}` }]);
  });
  rows.push([{ text: '🔄 刷新', callback_data: 'farm:v' }]);
  return { inline_keyboard: rows };
}

function sendFarm(msg) {
  const user = getUserByTgId(getActorId(msg));
  if (!user) return sendBindPrompt(msg);
  return bot.sendMessage(msg.chat.id,
    '🌾 <b>我的农场</b>\n\n种菜收流量，会员等级越高地块越多、收益越大～\n点下方按钮进入农场：',
    chatOptions(msg, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🌱 进入农场', web_app: { url: `${getPanelUrl()}/farm-game` } }]] },
    }));
}

// 编辑当前消息为最新农场状态
function editFarm(msg, user) {
  const { text, state } = renderFarm(user);
  return bot.editMessageText(text, {
    chat_id: msg.chat.id, message_id: msg.message_id,
    parse_mode: 'HTML', reply_markup: farmKeyboard(state),
  }).catch(() => {});
}

// 选作物播种的键盘
function plantKeyboard(user, slot) {
  const crops = farm.availableCrops(user);
  const rows = crops.map(c => [{
    text: `${c.emoji} ${c.name} · ${c.hours}h · 种子${c.seedGb}GB`,
    callback_data: `farm:s:${slot}:${c.id}`,
  }]);
  rows.push([{ text: '« 返回', callback_data: 'farm:v' }]);
  return { inline_keyboard: rows };
}

async function handleFarmCallback(msg, data, queryId) {
  const user = getUserByTgId(getActorId(msg));
  if (!user) { await bot.answerCallbackQuery(queryId, { text: '请先绑定账号' }).catch(() => {}); return; }
  const parts = data.split(':'); // farm:<action>:...
  const action = parts[1];

  if (action === 'v') {
    await editFarm(msg, user);
    await bot.answerCallbackQuery(queryId).catch(() => {});
    return;
  }
  if (action === 'p') { // 选地块 -> 列作物
    const slot = parseInt(parts[2], 10);
    await bot.editMessageText(`🌱 选择要种在第 ${slot + 1} 块地的作物：\n（种子用流量购买，成熟后收获更多流量）`, {
      chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: 'HTML',
      reply_markup: plantKeyboard(user, slot),
    }).catch(() => {});
    await bot.answerCallbackQuery(queryId).catch(() => {});
    return;
  }
  if (action === 's') { // 播种
    const slot = parseInt(parts[2], 10);
    const cropId = parts[3];
    const r = farm.plant(user, slot, cropId);
    await bot.answerCallbackQuery(queryId, { text: r.ok ? `已种下 ${r.crop.emoji}${r.crop.name}，扣 ${r.seedGb}GB` : r.error, show_alert: !r.ok }).catch(() => {});
    await editFarm(msg, user);
    return;
  }
  if (action === 'h') { // 收获单块
    const slot = parseInt(parts[2], 10);
    const r = farm.harvest(user, slot);
    await bot.answerCallbackQuery(queryId, { text: r.ok ? `收获 +${r.gainedGb}GB${r.capped ? '（今日已封顶）' : ''}` : r.error, show_alert: !r.ok }).catch(() => {});
    await editFarm(msg, user);
    return;
  }
  if (action === 'ha') { // 一键收获
    const r = farm.harvestAll(user);
    const txt = r.ok ? `🌾 共收获 ${r.count} 块，+${r.gainedGb}GB${r.cappedHit ? '（已达今日上限）' : ''}` : '没有可收获的成熟作物';
    await bot.answerCallbackQuery(queryId, { text: txt, show_alert: true }).catch(() => {});
    await editFarm(msg, user);
    return;
  }
  await bot.answerCallbackQuery(queryId).catch(() => {});
}

bot.on('callback_query', async (query) => {
  const msg = query.message ? { ...query.message, actor: query.from } : null;
  const data = query.data;
  if (!msg || !data) return;
  if (!isPrivateChat(msg)) { try { await bot.answerCallbackQuery(query.id); } catch (_) {} return; } // 仅私聊

  try {
    if (data === MY_ACTIONS.traffic) await handleTraffic(msg);
    else if (data === MY_ACTIONS.nodes) await handleNodes(msg);
    else if (data === MY_ACTIONS.sub) await handleSub(msg);
    else if (data === MY_ACTIONS.admin) await handleAdminStats(msg);
    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    await bot.answerCallbackQuery(query.id, { text: '操作失败，请稍后重试' }).catch(() => {});
    logger.warn({ err: err.message, data }, 'TG callback failed');
  }
});

// 错误处理 — 遇到 429 限流时暂停 polling 等待恢复
let _pollingRestartTimer = null;
bot.on('polling_error', (err) => {
  const msg = err.message || '';
  logger.error({ err: msg }, 'TG Bot polling error');
  if (msg.includes('429')) {
    const wait = parseInt(msg.match(/retry after (\d+)/)?.[1], 10) || 10;
    logger.warn({ wait }, 'TG 429 限流，暂停 polling');
    bot.stopPolling().then(() => {
      setTimeout(() => bot.startPolling(), wait * 1000);
    }).catch(() => {});
    return;
  }
  // 网络致命错误（EFATAL / ECONNRESET / ETIMEDOUT 等）：polling 可能已停止，自动重启恢复
  if (/EFATAL|ECONNRESET|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|socket hang up/i.test(msg)) {
    if (_pollingRestartTimer) return; // 防抖，避免重复重启
    logger.warn('TG polling 网络错误，5秒后自动重启 polling');
    _pollingRestartTimer = setTimeout(() => {
      _pollingRestartTimer = null;
      bot.stopPolling({ cancel: true }).catch(() => {}).finally(() => {
        bot.startPolling().then(() => logger.info('TG polling 已自动恢复')).catch((e) => logger.error({ err: e.message }, 'TG polling 重启失败'));
      });
    }, 5000);
  }
});

function init() {
  bot.getMe().then((me) => {
    _botUsername = me.username;
    const commands = [
      { command: 'start', description: '打开机器人菜单' },
      { command: 'checkin', description: '每日签到领种子' },
      { command: 'farm', description: '农场种菜收流量' },
      { command: 'me', description: '查看个人信息' },
      { command: 'sub', description: '获取订阅链接' },
      { command: 'traffic', description: '近7天流量' },
      { command: 'nodes', description: '节点状态' },
      { command: 'adminstats', description: '管理员查看今日总览' },
    ];
    return Promise.all([
      bot.setMyCommands(commands),
      bot.setMyCommands(commands, { scope: { type: 'all_private_chats' } }),
      bot.setChatMenuButton({ menu_button: { type: 'commands' } }),
    ]);
  }).catch((err) => {
    logger.warn({ err: err.message }, 'TG menu setup failed');
  });
  logger.info('TG Bot 已启动');
}

function generateBindToken(userId) {
  const token = require('crypto').randomBytes(16).toString('hex');
  db.getDb().prepare('UPDATE users SET tg_bind_token = ? WHERE id = ?').run(token, userId);
  return token;
}

// 静默探测拉黑/停用机器人的已绑定用户（发 typing 状态，用户无感），并解绑（telegram_id 置空）
// 使其纳入「未绑定」横幅提示与 7 天自动清理。供每日定时任务调用。
async function probeAndUnbindBlockers() {
  if (!bot) return { checked: 0, blocked: 0 };
  const rows = db.getDb().prepare("SELECT id, username, telegram_id FROM users WHERE telegram_id IS NOT NULL AND telegram_id != '' AND is_blocked = 0").all();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const blocked = [];
  for (const u of rows) {
    const chatId = String(u.telegram_id);
    try {
      await bot.sendChatAction(chatId, 'typing');
    } catch (err) {
      const body = err && err.response && err.response.body;
      const code = body && body.error_code;
      if (code === 429) {
        const wait = (body.parameters && body.parameters.retry_after ? body.parameters.retry_after : 2) + 1;
        await sleep(wait * 1000);
        try { await bot.sendChatAction(chatId, 'typing'); }
        catch (e2) { if (e2 && e2.response && e2.response.body && e2.response.body.error_code === 403) blocked.push(u); }
      } else if (code === 403) {
        blocked.push(u);
      }
      // 其它错误（网络等）忽略，避免误解绑
    }
    await sleep(60);
  }
  if (blocked.length > 0) {
    const d = db.getDb();
    const upd = d.prepare('UPDATE users SET telegram_id = NULL WHERE id = ?');
    d.transaction(() => { for (const u of blocked) upd.run(u.id); })();
    db.addAuditLog(null, 'unbind_tg_blocker', `定时探测解绑 ${blocked.length} 个拉黑机器人的用户: ${blocked.map((u) => u.username).join(', ')}`, 'system');
    logger.info({ count: blocked.length, users: blocked.map((u) => u.username) }, '定时探测解绑拉黑机器人用户');
  }
  return { checked: rows.length, blocked: blocked.length };
}

module.exports = {
  init,
  generateBindToken,
  getBotUsername,
  probeAndUnbindBlockers,
  _test: { today, weekKey, shiftIsoDate, countCurrentStreak, getTzDateParts },
};
