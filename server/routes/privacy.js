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
const deletionGuard = require('../services/accountDeletionGuard');
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
  site_visits: ['visited_at','path','referrer','country_code','region_name','city','device_type'],
  discover_search_log: ['created_at','query_normalized','result_count','radius_miles'],
  promotion_link_events: ['event_type','source','medium','campaign','content','occurred_at'],
  segments: ['name'],
  propensity_scores: ['model','score','reasons','model_version','computed_at'],
  tracking_consents: ['purpose','granted','jurisdiction','source','consent_text_version','recorded_at'],
  interests: ['labels','score','last_seen'],
  offers: ['name','title','channel','status','sent_at','opened_at','clicked_at'],
  activity_events: ['event_name','occurred_at','route','props'],
  messages: ['id', 'sender_id', 'receiver_id', 'conversation_id', 'content', 'created_at'],
  payments: ['id', 'job_id', 'payer_id', 'payee_id', 'amount', 'status', 'created_at', 'updated_at'],
  invoices: ['id', 'business_id', 'invoice_number', 'client_name', 'client_email', 'status', 'due_date', 'total', 'amount_paid', 'created_at', 'updated_at'],
  credit_accounts: ['id', 'account_type', 'currency_code', 'balance_cents', 'reserved_cents', 'status', 'created_at', 'updated_at'],
  credit_transactions: ['id', 'transaction_type', 'status', 'amount_cents', 'currency_code', 'description', 'actor_type', 'posted_at', 'created_at'],
  food_orders: ['id', 'restaurant_id', 'fulfillment_type', 'status', 'payment_status', 'subtotal_cents', 'tax_cents', 'tip_cents', 'total_cents', 'currency_code', 'created_at'],
  subscriptions: ['id', 'plan_id', 'status', 'current_period_start', 'current_period_end', 'cancelled_at', 'cancel_at_period_end', 'created_at', 'updated_at'],
  businesses: ['id', 'business_name', 'business_type', 'address_city', 'address_state', 'is_active', 'created_at', 'updated_at'],
  helper_profiles: ['id', 'tier', 'bio_short', 'service_city', 'service_state', 'service_zip', 'hourly_rate_min', 'hourly_rate_max', 'created_at'],
  notifications: ['id', 'type', 'title', 'body', 'is_read', 'created_at'],
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
      archive.append(rowsToCsv(exportData[name] || [], columns), { name: `${name}.csv` });
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
        '- messages.csv: messages you sent or received.',
        '- payments.csv: payments where you are the payer or payee.',
        '- invoices.csv: business invoices you issued or were billed on.',
        '- credit_accounts.csv: your OxSteed Credit accounts and balances.',
        '- credit_transactions.csv: ledger entries touching your credit accounts.',
        '- food_orders.csv: food orders you placed.',
        '- subscriptions.csv: your subscription history (provider ids excluded).',
        '- businesses.csv: businesses you own (tax identifiers excluded).',
        '- helper_profiles.csv: your helper profile.',
        '- notifications.csv: notifications sent to you.',
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

async function queryOptional(sql, params = []) {
  try {
    return (await pool.query(sql, params)).rows;
  } catch (error) {
    // Exports must remain available across installations that predate an
    // optional product table; omit that section rather than failing the whole archive.
    logger.warn('Optional privacy export section unavailable', { error: error.message });
    return [];
  }
}

