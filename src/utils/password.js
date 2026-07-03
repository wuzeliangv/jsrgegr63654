const crypto = require('crypto');

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 2;
const KEYLEN = 64;

function hashPassword(password) {
  const plain = String(password || '');
  if (!plain) return null;
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived.toString('hex')}`;
}

function verifyPassword(password, encoded) {
  const raw = String(encoded || '');
  if (!raw.startsWith('scrypt$')) return false;
  const parts = raw.split('$');
  if (parts.length !== 6) return false;
  const N = parseInt(parts[1], 10);
  const r = parseInt(parts[2], 10);
  const p = parseInt(parts[3], 10);
  const salt = parts[4];
  const expectedHex = parts[5];
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  if (N < 1 || N > 1048576 || r < 1 || r > 16 || p < 1 || p > 4) return false;
  if (!salt || !expectedHex) return false;

  const expected = Buffer.from(expectedHex, 'hex');
  const actual = crypto.scryptSync(String(password || ''), salt, expected.length, { N, r, p, maxmem: 128 * 1024 * 1024 });
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

module.exports = {
  hashPassword,
  verifyPassword,
};
