'use strict';

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const { sendEmail, sendOTPEmail } = require('../utils/email');
const { trialDefaults } = require('../utils/trial');
const { isSignupPasswordValid } = require('../utils/signupValidation');
const { TERMS_CONFIG } = require('../constants/termsConfig');

const SECRET = process.env.OTP_HMAC_SECRET || process.env.JWT_SECRET || 'development-only-investor-invitation-secret';
const GENERIC_FAILURE = 'The invitation could not be verified.';
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 15 * 60 * 1000;
const PROOF_TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function hash(value, purpose) {
  return crypto.createHmac('sha256', SECRET).update(`${purpose}:${String(value)}`).digest('hex');
}

function code() { return crypto.randomInt(10000000, 100000000).toString(); }

function safeBaseUrl() {
  return String(process.env.PUBLIC_APP_URL || process.env.APP_URL || 'https://oxsteed.com').replace(/\/$/, '');
}

function genericError(status = 400) {
  const err = new Error(GENERIC_FAILURE);
  err.statusCode = status;
  err.code = 'investor_invitation_invalid';
  return err;
}

function checkAttempts(row, field) {
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    const err = genericError(429);
    err.code = 'investor_invitation_rate_limited';
    return err;
  }
  if (Number(row[field] || 0) >= MAX_ATTEMPTS) {
    const err = genericError(429);
    err.code = 'investor_invitation_rate_limited';
    return err;
  }
  return null;
}

async function createInvitation({ email, createdBy, expiresAt } = {}) {
  const normalized = normalizeEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    const err = new Error('A valid email address is required.'); err.statusCode = 400; err.code = 'validation_failed'; throw err;
  }
  const inviteCode = code();
  const expiry = expiresAt ? new Date(expiresAt) : new Date(Date.now() + INVITE_TTL_MS);
  if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) {
    const err = new Error('Invitation expiry must be in the future.'); err.statusCode = 400; err.code = 'validation_failed'; throw err;
  }
  const { rows } = await pool.query(
    `INSERT INTO investor_invitations (email, invite_code_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id, email, expires_at, created_at`,
    [normalized, hash(inviteCode, 'investor-invite'), expiry, createdBy],
  );
  const invitation = rows[0];
  const link = `${safeBaseUrl()}/investor/invite?id=${encodeURIComponent(invitation.id)}`;
  const delivery = await sendEmail({
    to: normalized,
    subject: 'Your private OxSteed investor invitation',
    text: `You have been invited to OxSteed's private Investor workspace. Open ${link} and enter this one-time code: ${inviteCode}. This invitation expires ${expiry.toISOString()}.`,
    html: `<p>You have been invited to OxSteed's private Investor workspace.</p><p><a href="${link}">Open your invitation</a></p><p>One-time code: <strong>${inviteCode}</strong></p><p>This invitation expires ${expiry.toISOString()}.</p>`,
    idempotencyKey: `investor-invite:${invitation.id}`,
  });
  if (!delivery || delivery.success === false) {
    await pool.query('UPDATE investor_invitations SET revoked_at = NOW(), revoked_by = $2 WHERE id = $1', [invitation.id, createdBy]).catch(() => {});
    const err = new Error('Unable to deliver invitation.'); err.statusCode = 503; err.code = 'invitation_delivery_failed'; throw err;
  }
  return invitation;
}

async function verifyInvitation({ id, email, inviteCode } = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized || !inviteCode) throw genericError();
  return withTransaction(pool, async (client) => {
    const query = id
      ? ['SELECT * FROM investor_invitations WHERE id = $1 FOR UPDATE', [id]]
      : ['SELECT * FROM investor_invitations WHERE email = $1 AND revoked_at IS NULL AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE', [normalized]];
    const { rows } = await client.query(query[0], query[1]);
    const row = rows[0];
    const limiter = row ? checkAttempts(row, 'invite_attempts') : null;
    if (!row || row.email !== normalized || row.revoked_at || row.consumed_at || new Date(row.expires_at) <= new Date() || limiter) {
      if (row && row.email === normalized && !row.revoked_at && !row.consumed_at) {
        const attempts = Number(row.invite_attempts || 0) + 1;
        await client.query(`UPDATE investor_invitations SET invite_attempts = $2, locked_until = CASE WHEN $2 >= $3 THEN NOW() + interval '1 hour' ELSE locked_until END WHERE id = $1`, [row.id, attempts, MAX_ATTEMPTS]);
      }
      throw limiter || genericError();
    }
    const presented = hash(inviteCode, 'investor-invite');
    const ok = crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(row.invite_code_hash));
    if (!ok) {
      const attempts = Number(row.invite_attempts || 0) + 1;
      await client.query(`UPDATE investor_invitations SET invite_attempts = $2, locked_until = CASE WHEN $2 >= $3 THEN NOW() + interval '1 hour' ELSE locked_until END WHERE id = $1`, [row.id, attempts, MAX_ATTEMPTS]);
      throw attempts >= MAX_ATTEMPTS ? Object.assign(genericError(429), { code: 'investor_invitation_rate_limited' }) : genericError();
    }
    const proof = crypto.randomBytes(32).toString('hex');
    const verificationCode = code();
    await client.query(
      `UPDATE investor_invitations SET proof_hash = $2, proof_expires_at = NOW() + interval '30 minutes',
          verification_code_hash = $3, verification_expires_at = NOW() + interval '15 minutes',
          verification_sent_at = NOW(), verification_attempts = 0, locked_until = NULL WHERE id = $1`,
      [row.id, hash(proof, 'investor-proof'), hash(verificationCode, 'investor-verification')],
    );
    const delivery = await sendOTPEmail(normalized, verificationCode, 'en');
    if (!delivery || delivery.success === false) throw Object.assign(new Error('Unable to send verification code.'), { statusCode: 503, code: 'verification_delivery_failed' });
    return { invitationId: row.id, email: normalized, proof, verificationExpiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString() };
  }, 'verify_private_investor_invitation');
}

