const express = require('express');
const db = require('../services/database');
const farm = require('../services/farm');
const { verifyTgInitData } = require('../utils/tgGame');

const router = express.Router();

// 农场页面（TG WebApp）
router.get('/farm-game', (req, res) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors https://web.telegram.org https://desktop.telegram.org");
  res.render('farm-game', { nonce: res.locals.nonce || '' });
});

// 用 initData 解析并返回绑定用户；失败返回 null
function resolveUser(initData) {
  const tgUser = verifyTgInitData(initData || '');
  if (!tgUser || tgUser.id == null) return { error: '验证失败' };
  const user = db.getDb().prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(tgUser.id));
  if (!user) return { error: '未绑定账号，请先在机器人里绑定' };
  if (user.is_blocked) return { error: '账号已被封禁' };
  return { user };
}

// 组装返回给前端的完整状态
function buildPayload(user) {
  const st = farm.getState(user);
  return {
    ok: true,
    group: Math.min(Math.max(user.trust_level || 0, 0), 3),
    unlocked: st.unlocked,
    totalPlots: farm.TOTAL_PLOTS,
    seeds: st.seeds,
    seedCap: st.seedCap,
    cropYieldGb: st.cropYieldGb,
    cropName: st.cropName,
    cropEmoji: st.cropEmoji,
    matureCount: st.matureCount,
    plots: st.plots.map(p => ({
      slot: p.slot,
      locked: p.locked,
      planted: !!p.crop,
      mature: p.crop ? p.mature : false,
      remainingSec: p.crop ? p.remainingSec : 0,
      totalSec: p.crop ? p.totalSec : 0,
      expectedGb: p.crop ? p.expectedGb : 0,
    })),
  };
}

// 状态
router.post('/farm/api/state', express.json(), (req, res) => {
  const r = resolveUser(req.body?.initData);
  if (r.error) return res.json({ ok: false, error: r.error });
  res.json(buildPayload(r.user));
});

// 播种（消耗 1 颗种子，无需选作物）
router.post('/farm/api/plant', express.json(), (req, res) => {
  const r = resolveUser(req.body?.initData);
  if (r.error) return res.json({ ok: false, error: r.error });
  const slot = Number(req.body?.slot);
  const result = farm.plant(r.user, slot);
  const payload = buildPayload(db.getDb().prepare('SELECT * FROM users WHERE id = ?').get(r.user.id));
  res.json({ ...payload, action: result });
});

// 收获单块
router.post('/farm/api/harvest', express.json(), (req, res) => {
  const r = resolveUser(req.body?.initData);
  if (r.error) return res.json({ ok: false, error: r.error });
  const slot = Number(req.body?.slot);
  const result = farm.harvest(r.user, slot);
  const payload = buildPayload(db.getDb().prepare('SELECT * FROM users WHERE id = ?').get(r.user.id));
  res.json({ ...payload, action: result });
});

// 一键收获
router.post('/farm/api/harvest-all', express.json(), (req, res) => {
  const r = resolveUser(req.body?.initData);
  if (r.error) return res.json({ ok: false, error: r.error });
  const result = farm.harvestAll(r.user);
  const payload = buildPayload(db.getDb().prepare('SELECT * FROM users WHERE id = ?').get(r.user.id));
  res.json({ ...payload, action: result });
});

// 随机访问一个邻居农场（无好友系统，纯随机串门偷菜）
router.post('/farm/api/visit', express.json(), (req, res) => {
  const r = resolveUser(req.body?.initData);
  if (r.error) return res.json({ ok: false, error: r.error });
  res.json(farm.getRandomFarm(r.user));
});

// 偷一块邻居的成熟作物
router.post('/farm/api/steal', express.json(), (req, res) => {
  const r = resolveUser(req.body?.initData);
  if (r.error) return res.json({ ok: false, error: r.error });
  const victimId = Number(req.body?.victimId);
  const slot = Number(req.body?.slot);
  res.json(farm.steal(r.user, victimId, slot));
});

module.exports = router;
