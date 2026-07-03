const proxyAddr = require('proxy-addr');

function parseTrustProxyCidrs(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function parseTrustProxyValue(raw) {
  const value = String(raw ?? 'false').trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(value)) return false;
  if (/^\d+$/.test(value)) return Number(value);
  return String(raw ?? 'false').trim();
}

function resolveTrustProxyConfig(env = process.env) {
  const cidrs = parseTrustProxyCidrs(env.TRUST_PROXY_CIDRS);
  if (cidrs.length > 0) {
    return {
      mode: 'cidr',
      value: proxyAddr.compile(cidrs),
      cidrs,
    };
  }
  return {
    mode: 'default',
    value: parseTrustProxyValue(env.TRUST_PROXY),
    cidrs: [],
  };
}

module.exports = {
  parseTrustProxyCidrs,
  parseTrustProxyValue,
  resolveTrustProxyConfig,
};
