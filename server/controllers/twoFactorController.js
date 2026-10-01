// Two-Factor Authentication Controller (TOTP)
// OxSteed v2
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { authenticator } = require('@otplib/v12-adapter');
const bcrypt = require('bcrypt');
const QRCode = require('qrcode');
const pool = require('../db');
const { encrypt, decrypt, hashIP } = require('../utils/encryption');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');

const JWT_SECRET = process.env.JWT_SECRET;
const MAX_2FA_FAILURES = 5;
const LOCKOUT_WINDOW = '15 minutes';

const APP_NAME = 'OxSteed';
const BACKUP_CODE_COUNT = 8;
const SALT_ROUNDS = 10;

// Generate backup codes (8 random 8-char hex codes)
function generateBackupCodes() {
  const codes = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    codes.push(crypto.randomBytes(4).toString('hex'));
  }
  return codes;
}

// Hash a backup code for storage
async function hashCode(code) {
  return bcrypt.hash(code.toLowerCase().trim(), SALT_ROUNDS);
}

// Log 2FA action for audit trail
async function log2FAAction(userId, action, req, success) {
  try {
    const rawIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const ip = hashIP(rawIp);
    const ua = req.headers['user-agent'] || '';
    await pool.query(
      'INSERT INTO two_factor_audit_log (user_id, action, ip_address, user_agent, success) VALUES ($1, $2, $3, $4, $5)',
      [userId, action, ip, ua, success]
    );
  } catch (err) {
    logger.error('2FA audit log error:', { err: err.message });
  }
}

