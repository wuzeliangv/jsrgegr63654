const express = require('express');
const db = require('../../services/database');

const router = express.Router();

// 订单汇总
router.get('/orders/summary', (req, res) => {
  const d = db.getDb();
  const row = d.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
      COALESCE(SUM(CASE WHEN status='completed' THEN traffic_gb ELSE 0 END), 0) AS traffic_gb,
      COALESCE(SUM(CASE WHEN status='completed' THEN amount ELSE 0 END), 0) AS energy
    FROM nodeloc_payment_orders
  `).get();
  const todayCompleted = d.prepare(`
    SELECT COUNT(*) AS c, COALESCE(SUM(traffic_gb),0) AS gb
    FROM nodeloc_payment_orders
    WHERE status='completed'
      AND date(COALESCE(paid_at, updated_at), '+8 hours') = date('now', '+8 hours')
  `).get();
  res.json({ ok: true, summary: { ...row, todayCompleted: todayCompleted.c, todayTrafficGb: todayCompleted.gb } });
});

// 订单列表（分页 + 状态筛选 + 搜索用户名/订单号）
router.get('/orders', (req, res) => {
  const d = db.getDb();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const offset = (page - 1) * pageSize;
  const status = String(req.query.status || '').trim();
  const search = String(req.query.search || '').trim();

  const where = [];
  const params = [];
  if (['completed', 'pending', 'failed', 'closed'].includes(status)) { where.push('o.status = ?'); params.push(status); }
  if (search) { where.push('(u.username LIKE ? OR o.order_id LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = d.prepare(`
    SELECT COUNT(*) AS c FROM nodeloc_payment_orders o
    LEFT JOIN users u ON u.id = o.user_id ${whereSql}
  `).get(...params).c;

  const rows = d.prepare(`
    SELECT o.id, o.order_id, o.user_id, u.username, o.amount, o.traffic_gb, o.status,
           o.created_at, COALESCE(o.paid_at, o.updated_at) AS settled_at
    FROM nodeloc_payment_orders o
    LEFT JOIN users u ON u.id = o.user_id
    ${whereSql}
    ORDER BY o.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  res.json({ ok: true, total, page, pageSize, totalPages: Math.ceil(total / pageSize), orders: rows });
});

module.exports = router;
