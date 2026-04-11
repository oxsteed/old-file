// Phase 2 — Encryption utility for W-9 TIN storage
// OxSteed v2
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 64;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

// Validate ENCRYPTION_KEY at startup so a missing key fails fast
// before any user request can reach encrypt() or decrypt().
if (!process.env.ENCRYPTION_KEY) {
  console.error('FATAL: ENCRYPTION_KEY env variable is not set. Encryption features will not work.');
}

function getKey() {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error('ENCRYPTION_KEY env variable is required');
  const key = Buffer.from(secret, 'hex');
  // AES-256 requires exactly 32 bytes (64 hex chars)
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `ENCRYPTION_KEY must be ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes). ` +
      `Got ${key.length} bytes. Generate with: openssl rand -hex ${KEY_LENGTH}`
    );
  }
  return key;
}

function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
}

function decrypt(ciphertext) {
  const key = getKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid ciphertext format');
  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function hashTIN(tin) {
  const key = getKey();
  return crypto.createHmac('sha256', key).update(tin).digest('hex');
}

function maskTIN(tin) {
  if (!tin || tin.length < 4) return '***';
  return '***-**-' + tin.slice(-4);
}

function hashIP(ipStr) {
  if (!ipStr) return null;
  // Normalize IPv6-mapped IPv4 addresses (::ffff:1.2.3.4 → 1.2.3.4) for consistent hashing
  const normalized = ipStr.replace(/^::ffff:/i, '');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

module.exports = { encrypt, decrypt, hashTIN, maskTIN, hashIP };