// POST /api/2fa/setup - Generate TOTP secret + QR code
async function setup2FA(req, res, next) {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query('SELECT email, totp_enabled FROM users WHERE id = $1', [userId]);
    if (!rows[0]) {
      throw new AppError('User not found', 404, 'not_found');
    }
    if (rows[0].totp_enabled) {
      throw new AppError('2FA is already enabled. Disable it first to reconfigure.', 400, 'invalid_state');
    }

    const secretKey = authenticator.generateSecret(32);
    const otpauthUrl = authenticator.keyuri(rows[0].email, APP_NAME, secretKey);

    // Store secret temporarily (not yet verified)
    await pool.query(
      'UPDATE users SET totp_secret = $1, totp_enabled = false WHERE id = $2',
      [encrypt(secretKey), userId]
    );

    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

    await log2FAAction(userId, 'setup_initiated', req, true);

    res.json({
      secret: secretKey,
      qrCode: qrCodeUrl,
      message: 'Scan the QR code with your authenticator app, then verify with a code.'
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/2fa/verify-setup - Confirm TOTP setup with a code from the app
async function verifySetup(req, res, next) {
  try {
    const userId = req.user.id;
    const { token } = req.body;
    if (!token) {
      throw new AppError('Verification code required', 400, 'validation_failed', { token: 'Verification code is required' });
    }

    const { rows } = await pool.query('SELECT totp_secret, totp_enabled FROM users WHERE id = $1', [userId]);
    if (!rows[0] || !rows[0].totp_secret) {
      throw new AppError('No 2FA setup in progress. Call /api/2fa/setup first.', 400, 'invalid_state');
    }
    if (rows[0].totp_enabled) {
      throw new AppError('2FA is already enabled.', 400, 'invalid_state');
    }

    const decryptedSecret = decrypt(rows[0].totp_secret);

    // otplib options window config
    authenticator.options = { window: 1 };
    const verified = authenticator.verify({
      secret: decryptedSecret,
      token: token
    });

    if (!verified) {
      await log2FAAction(userId, 'setup_verify_failed', req, false);
      throw new AppError('Invalid verification code. Try again.', 400, 'validation_failed', { token: 'Invalid verification code' });
    }

    // Generate backup codes
    const backupCodes = generateBackupCodes();
    const hashedCodes = await Promise.all(backupCodes.map(c => hashCode(c)));

    await pool.query(
      'UPDATE users SET totp_enabled = true, totp_verified_at = NOW(), backup_codes = $1 WHERE id = $2',
      [hashedCodes, userId]
    );

    await log2FAAction(userId, 'setup_completed', req, true);

    res.json({
      message: '2FA enabled successfully.',
      backupCodes: backupCodes,
      warning: 'Save these backup codes in a safe place. They will not be shown again.'
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/2fa/validate - Validate a TOTP code during login
//
// H11 fix: this endpoint previously accepted an arbitrary `userId` with no
// authentication, letting anyone brute-force TOTP/backup codes for any
// account. It now requires the short-lived pre-auth `mfaToken` issued by
// POST /api/auth/login (same contract as POST /api/auth/login/2fa), and
// enforces the same 5-failures/15-minute lockout.
async function validate2FA(req, res, next) {
  try {
    const mfaToken = req.body.mfaToken || req.body.mfa_token;
    const { token, isBackupCode } = req.body;
    if (!mfaToken) {
      throw new AppError('MFA token required', 401, 'mfa_token_required');
    }
    if (!token) {
      throw new AppError('Verification code required', 400, 'validation_failed', { token: 'Verification code is required' });
    }

    let userId;
    try {
      const decoded = jwt.verify(mfaToken, JWT_SECRET, { algorithms: ['HS256'] });
      if (!decoded.isMfaToken) throw new Error('Invalid token type');
      userId = decoded.id;
    } catch (err) {
      throw new AppError('Invalid or expired MFA token', 401, 'invalid_mfa_token');
    }

    // The caller must not be able to substitute a different userId.
    if (req.body.userId && String(req.body.userId) !== String(userId)) {
      throw new AppError('User ID does not match the MFA session', 400, 'validation_failed');
    }

    // 5 failures in 15 minutes locks the endpoint, mirroring /auth/login/2fa.
    const { rows: auditRows } = await pool.query(
      `SELECT COUNT(*) FROM two_factor_audit_log
       WHERE user_id = $1 AND success = false
       AND created_at > NOW() - INTERVAL '15 minutes'`,
      [userId]
    );
    if (parseInt(auditRows[0].count, 10) >= MAX_2FA_FAILURES) {
      throw new AppError('Too many failed 2FA attempts. Please try again in 15 minutes.', 429, 'too_many_attempts');
    }

    const { rows } = await pool.query(
      'SELECT totp_secret, totp_enabled, backup_codes FROM users WHERE id = $1',
      [userId]
    );
    if (!rows[0] || !rows[0].totp_enabled) {
      throw new AppError('2FA is not enabled for this account', 400, 'invalid_state');
    }

    // Try backup code first if flagged
    if (isBackupCode) {
      let matchedIndex = -1;
      const codes = rows[0].backup_codes || [];
      for (let i = 0; i < codes.length; i++) {
        if (await bcrypt.compare(token.toLowerCase().trim(), codes[i])) {
          matchedIndex = i;
          break;
        }
      }
      if (matchedIndex === -1) {
        await log2FAAction(userId, 'backup_code_failed', req, false);
        throw new AppError('Invalid backup code', 400, 'validation_failed', { token: 'Invalid backup code' });
      }
      // Remove used backup code
      codes.splice(matchedIndex, 1);
      await pool.query('UPDATE users SET backup_codes = $1 WHERE id = $2', [codes, userId]);
      await log2FAAction(userId, 'backup_code_used', req, true);
      return res.json({ valid: true, remainingBackupCodes: codes.length });
    }

    // Verify TOTP
    const decryptedSecret = decrypt(rows[0].totp_secret);
    authenticator.options = { window: 1 };
    const verified = authenticator.verify({
      secret: decryptedSecret,
      token: token
    });

    if (!verified) {
      await log2FAAction(userId, 'totp_verify_failed', req, false);
      throw new AppError('Invalid verification code', 400, 'validation_failed', { token: 'Invalid verification code' });
    }

    await log2FAAction(userId, 'totp_verify_success', req, true);
    res.json({ valid: true });
  } catch (err) {
    next(err);
  }
}

// POST /api/2fa/disable - Disable 2FA (requires current TOTP code)
async function disable2FA(req, res, next) {
  try {
    const userId = req.user.id;
    const { token } = req.body;
    if (!token) {
      throw new AppError('Current 2FA code required to disable', 400, 'validation_failed', { token: 'Current 2FA code is required' });
    }

    const { rows } = await pool.query(
      'SELECT totp_secret, totp_enabled FROM users WHERE id = $1', [userId]
    );
    if (!rows[0] || !rows[0].totp_enabled) {
      throw new AppError('2FA is not currently enabled', 400, 'invalid_state');
    }

    const decryptedSecret = decrypt(rows[0].totp_secret);
    authenticator.options = { window: 1 };
    const verified = authenticator.verify({
      secret: decryptedSecret,
      token: token
    });

    if (!verified) {
      await log2FAAction(userId, 'disable_failed', req, false);
      throw new AppError('Invalid verification code', 400, 'validation_failed', { token: 'Invalid verification code' });
    }

    await pool.query(
      'UPDATE users SET totp_secret = NULL, totp_enabled = false, totp_verified_at = NULL, backup_codes = NULL WHERE id = $1',
      [userId]
    );

    await log2FAAction(userId, 'disabled', req, true);
    res.json({ message: '2FA has been disabled.' });
  } catch (err) {
    next(err);
  }
}

// GET /api/2fa/status - Check if 2FA is enabled
async function get2FAStatus(req, res, next) {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      'SELECT totp_enabled, totp_verified_at, COALESCE(array_length(backup_codes, 1), 0) as backup_count FROM users WHERE id = $1',
      [userId]
    );
    if (!rows[0]) {
      throw new AppError('User not found', 404, 'not_found');
    }
    res.json({
      enabled: rows[0].totp_enabled,
      verifiedAt: rows[0].totp_verified_at,
      backupCodesRemaining: rows[0].backup_count
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/2fa/regenerate-backup - Generate new backup codes (requires TOTP)
async function regenerateBackupCodes(req, res, next) {
  try {
    const userId = req.user.id;
    const { token } = req.body;
    if (!token) {
      throw new AppError('Current 2FA code required', 400, 'validation_failed', { token: 'Current 2FA code is required' });
    }

    const { rows } = await pool.query(
      'SELECT totp_secret, totp_enabled FROM users WHERE id = $1', [userId]
    );
    if (!rows[0] || !rows[0].totp_enabled) {
      throw new AppError('2FA is not enabled', 400, 'invalid_state');
    }

    const decryptedSecret = decrypt(rows[0].totp_secret);
    authenticator.options = { window: 1 };
    const verified = authenticator.verify({
      secret: decryptedSecret,
      token: token
    });

    if (!verified) {
      await log2FAAction(userId, 'regenerate_backup_failed', req, false);
      throw new AppError('Invalid verification code', 400, 'validation_failed', { token: 'Invalid verification code' });
    }

    const backupCodes = generateBackupCodes();
    const hashedCodes = await Promise.all(backupCodes.map(c => hashCode(c)));

    await pool.query('UPDATE users SET backup_codes = $1 WHERE id = $2', [hashedCodes, userId]);
    await log2FAAction(userId, 'backup_codes_regenerated', req, true);

    res.json({
      backupCodes: backupCodes,
      warning: 'Previous backup codes are now invalid. Save these new codes securely.'
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  setup2FA,
  verifySetup,
  validate2FA,
  disable2FA,
  get2FAStatus,
  regenerateBackupCodes
};