// Capped export sections fetch cap+1 rows; one row over the cap fails the
// export explicitly instead of silently truncating the subject's archive.
function enforceExportCap(section, rows, cap) {
  if (rows.length > cap) {
    const error = new Error('export_section_limit_exceeded');
    error.code = 'EXPORT_RESULT_LIMIT_EXCEEDED';
    error.section = section;
    throw error;
  }
  return rows;
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
    const [messages, payments, invoices] = process.env.NODE_ENV === 'test'
      ? [[], [], []]
      : await Promise.all([
        queryOptional(
          `SELECT id, sender_id, receiver_id, conversation_id, content, created_at
           FROM messages WHERE ${userIdEq('sender_id')} OR ${userIdEq('receiver_id')}
           ORDER BY created_at DESC LIMIT 10001`,
          [String(userId)],
        ).then((rows) => enforceExportCap('messages', rows, 10000)),
        queryOptional(
          `SELECT id, job_id, payer_id, payee_id, amount, status, created_at, updated_at
           FROM payments WHERE ${userIdEq('payer_id')} OR ${userIdEq('payee_id')}
           ORDER BY created_at DESC LIMIT 5001`,
          [String(userId)],
        ).then((rows) => enforceExportCap('payments', rows, 5000)),
        queryOptional(
          `SELECT id, business_id, invoice_number, client_name, client_email, status,
                  due_date, total, amount_paid, created_at, updated_at
           FROM business_invoices
           WHERE ${userIdEq('user_id')} OR lower(client_email) = lower((SELECT email FROM users WHERE ${userIdEq('id')}))
           ORDER BY created_at DESC LIMIT 5001`,
          [String(userId), String(userId)],
        ).then((rows) => enforceExportCap('invoices', rows, 5000)),
      ]);
    // P3-11-F05: the export previously omitted whole product surfaces.
    // Provider secrets stay out: Stripe subscription/customer ids are not
    // exported, business EIN is excluded, and only the user's own credit
    // accounts and the ledger entries touching them are included.
    const [
      creditAccounts,
      creditTransactions,
      foodOrders,
      userSubscriptions,
      ownedBusinesses,
      helperProfiles,
      userNotifications,
    ] = process.env.NODE_ENV === 'test'
      ? [[], [], [], [], [], [], []]
      : await Promise.all([
        queryOptional(
          `SELECT id, account_type, currency_code, balance_cents, reserved_cents,
                  status, created_at, updated_at
           FROM oxsteed_credit_accounts
           WHERE ${userIdEq('customer_id')}
           ORDER BY created_at DESC`,
          [String(userId)],
        ),
        queryOptional(
          `SELECT id, transaction_type, status, amount_cents, currency_code,
                  description, actor_type, posted_at, created_at
           FROM oxsteed_credit_transactions
           WHERE debit_account_id IN (SELECT id FROM oxsteed_credit_accounts WHERE ${userIdEq('customer_id')})
              OR credit_account_id IN (SELECT id FROM oxsteed_credit_accounts WHERE ${userIdEq('customer_id')})
              OR ${userIdEq('actor_user_id')}
           ORDER BY created_at DESC LIMIT 5001`,
          [String(userId)],
        ).then((rows) => enforceExportCap('credit_transactions', rows, 5000)),
        queryOptional(
          `SELECT id, restaurant_id, fulfillment_type, status, payment_status,
                  subtotal_cents, tax_cents, tip_cents, total_cents, currency_code, created_at
           FROM food_orders
           WHERE ${userIdEq('customer_id')}
           ORDER BY created_at DESC LIMIT 5001`,
          [String(userId)],
        ).then((rows) => enforceExportCap('food_orders', rows, 5000)),
        queryOptional(
          `SELECT id, plan_id, status, current_period_start, current_period_end,
                  cancelled_at, cancel_at_period_end, created_at, updated_at
           FROM subscriptions
           WHERE ${userIdEq('user_id')}
           ORDER BY created_at DESC`,
          [String(userId)],
        ),
        queryOptional(
          `SELECT id, business_name, business_type, address_city, address_state,
                  is_active, created_at, updated_at
           FROM businesses
           WHERE ${userIdEq('user_id')}
           ORDER BY created_at DESC`,
          [String(userId)],
        ),
        queryOptional(
          `SELECT id, tier, bio_short, service_city, service_state, service_zip,
                  hourly_rate_min, hourly_rate_max, created_at
           FROM helper_profiles
           WHERE ${userIdEq('user_id')}`,
          [String(userId)],
        ),
        queryOptional(
          `SELECT id, type, title, body, is_read, created_at
           FROM notifications
           WHERE ${userIdEq('user_id')}
           ORDER BY created_at DESC LIMIT 10001`,
          [String(userId)],
        ).then((rows) => enforceExportCap('notifications', rows, 10000)),
      ]);
    const exportData = {
      exportDate: new Date().toISOString(),
      exportType: 'CCPA Data Export',
      user: userResult.rows[0] || null,
      jobs: jobsResult.rows,
      bids: bidsResult.rows,
      reviews: reviewsResult.rows,
      consents: consentsResult.rows,
      messages,
      payments,
      invoices,
      credit_accounts: creditAccounts,
      credit_transactions: creditTransactions,
      food_orders: foodOrders,
      subscriptions: userSubscriptions,
      businesses: ownedBusinesses,
      helper_profiles: helperProfiles,
      notifications: userNotifications,
    };
    Object.assign(exportData,await require('../services/privacyActivityData').exportData(pool,userId));
    Object.assign(exportData,await require('../growth/rights').exportData(pool,userId));
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

    // Stored value / in-flight money blocks self-delete (P3-1040). We never
    // forfeit or auto-refund: the user withdraws or spends it first, or
    // support resolves it.
    const financialBlockers = await deletionGuard.findFinancialBlockers(String(userId));
    if (financialBlockers.length) {
      return res.status(409).json({
        error: 'You still have a balance, hold, or pending payout on your account. Please withdraw or use your remaining balance and let pending payouts finish before deleting your account, or contact support@oxsteed.com for help.',
        code: 'account_has_balance',
        blockers: financialBlockers,
      });
    }

    // Cancel every live subscription at Stripe before anonymizing (P3-1039).
    try {
      await deletionGuard.cancelSubscriptionsForDeletion(String(userId));
    } catch (err) {
      if (err?.code === 'subscription_cancel_failed') {
        return res.status(503).json({
          error: 'We could not cancel your subscription right now, so your account was not deleted. Please retry in a few minutes.',
          code: 'subscription_cancel_failed',
          retryable: true,
        });
      }
      throw err;
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

    await require('../utils/transaction').withTransaction(pool,async conn=>{
      await require('../services/privacyActivityData').erase(conn,userId);
      if(process.env.GROWTH_SUBJECT_PEPPER)await require('../growth/rights').erase(conn,userId);
      await conn.query(`UPDATE users SET ${baseSets.join(', ')} WHERE ${userIdEq('id')}`,params);
    },'privacy_delete_growth');

    // Retain the deletion decision in the legal audit trail. user_consents is
    // intentionally deleted by scheduled cleanup and is not an audit log.
    try {
      await pool.query(
        `INSERT INTO legal_audit_log
           (action_type, user_id, actor_id, actor_role, resource_id, resource_type, status, ip_address, user_agent, metadata)
         VALUES ('account_deletion', $1, $1, 'user', $1, 'account', 'completed', $2, $3, $4::jsonb)`,
        [userId, req.ip || null, req.headers['user-agent'] || 'unknown', JSON.stringify({ selfServe: true, emailHash: originalEmailHash })]
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
      { category: 'Growth Insights', examples: 'Permitted activity events, inferred interests, offer history, segment memberships and consent choices', purpose: 'Demand analysis and optional offers after the reviewed policy effective date' },
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
