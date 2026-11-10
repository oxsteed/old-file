'use strict';

// Security review F-08: irreversible self-service actions (account deletion)
// must prove the person at the keyboard still holds the account's
// credentials, not just a live session. A stolen 15-minute access token, an
// XSS on our origin or an impersonating admin otherwise had everything
// needed to delete and anonymize the account.
//
// The request body must carry:
//   - currentPassword, when the account has a password; and
//   - totpCode, when the account has TOTP enabled.
// An account with neither (for example passkey-only) must first set a
// password through the reset flow. Backup codes are deliberately not
// accepted (single-use recovery credentials, verified at login only).
// Impersonated sessions are refused before any credential is checked.
//
// Fails closed at every step.

const bcrypt = require('bcrypt');
const { authenticator } = require('@otplib/v12-adapter');
const pool = require('../db');
const { decrypt } = require('../utils/encryption');
const logger = require('../utils/logger');
const { isImpersonatedRequest } = require('./rejectImpersonated');

function hasUsablePassword(hash) {
  return typeof hash === 'string' && /^\$2[aby]\$\d{2}\$/.test(hash);
}

function readTotpCode(body) {
  const raw = body?.totpCode ?? body?.totp_code;
  const code = String(raw ?? '').replace(/[\s-]/g, '');
  return /^[0-9]{6,8}$/.test(code) ? code : null;
}

function deny(res, status, code, error) {
  return res.status(status).json({ error, code });
}

async function requireSensitiveReauth(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) return deny(res, 401, 'auth_required', 'Authentication required');
    if (isImpersonatedRequest(req)) {
      return deny(res, 403, 'impersonation_blocked', 'Impersonated sessions cannot perform this action.');
    }
    const { rows } = await pool.query(
      `SELECT password_hash, COALESCE(totp_enabled, FALSE) AS totp_enabled, totp_secret
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    const account = rows[0];
    if (!account) return deny(res, 401, 'auth_required', 'Authentication required');

    const passwordRequired = hasUsablePassword(account.password_hash);
    const totpRequired = account.totp_enabled === true && Boolean(account.totp_secret);
    if (!passwordRequired && !totpRequired) {
      return deny(res, 403, 'reauth_unavailable',
        'Set a password with "Forgot password" first, then confirm this action with it.');
    }

    const body = req.body || {};
    if (passwordRequired) {
      const password = typeof body.currentPassword === 'string' ? body.currentPassword : '';
      if (!password) return deny(res, 401, 'reauth_password_required', 'Enter your current password to confirm.');
      if (password.length > 1024 || !(await bcrypt.compare(password, account.password_hash))) {
        return deny(res, 401, 'reauth_invalid', 'Your password or verification code is incorrect.');
      }
    }
    if (totpRequired) {
      const code = readTotpCode(body);
      if (!code) return deny(res, 401, 'reauth_totp_required', 'Enter the code from your authenticator app to confirm.');
      let secret;
      try {
        secret = decrypt(account.totp_secret);
      } catch {
        return deny(res, 500, 'reauth_failed', 'Verification failed');
      }
      authenticator.options = { window: 1 };
      if (!authenticator.verify({ secret, token: code })) {
        return deny(res, 401, 'reauth_invalid', 'Your password or verification code is incorrect.');
      }
    }
    // Never let the credentials travel further down the chain.
    delete body.currentPassword;
    delete body.totpCode;
    delete body.totp_code;
    req.sensitiveReauthAt = new Date();
    return next();
  } catch (err) {
    logger.error('requireSensitiveReauth failed', { error: err.message });
    return deny(res, 500, 'reauth_failed', 'Verification failed');
  }
}

module.exports = { requireSensitiveReauth, hasUsablePassword };
