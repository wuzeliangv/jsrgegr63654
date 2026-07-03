const crypto = require('crypto');
const { safeTokenEqual } = require('../utils/securityTokens');

// 生成 CSRF token 并存入 session
function generateToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

// 验证 CSRF（POST/PUT/DELETE 请求）
function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  // JSON API：必须携带有效 CSRF token
  if (req.is('json')) {
    const token = req.headers['x-csrf-token'];
    if (token && req.session.csrfToken && safeTokenEqual(token, req.session.csrfToken)) {
      return next();
    }
    return res.status(403).json({ error: 'CSRF 校验失败：请刷新页面重试' });
  }

  // 表单提交：检查 CSRF token
  if (!req.session.csrfToken) {
    return res.status(403).json({ error: 'CSRF 会话未初始化，请刷新页面' });
  }
  const token = req.body?._csrf || req.headers['x-csrf-token'];
  if (!token || !safeTokenEqual(token, req.session.csrfToken)) {
    return res.status(403).json({ error: 'CSRF token 无效，请刷新页面重试' });
  }
  next();
}

// 模板中间件：自动注入 csrfToken 到 res.locals
function csrfLocals(req, res, next) {
  res.locals.csrfToken = generateToken(req);
  next();
}

module.exports = { csrfProtection, csrfLocals };
