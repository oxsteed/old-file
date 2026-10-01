const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { columnExists, userIdEq, ACTIVE_JOB_STATUS_SQL_IN } = require('../utils/schemaProbe');
const { authenticate } = require('../middleware/auth');
const { strictLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');
const { sendOTPEmail } = require('../utils/email');
const tokenRevocationService = require('../services/tokenRevocationService');
const socketService = require('../services/socketService');
/**
 * CCPA/CPRA Privacy Rights Routes
 * Provides data export, account deletion, and data portability
 * endpoints required by California and other state privacy laws.
 */

const EXPORT_CSV_COLUMNS = {
  user: [
    'id', 'email', 'phone', 'first_name', 'last_name', 'role',
    'subscription_status', 'email_verified', 'is_active', 'is_banned',
    'preferred_language', 'city', 'state', 'zip_code', 'created_at',
    'updated_at', 'deleted_at',
  ],
  jobs: [
    'id', 'client_id', 'assigned_helper_id', 'title', 'description',
    'category_name', 'job_type', 'budget_min', 'budget_max', 'job_value',
    'status', 'created_at', 'updated_at',
  ],
  bids: ['id', 'job_id', 'amount', 'message', 'status', 'created_at'],
  reviews: ['id', 'job_id', 'rating', 'comment', 'created_at'],
  consents: ['consent_type', 'version', 'accepted_at'],
};

function csvCell(value) {
  const raw = value === null || value === undefined
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
  // Prevent spreadsheet formula execution when user-generated text is opened.
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function rowsToCsv(rows, columns) {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(','));
  }
  return `\ufeff${lines.join('\r\n')}\r\n`;
}

function buildExportArchive(exportData) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));

    archive.append(JSON.stringify(exportData, null, 2), { name: 'data.json' });
    archive.append(rowsToCsv(exportData.user ? [exportData.user] : [], EXPORT_CSV_COLUMNS.user), { name: 'user.csv' });
    for (const [name, columns] of Object.entries(EXPORT_CSV_COLUMNS)) {
      if (name === 'user') continue;
      archive.append(rowsToCsv(exportData[name], columns), { name: `${name}.csv` });
    }
    archive.append(
      [
        'OxSteed personal data export',
        '============================',
        '',
        `Generated: ${exportData.exportDate}`,
        'Format: ZIP archive containing JSON and CSV representations.',
        '',
        'Files:',
        '- data.json: complete structured export for machine processing.',
        '- user.csv: account profile fields included in the export.',
        '- jobs.csv: jobs where you are the client or assigned helper.',
        '- bids.csv: bids submitted by you.',
        '- reviews.csv: reviews you wrote or received.',
        '- consents.csv: recorded consent history.',
        '',
        'Security:',
        '- Credentials, passwords, authentication tokens, and payment secrets are excluded.',
        '- Keep this archive private because it contains personal account data.',
        '',
      ].join('\n'),
      { name: 'README.txt' },
    );
    archive.finalize().catch(reject);
  });
}

const EXPORT_VERIFICATION_TTL_MINUTES = 15;
const EXPORT_VERIFICATION_MAX_ATTEMPTS = 5;

// L3: no hardcoded dev fallback. A missing secret fails closed at signing
// time (loud 500) instead of silently HMAC-ing with a public constant.
function getExportVerificationSecret() {
  const secret = String(process.env.EXPORT_VERIFICATION_SECRET || '').trim();
  if (!secret) {
    throw new Error('EXPORT_VERIFICATION_SECRET is not configured');
  }
  return secret;
}

function hashExportVerificationValue(value) {
  return crypto.createHmac('sha256', getExportVerificationSecret()).update(String(value)).digest('hex');
}

