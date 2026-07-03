const crypto = require('crypto');
const logger = require('../services/logger');

// 启动时强制检查 SESSION_SECRET
if (!process.env.SESSION_SECRET) {
  logger.fatal('[FATAL] 环境变量 SESSION_SECRET 未设置，拒绝启动。请在 .env 中配置一个强随机密钥。');
  process.exit(1);
}

const ALGO = 'aes-256-gcm';
const LEGACY_SALT = 'vless-panel-salt';

function resolveKdfSalt(secret) {
  const configured = String(process.env.CRYPTO_KDF_SALT || '').trim();
  if (configured) return configured;
  // 默认使用部署级动态盐，避免固定盐导致跨实例可预计算。
  return crypto.createHash('sha256').update(`vless-panel-kdf:${secret}`).digest('hex');
}

const KEY = crypto.scryptSync(process.env.SESSION_SECRET, resolveKdfSalt(process.env.SESSION_SECRET), 32);
const LEGACY_KEY = crypto.scryptSync(process.env.SESSION_SECRET, LEGACY_SALT, 32);

function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + tag + ':' + encrypted;
}

function decrypt(data) {
  if (!data) return null;
  // 兼容未加密的旧数据（不含冒号分隔符）
  if (!data.includes(':')) return data;
  const [ivHex, tagHex, encrypted] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const tryKeys = [KEY];
  // 仅在 key 不同的情况下尝试 legacy key，避免重复解密。
  if (!KEY.equals(LEGACY_KEY)) tryKeys.push(LEGACY_KEY);

  for (const key of tryKeys) {
    try {
      const decipher = crypto.createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (_err) {
      // intentionally ignored: try next candidate key for backward compatibility
    }
  }
  logger.warn('[crypto] failed to decrypt data (no matching key found)');
  return null;
}

module.exports = { encrypt, decrypt };
