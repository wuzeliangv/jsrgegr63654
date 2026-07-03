const express = require('express');
const crypto = require('crypto');
const db = require('../services/database');
const logger = require('../services/logger');
const { requireAuth } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { getClientIp } = require('../utils/clientIp');
const { safeTokenEqual } = require('../utils/securityTokens');

const router = express.Router();

const PACKAGES = [
  { amount: 50, trafficGb: 50, label: '50 能量 = 50GB' },
  { amount: 100, trafficGb: 100, label: '100 能量 = 100GB' },
];

function getPaymentConfig() {
  return {
    paymentId: process.env.NODELOC_PAYMENT_ID || '',
    token: process.env.NODELOC_PAYMENT_TOKEN || process.env.NODELOC_PAYMENT_SECRET || '',
  };
}

function sortedParamString(params) {
  return Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&');
}

function signCreatePayment(params, token) {
  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  return crypto.createHmac('sha256', tokenHash).update(sortedParamString(params)).digest('hex');
}

function signCallback(params, token) {
  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  return crypto.createHmac('sha256', tokenHash).update(sortedParamString(params)).digest('hex');
}

const EXCHANGE_MIN = 10;
const EXCHANGE_MAX = 100;

function getPackage(amount) {
  const n = parseInt(amount, 10);
  if (!Number.isInteger(n) || n < EXCHANGE_MIN || n > EXCHANGE_MAX) return null;
  return { amount: n, trafficGb: n, label: `${n} 能量 = ${n}GB` };
}

function isPaymentEnabled() {
  const cfg = getPaymentConfig();
  return !!(cfg.paymentId && cfg.token);
}

// 兑换维护开关：设置 exchange_paused='true' 时暂停兑换
function isExchangePaused() {
  return db.getSetting('exchange_paused') === 'true';
}

router.get('/packages', requireAuth, (req, res) => {
  res.json({ ok: true, enabled: isPaymentEnabled(), paused: isExchangePaused(), tgBound: !!req.user.telegram_id, min: EXCHANGE_MIN, max: EXCHANGE_MAX, packages: PACKAGES });
});

// 当前用户的兑换记录
router.get('/my-orders', requireAuth, (req, res) => {
  const rows = db.getDb().prepare(`
    SELECT amount, traffic_gb, status, created_at, COALESCE(paid_at, updated_at) AS settled_at
    FROM nodeloc_payment_orders
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 20
  `).all(req.user.id);
  res.json({ ok: true, orders: rows });
});

// 兑换页面
router.get('/', requireAuth, (req, res) => {
  res.render('exchange', {
    title: '能量兑换流量',
    enabled: isPaymentEnabled(),
    paused: isExchangePaused(),
    tgBound: !!req.user.telegram_id,
    min: EXCHANGE_MIN,
    max: EXCHANGE_MAX,
  });
});