function valuesMatch(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function maskEmail(email) {
  const [local = '', domain = ''] = String(email || '').split('@');
  if (!local || !domain) return 'your email address';
  const visible = local.length <= 2 ? local.slice(0, 1) : `${local.slice(0, 2)}***`;
  return `${visible}@${domain}`;
}

function requestIdFor(req) {
  return req.correlationId || req.id || req.requestId || req.headers['x-request-id'] || null;
}

function verificationError(res, status, code, error, extra = {}) {
  return res.status(status).json({ code, error, ...extra });
}

// POST /api/privacy/export/verification/request
// Password verification happens before an email code is issued.
router.post('/export/verification/request', authenticate, async (req, res) => {
  try {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password) {
      return verificationError(res, 400, 'EXPORT_PASSWORD_REQUIRED', 'Enter your current password to continue.');
    }

    const { rows } = await pool.query(
      'SELECT email, password_hash, preferred_language FROM users WHERE id = $1 AND deleted_at IS NULL',
      [req.user.id],
    );
    const user = rows[0];
    if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
      return verificationError(res, 401, 'EXPORT_PASSWORD_INVALID', 'Incorrect password.');
    }

    const challengeToken = crypto.randomBytes(32).toString('hex');
    const code = crypto.randomInt(100000, 1000000).toString();
    const challengeId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + EXPORT_VERIFICATION_TTL_MINUTES * 60 * 1000);

    await pool.query(
      `DELETE FROM privacy_export_verifications
       WHERE user_id = $1 AND consumed_at IS NULL`,
      [req.user.id],
    );
    await pool.query(
      `INSERT INTO privacy_export_verifications
         (id, user_id, challenge_token_hash, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [challengeId, req.user.id, hashExportVerificationValue(challengeToken), hashExportVerificationValue(code), expiresAt],
    );

    const emailResult = await sendOTPEmail(user.email, code, user.preferred_language);
    if (!emailResult || emailResult.success === false) {
      await pool.query('DELETE FROM privacy_export_verifications WHERE id = $1', [challengeId]);
      return verificationError(res, 503, 'EXPORT_VERIFICATION_UNAVAILABLE', 'We could not send the verification code. Please try again later.');
    }

    return res.json({
      challengeToken,
      emailHint: maskEmail(user.email),
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    logger.error('Privacy export verification request failed', {
      message: err.message,
      userId: req.user?.id,
      requestId: requestIdFor(req),
    });
    return verificationError(res, 500, 'EXPORT_VERIFICATION_FAILED', 'Unable to start export verification. Please try again.');
  }
});

// POST /api/privacy/export/verification/verify
router.post('/export/verification/verify', authenticate, async (req, res) => {
  try {
    const challengeToken = typeof req.body?.challengeToken === 'string' ? req.body.challengeToken : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!/^[a-f0-9]{64}$/i.test(challengeToken) || !/^\d{6}$/.test(code)) {
      return verificationError(res, 400, 'EXPORT_CODE_INVALID', 'Enter the six-digit code from your email.');
    }

    const { rows } = await pool.query(
      `SELECT id, code_hash, expires_at, attempts, locked_until, verified_at, consumed_at
       FROM privacy_export_verifications
       WHERE user_id = $1 AND challenge_token_hash = $2
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id, hashExportVerificationValue(challengeToken)],
    );
    const verification = rows[0];
    if (!verification || verification.consumed_at || verification.verified_at) {
      return verificationError(res, 400, 'EXPORT_CODE_INVALID', 'That verification request is no longer valid. Start again.');
    }
    if (new Date(verification.expires_at) <= new Date()) {
      return verificationError(res, 400, 'EXPORT_CODE_EXPIRED', 'That verification code has expired. Start again.');
    }
    if (verification.locked_until && new Date(verification.locked_until) > new Date()) {
      return verificationError(res, 429, 'EXPORT_CODE_LOCKED', 'Too many incorrect codes. Start a new verification request later.');
    }

    const codeValid = valuesMatch(verification.code_hash, hashExportVerificationValue(code));
    if (!codeValid) {
      const nextAttempts = Number(verification.attempts || 0) + 1;
      await pool.query(
        `UPDATE privacy_export_verifications
         SET attempts = $2,
             locked_until = CASE WHEN $2 >= $3 THEN NOW() + interval '15 minutes' ELSE locked_until END
         WHERE id = $1`,
        [verification.id, nextAttempts, EXPORT_VERIFICATION_MAX_ATTEMPTS],
      );
      if (nextAttempts >= EXPORT_VERIFICATION_MAX_ATTEMPTS) {
        return verificationError(res, 429, 'EXPORT_CODE_LOCKED', 'Too many incorrect codes. Start a new verification request later.');
      }
      return verificationError(res, 400, 'EXPORT_CODE_INVALID', 'That verification code is incorrect.');
    }

    const exportToken = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `UPDATE privacy_export_verifications
       SET export_token_hash = $2, verified_at = NOW()
       WHERE id = $1 AND consumed_at IS NULL AND verified_at IS NULL`,
      [verification.id, hashExportVerificationValue(exportToken)],
    );
    return res.json({ exportToken, expiresAt: new Date(verification.expires_at).toISOString() });
  } catch (err) {
    logger.error('Privacy export code verification failed', {
      message: err.message,
      userId: req.user?.id,
      requestId: requestIdFor(req),
    });
    return verificationError(res, 500, 'EXPORT_VERIFICATION_FAILED', 'Unable to verify the export code. Please try again.');
  }
});

