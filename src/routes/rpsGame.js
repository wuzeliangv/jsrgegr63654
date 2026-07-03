const express = require('express');
const db = require('../services/database');
const { gameRpsLimiter } = require('../middleware/rateLimit');
const { verifyTgInitData, today, TG_INITDATA_MAX_AGE_SEC, tryUnfreezeAfterTraffic } = require('../utils/tgGame');

const router = express.Router();

const WIN_RATE = 0.50;
const DRAW_RATE = 0.15;

function resolveOutcome(choice, roll = Math.random()) {
  let sysChoice;
  if (roll < WIN_RATE) sysChoice = (choice + 1) % 3;
  else if (roll < WIN_RATE + DRAW_RATE) sysChoice = choice;
  else sysChoice = (choice + 2) % 3;

  const result = choice === sysChoice ? 'draw' : (choice + 1) % 3 === sysChoice ? 'win' : 'lose';
  const gb = result === 'win' ? 1 : result === 'lose' ? -0.5 : 0;
  return { sysChoice, result, gb };
}

function applyRpsPlay(userId, date, outcome) {
  const d = db.getDb();
  const getUserStmt = d.prepare('SELECT id, traffic_limit FROM users WHERE id = ?');
  const getDailyStmt = d.prepare('SELECT plays, net_gb FROM tg_rps_daily WHERE user_id = ? AND date = ?');
  const insertDailyStmt = d.prepare(`
    INSERT INTO tg_rps_daily (user_id, date, plays, net_gb, created_at, updated_at)
    VALUES (?, ?, 1, ?, datetime('now'), datetime('now'))
  `);
  const updateDailyStmt = d.prepare(`
    UPDATE tg_rps_daily
    SET plays = plays + 1, net_gb = net_gb + ?, updated_at = datetime('now')
    WHERE user_id = ? AND date = ?
  `);
  const setTrafficStmt = d.prepare('UPDATE users SET traffic_limit = ? WHERE id = ?');

  return d.transaction(() => {
    const user = getUserStmt.get(userId);
    if (!user) return { ok: false, error: '未绑定账号' };

    const daily = getDailyStmt.get(userId, date);
    if (daily && daily.plays >= DAILY_RPS_LIMIT) {
      return { ok: false, error: `今天赢了 ${daily.net_gb > 0 ? '+' : ''}${daily.net_gb} GB 流量\n今日已玩 ${DAILY_RPS_LIMIT} 次，明天再来吧` };
    }

    if (daily) updateDailyStmt.run(outcome.gb, userId, date);
    else insertDailyStmt.run(userId, date, outcome.gb);

    if (outcome.gb !== 0 && user.traffic_limit >= 0) {
      const newLimit = Math.max(0, user.traffic_limit + outcome.gb * 1073741824);
      setTrafficStmt.run(newLimit, userId);
    }

    const nextDaily = getDailyStmt.get(userId, date);
    return {
      ok: true,
      plays: nextDaily.plays,
      netGb: nextDaily.net_gb,
    };
  })();
}

function getRpsProfileByTelegramId(telegramId) {
  const user = db.getDb().prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
  if (!user) return null;
  return getRpsProfileByUser(user);
}

function getRpsProfileByUser(user) {
  const day = today();
  const row = db.getDb().prepare('SELECT plays, net_gb FROM tg_rps_daily WHERE user_id = ? AND date = ?').get(user.id, day);
  const trafficRow = db.getDb().prepare('SELECT COALESCE(total_up + total_down, 0) as total FROM traffic_user_total WHERE user_id = ?').get(user.id);
  const totalCheckins = db.getDb().prepare('SELECT COUNT(*) as c FROM tg_checkin WHERE user_id = ?').get(user.id).c;
  const used = trafficRow ? trafficRow.total : 0;
  const remaining = user.traffic_limit < 0 ? -1 : Math.max(0, user.traffic_limit - used);

  return {
    userId: user.id,
    plays: row?.plays || 0,
    netGb: row?.net_gb || 0,
    remainingGB: remaining < 0 ? -1 : +(remaining / 1073741824).toFixed(2),
    playsLeft: DAILY_RPS_LIMIT - (row?.plays || 0),
    totalCheckins,
    broadbandUnlocked: totalCheckins >= 7,
    broadbandDaysLeft: Math.max(0, 7 - totalCheckins),
  };
}

// 游戏页面
router.get('/rps-game', (req, res) => {
  // TG WebApp 需要加载 telegram.org 脚本，覆盖 CSP
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors https://web.telegram.org https://desktop.telegram.org");
  res.render('rps-game', { nonce: res.locals.nonce || '' });
});

// 游戏 API
const DAILY_RPS_LIMIT = 20;

router.post('/api/rps-profile', express.json(), (req, res) => {
  const tgUser = verifyTgInitData(req.body?.initData || '');
  if (!tgUser) return res.json({ ok: false, error: '验证失败' });

  const profile = getRpsProfileByTelegramId(tgUser.id);
  if (!profile) return res.json({ ok: false, error: '未绑定账号' });

  res.json({ ok: true, ...profile });
});

router.post('/api/rps-play', express.json(), (req, res, next) => {
  const tgUser = verifyTgInitData(req.body?.initData || '');
  if (tgUser?.id != null) req.body.tgUserId = String(tgUser.id);
  req.tgUser = tgUser;
  next();
}, gameRpsLimiter, (req, res) => {
  if (db.getSetting('games_maintenance') === 'true') return res.json({ ok: false, error: '🛠 小游戏维护中，暂时无法游玩，敬请期待' });
  const tgUser = req.tgUser || null;
  if (!tgUser) return res.json({ ok: false, error: '验证失败' });

  const choice = Number(req.body?.choice); // 0=石头 1=剪刀 2=布
  if (![0, 1, 2].includes(choice)) return res.json({ ok: false, error: '无效选择' });

  const user = db.getDb().prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(tgUser.id));
  if (!user) return res.json({ ok: false, error: '未绑定账号' });

  const day = today();
  const outcome = resolveOutcome(choice);
  const result = applyRpsPlay(user.id, day, outcome);
  if (result.ok && outcome.gb > 0) tryUnfreezeAfterTraffic(db, user.id);
  if (!result.ok) {
    const profile = getRpsProfileByUser(user);
    return res.json({
      ...result,
      remainingGB: profile.remainingGB,
      playsLeft: profile.playsLeft,
      dayNetGb: profile.netGb,
      totalCheckins: profile.totalCheckins,
      broadbandUnlocked: profile.broadbandUnlocked,
      broadbandDaysLeft: profile.broadbandDaysLeft,
    });
  }

  const profile = getRpsProfileByTelegramId(tgUser.id);

  res.json({
    ok: true,
    sysChoice: outcome.sysChoice,
    result: outcome.result,
    gb: outcome.gb,
    remainingGB: profile.remainingGB,
    playsLeft: profile.playsLeft,
    dayNetGb: profile.netGb,
    totalCheckins: profile.totalCheckins,
    broadbandUnlocked: profile.broadbandUnlocked,
    broadbandDaysLeft: profile.broadbandDaysLeft,
  });
});

module.exports = router;
module.exports._test = { verifyTgInitData, today, resolveOutcome, applyRpsPlay, getRpsProfileByTelegramId, getRpsProfileByUser, TG_INITDATA_MAX_AGE_SEC };
