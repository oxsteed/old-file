// Two-Factor Authentication Controller (TOTP)
// OxSteed v2 — speakeasy replaced with otplib (actively maintained)
const crypto        = require('crypto');
const { authenticator } = require('otplib');
const QRCode        = require('qrcode');
const pool          = require('../db');
const logger        = require('../utils/logger');

const APP_NAME         = 'OxSteed';
const BACKUP_CODE_COUNT = 8;

// Allow 1 time-step tolerance (30s before/after)
authenticator.options = { window: 1 };

// Generate backup codes (8 random 8-char hex codes)
function generateBackupCodes() {
  const codes = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    codes.push(crypto.randomBytes(4).toString('hex'));
  }
  return codes;
}

// HMAC-SHA256 with JWT_SECRET — resistant to rainbow tables
function hashCode(code) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(code.toLowerCase().trim())
    .digest('hex');
}

// Log 2FA action for audit trail
async function log2FAAction(userId, action, req, success) {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const ua = req.headers['user-agent'] || '';
    await pool.query(
      'INSERT INTO two_factor_audit_log (user_id, action, ip_address, user_agent, success) VALUES ($1, $2, $3, $4, $5)',
      [userId, action, ip, ua, success]
    );
  } catch (err) {
    logger.error('2FA audit log error', { message: err.message });
  }
}

// POST /api/2fa/setup — Generate TOTP secret + QR code
async function setup2FA(req, res) {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query('SELECT email, totp_enabled FROM users WHERE id = $1', [userId]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    if (rows[0].totp_enabled) {
      return res.status(400).json({ error: '2FA is already enabled. Disable it first to reconfigure.' });
    }

    const secret      = authenticator.generateSecret(20);
    const otpauthUrl  = authenticator.keyuri(rows[0].email, APP_NAME, secret);

    // Store secret temporarily (not yet verified)
    await pool.query(
      'UPDATE users SET totp_secret = $1, totp_enabled = false WHERE id = $2',
      [secret, userId]
    );

    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

    await log2FAAction(userId, 'setup_initiated', req, true);

    res.json({
      secret:  secret,
      qrCode:  qrCodeUrl,
      message: 'Scan the QR code with your authenticator app, then verify with a code.',
    });
  } catch (err) {
    logger.error('2FA setup error', { err });
    res.status(500).json({ error: 'Failed to setup 2FA' });
  }
}

// POST /api/2fa/verify-setup — Confirm TOTP setup with a code from the app
async function verifySetup(req, res) {
  try {
    const userId = req.user.id;
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Verification code required' });

    const { rows } = await pool.query('SELECT totp_secret, totp_enabled FROM users WHERE id = $1', [userId]);
    if (!rows[0] || !rows[0].totp_secret) {
      return res.status(400).json({ error: 'No 2FA setup in progress. Call /api/2fa/setup first.' });
    }
    if (rows[0].totp_enabled) {
      return res.status(400).json({ error: '2FA is already enabled.' });
    }

    const verified = authenticator.verify({ token, secret: rows[0].totp_secret });

    if (!verified) {
      await log2FAAction(userId, 'setup_verify_failed', req, false);
      return res.status(400).json({ error: 'Invalid verification code. Try again.' });
    }

    // Generate backup codes
    const backupCodes  = generateBackupCodes();
    const hashedCodes  = backupCodes.map(c => hashCode(c));

    await pool.query(
      'UPDATE users SET totp_enabled = true, totp_verified_at = NOW(), backup_codes = $1 WHERE id = $2',
      [hashedCodes, userId]
    );

    await log2FAAction(userId, 'setup_completed', req, true);

    res.json({
      message:     '2FA enabled successfully.',
      backupCodes: backupCodes,
      warning:     'Save these backup codes in a safe place. They will not be shown again.',
    });
  } catch (err) {
    logger.error('2FA verify setup error', { err });
    res.status(500).json({ error: 'Failed to verify 2FA setup' });
  }
}

