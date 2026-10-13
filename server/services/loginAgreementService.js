'use strict';

// Review P1-113: the per-login digital signature and consent records, shared
// by password login and passkey login so both leave the same legal trail.
const pool = require('../db');
const logger = require('../utils/logger');
const { hashIP } = require('../utils/encryption');
const { TERMS_CONFIG } = require('../constants/termsConfig');
const { AppError } = require('../middleware/errorHandler');

const NAME_WORD = /^[A-Za-zÀ-ÖØ-öø-ÿ''-]+$/;
const normalizeName = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();

function isValidSignatureName(agreementName) {
  const trimmed = String(agreementName || '').trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  return trimmed.length >= 5 && words.length >= 2 && words.every((w) => NAME_WORD.test(w));
}

// Throws the same AppErrors as password login.
function assertLoginAgreement({ termsAgreed, agreementName }, user) {
  if (!termsAgreed) {
    throw new AppError('You must agree to the Terms of Service and Privacy Policy to sign in', 400, 'validation_failed', { termsAgreed: 'Required' });
  }
  if (!isValidSignatureName(agreementName)) {
    throw new AppError('Please enter your full name (first and last name) as your digital signature', 400, 'validation_failed',
      { agreementName: 'Full name required (first and last name)' });
  }
  if (user) {
    const accountName = normalizeName(`${user.first_name} ${user.last_name}`);
    if (!accountName || normalizeName(agreementName) !== accountName) {
      throw new AppError('The name you entered does not match the name on your account. Please use your full name exactly as registered.',
        400, 'signature_name_mismatch', { agreementName: 'Name does not match account' });
    }
  }
}

function requestIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || req.ip || null;
}

// Non-fatal, like the original inline code in login().
async function recordLoginAgreement(req, user, agreementName, db = pool) {
  const ip = requestIp(req);
  const ua = req.headers['user-agent'] || null;
  try {
    await db.query(
      `INSERT INTO login_agreements (user_id, full_name, ip_address, user_agent) VALUES ($1, $2, $3, $4)`,
      [user.id, String(agreementName).trim(), ip, ua]
    );
  } catch (err) {
    logger.warn('Failed to record login agreement', { userId: user.id, error: err.message });
  }
  try {
    const ipHash = hashIP(ip);
    for (const type of ['terms_of_service', 'privacy_policy']) {
      const version = TERMS_CONFIG[type]?.version;
      if (!version) continue;
      await db.query(
        `INSERT INTO user_consents (user_id, consent_type, version, ip_hash, user_agent) VALUES ($1, $2, $3, $4, $5)`,
        [user.id, type, version, ipHash, ua]
      );
    }
  } catch (err) {
    logger.warn('Failed to record login consent', { userId: user.id, error: err.message });
  }
}

module.exports = { isValidSignatureName, assertLoginAgreement, recordLoginAgreement };
