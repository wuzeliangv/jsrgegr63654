const { toPosInt } = require("../utils/validators");
const rateLimit = require('express-rate-limit');
const db = require('../services/database');
const { getClientIp } = require('../utils/clientIp');
const logger = require('../services/logger');


// 订阅单 token 限流配置

const SUB_IP_WINDOW_MS = toPosInt(process.env.SUB_IP_WINDOW_MS, 60 * 1000, 1000, 60 * 60 * 1000);
const SUB_IP_MAX_REQ = toPosInt(process.env.SUB_IP_MAX_REQ, 15, 1, 1000);

function logSubRateLimited(req) {
  try {
    const token = String(req.params?.token || '');
    const user = token ? db.getUserBySubToken(token) : null;
    const path = String(req.path || '');
    const route = path.includes('/sub6/') ? 'sub6' : path.includes('/subhy2/') ? 'subhy2' : 'sub';
    db.logSubAccessEvent({
      userId: user?.id || null,
      tokenPrefix: token.slice(0, 8),
      route,
      result: 'deny',
      reason: 'ip_rate_limited',
      ip: getClientIp(req),
      ua: req.headers?.['user-agent'] || '',
      clientType: '',
      httpStatus: 429,
    });
  } catch (err) {
    logger.debug({
      err,
      route: req.path || '',
      tokenPrefix: String(req.params?.token || '').slice(0, 8),
    }, '记录订阅限流事件失败，已忽略');
  }
}

// 订阅拉取限流：每 IP 每分钟 N 次（默认 5）
const subLimiter = rateLimit({
  windowMs: SUB_IP_WINDOW_MS,
  max: SUB_IP_MAX_REQ,
  handler: (req, res, _next, options) => {
    logSubRateLimited(req);
    res.status(options.statusCode).type('text').send('Too many requests, please try again later.');
  },
  standardHeaders: true,
  legacyHeaders: false
});

// 管理 API 限流：每 IP 每分钟 300 次
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: '请求过于频繁' },
  standardHeaders: true,
  legacyHeaders: false
});

// Agent 下载限流：每 IP 每分钟最多 30 次（可通过环境变量调整）
const AGENT_DOWNLOAD_WINDOW_MS = toPosInt(process.env.AGENT_DOWNLOAD_WINDOW_MS, 60 * 1000, 1000, 60 * 60 * 1000);
const AGENT_DOWNLOAD_MAX_REQ = toPosInt(process.env.AGENT_DOWNLOAD_MAX_REQ, 30, 1, 10000);
const agentDownloadLimiter = rateLimit({
  windowMs: AGENT_DOWNLOAD_WINDOW_MS,
  max: AGENT_DOWNLOAD_MAX_REQ,
  message: { error: 'Agent 下载请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false
});

const GAME_RPS_WINDOW_MS = toPosInt(process.env.GAME_RPS_WINDOW_MS, 10 * 1000, 1000, 10 * 60 * 1000);
const GAME_RPS_MAX_REQ = toPosInt(process.env.GAME_RPS_MAX_REQ, 20, 1, 1000);
const GAME_FLIP_WINDOW_MS = toPosInt(process.env.GAME_FLIP_WINDOW_MS, 10 * 1000, 1000, 10 * 60 * 1000);
const GAME_FLIP_MAX_REQ = toPosInt(process.env.GAME_FLIP_MAX_REQ, 10, 1, 1000);
const GAME_LUCKY_WINDOW_MS = toPosInt(process.env.GAME_LUCKY_WINDOW_MS, 15 * 1000, 1000, 10 * 60 * 1000);
const GAME_LUCKY_MAX_REQ = toPosInt(process.env.GAME_LUCKY_MAX_REQ, 2, 1, 1000);

function buildGameLimiter(windowMs, max) {
  return rateLimit({
    windowMs,
    max,
    message: { ok: false, error: '操作过于频繁，请稍后再试' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // 优先用 IP 限流（不可伪造）。如果 tgUserId 同时存在且对应已绑定的真实用户，
      // 则使用 IP+tgUserId 复合 key（让同 IP 不同账号也分别限流），
      // 但 tgUserId 单独不能作为唯一 key —— 攻击者每次发不同 tgUserId 即绕过限流。
      const ipKey = `ip:${getClientIp(req)}`;
      const tgUserIdRaw = String(req.body?.tgUserId || '').trim();
      if (!tgUserIdRaw || !/^\d{1,20}$/.test(tgUserIdRaw)) return ipKey;
      try {
        const exists = db.getDb().prepare('SELECT 1 FROM users WHERE telegram_id = ? LIMIT 1').get(tgUserIdRaw);
        if (exists) return `${ipKey}|tg:${tgUserIdRaw}`;
      } catch (_) { /* DB 暂不可用时回退 */ }
      return ipKey;
    },
  });
}

const gameRpsLimiter = buildGameLimiter(GAME_RPS_WINDOW_MS, GAME_RPS_MAX_REQ);
const gameFlipLimiter = buildGameLimiter(GAME_FLIP_WINDOW_MS, GAME_FLIP_MAX_REQ);
const gameLuckyLimiter = buildGameLimiter(GAME_LUCKY_WINDOW_MS, GAME_LUCKY_MAX_REQ);

// 已登录 API per-user 限流（用于聚合查询路由）：每用户 60 秒 120 次
const userApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { ok: false, error: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // 优先按 userId 限流（同账号多设备共享配额是合理的）
    if (req.user?.id) return `user:${req.user.id}`;
    return `ip:${getClientIp(req)}`;
  },
});

module.exports = {
  subLimiter,
  adminLimiter,
  agentDownloadLimiter,
  gameRpsLimiter,
  gameFlipLimiter,
  gameLuckyLimiter,
  userApiLimiter,
};
