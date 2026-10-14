'use strict';

/**
 * ADM-126 — webhook/integration secret handling for support admin settings.
 *
 * Webhook URLs are bearer <redacted>: anyone holding one can post into the
 * business's Slack/Zapier. They must never sit in plaintext at rest and must
 * never be returned in full by the settings API (which business admins, not
 * just super admins, can read).
 *
 * Contract:
 *  - `prepareSecretFieldsForWrite(section)`: before persisting the
 *    integrations section, encrypts non-empty secret values with the app
 *    AES-256-GCM key (`server/utils/encryption.js`), stored as
 *    `enc:v1:<ciphertext>`. Values that still carry the masked placeholder
 *    returned by GET are dropped from the write so the stored secret
 *    survives a round-trip; an explicit empty string clears the secret.
 *  - `maskSecretsForRead(section)`: returns a copy of the section with every
 *    secret field replaced by `••••••••` + last 4 chars, so the UI can show
 *    "configured" without exposing the bearer <redacted> Legacy plaintext
 *    values (stored before this change) are masked the same way.
 */

const { encrypt, decrypt } = require('./encryption');
const logger = require('./logger');

const ENC_MARKER = 'enc:v1:';
const MASK_PREFIX = '••••••••';

const SECRET_FIELD_PATTERNS = [/secret/i, /token/i, /webhook/i, /api[_-]?key/i];

function isSecretField(name) {
  return typeof name === 'string' && SECRET_FIELD_PATTERNS.some((re) => re.test(name));
}

/** True when the value is the masked placeholder GET returns (round-trip). */
function isMaskedPlaceholder(value) {
  return typeof value === 'string' && value.startsWith('•');
}

function isEncryptedValue(value) {
  return typeof value === 'string' && value.startsWith(ENC_MARKER);
}

function maskPlaintext(plaintext) {
  const s = String(plaintext == null ? '' : plaintext);
  return MASK_PREFIX + s.slice(-4);
}

/**
 * Decrypt a stored secret for masking purposes. Returns the plaintext, or
 * null when the value cannot be decrypted (wrong/missing key). Legacy
 * plaintext values are returned as-is so they can still be masked.
 */
function revealForMasking(stored) {
  if (typeof stored !== 'string' || !stored) return '';
  if (!isEncryptedValue(stored)) return stored; // legacy plaintext
  try {
    return decrypt(stored.slice(ENC_MARKER.length));
  } catch (err) {
    logger.warn('support settings secret could not be decrypted for masking', {
      error: err.message,
    });
    return null;
  }
}

function maskStoredSecret(stored) {
  const revealed = revealForMasking(stored);
  if (revealed === null) return MASK_PREFIX; // undecryptable: hide everything
  return maskPlaintext(revealed);
}

/**
 * Rewrite an integrations settings section for persistence:
 *  - masked placeholder  -> key removed (existing stored secret is kept)
 *  - empty/blank         -> key kept as '' (explicit clear)
 *  - new value           -> AES-256-GCM encrypted with enc:v1: marker
 * Non-secret fields pass through untouched.
 */
function prepareSecretFieldsForWrite(section) {
  const out = { ...(section || {}) };
  for (const key of Object.keys(out)) {
    if (!isSecretField(key)) continue;
    const value = out[key];
    if (isMaskedPlaceholder(value)) {
      delete out[key]; // round-tripped mask: preserve the stored secret
      continue;
    }
    if (typeof value === 'string' && value.trim() === '') continue; // explicit clear
    if (value === null || value === undefined) continue;
    out[key] = ENC_MARKER + encrypt(String(value));
  }
  return out;
}

/** Copy a settings section with secret values replaced by masked display. */
function maskSecretsForRead(section) {
  const out = { ...(section || {}) };
  for (const key of Object.keys(out)) {
    if (!isSecretField(key)) continue;
    out[key] = maskStoredSecret(out[key]);
  }
  return out;
}

module.exports = {
  ENC_MARKER,
  isSecretField,
  isMaskedPlaceholder,
  prepareSecretFieldsForWrite,
  maskSecretsForRead,
  maskStoredSecret,
};
