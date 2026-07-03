const { safeTokenEqual } = require('../utils/securityTokens');
const logger = require('../services/logger');

/**
 * OPS API Bearer Token 认证中间件
 * 使用 .env 中的 OPS_API_KEY 校验，绕过 session/CSRF
 */
function opsAuth(req, res, next) {
  const key = process.env.OPS_API_KEY;
  if (!key) {
    return res.status(503).json({ error: 'Service unavailable' });
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = auth.slice(7).trim();
  if (!token || !safeTokenEqual(token, key)) {
    logger.debug({ ip: req.ip }, 'OPS API auth failed');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

module.exports = { opsAuth };
