'use strict';

const crypto = require('crypto');

function generatePublicReference() {
  return `DQ-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
}

function normalizeZipCode(value) {
  const raw = String(value || '').trim().toUpperCase();
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 5) return digits.slice(0, 5);
  return raw.replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

function maskEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value.includes('@')) return '';
  const [local, domain] = value.split('@');
  const safeLocal = local ? `${local.slice(0, 1)}***` : '***';
  const parts = domain.split('.');
  const safeDomain = parts.length > 1
    ? `${parts[0].slice(0, 1)}***.${parts.slice(1).join('.')}`
    : `${domain.slice(0, 1)}***`;
  return `${safeLocal}@${safeDomain}`;
}

function generateLookupCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashLookupCode(challengeToken, code) {
  return crypto.createHash('sha256').update(`${challengeToken}:${String(code).trim()}`).digest('hex');
}

module.exports = {
  generateLookupCode,
  generatePublicReference,
  hashLookupCode,
  maskEmail,
  normalizeZipCode,
};
