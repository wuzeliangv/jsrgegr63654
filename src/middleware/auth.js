const db = require('../services/database');
const logger = require('../services/logger');

function setupAuth(app) {
  // 使用 express-session 的手动序列化/反序列化
  app.use((req, res, next) => {
    if (req.session?.userId) {
      const user = db.getUserById(req.session.userId);
      if (user) {
        req.user = user;
        req.isAuthenticated = () => true;
      } else {
        delete req.session.userId;
        req.isAuthenticated = () => false;
      }
    } else {
      req.isAuthenticated = () => false;
    }
    // 兼容原有的 logIn/logOut 接口
    // 登录时 regenerate session ID，防止 Session Fixation 攻击
    req.logIn = (user, cb) => {
      req.session.regenerate((err) => {
        if (err) { if (typeof cb === 'function') cb(err); return; }
        req.session.userId = user.id;
        req.user = user;
        req.isAuthenticated = () => true;
        // regenerate 后必须 save 才能持久化
        req.session.save((saveErr) => {
          if (typeof cb === 'function') cb(saveErr || null);
        });
      });
    };
    // 登出时销毁整个 session（清除 store 中的会话和 CSRF token）
    req.logout = (cb) => {
      req.user = null;
      req.isAuthenticated = () => false;
      req.session.destroy((err) => {
        if (typeof cb === 'function') cb(err || null);
      });
    };
    next();
  });
}

// 用户活跃时间更新缓存（节流5分钟，避免频繁写库）
const _lastActiveCache = new Map();
const LAST_ACTIVE_CACHE_TTL_MS = 30 * 60 * 1000;
const LAST_ACTIVE_CACHE_MAX_ENTRIES = 50000;

let lastCleanup = 0;
function cleanupLastActiveCache(now = Date.now()) {
  if (now - lastCleanup < 60000) return;
  lastCleanup = now;
  for (const [uid, ts] of _lastActiveCache) {
    if (now - ts > LAST_ACTIVE_CACHE_TTL_MS) _lastActiveCache.delete(uid);
  }
  if (_lastActiveCache.size <= LAST_ACTIVE_CACHE_MAX_ENTRIES) return;
  const sorted = [..._lastActiveCache.entries()].sort((a, b) => a[1] - b[1]);
  const removeCount = _lastActiveCache.size - LAST_ACTIVE_CACHE_MAX_ENTRIES;
  for (let i = 0; i < removeCount; i++) {
    _lastActiveCache.delete(sorted[i][0]);
  }
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated() && !req.user.is_blocked) {
    const userId = req.user.id;
    const now = Date.now();
    cleanupLastActiveCache(now);
    const last = _lastActiveCache.get(userId) || 0;
    if (now - last > 5 * 60 * 1000) {
      _lastActiveCache.set(userId, now);
      try {
        db.getDb().prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(userId);
      } catch (err) {
        logger.debug({ err, userId }, '更新用户最后活跃时间失败，已忽略');
      }
    }
    return next();
  }
  res.redirect('/auth/login');
}

function requireAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user && !req.user.is_blocked && req.user.is_admin) return next();
  res.status(403).json({ error: '需要管理员权限' });
}

module.exports = { setupAuth, requireAuth, requireAdmin };
