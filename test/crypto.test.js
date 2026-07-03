const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const cryptoPath = require.resolve('../src/utils/crypto');
const ALGO = 'aes-256-gcm';
const LEGACY_SALT = 'vless-panel-salt';

function loadCryptoWithEnv(env) {
  const prev = {
    SESSION_SECRET: process.env.SESSION_SECRET,
    CRYPTO_KDF_SALT: process.env.CRYPTO_KDF_SALT,
  };
  process.env.SESSION_SECRET = env.SESSION_SECRET;
  if (env.CRYPTO_KDF_SALT == null) delete process.env.CRYPTO_KDF_SALT;
  else process.env.CRYPTO_KDF_SALT = env.CRYPTO_KDF_SALT;
  delete require.cache[cryptoPath];
  const mod = require('../src/utils/crypto');
  return { mod, restore: () => {
    if (prev.SESSION_SECRET == null) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = prev.SESSION_SECRET;
    if (prev.CRYPTO_KDF_SALT == null) delete process.env.CRYPTO_KDF_SALT;
    else process.env.CRYPTO_KDF_SALT = prev.CRYPTO_KDF_SALT;
    delete require.cache[cryptoPath];
  } };
}

function encryptWithKey(key, plain) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let encrypted = cipher.update(plain, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

test('crypto encrypt/decrypt works with deployment-specific derived salt', () => {
  const { mod, restore } = loadCryptoWithEnv({ SESSION_SECRET: 'test-secret-1', CRYPTO_KDF_SALT: null });
  try {
    const encrypted = mod.encrypt('hello');
    assert.ok(encrypted.includes(':'));
    assert.equal(mod.decrypt(encrypted), 'hello');
  } finally {
    restore();
  }
});

test('crypto decrypt keeps backward compatibility with legacy fixed salt data', () => {
  const { mod, restore } = loadCryptoWithEnv({ SESSION_SECRET: 'test-secret-2', CRYPTO_KDF_SALT: 'new-random-salt' });
  try {
    const legacyKey = crypto.scryptSync(process.env.SESSION_SECRET, LEGACY_SALT, 32);
    const legacyEncrypted = encryptWithKey(legacyKey, 'legacy-value');
    assert.equal(mod.decrypt(legacyEncrypted), 'legacy-value');
  } finally {
    restore();
  }
});
