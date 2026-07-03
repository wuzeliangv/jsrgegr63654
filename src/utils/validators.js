const net = require('net');
const HOST_RE = /^[a-zA-Z0-9._-]{1,253}$/;
const USERNAME_MAX_LEN = 64;

function toPosInt(value, fallback, min = 1, max = null) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  let out = n;
  if (out < min) out = min;
  if (max != null && out > max) out = max;
  return out;
}

function parseIntId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isValidHost(host) {
  if (typeof host !== 'string') return false;
  const value = host.trim();
  if (!value) return false;

  // 兼容 IPv4 / IPv6
  if (net.isIP(value)) return true;

  // 兼容域名/主机名
  return HOST_RE.test(value);
}

function normalizeUsernameInput(raw, maxLen = USERNAME_MAX_LEN) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.length > maxLen) return '';
  return value;
}

module.exports = {
  toPosInt,
  parseIntId,
  isValidHost,
  USERNAME_MAX_LEN,
  normalizeUsernameInput,
};
