function normalizeIp(ip) {
  let raw = String(ip || '').trim();
  if (!raw) return '';

  // [IPv6]:port -> IPv6
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end > 1) raw = raw.slice(1, end);
  }

  // 去掉 IPv6 zone id（fe80::1%eth0）
  const zoneIdx = raw.indexOf('%');
  if (zoneIdx > 0) raw = raw.slice(0, zoneIdx);

  // 203.0.113.7:54321 -> 203.0.113.7
  const ipv4Port = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4Port) raw = ipv4Port[1];

  if (raw.startsWith('::ffff:')) return raw.slice(7);
  return raw;
}

function getFirstHeaderIp(headerValue) {
  if (!headerValue) return '';
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const first = String(raw).split(',')[0].trim();
  return normalizeIp(first);
}

function isPrivateOrLoopback(ip) {
  const normalized = normalizeIp(ip).toLowerCase();
  if (!normalized) return false;
  if (normalized === '::1') return true;
  if (normalized.startsWith('127.')) return true;
  if (normalized.startsWith('10.')) return true;
  if (normalized.startsWith('192.168.')) return true;
  // IPv4 link-local 169.254.0.0/16 — 含 AWS/GCP/Azure 元数据服务 169.254.169.254
  if (normalized.startsWith('169.254.')) return true;
  // CGNAT 100.64.0.0/10
  const cgnat = normalized.match(/^100\.(\d{1,3})\./);
  if (cgnat) {
    const second = parseInt(cgnat[1], 10);
    if (second >= 64 && second <= 127) return true;
  }
  // 0.0.0.0/8（包括 0.0.0.0 本身）
  if (normalized.startsWith('0.')) return true;
  const m = normalized.match(/^172\.(\d{1,3})\./);
  if (m) {
    const second = parseInt(m[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  // Unique local / link local IPv6
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) return true;
  // IPv6 unspecified ::、IPv4-mapped
  if (normalized === '::' || normalized === '::ffff:0:0') return true;
  return false;
}

function getForwardedIp(req) {
  const headers = req?.headers || {};
  return (
    getFirstHeaderIp(headers['cf-connecting-ip']) ||
    getFirstHeaderIp(headers['x-real-ip']) ||
    getFirstHeaderIp(headers['x-forwarded-for']) ||
    ''
  );
}

function getCloudflareClientIp(req) {
  const headers = req?.headers || {};
  const cfIp = getFirstHeaderIp(headers['cf-connecting-ip']);
  if (!cfIp) return '';
  // 仅在存在 Cloudflare 特征头时采用，降低直连伪造风险
  const hasCfSignal = Boolean(headers['cf-ray'] || headers['cf-worker'] || headers['cf-visitor']);
  return hasCfSignal ? cfIp : '';
}

function getClientIp(req) {
  const remote = normalizeIp(req?.connection?.remoteAddress || req?.socket?.remoteAddress || '');
  const cfClientIp = getCloudflareClientIp(req);
  const forwarded = getForwardedIp(req);

  // Express 场景：req.ip 已按 trust proxy 规则处理；若处于 Cloudflare 链路，优先记录真实客户端 IP
  const trustedExpressIp = normalizeIp(req?.ip || '');
  if (trustedExpressIp) {
    if (cfClientIp && cfClientIp !== trustedExpressIp) return cfClientIp;
    return trustedExpressIp;
  }

  // 原生 HTTP/WebSocket Upgrade 场景
  if (cfClientIp && (remote ? !isPrivateOrLoopback(remote) : true)) return cfClientIp;

  // 仅在本地/内网反代转发时采用转发头，避免公网直连伪造
  if (forwarded && isPrivateOrLoopback(remote)) return forwarded;
  return remote || forwarded || '';
}

function parseIpAllowlist(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map(v => normalizeIp(v))
    .filter(Boolean);
}

function isIpAllowed(ip, allowlist) {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  if (!Array.isArray(allowlist) || allowlist.length === 0) return true;
  return allowlist.includes(normalized);
}

module.exports = {
  getClientIp,
  normalizeIp,
  parseIpAllowlist,
  isIpAllowed,
  isPrivateOrLoopback,
};
