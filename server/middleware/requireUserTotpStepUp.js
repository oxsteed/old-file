'use strict';

// Audit fix (auth finding 20): changing where helper earnings are sent is
// the classic account-takeover payout-redirection vector. Payout-method
// create/update/delete require a fresh TOTP proof: the request body must
// carry `totp_code` (or `totpCode`), verified against the user's enrolled
// secret with the same otplib settings as login.
//
// Fail closed at every step: no authenticated user, no TOTP enrolled, no
// code, or a bad code all reject. Backup codes are deliberately NOT
// accepted here (single-use recovery credentials, verified at login only).
// A helper without TOTP enrolled must enroll 2FA before managing payout
// methods.

const { authenticator } = require('@otplib/v12-adapter');
const pool = require('../db');
const { decrypt } = require('../utils/encryption');

function extractTotpCode(req) {
  const body = req.body || {};
  const raw = body.totp_code ?? body.totpCode;
  const code = String(raw ?? '').replace(/[\s-]/g, '');
  return /^[0-9]{6,8}$/.test(code) ? code : null;
}

async function requireUserTotpStepUp(req, res, next) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required', code: 'auth_required' });
    }
    const { rows } = await pool.query(
      'SELECT totp_secret, totp_enabled FROM users WHERE id = $1',
      [userId]
    );
    if (!rows[0] || !rows[0].totp_enabled || !rows[0].totp_secret) {
      return res.status(403).json({
        error: 'Changing payout methods requires two-factor authentication. Enroll TOTP first, then retry with a fresh code.',
        code: 'totp_stepup_required',
      });
    }
    const code = extractTotpCode(req);
    if (!code) {
      return res.status(403).json({
        error: 'A fresh TOTP code is required to change payout methods.',
        code: 'totp_stepup_required',
      });
    }
    let secret;
    try {
      secret = decrypt(rows[0].totp_secret);
    } catch {
      return res.status(500).json({ error: 'Step-up check failed' });
    }
    authenticator.options = { window: 1 };
    const verified = authenticator.verify({ secret, token: code });
    if (!verified) {
      return res.status(403).json({
        error: 'Invalid TOTP code.',
        code: 'totp_stepup_invalid',
      });
    }
    return next();
  } catch (err) {
    return res.status(500).json({ error: 'Step-up check failed' });
  }
}

module.exports = { requireUserTotpStepUp };
