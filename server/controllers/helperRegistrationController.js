// server/controllers/helperRegistrationController.js
const crypto = require('crypto');
const { setSessionCookies, setAccessTokenCookie } = require('../utils/authCookies');
const pool = require('../db');
const bcrypt = require('bcrypt');
const { generateTokens } = require('../middleware/auth');
const { formatAuthUser } = require('./authController');
const { sendOTPEmail } = require('../utils/email');
const { encrypt, hashTIN, maskTIN, hashIP } = require('../utils/encryption');
const { TERMS_CONFIG } = require('../constants/termsConfig');
const { trialDefaults, hasProAccess } = require('../utils/trial');
const { validate, rules } = require('../utils/validate');
const { assertRegistrationsOpen } = require('../middleware/maintenanceGate'); // Review P3-7-F07
const countriesUtil = require('../utils/countries');
const logger = require('../utils/logger');
const { ONBOARDING_COLUMNS, deriveHelperOnboarding } = require('../services/helperOnboarding');
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

    // Review P3-7-F07: 'new_user_registrations' kill-switch. Checked after
    // input validation (so invalid input still 400s without a settings
    // lookup) but before any account state is created.
    await assertRegistrationsOpen();

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
              otp_code, otp_expires_at, otp_attempts, otp_locked_until, user_id, account_created,
              terms_accepted_at, terms_version, terms_acceptance_ip, terms_acceptance_ua
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

    // Review P2-477: helpers must have recorded consent (via
    // /registration-terms) before an account is created.
    if (!(reg.user_id && reg.account_created) && !(reg.terms_accepted_at && reg.terms_version)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Terms must be accepted before verifying', code: 'terms_required' });
    }

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
                           terms_accepted_at, terms_version, terms_acceptance_ip, terms_acceptance_ua,
                           trial_started_at, trial_ends_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'helper', true, 'verified_pending_onboarding', FALSE,
                'tier1', FALSE, TRUE, TRUE, $12,
                $13, $14, $15, $16,
                $17, $18)
        RETURNING id
      `, [reg.email, reg.password_hash, reg.first_name, reg.last_name,
          reg.phone || null, reg.zip_code || null,
          cityU, stateU, addr1, countryU, preferredCurrency,
          Boolean(reg.phone && reg.zip_code),
          reg.terms_accepted_at, reg.terms_version, reg.terms_acceptance_ip || null, reg.terms_acceptance_ua || null,
          trial_started_at, trial_ends_at]);

      userId = userResult.rows[0].id;

      const { rows: hpUpsertRows } = await client.query(
        `INSERT INTO helper_profiles (user_id, tier, is_listed, service_city, service_state, service_zip, created_at, updated_at)
         VALUES ($1, 'tier1', false, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           service_city = COALESCE(EXCLUDED.service_city, helper_profiles.service_city),
           service_state = COALESCE(EXCLUDED.service_state, helper_profiles.service_state),
           service_zip = COALESCE(EXCLUDED.service_zip, helper_profiles.service_zip),
           updated_at = NOW()
         RETURNING id`,
        [userId, cityU, stateU, reg.zip_code || null],
      );
      // Mint universal entity IDs (migration 670) inside the same transaction.
      {
        const { getOrMintEntityId, grantLink } = require('../lib/entityIds');
        const personPublicId = await getOrMintEntityId(client, 'person', userId);
        let helperProfileId = hpUpsertRows[0]?.id;
        if (!helperProfileId) {
          const { rows: hpIdRows } = await client.query(
            'SELECT id FROM helper_profiles WHERE user_id = $1', [userId]
          );
          helperProfileId = hpIdRows[0]?.id;
        }
        if (helperProfileId) {
          const profilePublicId = await getOrMintEntityId(client, 'helper_profile', helperProfileId);
          await grantLink(client, { subjectId: personPublicId, objectId: profilePublicId, relation: 'acts_as' });
        }
      }

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
      "INSERT INTO sessions (user_id, refresh_token, access_token_hash, expires_at) VALUES ($1, $2, $3, NOW() + interval '7 days')",
      [userId, hashedRefresh, crypto.createHash('sha256').update(tokens.accessToken).digest('hex')]
    );
    setSessionCookies(res, tokens);

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
        onboarding_status = CASE WHEN onboarding_status = 'verified_pending_onboarding'
                                 THEN 'onboarding_in_progress' ELSE onboarding_status END
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


// ── 7. Submit Background Check ───────────────────────
async function submitBackgroundCheck(req, res) {
  try {
    const userId = req.user.id;
    const { background_check_consent } = req.body;

    if (!background_check_consent)
      return res.status(400).json({ error: 'Background check consent required' });

    // Review P2-595: never overwrite an existing result; record consent only.
    const { rows } = await pool.query(`
      UPDATE users SET
        background_check_status = COALESCE(background_check_status, 'consented'),
        onboarding_status       = CASE WHEN onboarding_status = 'verified_pending_onboarding'
                                       THEN 'onboarding_in_progress' ELSE onboarding_status END
      WHERE id = $1 AND role = 'helper'
      RETURNING background_check_status, background_check_passed
    `, [userId]);
    if (!rows.length) return res.status(404).json({ error: 'Helper not found' });

    res.json({ message: 'Background check consent recorded', onboarding_step: 'background_submitted',
      background_check_status: rows[0].background_check_status });
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
      `SELECT ${ONBOARDING_COLUMNS}, membership_tier, trial_ends_at, tier_selected, w9_completed
       FROM users WHERE id = $1 AND role = 'helper'`,
      [userId]
    );
    if (!rows.length)
      return res.status(404).json({ error: 'Helper not found' });

    const u = rows[0];
    const onboarding = deriveHelperOnboarding(u);
    let onboarding_step = 'email_verified';
    if (onboarding.complete && u.onboarding_completed) onboarding_step = 'active';
    else if (onboarding.complete) onboarding_step = 'ready_to_finalize';
    else if (onboarding.steps.profile) onboarding_step = 'profile_complete';

    res.json({
      onboarding_step,
      steps:                   onboarding.steps,
      missing:                 onboarding.missing,
      membership_tier:         u.membership_tier,
      id_verified:             onboarding.steps.identityVerified,
      background_check_passed: onboarding.steps.background === 'passed',
      profile_complete:        onboarding.steps.profile,
      terms_accepted:          onboarding.steps.terms,
      onboarding_completed:    Boolean(u.onboarding_completed),
      canBrowseJobs:           true,
      canApplyToJobs:          Boolean(u.onboarding_completed && onboarding.complete),
      canAppearInSearch:       Boolean(u.onboarding_completed && onboarding.canAppearInSearch),
    });
  } catch (err) {
    logger.error('getOnboardingStatus error:', { err });
    res.status(500).json({ error: 'Failed to get onboarding status' });
  }
}



// ── 11. Save W9 information ────────────────────────────
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

// ── 12. Accept terms ──────────────────────────────────
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

// Review P2-477: record terms consent on the pending registration (by its
// opaque token) before OTP verification, without re-sending the OTP.
async function acceptPendingTerms(req, res) {
  const { token, accepted } = req.body || {};
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Token required' });
  if (accepted !== true) return res.status(400).json({ error: 'Terms must be accepted', code: 'terms_required' });
  try {
    const termsVersion = TERMS_CONFIG?.terms_of_service?.version || '2026-03-20';
    const { rows } = await pool.query(
      `UPDATE pending_registrations
       SET terms_accepted_at   = NOW(),
           terms_version       = $2,
           terms_acceptance_ip = $3,
           terms_acceptance_ua = $4
       WHERE token = $1 AND role = 'helper' AND COALESCE(account_created, false) = false
       RETURNING id`,
      [token, termsVersion,
        hashIP(req.ip || 'unknown')?.slice(0, TERMS_IP_HASH_MAX_LEN) || null,
        String(req.headers['user-agent'] || '').slice(0, 500)]
    );
    if (!rows.length) return res.status(404).json({ error: 'No pending registration found' });
    return res.json({ message: 'Terms accepted', terms_version: termsVersion });
  } catch (err) {
    logger.error('acceptPendingTerms error:', { err });
    return res.status(500).json({ error: 'Failed to accept terms' });
  }
}

// ── 13. Finalize helper onboarding ──────────────────────
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
         AND email_verified AND profile_completed AND contact_completed
         AND terms_accepted AND terms_accepted_at IS NOT NULL AND terms_version IS NOT NULL
         AND (id_verified OR identity_verified OR didit_status = 'verified')
       RETURNING id`,
      [userId]
    );
    if (!rows.length) {
      // Review P2-593: prerequisites are re-checked in the UPDATE itself.
      return res.status(409).json({ error: 'Onboarding prerequisites not met', code: 'onboarding_step_missing' });
    }
    return res.json({ message: 'Helper registration finalized' });
  } catch (err) {
    logger.error('finalizeRegistration error:', { err });
    return res.status(500).json({ error: 'Failed to finalize registration' });
  }
}


module.exports = {
  startRegistration,
  verifyOTP,
  resendOTP,
  getCategories,
  submitOnboardingProfile,
  submitBackgroundCheck,
  getOnboardingStatus,
  saveW9,
  acceptTerms,
  acceptPendingTerms,
  finalizeRegistration,
};
