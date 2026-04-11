const db      = require('../db');
const bcrypt = require('bcrypt');
const crypto  = require('crypto');
const { ROLES } = require('../constants/roles');
const { hashIP } = require('../utils/encryption');

const SALT_ROUNDS = 12;

// ─── Hash Helpers ─────────────────────────────────────────────
const hashPassword = (plain) => bcrypt.hash(plain, SALT_ROUNDS);
// hashIP imported from encryption.js — normalizes ::ffff: IPv6-mapped IPv4 before hashing (L-40)

// ─── Find by ID ───────────────────────────────────────────────
// Returns safe user fields — never includes password_hash, reset tokens,
// or email verification tokens (M-42)
exports.findById = async (id) => {
  const { rows } = await db.query(
    `SELECT
       u.id, u.email, u.first_name, u.last_name, u.phone,
       u.role, u.is_active, u.is_banned, u.is_verified,
       u.email_verified, u.onboarding_status, u.onboarding_completed,
       u.contact_completed, u.profile_completed, u.tier_selected,
       u.w9_completed, u.terms_accepted, u.membership_tier,
       u.city, u.state, u.zip_code,
       u.subscription_status, u.display_name_preference,
       u.profile_photo_url, u.bio,
       u.created_at, u.updated_at, u.last_login_at,
       u.didit_status, u.didit_verified_at,
       u.trial_started_at, u.trial_ends_at,
       hp.tier,
       hp.bio_short,
       hp.avg_rating,
       hp.completed_jobs_count,
       hp.is_background_checked,
       hp.stripe_account_id,
       hp.stripe_charges_enabled,
       hp.stripe_payouts_enabled,
       hp.service_city,
       hp.service_state,
       hp.service_radius_miles,
       p.slug  AS plan_slug,
       p.name  AS plan_name,
       s.status AS subscription_status_detail,
       s.current_period_end
     FROM users u
     LEFT JOIN helper_profiles hp ON hp.user_id = u.id
     LEFT JOIN subscriptions s
       ON s.user_id = u.id AND s.status IN ('active','trialing','past_due')
     LEFT JOIN plans p ON p.id = s.plan_id
     WHERE u.id = $1
       AND u.deleted_at IS NULL`,
    [id]
  );
  return rows[0] ?? null;
};

// ─── Find by Email (auth-only) ────────────────────────────────
// Returns the full user row including password_hash.
// ONLY use this in authentication flows (login, password reset).
// For all other uses, call findByEmailSafe() which excludes credentials (M-43).
exports.findByEmail = async (email) => {
  const { rows } = await db.query(
    `SELECT * FROM users
     WHERE LOWER(email) = LOWER($1)
       AND deleted_at IS NULL`,
    [email]
  );
  return rows[0] ?? null;
};

// ─── Find by Email (safe, non-auth) ──────────────────────────
// Excludes password_hash, reset tokens, and verification tokens.
exports.findByEmailSafe = async (email) => {
  const { rows } = await db.query(
    `SELECT id, email, first_name, last_name, phone, role,
            is_active, is_banned, is_verified, email_verified,
            onboarding_status, subscription_status, profile_photo_url,
            city, state, zip_code, created_at, updated_at
     FROM users
     WHERE LOWER(email) = LOWER($1)
       AND deleted_at IS NULL`,
    [email]
  );
  return rows[0] ?? null;
};

// ─── Find by Username ─────────────────────────────────────────
// Returns only safe fields — excludes credentials (M-44)
exports.findByUsername = async (username) => {
  const { rows } = await db.query(
    `SELECT id, email, first_name, last_name, phone, role,
            is_active, is_banned, is_verified, email_verified,
            onboarding_status, subscription_status, profile_photo_url,
            city, state, zip_code, created_at, updated_at
     FROM users
     WHERE LOWER(username) = LOWER($1)
       AND deleted_at IS NULL`,
    [username]
  );
  return rows[0] ?? null;
};

// ─── Create User ──────────────────────────────────────────────
exports.create = async ({
  email,
  password,
  firstName,
  lastName,
  role    = ROLES.CUSTOMER,
  phone   = null,
  ip      = null,
  userAgent = null,
  language  = 'en',
}) => {
  // Validate role — cannot self-assign admin roles
  const allowedSelfRoles = [
    ROLES.CUSTOMER,
    ROLES.HELPER_FREE,
  ];
  if (!allowedSelfRoles.includes(role)) {
    throw new Error('Invalid role for self-registration.');
  }

  const passwordHash = await hashPassword(password);
  const ipHash       = hashIP(ip);
  const verifyToken  = crypto.randomBytes(32).toString('hex');
  const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  const { rows } = await db.query(
    `INSERT INTO users (
       email, password_hash, first_name, last_name,
       role, phone, last_known_ip_hash,
       preferred_language,
       email_verify_token, email_verify_expires
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, email, first_name, last_name,
               role, created_at, email_verified`,
    [
      email.toLowerCase().trim(),
      passwordHash,
      firstName.trim(),
      lastName.trim(),
      role,
      phone ?? null,
      ipHash,
      language,
      verifyToken,
      verifyExpiry,
    ]
  );

  const user = rows[0];

  // Record T&C consent
  await exports.recordConsent({
    userId:       user.id,
    consentType:  'terms_of_service',
    version:      '2026-03-20',
    ip,
    userAgent,
  });

  await exports.recordConsent({
    userId:       user.id,
    consentType:  'privacy_policy',
    version:      '2026-03-20',
    ip,
    userAgent,
  });

  // Create helper profile if role is helper
  if (role === ROLES.HELPER_FREE) {
    await db.query(
      `INSERT INTO helper_profiles (user_id, tier)
       VALUES ($1, 'free')`,
      [user.id]
    );
  }

  return { user, verifyToken };
};

