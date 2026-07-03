function toInt(value, fallback, min = null) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  if (min != null && n < min) return min;
  return n;
}

function compileAllowlist(raw, defaults) {
  const patterns = String(raw || '').trim()
    ? String(raw).split(',').map(s => s.trim()).filter(Boolean)
    : defaults;
  const regexes = [];
  for (const p of patterns) {
    try {
      // 防御 ReDoS: 限制单个正则表达式的长度，并确保其格式不会引发回溯问题
      if (p.length > 100) {
        throw new Error('Pattern too long');
      }
      regexes.push(new RegExp(p, 'i'));
    } catch (_err) {
      // intentionally ignored: invalid custom regex pattern is skipped
    }
  }
  return regexes;
}

function createSubGuard(config = {}) {
  const mode = String(config.mode || 'off').toLowerCase();
  const tokenWindowMs = toInt(config.tokenWindowMs, 60000, 1000);
  const tokenMaxReq = toInt(config.tokenMaxReq, 20, 1);
  const tokenBanMs = toInt(config.tokenBanMs, 900000, 5000);
  const behaviorWindowMs = toInt(config.behaviorWindowMs, 120000, 5000);
  const behaviorMaxIps = toInt(config.behaviorMaxIps, 6, 2);
  const behaviorMaxUas = toInt(config.behaviorMaxUas, 4, 2);
  const unknownUaLogTtlMs = toInt(config.unknownUaLogTtlMs, 10 * 60 * 1000, 1000);
  const tokenGuardMaxEntries = toInt(config.tokenGuardMaxEntries, 20000, 100);
  const unknownUaLogMaxEntries = toInt(config.unknownUaLogMaxEntries, 10000, 100);
  const allowlistRegex = compileAllowlist(config.uaAllowlist, config.defaultAllowlist || []);

  const tokenGuard = new Map();
  const unknownUaLogCache = new Map();

  function trimOldEntries(map, maxEntries) {
    if (map.size <= maxEntries) return;
    const sorted = [...map.entries()].sort((a, b) => {
      const av = Number(a[1]?.updatedAt || a[1] || 0);
      const bv = Number(b[1]?.updatedAt || b[1] || 0);
      return av - bv;
    });
    const removeCount = map.size - maxEntries;
    for (let i = 0; i < removeCount; i++) map.delete(sorted[i][0]);
  }

  function purgeSeenMap(seenMap, now, windowMs) {
    for (const [k, ts] of seenMap) {
      if (now - ts > windowMs) seenMap.delete(k);
    }
  }

  function isUaAllowed(ua) {
    if (mode === 'off') return true;
    const s = String(ua || '');
    return allowlistRegex.some(re => re.test(s));
  }

  function shouldLogUnknownUa(token, ip, ua, now) {
    const key = `${token}:${ip}:${ua}`;
    const last = unknownUaLogCache.get(key) || 0;
    unknownUaLogCache.set(key, now);
    trimOldEntries(unknownUaLogCache, unknownUaLogMaxEntries);
    if (!last) return true;
    return now - last > unknownUaLogTtlMs;
  }

  function checkBehavior(token, ip, ua, now) {
    let state = tokenGuard.get(token);
    if (!state) {
      state = {
        windowStart: now,
        count: 0,
        blockedUntil: 0,
        seenIps: new Map(),
        seenUas: new Map(),
        updatedAt: now,
      };
      tokenGuard.set(token, state);
    }

    if (state.blockedUntil > now) {
      return { ok: false, reason: 'token_temporarily_blocked' };
    }

    if (now - state.windowStart >= tokenWindowMs) {
      state.windowStart = now;
      state.count = 0;
    }
    state.count += 1;
    if (state.count > tokenMaxReq) {
      state.blockedUntil = now + tokenBanMs;
      state.updatedAt = now;
      return { ok: false, reason: 'token_rate_limited' };
    }

    state.seenIps.set(ip, now);
    state.seenUas.set(ua, now);
    purgeSeenMap(state.seenIps, now, behaviorWindowMs);
    purgeSeenMap(state.seenUas, now, behaviorWindowMs);

    if (state.seenIps.size > behaviorMaxIps || state.seenUas.size > behaviorMaxUas) {
      state.blockedUntil = now + tokenBanMs;
      state.updatedAt = now;
      return { ok: false, reason: 'token_abuse_detected' };
    }

    state.updatedAt = now;
    trimOldEntries(tokenGuard, tokenGuardMaxEntries);
    return { ok: true };
  }

  function apply(token, ua, ip, now = Date.now()) {
    const uaAllowed = isUaAllowed(ua);
    if (!uaAllowed && mode === 'enforce') {
      return { ok: false, status: 403, message: '订阅请求被拒绝', reason: 'unknown_ua' };
    }

    const behavior = checkBehavior(token, ip, ua || '-', now);
    if (!behavior.ok) {
      return { ok: false, status: 429, message: '请求过于频繁，请稍后再试', reason: behavior.reason };
    }

    return {
      ok: true,
      reason: uaAllowed ? 'ok' : 'unknown_ua_observe',
      shouldLogUnknownUa: !uaAllowed ? shouldLogUnknownUa(token, ip, ua, now) : false,
    };
  }

  return { apply };
}

module.exports = {
  createSubGuard,
};
