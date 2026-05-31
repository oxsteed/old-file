// server/controllers/helperRegistrationController.js
const crypto = require('crypto');
const pool = require('../db');
const bcrypt = require('bcrypt');
const { generateTokens } = require('../middleware/auth');
const { formatAuthUser } = require('./authController');
const { sendOTPEmail } = require('../utils/email');
const { encrypt, hashTIN, maskTIN, hashIP } = require('../utils/encryption');
const { TERMS_CONFIG } = require('../constants/termsConfig');
const { trialDefaults } = require('../utils/trial');
const { uploadFile, getPublicUrl } = require('../utils/storage');
const { validate, rules } = require('../utils/validate');
const countriesUtil = require('../utils/countries');
const logger = require('../utils/logger');
const TERMS_IP_HASH_MAX_LEN = 45;
const SUPPORTED_LANGUAGE_CODES = new Set(['en', 'es', 'fr', 'ht', 'ar']);

function resolveRequestLanguage(req, fallback = 'en') {
  const candidate =
    req?.body?.language ||
    req?.headers?.['x-preferred-language'] ||
    req?.headers?.['accept-language'] ||
    '';

  const parsed = String(candidate || '')
    .split(',')[0]
    .trim()
    .split('-')[0]
    .toLowerCase();

  return SUPPORTED_LANGUAGE_CODES.has(parsed) ? parsed : fallback;
}

async function pendingRegistrationsHasRoleColumn() {
  const { rows } = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'pending_registrations'
       AND column_name = 'role'`
  );
  return rows.length > 0;
}

// ── helpers ────────────────────────────────────────────
function generateOTP() {
  return crypto.randomInt(100000, 1000000).toString();
}

function otpExpiry() {
  return new Date(Date.now() + 10 * 60 * 1000); // 10 min
}

// GET /api/helper-registration/categories
async function getCategories(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, slug, icon
       FROM categories
       WHERE is_active = TRUE
       ORDER BY sort_order ASC, id ASC`
    );
    return res.json({ categories: rows });
  } catch (err) {
    logger.error('getCategories error', { err });
    return res.status(500).json({ error: 'Failed to load categories' });
  }
}