// ─── Verify Password ──────────────────────────────────────────
exports.verifyPassword = async (plain, hash) => {
  return bcrypt.compare(plain, hash);
};

// ─── Verify Email ─────────────────────────────────────────────
exports.verifyEmail = async (token) => {
  const { rows } = await db.query(
    `UPDATE users
     SET email_verified       = true,
         email_verify_token   = NULL,
         email_verify_expires = NULL,
         updated_at           = now()
     WHERE email_verify_token   = $1
       AND email_verify_expires > now()
       AND email_verified       = false
     RETURNING id, email, first_name, role`,
    [token]
  );
  return rows[0] ?? null;
};

// ─── Update Role ──────────────────────────────────────────────
// Used only by admin/super_admin — never called from user-facing routes
exports.updateRole = async (userId, newRole, adminId) => {
  const validRoles = Object.values(ROLES);
  if (!validRoles.includes(newRole)) {
    throw new Error(`Invalid role: ${newRole}`);
  }

  const { rows } = await db.query(
    `UPDATE users
     SET role = $1, updated_at = now()
     WHERE id = $2
     RETURNING id, email, role`,
    [newRole, userId]
  );

  // Audit log
  await db.query(
    `INSERT INTO admin_audit_log
       (admin_id, action, target_type, target_id, after_state)
     VALUES ($1, 'role_changed', 'user', $2, $3)`,
    [adminId, userId, JSON.stringify({ new_role: newRole })]
  );

  return rows[0] ?? null;
};

// ─── Update Subscription Status ───────────────────────────────
exports.updateSubscriptionStatus = async (userId, status) => {
  await db.query(
    `UPDATE users
     SET subscription_status = $1, updated_at = now()
     WHERE id = $2`,
    [status, userId]
  );
};

// ─── Upgrade Helper Tier ──────────────────────────────────────
exports.upgradeHelperTier = async (userId, tier) => {
  const validTiers = ['free', 'pro', 'broker'];
  if (!validTiers.includes(tier)) {
    throw new Error(`Invalid tier: ${tier}`);
  }

  // Map tier to role
  const tierRoleMap = {
    free:   ROLES.HELPER_FREE,
    pro:    ROLES.HELPER_PRO,
    broker: ROLES.HELPER_BROKER,
  };

  await db.query(
    `UPDATE users
     SET role = $1, updated_at = now()
     WHERE id = $2`,
    [tierRoleMap[tier], userId]
  );

  await db.query(
    `UPDATE helper_profiles
     SET tier = $1, updated_at = now()
     WHERE user_id = $2`,
    [tier, userId]
  );
};

// ─── Record Consent ───────────────────────────────────────────
exports.recordConsent = async ({
  userId,
  consentType,
  version,
  ip       = null,
  userAgent = null,
}) => {
  await db.query(
    `INSERT INTO user_consents
       (user_id, consent_type, version, ip_hash, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, consentType, version, hashIP(ip), userAgent]
  );
};

// ─── Ban User ─────────────────────────────────────────────────
exports.ban = async (userId, reason, adminId) => {
  await db.query(
    `UPDATE users
     SET is_banned  = true,
         ban_reason = $1,
         banned_at  = now(),
         banned_by  = $2,
         is_active  = false,
         updated_at = now()
     WHERE id = $3`,
    [reason, adminId, userId]
  );

  // Audit log
  await db.query(
    `INSERT INTO admin_audit_log
       (admin_id, action, target_type, target_id, after_state)
     VALUES ($1, 'user_banned', 'user', $2, $3)`,
    [adminId, userId, JSON.stringify({ reason })]
  );
};

// ─── Soft Delete ──────────────────────────────────────────────
exports.softDelete = async (userId) => {
  await db.query(
    `UPDATE users
     SET deleted_at = now(),
         is_active  = false,
         email      = CONCAT('deleted_', id, '@oxsteed.invalid'),
         phone      = NULL,
         updated_at = now()
     WHERE id = $1`,
    [userId]
  );
};

// ─── Update Last Login ────────────────────────────────────────
exports.touchLastLogin = async (userId, ip) => {
  await db.query(
    `UPDATE users
     SET last_login_at     = now(),
         last_known_ip_hash = $1,
         updated_at         = now()
     WHERE id = $2`,
    [hashIP(ip), userId]
  );
};

// ─── Password Reset ───────────────────────────────────────────
exports.setResetToken = async (email) => {
  const token   = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  const { rows } = await db.query(
    `UPDATE users
     SET reset_token         = $1,
         reset_token_expires = $2,
         updated_at          = now()
     WHERE LOWER(email) = LOWER($3)
       AND deleted_at IS NULL
     RETURNING id, email, first_name`,
    [token, expires, email]
  );

  return rows[0] ? { user: rows[0], token } : null;
};

exports.resetPassword = async (token, newPassword) => {
  const hash = await hashPassword(newPassword);

  const { rows } = await db.query(
    `UPDATE users
     SET password_hash       = $1,
         reset_token         = NULL,
         reset_token_expires = NULL,
         updated_at          = now()
     WHERE reset_token         = $2
       AND reset_token_expires > now()
     RETURNING id, email, first_name`,
    [hash, token]
  );

  return rows[0] ?? null;
};

// ─── Feature flag check ───────────────────────────────────────
exports.getFeatureFlag = async (key) => {
  const { rows } = await db.query(
    `SELECT is_enabled FROM feature_flags WHERE key = $1`,
    [key]
  );
  return rows[0]?.is_enabled ?? false;
};
