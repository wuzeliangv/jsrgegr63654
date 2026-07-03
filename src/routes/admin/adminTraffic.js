const express = require('express');
const db = require('../../services/database');

const router = express.Router();
const ADMIN_TRAFFIC_CACHE_TTL_MS = Math.max(1000, parseInt(process.env.ADMIN_TRAFFIC_CACHE_TTL_MS || '5000', 10) || 5000);
const _adminTrafficCache = new Map();

function getCachedTraffic(key) {
  const cached = _adminTrafficCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.ts >= ADMIN_TRAFFIC_CACHE_TTL_MS) {
    _adminTrafficCache.delete(key);
    return null;
  }
  return cached.payload;
}

function setCachedTraffic(key, payload) {
  _adminTrafficCache.set(key, { ts: Date.now(), payload });
}

router.get('/traffic', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const range = req.query.range || req.query.date || 'today';
  const limit = 20;
  const offset = (page - 1) * limit;
  const data = db.getUsersTrafficByRange(range, limit, offset);
  const pages = Math.max(1, Math.ceil((data.total || 0) / limit));
  res.json({ ...data, page, limit, pages });
});

router.get('/traffic/nodes', (req, res) => {
  const range = req.query.range || 'today';
  const cacheKey = `traffic-nodes:${range}`;
  const cached = getCachedTraffic(cacheKey);
  if (cached) return res.json(cached);
  const payload = { rows: db.getNodesTrafficByRange(range) };
  setCachedTraffic(cacheKey, payload);
  res.json(payload);
});

router.get('/traffic/trend', (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 90);
  const rows = db.getTrafficTrend(days);
  res.json(rows);
});

module.exports = router;