async function acceptInvitation({ email, proof, verificationCode, userId = null, account = {}, request } = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized || !proof || !verificationCode) throw genericError();
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM investor_invitations WHERE email = $1 AND proof_hash = $2 FOR UPDATE`,
      [normalized, hash(proof, 'investor-proof')],
    );
    const row = rows[0];
    const limiter = row ? checkAttempts(row, 'verification_attempts') : null;
    const valid = row && !row.revoked_at && !row.consumed_at && new Date(row.expires_at) > new Date()
      && row.proof_expires_at && new Date(row.proof_expires_at) > new Date()
      && row.verification_expires_at && new Date(row.verification_expires_at) > new Date();
    if (!valid || limiter) throw limiter || genericError();
    const ok = crypto.timingSafeEqual(Buffer.from(hash(verificationCode, 'investor-verification')), Buffer.from(row.verification_code_hash));
    if (!ok) {
      const attempts = Number(row.verification_attempts || 0) + 1;
      await client.query(`UPDATE investor_invitations SET verification_attempts = $2, locked_until = CASE WHEN $2 >= $3 THEN NOW() + interval '1 hour' ELSE locked_until END WHERE id = $1`, [row.id, attempts, MAX_ATTEMPTS]);
      throw attempts >= MAX_ATTEMPTS ? Object.assign(genericError(429), { code: 'investor_invitation_rate_limited' }) : genericError();
    }

    const existing = (await client.query('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL FOR UPDATE', [normalized])).rows[0];
    if (existing && (!userId || String(existing.id) !== String(userId))) {
      const err = new Error('Sign in with the invited email to finish this invitation.'); err.statusCode = 409; err.code = 'sign_in_required'; throw err;
    }
    let user = existing;
    if (!user) {
      const password = String(account.password || '');
      if (!isSignupPasswordValid(password)) { const err = new Error('A valid password is required to create your customer account.'); err.statusCode = 400; err.code = 'validation_failed'; throw err; }
      if (account.ageConfirmed !== true || account.termsAccepted !== true) { const err = new Error('Age and terms confirmation are required.'); err.statusCode = 400; err.code = 'validation_failed'; throw err; }
      const { trial_started_at, trial_ends_at } = await trialDefaults();
      const passwordHash = await bcrypt.hash(password, 12);
      const firstName = String(account.firstName || '').trim();
      const lastName = String(account.lastName || '').trim();
      if (!firstName || !lastName) { const err = new Error('First and last name are required.'); err.statusCode = 400; err.code = 'validation_failed'; throw err; }
      const inserted = await client.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, phone, role, email_verified,
           age_confirmed, terms_accepted_at, terms_version, onboarding_status, onboarding_completed,
           profile_completed, tier_selected, terms_accepted, contact_completed, membership_tier,
           trial_started_at, trial_ends_at, default_mode, country, preferred_currency)
         VALUES ($1,$2,$3,$4,$5,'customer',TRUE,TRUE,NOW(),$6,'onboarding_complete',TRUE,TRUE,TRUE,TRUE,TRUE,'tier1',$7,$8,'customer',$9,$10)
         RETURNING *`,
        [normalized, passwordHash, firstName, lastName, account.phone || null, TERMS_CONFIG?.terms_of_service?.version || '2026-03-20', trial_started_at, trial_ends_at, account.country || 'US', account.preferredCurrency || 'USD'],
      );
      user = inserted.rows[0];
    }
    const admission = await client.query(
      `INSERT INTO investor_admissions (invitation_id, user_id, email) VALUES ($1,$2,$3)
       ON CONFLICT (invitation_id) DO UPDATE SET updated_at = NOW() RETURNING *`, [row.id, user.id, normalized],
    );
    await client.query(`UPDATE investor_invitations SET consumed_at = NOW(), accepted_by_user_id = $2, proof_hash = NULL, verification_code_hash = NULL WHERE id = $1`, [row.id, user.id]);
    return { user, admission: admission.rows[0], created: !existing };
  }, 'accept_private_investor_invitation');
}

async function revokeInvitation({ id, adminId } = {}) {
  const { rows } = await pool.query(`UPDATE investor_invitations SET revoked_at = NOW(), revoked_by = $2 WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL RETURNING id, revoked_at`, [id, adminId]);
  if (!rows.length) { const err = genericError(404); err.code = 'not_found'; throw err; }
  return rows[0];
}

module.exports = { normalizeEmail, hash, createInvitation, verifyInvitation, acceptInvitation, revokeInvitation, GENERIC_FAILURE };