router.post('/nodeloc/create', requireAuth, csrfProtection, async (req, res) => {
  if (isExchangePaused()) return res.status(503).json({ ok: false, error: '兑换功能暂停维护中，请稍后再试' });
  // 未绑定 Telegram 的用户不能兑换（防止绕过绑定靠兑换刷流量）
  if (!req.user.telegram_id) return res.status(403).json({ ok: false, error: '请先绑定 Telegram 后再兑换流量' });
  const cfg = getPaymentConfig();
  if (!cfg.paymentId || !cfg.token) return res.status(503).json({ ok: false, error: 'NodeLoc Payment 未配置' });

  const pkg = getPackage(req.body?.amount);
  if (!pkg) return res.status(400).json({ ok: false, error: '无效兑换档位' });

  const d = db.getDb();
  const todayPaid = d.prepare(`
    SELECT id FROM nodeloc_payment_orders
    WHERE user_id = ?
      AND status = 'completed'
      AND date(COALESCE(paid_at, updated_at), '+8 hours') = date('now', '+8 hours')
    LIMIT 1
  `).get(req.user.id);
  if (todayPaid) return res.status(429).json({ ok: false, error: '今天已经兑换过了，明天再来吧' });

  const orderId = `nl_${req.user.id}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const description = `兑换 ${pkg.trafficGb}GB 流量`;
  const payload = {
    amount: pkg.amount,
    description,
    order_id: orderId,
  };
  payload.signature = signCreatePayment(payload, cfg.token);

  d.prepare(`
    INSERT INTO nodeloc_payment_orders (order_id, user_id, amount, traffic_gb, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(orderId, req.user.id, pkg.amount, pkg.trafficGb);

  try {
    const resp = await fetch(`https://www.nodeloc.com/payment/pay/${cfg.paymentId}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v)]))),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.payment_url) {
      logger.warn({ status: resp.status, data, orderId }, 'NodeLoc 发起支付失败');
      d.prepare("UPDATE nodeloc_payment_orders SET status = 'failed', raw_callback = ?, updated_at = datetime('now') WHERE order_id = ?")
        .run(JSON.stringify(data), orderId);
      return res.status(502).json({ ok: false, error: '发起支付失败，请稍后重试' });
    }
    d.prepare(`
      UPDATE nodeloc_payment_orders
      SET transaction_id = ?, payment_url = ?, status = ?, updated_at = datetime('now')
      WHERE order_id = ?
    `).run(data.transaction_id || null, data.payment_url, data.status || 'pending', orderId);
    db.addAuditLog(req.user.id, 'nodeloc_payment_create', `发起 NodeLoc 兑换: ${pkg.amount}能量 -> ${pkg.trafficGb}GB`, getClientIp(req));
    return res.json({ ok: true, paymentUrl: data.payment_url, orderId });
  } catch (err) {
    logger.error({ err, orderId }, 'NodeLoc 发起支付异常');
    d.prepare("UPDATE nodeloc_payment_orders SET status = 'failed', raw_callback = ?, updated_at = datetime('now') WHERE order_id = ?")
      .run(String(err?.message || err), orderId);
    return res.status(502).json({ ok: false, error: '发起支付失败，请稍后重试' });
  }
});

router.get('/callback', (req, res) => {
  const cfg = getPaymentConfig();
  const params = { ...req.query };
  const incomingSig = String(params.signature || '');
  delete params.signature;
  const orderId = String(params.external_reference || '');
  const status = String(params.status || '');
  const transactionId = String(params.transaction_id || '');
  const amount = parseInt(params.amount, 10);
  const raw = JSON.stringify(req.query);

  try {
    if (!cfg.token || !incomingSig) throw new Error('missing signature');
    const expected = signCallback(params, cfg.token);
    if (!safeTokenEqual(expected, incomingSig)) throw new Error('invalid signature');
    if (status !== 'completed') throw new Error(`payment not completed: ${status}`);

    const d = db.getDb();
    const tx = d.transaction(() => {
      const order = d.prepare('SELECT * FROM nodeloc_payment_orders WHERE order_id = ?').get(orderId);
      if (!order) throw new Error('order not found');
      if (order.status === 'completed') return { order, duplicated: true };
      if (Number(order.amount) !== amount) throw new Error('amount mismatch');

      const completedToday = d.prepare(`
        SELECT id FROM nodeloc_payment_orders
        WHERE user_id = ?
          AND id <> ?
          AND status = 'completed'
          AND date(COALESCE(paid_at, updated_at), '+8 hours') = date('now', '+8 hours')
        LIMIT 1
      `).get(order.user_id, order.id);
      if (completedToday) {
        d.prepare(`
          UPDATE nodeloc_payment_orders
          SET status = 'rejected_daily_limit', transaction_id = ?, paid_at = ?, raw_callback = ?, updated_at = datetime('now')
          WHERE order_id = ?
        `).run(transactionId || order.transaction_id, params.paid_at || new Date().toISOString(), raw, orderId);
        db.addAuditLog(order.user_id, 'nodeloc_payment_daily_limit', `NodeLoc 兑换超过每日次数: ${order.amount}能量`, 'nodeloc-payment');
        return { order, duplicated: false, dailyLimit: true };
      }

      const user = d.prepare('SELECT id, username, traffic_limit FROM users WHERE id = ?').get(order.user_id);
      if (!user) throw new Error('user not found');
      const addBytes = Math.round(Number(order.traffic_gb) * 1073741824);
      if (user.traffic_limit >= 0) {
        d.prepare('UPDATE users SET traffic_limit = ? WHERE id = ?').run(Math.max(0, user.traffic_limit + addBytes), user.id);
      }
      d.prepare(`
        UPDATE nodeloc_payment_orders
        SET status = 'completed', transaction_id = ?, paid_at = ?, raw_callback = ?, updated_at = datetime('now')
        WHERE order_id = ?
      `).run(transactionId || order.transaction_id, params.paid_at || new Date().toISOString(), raw, orderId);
      db.addAuditLog(user.id, 'nodeloc_payment_complete', `NodeLoc 兑换到账: ${order.amount}能量 -> ${order.traffic_gb}GB`, 'nodeloc-payment');
      return { order, duplicated: false };
    });

    const result = tx();
    return res.send(`
      <!doctype html><meta charset="utf-8">
      <title>兑换成功</title>
      <body style="font-family:system-ui;background:#0c0a0f;color:#fff;display:grid;place-items:center;min-height:100vh">
        <div style="text-align:center">
          <h1>${result.dailyLimit ? '今日已兑换' : (result.duplicated ? '订单已处理' : '兑换成功')}</h1>
          <p>${result.dailyLimit ? '今天已经兑换过了，本次不会重复到账。' : `已到账 ${result.order.traffic_gb}GB 流量。`}</p>
          <p><a href="/" style="color:#fb7185">返回面板</a></p>
        </div>
      </body>
    `);
  } catch (err) {
    logger.warn({ err, query: req.query }, 'NodeLoc 支付回调处理失败');
    return res.status(400).send('Payment callback failed');
  }
});

module.exports = router;
module.exports._test = { PACKAGES, signCreatePayment, signCallback, sortedParamString };
