/**
 * CSP Nonce 中间件
 * 每个请求生成唯一 nonce，用于内联 script/style 的 CSP 白名单
 */
const crypto = require('crypto');

function cspNonce(req, res, next) {
  res.locals.nonce = crypto.randomBytes(32).toString('base64');
  next();
}

module.exports = { cspNonce };