// GET /api/privacy/export - Export all user data (CCPA right to know)
router.get('/export', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const exportToken = req.get('X-Export-Verification-Token');
    if (!exportToken) {
      return verificationError(res, 403, 'EXPORT_VERIFICATION_REQUIRED', 'Verify your password and email code before exporting data.');
    }
    const { rows: verificationRows } = await pool.query(
      `SELECT id FROM privacy_export_verifications
       WHERE user_id = $1 AND export_token_hash = $2
         AND verified_at IS NOT NULL AND consumed_at IS NULL AND expires_at > NOW()
       LIMIT 1`,
      [userId, hashExportVerificationValue(exportToken)],
    );
    if (!verificationRows[0]) {
      return verificationError(res, 403, 'EXPORT_VERIFICATION_REQUIRED', 'Verify your password and email code before exporting data.');
    }
    // Gather all user data across tables
    const userResult = await pool.query(
      `SELECT id, email, phone, first_name, last_name, role,
              subscription_status, email_verified, is_active, is_banned,
              preferred_language, city, state, zip_code, created_at,
              updated_at, deleted_at
       FROM users WHERE ${userIdEq('id')}`,
      [String(userId)]
    );
    const jobsResult = await pool.query(
      `SELECT id, client_id, assigned_helper_id, title, description,
              category_name, job_type, budget_min, budget_max, job_value,
              status, created_at, updated_at
       FROM jobs
       WHERE ${userIdEq('client_id')} OR ${userIdEq('assigned_helper_id')}`,
      [String(userId)]
    );
    const bidsResult = await pool.query(
      `SELECT id, job_id, amount, message, status, created_at
       FROM bids WHERE ${userIdEq('helper_id')}`,
      [String(userId)]
    );
    const reviewsResult = await pool.query(
      `SELECT id, job_id, rating, comment, created_at
       FROM reviews
       WHERE ${userIdEq('reviewer_id')} OR ${userIdEq('reviewee_id')}`,
      [String(userId)]
    );
    const consentsResult = await pool.query(
      `SELECT consent_type, version, accepted_at
       FROM user_consents WHERE ${userIdEq('user_id')}
       ORDER BY accepted_at DESC`,
      [String(userId)]
    );
    const exportData = {
      exportDate: new Date().toISOString(),
      exportType: 'CCPA Data Export',
      user: userResult.rows[0] || null,
      jobs: jobsResult.rows,
      bids: bidsResult.rows,
      reviews: reviewsResult.rows,
      consents: consentsResult.rows,
    };
    const archiveBuffer = await buildExportArchive(exportData);
    const consumed = await pool.query(
      `UPDATE privacy_export_verifications
       SET consumed_at = NOW()
       WHERE id = $1 AND consumed_at IS NULL
       RETURNING id`,
      [verificationRows[0].id],
    );
    if (!consumed.rows[0]) {
      return verificationError(res, 403, 'EXPORT_VERIFICATION_REQUIRED', 'This export authorization has already been used. Start again.');
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', archiveBuffer.length);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="oxsteed-data-export-${userId}-${Date.now()}.zip"`
    );
    res.end(archiveBuffer);
  } catch (err) {
    const requestId = requestIdFor(req);
    logger.error('Privacy data export failed', {
      message: err.message,
      code: err.code,
      userId: req.user?.id,
      requestId,
    });
    res.status(500).json({
      code: 'DATA_EXPORT_FAILED',
      error: 'Failed to export data. Please try again.',
      requestId,
    });
  }
});
// DELETE /api/privacy/delete-account - CCPA right to delete (user self-initiated)
//
// Self-delete is a SOFT delete only. Key behaviors:
// - Banned users cannot self-delete to escape their ban
// - Active jobs or escrow holds block deletion
// - Pending payouts block deletion until released
// - Tokens are immediately revoked, WebSockets disconnected
// - is_active set to false so existing JWTs stop working
// - Email is freed but original_email_hash is stored to detect bad-faith re-registration
// - was_banned_at_deletion is recorded so re-registration can be blocked
// - Reviews and dispute history are intentionally retained (user cannot delete-to-escape)
// - No 30-day recovery window for self-deletes (admin deletions have one)
router.delete('/delete-account', strictLimiter, authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { confirmation } = req.body;

    if (confirmation !== 'DELETE MY ACCOUNT') {
      return res.status(400).json({
        error: 'Please type "DELETE MY ACCOUNT" to confirm.',
      });
    }

    const [
      hasDeletionScheduled,
      hasDeletionType,
      hasDeletionReason,
      hasWasBannedAtDeletion,
      hasOriginalEmailHash,
    ] = await Promise.all([
      columnExists('users', 'deletion_scheduled_at'),
      columnExists('users', 'deletion_type'),
      columnExists('users', 'deletion_reason'),
      columnExists('users', 'was_banned_at_deletion'),
      columnExists('users', 'original_email_hash'),
    ]);
    const hasMig165SelfDelete = hasDeletionType && hasOriginalEmailHash;

    // Load full user state before proceeding
    const { rows: userRows } = await pool.query(
      `SELECT id, email, first_name, last_name, role, is_banned, is_active, deleted_at
       FROM users WHERE ${userIdEq('id')}`,
      [String(userId)]
    );
    if (!userRows.length) return res.status(404).json({ error: 'User not found.' });
    const user = userRows[0];

    if (user.deleted_at) {
      return res.status(409).json({ error: 'This account has already been deleted.' });
    }

    // Banned users cannot self-delete to escape their ban record.
    if (user.is_banned) {
      return res.status(403).json({
        error: 'Banned accounts cannot be self-deleted. Please contact support if you believe this ban was made in error.',
      });
    }

    // Block if account has already been scheduled for admin deletion
    if (hasDeletionScheduled) {
      const { rows: pendingRows } = await pool.query(
        `SELECT deletion_scheduled_at FROM users WHERE ${userIdEq('id')} AND deletion_scheduled_at IS NOT NULL`,
        [String(userId)]
      );
      if (pendingRows.length) {
        return res.status(409).json({ error: 'This account is already scheduled for deletion by an administrator.' });
      }
    }

    // Check for active jobs — use the correct column names (client_id / assigned_helper_id)
    const { rows: activeJobRows } = await pool.query(
      `SELECT id, title, status FROM jobs
       WHERE (${userIdEq('client_id')} OR ${userIdEq('assigned_helper_id')})
         AND status IN ${ACTIVE_JOB_STATUS_SQL_IN}`,
      [String(userId)]
    );
    if (activeJobRows.length > 0) {
      return res.status(409).json({
        error: 'Cannot delete your account while you have active or in-progress jobs. Please complete or cancel all active jobs first.',
        activeJobs: activeJobRows.map(j => ({ id: j.id, title: j.title, status: j.status })),
      });
    }

    // Check for pending outgoing payments (payer owes money)
    const { rows: pendingPayments } = await pool.query(
      `SELECT id FROM payments
       WHERE ${userIdEq('payer_id')} AND status IN ('pending', 'authorized', 'processing')
       LIMIT 5`,
      [String(userId)]
    );
    if (pendingPayments.length) {
      return res.status(409).json({
        error: 'Cannot delete your account while you have pending payments. Please resolve all outstanding payments first.',
      });
    }

    // Check for pending payouts owed to this user (payee has uncollected funds)
    const { rows: pendingPayouts } = await pool.query(
      `SELECT id FROM payments
       WHERE ${userIdEq('payee_id')} AND status IN ('pending', 'authorized', 'processing', 'captured')
       LIMIT 5`,
      [String(userId)]
    );
    if (pendingPayouts.length) {
      return res.status(409).json({
        error: 'Cannot delete your account while you have pending earnings. Please allow all pending payouts to complete first.',
      });
    }

    // Hash original email before anonymizing (one-way, for re-registration detection)
    const originalEmailHash = crypto
      .createHash('sha256')
      .update(user.email.toLowerCase().trim())
      .digest('hex');

    // Revoke tokens before anonymizing the account. If the revocation store is
    // unavailable, stop here: deleting the account while old JWTs remain
    // usable would create a security and privacy incident.
    try {
      await tokenRevocationService.revokeAllUserTokens(userId);
    } catch (err) {
      if (err?.code === 'token_revocation_unavailable') {
        return res.status(503).json({
          error: 'Account deletion is temporarily unavailable. Please retry.',
          code: 'token_revocation_unavailable',
          retryable: true,
        });
      }
      throw err;
    }
    try { await pool.query(
      `UPDATE sessions SET is_valid = false WHERE ${userIdEq('user_id')}`,
      [String(userId)],
    ); } catch { /* non-fatal */ }
    try { socketService.disconnectUserSockets(userId); } catch { /* non-fatal */ }

    // Soft-delete: anonymize PII, set is_active=false, record deletion metadata when columns exist
    const baseSets = [
      "first_name   = 'Deleted'",
      "last_name    = 'User'",
      "email        = CONCAT('deleted_', id::text, '@oxsteed.removed')",
      'phone        = NULL',
      'phone_number = NULL',
      'bio          = NULL',
      'profile_photo_url = NULL',
      'city         = NULL',
      'state        = NULL',
      'zip_code     = NULL',
      'address_line1 = NULL',
      'country      = NULL',
      "password_hash = 'DELETED'",
      'totp_secret   = NULL',
      'totp_enabled  = FALSE',
      'backup_codes  = NULL',
      'is_active     = FALSE',
      'deleted_at    = NOW()',
      'updated_at    = NOW()',
    ];
    const params = [String(userId)];
    let pi = 2;
    if (hasMig165SelfDelete) {
      baseSets.push("deletion_type = 'self'");
      if (hasDeletionReason) {
        baseSets.push(`deletion_reason = $${pi++}`);
        params.push('User requested account deletion via Settings');
      }
      if (hasWasBannedAtDeletion) {
        baseSets.push(`was_banned_at_deletion = $${pi++}`);
        params.push(user.is_banned);
      }
      baseSets.push(`original_email_hash = $${pi++}`);
      params.push(originalEmailHash);
    }

    await pool.query(
      `UPDATE users SET ${baseSets.join(', ')} WHERE ${userIdEq('id')}`,
      params
    );

    // Audit log
    try {
      await pool.query(
        `INSERT INTO user_consents (user_id, consent_type, version, ip_hash, user_agent)
         VALUES ($1, 'account_deletion', '1.0', $2, $3)
         ON CONFLICT DO NOTHING`,
        [userId, req.ip, req.headers['user-agent'] || 'unknown']
      );
    } catch { /* non-fatal */ }

    logger.info('User self-deleted account', { userId, emailHash: originalEmailHash });

    res.json({
      message: 'Your account has been deleted. Your personal information has been anonymized. Transaction records, reviews, and dispute history are retained as required by our Privacy Policy and applicable law. If you have questions, contact support@oxsteed.com.',
    });
  } catch (err) {
    logger.error('Account deletion failed', { message: err.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to process deletion request. Please try again or contact support.' });
  }
});
// GET /api/privacy/data-categories - List categories of data collected (CCPA disclosure)
router.get('/data-categories', strictLimiter, (req, res) => {
  res.json({
    categories: [
      { category: 'Identifiers', examples: 'Name, email, phone number, mailing address', purpose: 'Account creation and authentication' },
      { category: 'Commercial Information', examples: 'Job postings, bids, transaction history', purpose: 'Platform marketplace operations' },
      { category: 'Financial Data', examples: 'Stripe customer ID, subscription tier', purpose: 'Payment processing (credit card data stored by Stripe only)' },
      { category: 'Professional Information', examples: 'Skills, hourly rate, availability, bio', purpose: 'Helper profile and job matching' },
      { category: 'Internet Activity', examples: 'IP address, browser type, pages visited', purpose: 'Analytics and security' },
      { category: 'Geolocation', examples: 'City, state, zip code', purpose: 'Location-based job matching' },
      { category: 'Background Check', examples: 'Pass/fail status from Checkr', purpose: 'Verified badge eligibility' },
    ],
    thirdParties: [
      { name: 'Stripe, Inc.', purpose: 'Payment processing', dataShared: 'Name, email for payment account' },
      { name: 'Checkr, Inc.', purpose: 'Background checks', dataShared: 'Name, DOB, SSN (provided directly to Checkr)' },
      { name: 'Resend', purpose: 'Email delivery', dataShared: 'Email address' },
      { name: 'Google Analytics', purpose: 'Usage analytics', dataShared: 'Anonymized usage data' },
    ],
  });
});
module.exports = router;
