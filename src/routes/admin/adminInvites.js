const express = require('express');
const db = require('../../services/database');
const { formatDateTimeInTimeZone } = require('../../utils/time');

const router = express.Router();

router.get('/invite-relations', (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const search = String(req.query.search || '').trim();
  const status = ['all', 'used', 'active', 'expired'].includes(String(req.query.status || 'all'))
    ? String(req.query.status || 'all')
    : 'all';
  const limit = 20;
  const offset = (page - 1) * limit;
  const data = db.getInviteRelationsPaged(limit, offset, search, status);
  const rows = (data.rows || []).map((row) => ({
    ...row,
    created_at_display: formatDateTimeInTimeZone(row.created_at, 'Asia/Shanghai', true),
    expires_at_display: formatDateTimeInTimeZone(row.expires_at, 'Asia/Shanghai', true),
    used_at_display: formatDateTimeInTimeZone(row.used_at, 'Asia/Shanghai', true),
  }));
  res.json({ rows, total: data.total, page, status });
});

module.exports = router;
