import crypto from 'node:crypto';

export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// Sessions are stored by the hash of their token, so a leaked database cannot be used to log in.
export function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(secret), salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifySecret(secret, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(String(secret), Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Allows a few attempts per key in a time window; used to slow down password guessing.
export function createLimiter({ max = 5, windowMs = 15 * 60 * 1000 } = {}) {
  const hits = new Map();
  return {
    blocked(key) {
      const h = hits.get(key);
      if (!h) return false;
      if (Date.now() > h.resetAt) {
        hits.delete(key);
        return false;
      }
      return h.count >= max;
    },
    fail(key) {
      const h = hits.get(key);
      if (!h || Date.now() > h.resetAt) hits.set(key, { count: 1, resetAt: Date.now() + windowMs });
      else h.count += 1;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