// POST /api/2fa/validate — Validate a TOTP code during login
async function validate2FA(req, res) {
  try {
    const { userId, token, isBackupCode } = req.body;
    if (!userId || !token) {
      return res.status(400).json({ error: 'User ID and verification code required' });
    }

    const { rows } = await pool.query(
      'SELECT totp_secret, totp_enabled, backup_codes FROM users WHERE id = $1',
      [userId]
    );
    if (!rows[0] || !rows[0].totp_enabled) {
      return res.status(400).json({ error: '2FA is not enabled for this account' });
    }

    if (isBackupCode) {
      const hashedInput = hashCode(token);
      const codes       = rows[0].backup_codes || [];
      const codeIndex   = codes.indexOf(hashedInput);
      if (codeIndex === -1) {
        await log2FAAction(userId, 'backup_code_failed', req, false);
        return res.status(400).json({ error: 'Invalid backup code' });
      }
      codes.splice(codeIndex, 1);
      await pool.query('UPDATE users SET backup_codes = $1 WHERE id = $2', [codes, userId]);
      await log2FAAction(userId, 'backup_code_used', req, true);
      return res.json({ valid: true, remainingBackupCodes: codes.length });
    }

    const verified = authenticator.verify({ token, secret: rows[0].totp_secret });

    if (!verified) {
      await log2FAAction(userId, 'totp_verify_failed', req, false);
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    await log2FAAction(userId, 'totp_verify_success', req, true);
    res.json({ valid: true });
  } catch (err) {
    logger.error('2FA validate error', { err });
    res.status(500).json({ error: 'Failed to validate 2FA' });
  }
}

// POST /api/2fa/disable — Disable 2FA (requires current TOTP code)
async function disable2FA(req, res) {
  try {
    const userId = req.user.id;
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Current 2FA code required to disable' });

    const { rows } = await pool.query(
      'SELECT totp_secret, totp_enabled FROM users WHERE id = $1', [userId]
    );
    if (!rows[0] || !rows[0].totp_enabled) {
      return res.status(400).json({ error: '2FA is not currently enabled' });
    }

    const verified = authenticator.verify({ token, secret: rows[0].totp_secret });

    if (!verified) {
      await log2FAAction(userId, 'disable_failed', req, false);
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    await pool.query(
      'UPDATE users SET totp_secret = NULL, totp_enabled = false, totp_verified_at = NULL, backup_codes = NULL WHERE id = $1',
      [userId]
    );

    await log2FAAction(userId, 'disabled', req, true);
    res.json({ message: '2FA has been disabled.' });
  } catch (err) {
    logger.error('2FA disable error', { err });
    res.status(500).json({ error: 'Failed to disable 2FA' });
  }
}

// GET /api/2fa/status — Check if 2FA is enabled
async function get2FAStatus(req, res) {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      'SELECT totp_enabled, totp_verified_at, COALESCE(array_length(backup_codes, 1), 0) as backup_count FROM users WHERE id = $1',
      [userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({
      enabled:               rows[0].totp_enabled,
      verifiedAt:            rows[0].totp_verified_at,
      backupCodesRemaining:  rows[0].backup_count,
    });
  } catch (err) {
    logger.error('2FA status error', { err });
    res.status(500).json({ error: 'Failed to get 2FA status' });
  }
}

// POST /api/2fa/regenerate-backup — Generate new backup codes (requires TOTP)
async function regenerateBackupCodes(req, res) {
  try {
    const userId = req.user.id;
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Current 2FA code required' });

    const { rows } = await pool.query(
      'SELECT totp_secret, totp_enabled FROM users WHERE id = $1', [userId]
    );
    if (!rows[0] || !rows[0].totp_enabled) {
      return res.status(400).json({ error: '2FA is not enabled' });
    }

    const verified = authenticator.verify({ token, secret: rows[0].totp_secret });

    if (!verified) {
      await log2FAAction(userId, 'regenerate_backup_failed', req, false);
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    const backupCodes = generateBackupCodes();
    const hashedCodes = backupCodes.map(c => hashCode(c));

    await pool.query('UPDATE users SET backup_codes = $1 WHERE id = $2', [hashedCodes, userId]);
    await log2FAAction(userId, 'backup_codes_regenerated', req, true);

    res.json({
      backupCodes: backupCodes,
      warning:     'Previous backup codes are now invalid. Save these new codes securely.',
    });
  } catch (err) {
    logger.error('Regenerate backup codes error', { err });
    res.status(500).json({ error: 'Failed to regenerate backup codes' });
  }
}

module.exports = {
  setup2FA,
  verifySetup,
  validate2FA,
  disable2FA,
  get2FAStatus,
  regenerateBackupCodes,
};