// ── 1. Start Registration ────────────────────────────────────
// POST /api/helper-registration/start
async function startRegistration(req, res) {
  try {
    const {
      email,
      password,
      firstName,
      lastName,
      phone,
      zip,
      addressLine1,
      address_line1,
      city,
      state,
      country,
      ageConfirmed,
    } = req.body;

    const line1 = String(addressLine1 ?? address_line1 ?? '').trim();
    const cityTrim = String(city || '').trim();
    const countryCode = countriesUtil.normalizeCountry(country, 'US');
    const stateTrim = countriesUtil.hasRegions(countryCode)
      ? String(state || '').trim().toUpperCase()
      : String(state || '').trim();

    const normalized = {
      email: String(email || '').trim().toLowerCase(),
      password,
      firstName: String(firstName || '').trim(),
      lastName: String(lastName || '').trim(),
      phone: String(phone || '').trim(),
      zip: String(zip || '').trim(),
      addressLine1: line1,
      city: cityTrim,
      state: stateTrim,
      country: countryCode,
      ageConfirmed,
    };

    const errs = validate(normalized, {
      email:     [rules.required, rules.email, rules.maxLen(254)],
      password:  [rules.required, rules.minLen(8), rules.maxLen(128)],
      firstName: [rules.required, rules.minLen(1), rules.maxLen(50), rules.noScript],
      lastName:  [rules.required, rules.minLen(1), rules.maxLen(50), rules.noScript],
      phone:     [rules.required, rules.phone, rules.maxLen(20)],
      addressLine1: [rules.required, rules.minLen(1), rules.maxLen(255), rules.noScript],
      city:      [rules.required, rules.minLen(1), rules.maxLen(100), rules.noScript],
      country:   [rules.required, rules.country],
      state:     [rules.required, rules.maxLen(100), rules.regionFor(countryCode), rules.noScript],
      zip:       countriesUtil.hasPostalCode(countryCode)
        ? [rules.required, rules.maxLen(20), rules.postalFor(countryCode)]
        : [rules.maxLen(20)],
    });
    if (errs) {
      // Log which fields failed so WARN 400s in production are self-diagnosing
      logger.warn('startRegistration validation_failed', {
        fields: Object.keys(errs),
        ip: req.ip,
      });
      return res.status(400).json({ error: 'validation_failed', fields: errs });
    }

    // Check for existing user
    const dup = await pool.query(
      'SELECT id FROM users WHERE email = $1', [normalized.email]);
    if (dup.rows.length)
      return res.status(409).json({ error: 'Email already registered' });

    const password_hash = await bcrypt.hash(password, 12);
    const otp = generateOTP();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const otp_expires = otpExpiry();

    // Generate a unique token for this registration
    const token = crypto.randomBytes(32).toString('hex');

    const hasRole = await pendingRegistrationsHasRoleColumn();

    // Delete any existing pending registration for this email, then insert fresh
    await pool.query(
      hasRole
        ? 'DELETE FROM pending_registrations WHERE email = $1 AND (role = $2 OR role IS NULL)'
        : 'DELETE FROM pending_registrations WHERE email = $1',
      hasRole ? [email, 'helper'] : [email]
    );

    const result = hasRole
      ? await pool.query(`
          INSERT INTO pending_registrations
            (token, email, password_hash, first_name, last_name, phone, zip_code,
             address_line1, city, state, country,
             role, otp_code, otp_expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'helper',$12,$13)
          RETURNING token
        `, [
          token,
          normalized.email,
          password_hash,
          normalized.firstName,
          normalized.lastName,
          normalized.phone,
          normalized.zip,
          normalized.addressLine1,
          normalized.city,
          normalized.state,
          normalized.country,
          otpHash,
          otp_expires,
        ])
      : await pool.query(`
          INSERT INTO pending_registrations
            (token, email, password_hash, first_name, last_name, phone, zip_code,
             address_line1, city, state, country,
             otp_code, otp_expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          RETURNING token
        `, [
          token,
          normalized.email,
          password_hash,
          normalized.firstName,
          normalized.lastName,
          normalized.phone,
          normalized.zip,
          normalized.addressLine1,
          normalized.city,
          normalized.state,
          normalized.country,
          otpHash,
          otp_expires,
        ]);

    await sendOTPEmail(normalized.email, otp, resolveRequestLanguage(req));

    res.status(201).json({
      message: 'OTP sent to email',
      token: result.rows[0].token,
    });
  } catch (err) {
    if (err?.code === '22001') {
      return res.status(400).json({ error: 'One or more registration fields are too long' });
    }
    logger.error('startRegistration error:', { err });
    res.status(500).json({ error: 'Registration failed' });
  }
}

