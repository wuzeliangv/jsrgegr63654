const crypto = require('crypto');

function safeTokenEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (aa.length === 0 || bb.length === 0) return false;
  // 统一哈希到固定长度，避免长度比较泄露信息
  const ha = crypto.createHash('sha256').update(aa).digest();
  const hb = crypto.createHash('sha256').update(bb).digest();
  return crypto.timingSafeEqual(ha, hb) && aa.length === bb.length;
}

function isValidOAuthState(expectedState, incomingState) {
  if (!expectedState || !incomingState) return false;
  return safeTokenEqual(incomingState, expectedState);
}

module.exports = {
  safeTokenEqual,
  isValidOAuthState,
};
