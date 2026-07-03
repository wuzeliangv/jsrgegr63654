const logger = require('./logger');

const REQUEST_METRICS_WINDOW_MS = Math.max(60000, parseInt(process.env.REQUEST_METRICS_WINDOW_MS || '60000', 10) || 60000);
const REQUEST_METRICS_RETENTION_MS = Math.max(REQUEST_METRICS_WINDOW_MS, parseInt(process.env.REQUEST_METRICS_RETENTION_MS || '300000', 10) || 300000);
const REQUEST_METRICS_LOG_INTERVAL_MS = Math.max(10000, parseInt(process.env.REQUEST_METRICS_LOG_INTERVAL_MS || '60000', 10) || 60000);
const REQUEST_METRICS_TOP_N = Math.max(1, parseInt(process.env.REQUEST_METRICS_TOP_N || '8', 10) || 8);

const _requests = [];
let _summaryTimer = null;

function normalizePath(req) {
  if (req?.baseUrl && req?.route?.path) return `${req.baseUrl}${req.route.path}`;
  if (req?.route?.path) return req.route.path;
  return req?.path || req?.originalUrl?.split('?')[0] || 'unknown';
}

function pruneRequests(now = Date.now()) {
  while (_requests.length > 0 && now - _requests[0].ts > REQUEST_METRICS_RETENTION_MS) {
    _requests.shift();
  }
}

function recordRequest(input = {}) {
  const now = Number(input.ts || Date.now());
  _requests.push({
    ts: now,
    method: String(input.method || 'GET').toUpperCase(),
    path: String(input.path || 'unknown'),
    statusCode: Number(input.statusCode || 0),
    durationMs: Number(input.durationMs || 0),
  });
  pruneRequests(now);
}

function getTopRoutes(windowMs = REQUEST_METRICS_WINDOW_MS, topN = REQUEST_METRICS_TOP_N, now = Date.now()) {
  pruneRequests(now);
  const stats = new Map();
  for (const row of _requests) {
    if (now - row.ts > windowMs) continue;
    const key = `${row.method} ${row.path}`;
    if (!stats.has(key)) {
      stats.set(key, {
        method: row.method,
        path: row.path,
        count: 0,
        totalMs: 0,
        maxMs: 0,
        errors: 0,
      });
    }
    const item = stats.get(key);
    item.count += 1;
    item.totalMs += row.durationMs;
    item.maxMs = Math.max(item.maxMs, row.durationMs);
    if (row.statusCode >= 400) item.errors += 1;
  }
  return [...stats.values()]
    .map((item) => ({
      ...item,
      avgMs: item.count > 0 ? Math.round((item.totalMs / item.count) * 100) / 100 : 0,
    }))
    .sort((a, b) => {
      if (b.totalMs !== a.totalMs) return b.totalMs - a.totalMs;
      if (b.count !== a.count) return b.count - a.count;
      return b.maxMs - a.maxMs;
    })
    .slice(0, topN);
}

function logTopRoutes(now = Date.now()) {
  const top = getTopRoutes(REQUEST_METRICS_WINDOW_MS, REQUEST_METRICS_TOP_N, now);
  if (top.length === 0) return;
  logger.info({ windowMs: REQUEST_METRICS_WINDOW_MS, top }, 'request 热点路由');
}

function scheduleSummaryLogs() {
  if (_summaryTimer) return;
  _summaryTimer = setInterval(() => logTopRoutes(), REQUEST_METRICS_LOG_INTERVAL_MS);
  if (typeof _summaryTimer.unref === 'function') _summaryTimer.unref();
}

function requestMetricsMiddleware(req, res, next) {
  const startedAt = Date.now();
  res.on('finish', () => {
    recordRequest({
      ts: Date.now(),
      method: req.method,
      path: normalizePath(req),
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });
  next();
}

function _resetForTests() {
  _requests.length = 0;
}

module.exports = {
  requestMetricsMiddleware,
  scheduleSummaryLogs,
  recordRequest,
  getTopRoutes,
  _test: {
    normalizePath,
    pruneRequests,
    reset: _resetForTests,
  },
};