// ── 2. Verify OTP - creates the helper user and returns auth tokens ──
// POST /api/helper-registration/verify-otp
async function verifyOTP(req, res) {
  const { token, otp } = req.body;
  if (!token || !otp)
    return res.status(400).json({ error: 'Token and OTP required' });

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, email, password_hash, first_name, last_name, phone, zip_code,
              address_line1, city, state,
              otp_code, otp_expires_at, otp_attempts, otp_locked_until, user_id, account_created
       FROM pending_registrations
       WHERE token = $1 AND role = 'helper'`,
      [token]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No pending registration found' });
    }

    const reg = rows[0];

    if (reg.otp_locked_until && new Date(reg.otp_locked_until) > new Date()) {
      await client.query('ROLLBACK');
      return res.status(429).json({ error: 'Account locked due to too many failed attempts. Try again in 1 hour.', lockUntil: reg.otp_locked_until });
    }

    const otpHash  = crypto.createHash('sha256').update(otp).digest('hex');
    const expired  = reg.otp_expires_at && new Date(reg.otp_expires_at) < new Date();
    // Use timing-safe comparison to prevent timing attacks on the OTP hash (I-09)
    const storedBuf   = Buffer.from(reg.otp_code || '', 'hex');
    const computedBuf = Buffer.from(otpHash, 'hex');
    const hashMatch   = storedBuf.length === computedBuf.length &&
                        crypto.timingSafeEqual(storedBuf, computedBuf);

    if (!hashMatch || expired) {
      const newAttempts = (reg.otp_attempts || 0) + 1;
      if (newAttempts >= 3) {
        await client.query(
          "UPDATE pending_registrations SET otp_attempts = $2, otp_locked_until = NOW() + interval '1 hour' WHERE token = $1",
          [token, newAttempts]
        );
        await client.query('COMMIT');
        return res.status(429).json({ error: 'Too many failed attempts. Locked for 1 hour.' });
      }
      await client.query('UPDATE pending_registrations SET otp_attempts = $2 WHERE token = $1', [token, newAttempts]);
      await client.query('COMMIT');
      return res.status(400).json({ error: 'Invalid or expired OTP', attemptsRemaining: 3 - newAttempts });
    }

    let userId;

    if (reg.user_id && reg.account_created) {
      // Account was already created on a previous OTP verify (idempotent re-verify)
      userId = reg.user_id;
    } else {
      // Create the helper user row
      const { trial_started_at, trial_ends_at } = await trialDefaults();
      const addr1 = (reg.address_line1 || '').trim() || null;
      const cityU = (reg.city || '').trim() || null;
      const countryU = countriesUtil.normalizeCountry(reg.country, 'US');
      const rawState = (reg.state || '').trim();
      const stateU = rawState
        ? (countriesUtil.hasRegions(countryU) ? rawState.toUpperCase() : rawState)
        : null;
      const preferredCurrency = countriesUtil.getDefaultCurrency(countryU);

      const userResult = await client.query(`
        INSERT INTO users (email, password_hash, first_name, last_name, phone, zip_code,
                           city, state, address_line1, country, preferred_currency,
                           role, email_verified, onboarding_status, onboarding_completed,
                           membership_tier, profile_completed, tier_selected, terms_accepted, contact_completed,
                           trial_started_at, trial_ends_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'helper', true, 'onboarding_complete', TRUE,
                'tier1', TRUE, TRUE, TRUE, TRUE,
                $12, $13)
        RETURNING id
      `, [reg.email, reg.password_hash, reg.first_name, reg.last_name,
          reg.phone || null, reg.zip_code || null,
          cityU, stateU, addr1, countryU, preferredCurrency,
          trial_started_at, trial_ends_at]);

      userId = userResult.rows[0].id;

      await client.query(
        `INSERT INTO helper_profiles (user_id, tier, is_listed, service_city, service_state, service_zip, created_at, updated_at)
         VALUES ($1, 'tier1', false, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           service_city = COALESCE(EXCLUDED.service_city, helper_profiles.service_city),
           service_state = COALESCE(EXCLUDED.service_state, helper_profiles.service_state),
           service_zip = COALESCE(EXCLUDED.service_zip, helper_profiles.service_zip),
           updated_at = NOW()`,
        [userId, cityU, stateU, reg.zip_code || null],
      );

      // Mark the pending row so we don't re-create on retry
      await client.query(
        `UPDATE pending_registrations
         SET user_id = $1, account_created = true, otp_code = NULL, otp_attempts = -1
         WHERE id = $2`,
        [userId, reg.id]
      );
    }

    await client.query('COMMIT');

    // Fetch the full user row (outside txn - data is committed)
    const { rows: fullRows } = await pool.query(
      `SELECT id, first_name, last_name, email, phone, role, email_verified, is_verified,
              onboarding_status, onboarding_completed, contact_completed, profile_completed,
              tier_selected, w9_completed, terms_accepted, membership_tier, id_verified,
              background_check_passed, city, state, zip_code,
              trial_started_at, trial_ends_at, didit_status, didit_verified_at,
              COALESCE(didit_enforcement_required, FALSE) AS didit_enforcement_required
       FROM users WHERE id = $1`,
      [userId]
    );

    const tokens = generateTokens(fullRows[0]);
    // Persist the refresh token so subsequent /auth/refresh calls work
    const hashedRefresh = crypto.createHash('sha256').update(tokens.refreshToken).digest('hex');
    await pool.query(
      "INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval '7 days')",
      [userId, hashedRefresh]
    );

    res.json({
      message: 'Email verified',
      user: formatAuthUser(fullRows[0]),
      ...tokens
    });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    }
    logger.error('verifyOTP error:', { err });
    res.status(500).json({ error: 'OTP verification failed' });
  } finally {
    if (client) client.release();
  }
}

// ── 3. Resend OTP ──────────────────────────────────────────
// POST /api/helper-registration/resend-otp
async function resendOTP(req, res) {
  try {
    const { email, token } = req.body;
    if (!email && !token) {
      return res.status(400).json({ error: 'Email or token required' });
    }

    const otp = generateOTP();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const otp_expires = otpExpiry();

    const lookup = token
      ? { where: 'token = $3', value: token }
      : { where: 'email = $3', value: email };

    const { rows } = await pool.query(
      `UPDATE pending_registrations
       SET otp_code = $1, otp_expires_at = $2, otp_attempts = 0
       WHERE ${lookup.where} AND role = 'helper'
       RETURNING email`,
      [otpHash, otp_expires, lookup.value]
    );

    if (!rows.length)
      return res.status(404).json({ error: 'No pending registration found' });

    await sendOTPEmail(rows[0].email, otp, resolveRequestLanguage(req));
    res.json({ message: 'New OTP sent' });
  } catch (err) {
    logger.error('resendOTP error:', { err });
    res.status(500).json({ error: 'Resend OTP failed' });
  }
}

// ── 4. DEPRECATED - completeRegistration ─────────────────
async function completeRegistration(req, res) {
  const { email, token } = req.body;
  if (!email && !token) return res.status(400).json({ error: 'Email or token required' });

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const lookupClause = token ? 'token = $1' : 'email = $1';

    const { rows } = await client.query(
      `SELECT * FROM pending_registrations
       WHERE ${lookupClause} AND role = 'helper' AND otp_attempts = -1`,
      [token || email]
    );
    if (!rows.length)
      return res.status(400).json({ error: 'Email not verified or no pending registration' });

    const reg = rows[0];

    const userResult = await client.query(`
      INSERT INTO users (email, password_hash, first_name, last_name, phone, zip_code, role,
                         membership_tier, onboarding_status, onboarding_completed, email_verified)
      VALUES ($1,$2,$3,$4,$5,$6,'helper','tier1','verified_pending_onboarding',false,true)
      RETURNING id, email, first_name, last_name, phone, zip_code, role, membership_tier, onboarding_status
    `, [reg.email, reg.password_hash, reg.first_name, reg.last_name, reg.phone || null, reg.zip_code || null]);

    const user = userResult.rows[0];

    await client.query('DELETE FROM pending_registrations WHERE id = $1', [reg.id]);
    await client.query('COMMIT');

    const { rows: fullRows } = await pool.query(
      `SELECT id, first_name, last_name, email, phone, role, email_verified, is_verified,
              onboarding_status, onboarding_completed, contact_completed, profile_completed,
              tier_selected, w9_completed, terms_accepted, membership_tier, id_verified,
              background_check_passed, city, state, zip_code
       FROM users WHERE id = $1`,
      [user.id]
    );

    const tokens = generateTokens(fullRows[0]);
    res.status(201).json({
      message: 'Registration complete',
      user: formatAuthUser(fullRows[0]),
      ...tokens
    });
  } catch (err) {
    logger.error('completeRegistration (deprecated) error:', { err });
    res.status(500).json({ error: 'Registration completion failed' });
  } finally {
    if (client) client.release();
  }
}

// ── 5. Submit Onboarding Profile ─────────────────────────
// PUT /api/helper-registration/onboarding/profile
async function submitOnboardingProfile(req, res) {
  try {
    const userId = req.user.id;
    const { phone, city, state, zip_code, bio, skills } = req.body;

    if (!phone || !city || !state || !zip_code)
      return res.status(400).json({ error: 'Required profile fields missing' });

    // Update contact fields on users table (no bio/skills - those live in helper_profiles)
    await pool.query(`
      UPDATE users SET
        phone             = $1,
        city              = $2,
        state             = $3,
        zip_code          = $4,
        profile_completed = true,
        contact_completed = true,
        onboarding_status = 'onboarding_in_progress'
      WHERE id = $5 AND role = 'helper'
    `, [phone, city, state, zip_code, userId]);

    // Upsert bio and location into helper_profiles
    await pool.query(`
      INSERT INTO helper_profiles (user_id, bio_long, service_city, service_state, service_zip)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id) DO UPDATE SET
        bio_long      = EXCLUDED.bio_long,
        service_city  = EXCLUDED.service_city,
        service_state = EXCLUDED.service_state,
        service_zip   = EXCLUDED.service_zip,
        updated_at    = NOW()
    `, [userId, bio || null, city, state, zip_code]);

    res.json({ message: 'Profile saved', onboarding_step: 'profile_complete' });
  } catch (err) {
    logger.error('submitOnboardingProfile error:', { err });
    res.status(500).json({ error: 'Profile save failed' });
  }
}

// ── 6. Submit ID Verification ────────────────────────
async function submitIdVerification(req, res) {
  try {
    const userId = req.user.id;
    const { id_document_url } = req.body;

    if (!id_document_url)
      return res.status(400).json({ error: 'ID document URL required' });

    await pool.query(`
      UPDATE users SET
        id_verified       = false,
        onboarding_status = 'onboarding_in_progress'
      WHERE id = $1 AND role = 'helper'
    `, [userId]);

    res.json({ message: 'ID submitted for review', onboarding_step: 'id_submitted' });
  } catch (err) {
    logger.error('submitIdVerification error:', { err });
    res.status(500).json({ error: 'ID verification submission failed' });
  }
}

// ── 7. Submit Background Check ───────────────────────
async function submitBackgroundCheck(req, res) {
  try {
    const userId = req.user.id;
    const { background_check_consent } = req.body;

    if (!background_check_consent)
      return res.status(400).json({ error: 'Background check consent required' });

    await pool.query(`
      UPDATE users SET
        background_check_passed = false,
        onboarding_status       = 'onboarding_in_progress'
      WHERE id = $1 AND role = 'helper'
    `, [userId]);

    res.json({ message: 'Background check submitted', onboarding_step: 'background_submitted' });
  } catch (err) {
    logger.error('submitBackgroundCheck error:', { err });
    res.status(500).json({ error: 'Background check submission failed' });
  }
}

// ── 8. Get Onboarding Status ─────────────────────────
async function getOnboardingStatus(req, res) {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `SELECT u.onboarding_status, u.membership_tier, u.id_verified,
              u.background_check_passed, u.profile_completed, u.contact_completed,
              u.tier_selected, u.w9_completed, u.terms_accepted, u.onboarding_completed,
              hp.bio_long AS bio
       FROM users u
       LEFT JOIN helper_profiles hp ON hp.user_id = u.id
       WHERE u.id = $1 AND u.role = 'helper'`,
      [userId]
    );

    if (!rows.length)
      return res.status(404).json({ error: 'Helper not found' });

    const u = rows[0];

    let onboarding_step = 'registered';
    if (u.onboarding_completed || u.onboarding_status === 'onboarding_complete') {
      onboarding_step = 'active';
    } else if (u.w9_completed || u.terms_accepted) {
      onboarding_step = 'tax_complete';
    } else if (u.tier_selected) {
      onboarding_step = 'plan_selected';
    } else if (u.profile_completed) {
      onboarding_step = 'profile_complete';
    } else {
      onboarding_step = 'email_verified';
    }

    res.json({
      onboarding_step,
      membership_tier:         u.membership_tier,
      id_verified:             u.id_verified,
      background_check_passed: u.background_check_passed,
      profile_complete:        !!u.profile_completed,
      canBrowseJobs:           true,
      canApplyToJobs:          u.membership_tier === 'tier2' || u.onboarding_completed,
      canAppearInSearch:       u.membership_tier === 'tier2' && u.onboarding_completed,
    });
  } catch (err) {
    logger.error('getOnboardingStatus error:', { err });
    res.status(500).json({ error: 'Failed to get onboarding status' });
  }
}

// ── 9. Submit Profile (called by frontend Step 4) ────────
// POST /api/helper-registration/profile
async function submitProfile(req, res) {
  try {
    const userId = req.user.id;
    const { bio, serviceCategories, serviceRadius, ratePreference } = req.body;

    // Mark profile complete on users table
    await pool.query(`
      UPDATE users SET
        profile_completed = true,
        onboarding_status = 'onboarding_in_progress'
      WHERE id = $1 AND role = 'helper'
    `, [userId]);

    // Upsert bio and service info into helper_profiles
    // Note: profile_headline column does not exist in this DB - omitted
    await pool.query(`
      INSERT INTO helper_profiles (user_id, bio_long, service_radius_miles, rate_preference)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id) DO UPDATE SET
        bio_long             = EXCLUDED.bio_long,
        service_radius_miles = EXCLUDED.service_radius_miles,
        rate_preference      = EXCLUDED.rate_preference,
        updated_at           = NOW()
    `, [userId, bio || null, serviceRadius || 10, ratePreference || 'per_job']);

    res.json({ message: 'Profile saved', onboarding_step: 'profile_complete' });
  } catch (err) {
    logger.error('submitProfile error:', { err });
    res.status(500).json({ error: 'Profile save failed' });
  }
}

// ── 10. Update Contact Info (called by frontend Step 4) ──
// POST /api/helper-registration/update-contact
async function updateContact(req, res) {
  try {
    const userId = req.user.id;
    const { phone, zip } = req.body;

    if (!phone || !zip) return res.status(400).json({ error: 'Phone and zip required' });

    const { rows } = await pool.query(`
      UPDATE users SET
        phone             = $1,
        zip_code          = $2,
        contact_completed = true
      WHERE id = $3 AND role = 'helper'
      RETURNING id
    `, [phone, zip, userId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Helper account not found' });
    }

    res.json({ message: 'Contact updated' });
  } catch (err) {
    logger.error('updateContact error:', { err });
    res.status(500).json({ error: 'Contact update failed' });
  }
}

// ── 11. Upload Profile Photo ───────────────────────────
// POST /api/helper-registration/profile-photo
async function uploadProfilePhoto(req, res) {
  try {
    const userId = req.user.id;
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

    const allowedMime = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedMime.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Only JPEG, PNG, WebP, or GIF images allowed' });
    }

    // Upload to S3; fall back to base64 data-URL only if S3 is not configured
    let photoUrl;
    const s3Key = await uploadFile(req.file.buffer, 'avatars', req.file.originalname, req.file.mimetype);
    if (s3Key) {
      photoUrl = getPublicUrl(s3Key);
    } else {
      // S3 not configured - store compact base64 for dev/staging only
      photoUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }

    await pool.query(
      'UPDATE users SET profile_photo_url = $1, avatar_url = $1 WHERE id = $2',
      [photoUrl, userId]
    );
    await pool.query(
      `INSERT INTO helper_profiles (user_id, profile_photo_url)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET profile_photo_url = $2, updated_at = NOW()`,
      [userId, photoUrl]
    );
    res.json({ message: 'Photo uploaded', photoUrl });
  } catch (err) {
    logger.error('uploadProfilePhoto error:', { err });
    res.status(500).json({ error: 'Photo upload failed' });
  }
}

// ── 12. Save selected tier ──────────────────────────────
// POST /api/helper-registration/tier
async function saveTier(req, res) {
  let client;
  try {
    const userId = req.user.id;
    const { tier } = req.body;
    const allowed = new Set(['free', 'basic', 'pro', 'tier1', 'tier2']);
    if (!allowed.has(String(tier || ''))) {
      return res.status(400).json({ error: 'Invalid tier selection' });
    }

    // Normalize to canonical tier values: 'tier1' (free) or 'tier2' (paid)
    const normalized = (tier === 'pro' || tier === 'basic' || tier === 'tier2') ? 'tier2' : 'tier1';

    // ── SECURITY: Prevent tier upgrade bypass ────────────────────────────
    // Users must complete identity verification before upgrading to paid tier.
    // Fetch fresh DB state (not stale JWT) to prevent race conditions.
    if (normalized === 'tier2') {
      client = await pool.connect();
      const { rows } = await client.query(
        'SELECT id_verified FROM users WHERE id = $1 AND role = $2 FOR UPDATE',
        [userId, 'helper']
      );
      if (!rows.length) {
        client.release();
        return res.status(404).json({ error: 'Helper account not found' });
      }
      if (!rows[0].id_verified) {
        client.release();
        return res.status(403).json({
          error: 'Onboarding incomplete',
          message: 'Complete identity verification before upgrading to paid tier',
          required_step: 'id_verified'
        });
      }
      client.release();
      client = null;
    }

    // Update with canonical tier representation in both tables
    const { rows: updateRows } = await pool.query(
      `UPDATE users
       SET tier_selected   = TRUE,
           membership_tier = $1,
           updated_at      = NOW()
       WHERE id = $2 AND role = 'helper'
       RETURNING id`,
      [normalized, userId]
    );
    if (updateRows.length === 0) {
      return res.status(404).json({ error: 'Helper account not found' });
    }

    await pool.query(
      `INSERT INTO helper_profiles (user_id, tier)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET tier = $2, updated_at = NOW()`,
      [userId, normalized]
    );

    return res.json({ message: 'Tier saved', membership_tier: normalized });
  } catch (err) {
    if (client) {
      try { client.release(); } catch (_) { /* ignore */ }
    }
    logger.error('saveTier error:', { err });
    return res.status(500).json({ error: 'Failed to save tier' });
  }
}

// ── 13. Save W9 information ────────────────────────────
// POST /api/helper-registration/w9
async function saveW9(req, res) {
  try {
    const userId = req.user.id;
    const { legalName, businessName, taxClassification, tin, address, signatureData, certify } = req.body;

    if (!legalName || !taxClassification || !tin || !address || !signatureData || !certify) {
      return res.status(400).json({ error: 'Missing required W9 fields' });
    }

    const sanitizedTIN = String(tin).replace(/\D/g, '');
    if (sanitizedTIN.length < 9) {
      return res.status(400).json({ error: 'TIN must be at least 9 digits' });
    }

    // Note: tin_verified column does not exist in this DB - omitted from INSERT
    await pool.query(
      `INSERT INTO w9_records
       (user_id, legal_name, business_name, tax_classification, ssn_last4, tin_encrypted,
        address, signature_data, signed_at, ip_address, user_agent, year_applicable)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, $11)`,
      [
        userId, legalName, businessName || null, taxClassification,
        maskTIN(sanitizedTIN).slice(-4), encrypt(sanitizedTIN),
        address, signatureData,
        hashIP(req.ip || 'unknown'), req.headers['user-agent'] || '',
        new Date().getUTCFullYear()
      ]
    );

    await pool.query(
      `UPDATE users
       SET w9_completed    = TRUE,
           w9_on_file      = TRUE,
           tax_id_last4    = $1,
           w9_submitted_at = NOW(),
           updated_at      = NOW()
       WHERE id = $2`,
      [maskTIN(sanitizedTIN).slice(-4), userId]
    );

    return res.json({ message: 'W9 saved successfully' });
  } catch (err) {
    logger.error('saveW9 error:', { err });
    return res.status(500).json({ error: 'Failed to save W9 information' });
  }
}

// ── 14. Accept terms ──────────────────────────────────
// POST /api/helper-registration/accept-terms
async function acceptTerms(req, res) {
  try {
    const userId = req.user.id;
    const termsVersion = TERMS_CONFIG?.terms_of_service?.version || '2026-03-20';
    const { rows } = await pool.query(
      `UPDATE users
       SET terms_accepted      = TRUE,
           terms_accepted_at   = NOW(),
           terms_version       = $1,
           terms_acceptance_ip = $2,
           terms_acceptance_ua = $3,
           updated_at          = NOW()
       WHERE id = $4 AND role = 'helper'
       RETURNING id`,
      [
        termsVersion,
        hashIP(req.ip || 'unknown')?.slice(0, TERMS_IP_HASH_MAX_LEN) || null,
        req.headers['user-agent'] || '',
        userId
      ]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Helper account not found' });
    }
    return res.json({ message: 'Terms accepted' });
  } catch (err) {
    logger.error('acceptTerms helper error:', { err });
    return res.status(500).json({ error: 'Failed to accept terms' });
  }
}

// ── 15. Finalize helper onboarding ──────────────────────
// POST /api/helper-registration/finalize
async function finalizeRegistration(req, res) {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `UPDATE users
       SET onboarding_completed = TRUE,
           onboarding_status    = 'onboarding_complete',
           updated_at           = NOW()
       WHERE id = $1 AND role = 'helper'
       RETURNING id`,
      [userId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Helper account not found' });
    }
    return res.json({ message: 'Helper registration finalized' });
  } catch (err) {
    logger.error('finalizeRegistration error:', { err });
    return res.status(500).json({ error: 'Failed to finalize registration' });
  }
}

// ── 16. Legacy payment step (no-op) ──────────────────
async function savePaymentStep(req, res) {
  return res.json({ message: 'Payment step recorded' });
}

module.exports = {
  startRegistration,
  verifyOTP,
  resendOTP,
  getCategories,
  completeRegistration,
  submitOnboardingProfile,
  submitIdVerification,
  submitBackgroundCheck,
  getOnboardingStatus,
  submitProfile,
  updateContact,
  uploadProfilePhoto,
  saveTier,
  saveW9,
  acceptTerms,
  finalizeRegistration,
  savePaymentStep,
};
