// Phase 2 - Auth controller (register, login, OTP, refresh, logout)
// + Customer Registration Flow (3-step)
// + 2FA (TOTP) support on login
// OxSteed v2
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const pool = require('../db');
const { generateTokens } = require('../middleware/auth');
const { sendOTPEmail, sendPasswordResetEmail } = require('../utils/email');
const { sendOTPSMS } = require('../utils/sms');
const { TERMS_CONFIG } = require('../constants/termsConfig');
const { getEffectiveTier, isTrialActive, trialDaysLeft, trialDefaults } = require('../utils/trial');
const { validate, rules } = require('../utils/validate');
const logger = require('../utils/logger');
const SALT_ROUNDS = 12;

function formatAuthUser(user) {
  if (!user) return null;

      // Compute virtual onboarding_step from existing columns
    // Order matters: check from most-complete to least-complete
    let onboarding_step = 'registered';
    if (user.onboarding_completed || user.onboarding_status === 'onboarding_complete') {
      onboarding_step = 'active';
    } else if (user.w9_completed || user.terms_accepted) {
      onboarding_step = 'tax_complete';
    } else if (user.tier_selected) {
      onboarding_step = 'plan_selected';
    } else if (user.profile_completed) {
      onboarding_step = 'profile_complete';
    } else if (user.email_verified) {
      onboarding_step = 'email_verified';
    }

  return {
    id:                    user.id,
    first_name:            user.first_name,
    last_name:             user.last_name,
    email:                 user.email,
    phone:                 user.phone,
    role:                  user.role,
    email_verified:        !!user.email_verified,
    is_verified:           !!user.is_verified,
    onboarding_status:     user.onboarding_status,
    onboarding_completed:  !!user.onboarding_completed,
    onboarding_step:       onboarding_step,
    contact_completed:     !!user.contact_completed,
    profile_completed:     !!user.profile_completed,
    tier_selected:         !!user.tier_selected,
    w9_completed:          !!user.w9_completed,
    terms_accepted:        !!user.terms_accepted,
    membership_tier:       user.membership_tier,
    effective_tier:        getEffectiveTier(user),
    is_trial_active:       isTrialActive(user),
    trial_days_left:       trialDaysLeft(user),
    trial_ends_at:         user.trial_ends_at || null,
    didit_status:          user.didit_status || 'pending',
    didit_verified_at:     user.didit_verified_at || null,
    id_verified:           !!user.id_verified,
    background_check_passed: !!user.background_check_passed,
    city:                  user.city,
    state:                 user.state,
    zip_code:              user.zip_code,
    display_name_preference: user.display_name_preference || 'first_name',
    business_name:         user.business_name || null,
  };
}

async function register(req, res) {
  try {
    const { email, password, first_name, last_name, phone, role, language = 'en', ref } = req.body;

    const errs = validate(req.body, {
      email:      [rules.required, rules.email, rules.maxLen(254)],
      password:   [rules.required, rules.minLen(8), rules.maxLen(128)],
      first_name: [rules.required, rules.minLen(1), rules.maxLen(50), rules.noScript],
      last_name:  [rules.required, rules.minLen(1), rules.maxLen(50), rules.noScript],
      phone:      [rules.phone],
    });
    if (errs) return res.status(400).json({ error: 'validation_failed', fields: errs });
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const referralCode = crypto.randomBytes(6).toString('hex');
    const finalRole = role || 'customer';
const defaultOnboardingStatus = finalRole === 'helper' ? 'verified_pending_onboarding' : null;
const defaultMembershipTier = finalRole === 'helper' ? 'tier1' : null;
const { trial_started_at, trial_ends_at } = trialDefaults();

    // Resolve referrer from optional ?ref= code
    let referrerId = null;
    if (ref) {
      const { rows: refRows } = await pool.query(
        `SELECT id FROM users WHERE referral_code = $1`, [String(ref).trim()]
      );
      if (refRows.length) referrerId = refRows[0].id;
    }

const { rows } = await pool.query(
  `INSERT INTO users (email, password_hash, first_name, last_name, phone, role,
   preferred_language, referral_code, onboarding_status, membership_tier,
   trial_started_at, trial_ends_at, referred_by)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
   RETURNING id, email, role`,
  [email.toLowerCase(), passwordHash, first_name, last_name, phone || null,
   finalRole, language || 'en', referralCode,
   defaultOnboardingStatus, defaultMembershipTier,
   trial_started_at, trial_ends_at, referrerId]
);
    const user = rows[0];

    // Increment referrer's count
    if (referrerId) {
      pool.query(
        `UPDATE users SET referrals_count = referrals_count + 1 WHERE id = $1`,
        [referrerId]
      ).catch(err => logger.error('Failed to increment referrals_count', { err }));
    }
    const tokens = generateTokens(user);
    await pool.query(
      "INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval '7 days')",
      [user.id, tokens.refreshToken]
    );
   const { rows: fullRows } = await pool.query(
  `SELECT id, first_name, last_name, email, phone, role, email_verified, is_verified,
   onboarding_status, onboarding_completed, contact_completed, profile_completed,
   tier_selected, w9_completed, terms_accepted, membership_tier, id_verified,
   background_check_passed, city, state, zip_code,
   trial_started_at, trial_ends_at, didit_status, didit_verified_at
   FROM users WHERE id = $1`,
  [user.id]
);
res.status(201).json({ user: formatAuthUser(fullRows[0]), ...tokens });
  } catch (err) {
    logger.error('Register error', { err });
    res.status(500).json({ error: 'Registration failed' });
  }
}

// LOGIN - Updated to support 2FA
async function login(req, res) {
  try {
    const { email, password, rememberMe } = req.body;

    const errs = validate(req.body, {
      email:    [rules.required, rules.email],
      password: [rules.required],
    });
    if (errs) return res.status(400).json({ error: 'validation_failed', fields: errs });

    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, email, phone, password_hash, role, is_active,
              email_verified, is_verified,
              onboarding_status, onboarding_completed,
              contact_completed, profile_completed,
              tier_selected, w9_completed, terms_accepted,
              membership_tier, id_verified, background_check_passed,
              city, state, zip_code, totp_enabled,
              trial_started_at, trial_ends_at, didit_status, didit_verified_at
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Invalid credentials' });
    const user = rows[0];
    if (!user.is_active) return res.status(403).json({ error: 'Account deactivated' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    // 2FA check - totp_enabled may not exist yet if migration 022 hasn't run
    if (user.totp_enabled) {
      return res.status(200).json({
        requiresTwoFactor: true,
        userId: user.id,
        message: 'Please provide your 2FA code to complete login.'
      });
    }
    const tokens = generateTokens(user);
    const sessionSql = rememberMe
      ? "INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval '30 days')"
      : "INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval '7 days')";
    await pool.query(sessionSql, [user.id, tokens.refreshToken]);
    // Fetch tier from helper_profiles if helper, otherwise 'free'
    
    res.json({
      success: true,
      message: 'Login successful',
      user: formatAuthUser(user),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });
  } catch (err) {
    logger.error('Login error', { err });
    res.status(500).json({ error: 'Login failed' });
  }
}

// Complete login after 2FA verification
async function loginWith2FA(req, res) {
  try {
    const { userId, token, isBackupCode } = req.body;
    if (!userId || !token) {
      return res.status(400).json({ error: 'User ID and 2FA code required' });
    }
    const { rows } = await pool.query(
      'SELECT id, email, role, is_active, totp_secret, totp_enabled, backup_codes FROM users WHERE id = $1',
      [userId]
    );
    if (!rows[0] || !rows[0].totp_enabled) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    const user = rows[0];
    if (!user.is_active) return res.status(403).json({ error: 'Account deactivated' });
    let verified = false;
    if (isBackupCode) {
      const hashed = crypto.createHash('sha256').update(token.toLowerCase().trim()).digest('hex');
      const codes = user.backup_codes || [];
      const idx = codes.indexOf(hashed);
      if (idx !== -1) {
        codes.splice(idx, 1);
        await pool.query('UPDATE users SET backup_codes = $1 WHERE id = $2', [codes, userId]);
        verified = true;
      }
    } else {
      verified = speakeasy.totp.verify({
        secret: user.totp_secret,
        encoding: 'base32',
        token: token,
        window: 1
      });
    }
    if (!verified) {
      return res.status(401).json({ error: 'Invalid 2FA code' });
    }
    const tokens = generateTokens(user);
    await pool.query(
      "INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval '7 days')",
      [user.id, tokens.refreshToken]
    );
        const { rows: fullRows } = await pool.query(
      `SELECT id, first_name, last_name, email, phone, role, email_verified, is_verified,
       onboarding_status, onboarding_completed, contact_completed, profile_completed,
       tier_selected, w9_completed, terms_accepted, membership_tier, id_verified,
       background_check_passed, city, state, zip_code,
       trial_started_at, trial_ends_at, didit_status, didit_verified_at
       FROM users WHERE id = $1`,
      [user.id]
    );
    res.json({
      success: true,
      message: 'Login successful',
      user: formatAuthUser(fullRows[0]),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });
  } catch (err) {
    logger.error('Login 2FA error', { err });
    res.status(500).json({ error: 'Login failed' });
  }
}

async function requestOTP(req, res) {
  try {
    const { email, phone } = req.body;
    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query(
      'UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE email = $3',
      [otp, expiresAt, email.toLowerCase()]
    );
    if (phone) await sendOTPSMS(phone, otp);
    else await sendOTPEmail(email, otp);
    res.json({ message: 'OTP sent' });
  } catch (err) {
    logger.error('OTP error', { err });
    res.status(500).json({ error: 'Failed to send OTP' });
  }
}

async function verifyOTP(req, res) {
  try {
    const { email, otp } = req.body;
    const { rows } = await pool.query(
      'SELECT id, otp_code, otp_expires_at FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    const user = rows[0];
    if (user.otp_code !== otp || new Date(user.otp_expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }
    await pool.query(
      'UPDATE users SET email_verified = true, otp_code = NULL, otp_expires_at = NULL WHERE id = $1',
      [user.id]
    );
    res.json({ message: 'Email verified' });
  } catch (err) {
    logger.error('Verify OTP error', { err });
    res.status(500).json({ error: 'Verification failed' });
  }
}

async function refreshToken(req, res) {
  try {
    const { refreshToken: token } = req.body;
    const { rows: sessionRows } = await pool.query(
      'SELECT s.user_id FROM sessions s WHERE s.refresh_token = $1 AND s.is_valid = true AND s.expires_at > NOW()',
      [token]
    );
    if (!sessionRows[0]) return res.status(401).json({ error: 'Invalid refresh token' });
    await pool.query('UPDATE sessions SET is_valid = false WHERE refresh_token = $1', [token]);
    const { rows: userRows } = await pool.query(
      `SELECT id, first_name, last_name, email, phone, role,
              email_verified, is_verified,
              onboarding_status, onboarding_completed,
              contact_completed, profile_completed,
              tier_selected, w9_completed, terms_accepted,
              membership_tier, id_verified, background_check_passed,
              city, state, zip_code,
              trial_started_at, trial_ends_at, didit_status, didit_verified_at
       FROM users WHERE id = $1`,
      [sessionRows[0].user_id]
    );
    if (!userRows[0]) return res.status(401).json({ error: 'User not found' });
    const user = userRows[0];
    const tokens = generateTokens(user);
    await pool.query(
      "INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval '7 days')",
      [user.id, tokens.refreshToken]
    );
    res.json({
      success: true,
      user: formatAuthUser(user),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });
  } catch (err) {
    logger.error('Refresh error', { err });
    res.status(500).json({ error: 'Token refresh failed' });
  }
}

async function logout(req, res) {
  try {
    const { refreshToken: token } = req.body;
    await pool.query('UPDATE sessions SET is_valid = false WHERE refresh_token = $1', [token]);
    res.json({ message: 'Logged out' });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed' });
  }
}

// ===== CUSTOMER REGISTRATION FLOW (3-Step) =====
async function checkEmail(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (rows.length > 0) return res.status(409).json({ available: false, error: 'Email already registered' });
    res.json({ available: true });
  } catch (err) {
    logger.error('Check email error', { err });
    res.status(500).json({ error: 'Failed to check email' });
  }
}

async function checkZip(req, res) {
  try {
    const { zip } = req.body;
    if (!zip) return res.status(400).json({ error: 'Zip code required' });
    if (!/^\d{5}$/.test(zip)) return res.status(400).json({ error: 'Invalid zip code format' });
    res.json({ inMarket: true });
  } catch (err) {
    logger.error('Check zip error', { err });
    res.status(500).json({ error: 'Failed to check zip code' });
  }
}

async function addToWaitlist(req, res) {
  try {
    const { email, zip } = req.body;
    if (!email || !zip) return res.status(400).json({ error: 'Email and zip code required' });
    const ipHash = crypto.createHash('sha256').update(req.ip || 'unknown').digest('hex');
    await pool.query(
      'INSERT INTO waitlist (email, zip_code, ip_hash) VALUES ($1, $2, $3) ON CONFLICT (email, zip_code) DO NOTHING',
      [email.toLowerCase(), zip, ipHash]
    );
    res.json({ message: 'Added to waitlist' });
  } catch (err) {
    logger.error('Waitlist error', { err });
    res.status(500).json({ error: 'Failed to add to waitlist' });
  }
}

async function startRegistration(req, res) {
  try {
    const { email, password, firstName, lastName, phone, zip, ageConfirmed, ref } = req.body;
    if (!email || !password || !firstName || !lastName || !phone || !zip) {
      return res.status(400).json({ error: 'All fields required' });
    }
    if (!ageConfirmed) return res.status(400).json({ error: 'Age confirmation required' });
    const phoneClean = phone.replace(/\D/g, '');
    if (phoneClean.length < 10 || phoneClean.length > 11) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }
    const formattedPhone = phoneClean.length === 11 ? '+' + phoneClean : '+1' + phoneClean;
    if (!/^\d{5}$/.test(zip)) return res.status(400).json({ error: 'Invalid zip code' });
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' });
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query('DELETE FROM pending_registrations WHERE email = $1 AND (role = $2 OR role IS NULL)', [email.toLowerCase(), 'customer']);
    await pool.query(
  'INSERT INTO pending_registrations (token, email, password_hash, first_name, last_name, phone, zip_code, age_confirmed, role, referral_ref) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
  [token, email.toLowerCase(), passwordHash, firstName, lastName, formattedPhone, zip, ageConfirmed, 'customer', ref || null]
);
    res.json({ token, message: 'Basic info validated' });
  } catch (err) {
    logger.error('Start registration error', { err });
    res.status(500).json({ error: 'Registration failed' });
  }
}

async function acceptTerms(req, res) {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });
    const { rows } = await pool.query(
      'SELECT * FROM pending_registrations WHERE token = $1 AND expires_at > NOW()', [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Invalid or expired registration' });
    const pending = rows[0];
    const termsVersion = TERMS_CONFIG?.terms_of_service?.version || '2026-03-20';
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const userAgent = req.headers['user-agent'] || '';
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpExpires = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query(
      'UPDATE pending_registrations SET terms_accepted_at = NOW(), terms_version = $2, terms_acceptance_ip = $3, terms_acceptance_ua = $4, otp_code = $5, otp_expires_at = $6, otp_attempts = 0 WHERE token = $1',
      [token, termsVersion, ip, userAgent, otp, otpExpires]
    );
    await sendOTPEmail(pending.email, otp);
    res.json({ message: 'Terms accepted, OTP sent' });
  } catch (err) {
    logger.error('Accept terms error', { err });
    res.status(500).json({ error: 'Failed to accept terms' });
  }
}

async function verifyRegistrationOTP(req, res) {
  try {
    const { token, otp } = req.body;
    if (!token || !otp) return res.status(400).json({ error: 'Token and OTP required' });
    const { rows } = await pool.query(
      'SELECT * FROM pending_registrations WHERE token = $1 AND expires_at > NOW()', [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Invalid or expired registration' });
    const pending = rows[0];
    if (pending.otp_locked_until && new Date(pending.otp_locked_until) > new Date()) {
      return res.status(429).json({ error: 'Too many attempts. Try again later.', lockoutUntil: pending.otp_locked_until });
    }
    if (pending.otp_code !== otp || new Date(pending.otp_expires_at) < new Date()) {
      const newAttempts = pending.otp_attempts + 1;
      if (newAttempts >= 3) {
        await pool.query(
          "UPDATE pending_registrations SET otp_attempts = $2, otp_locked_until = NOW() + interval '1 hour' WHERE token = $1",
          [token, newAttempts]
        );
        return res.status(429).json({ error: 'Too many failed attempts. Locked for 1 hour.' });
      }
      await pool.query('UPDATE pending_registrations SET otp_attempts = $2 WHERE token = $1', [token, newAttempts]);
      return res.status(400).json({ error: 'Invalid or expired OTP', attemptsRemaining: 3 - newAttempts });
    }
    const referralCode = crypto.randomBytes(6).toString('hex');
    const { trial_started_at, trial_ends_at } = trialDefaults();

    // Resolve referrer from pending.referral_ref
    let referrerId = null;
    if (pending.referral_ref) {
      const { rows: refRows } = await pool.query(
        `SELECT id FROM users WHERE referral_code = $1`, [pending.referral_ref]
      );
      if (refRows.length) referrerId = refRows[0].id;
    }

    const userResult = await pool.query(
      'INSERT INTO users (email, password_hash, first_name, last_name, phone, zip_code, role, age_confirmed, email_verified, terms_accepted_at, terms_version, terms_acceptance_ip, terms_acceptance_ua, referral_code, trial_started_at, trial_ends_at, referred_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *',
      [pending.email, pending.password_hash, pending.first_name, pending.last_name, pending.phone, pending.zip_code, 'customer', pending.age_confirmed, pending.terms_accepted_at, pending.terms_version, pending.terms_acceptance_ip, pending.terms_acceptance_ua, referralCode, trial_started_at, trial_ends_at, referrerId]
    );
    const user = userResult.rows[0];
    await pool.query('DELETE FROM pending_registrations WHERE token = $1', [token]);

    // Increment referrer count (non-fatal)
    if (referrerId) {
      pool.query(
        `UPDATE users SET referrals_count = referrals_count + 1 WHERE id = $1`, [referrerId]
      ).catch(err => logger.error('Failed to increment referrals_count', { err }));
    }
    const tokens = generateTokens(user);
    await pool.query(
      "INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval '7 days')",
      [user.id, tokens.refreshToken]
    );
    res.status(201).json({ user: formatAuthUser(user), ...tokens });
  } catch (err) {
    logger.error('Verify registration OTP error', { err });
    res.status(500).json({ error: 'Verification failed' });
  }
}

async function resendRegistrationOTP(req, res) {
  try {
    const { token } = req.body;
    const { rows } = await pool.query(
      'SELECT * FROM pending_registrations WHERE token = $1 AND expires_at > NOW()', [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Invalid or expired registration' });
    const pending = rows[0];
    if (pending.otp_locked_until && new Date(pending.otp_locked_until) > new Date()) {
      return res.status(429).json({ error: 'Account locked' });
    }
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpExpires = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query(
      'UPDATE pending_registrations SET otp_code = $2, otp_expires_at = $3, otp_attempts = 0 WHERE token = $1',
      [token, otp, otpExpires]
    );
    await sendOTPEmail(pending.email, otp);
    res.json({ message: 'OTP resent' });
  } catch (err) {
    logger.error('Resend OTP error', { err });
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
}

// Password reset flow
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    const errs = validate(req.body, { email: [rules.required, rules.email] });
    if (errs) return res.status(400).json({ error: 'validation_failed', fields: errs });

    const normalizedEmail = email.toLowerCase().trim();
    const { rows } = await pool.query(
      'SELECT id, email FROM users WHERE email = $1 AND deleted_at IS NULL',
      [normalizedEmail]
    );

    // Respond with the same message regardless of account existence.
    const genericResponse = {
      message: 'If that email exists, a reset link has been sent.'
    };

    if (!rows[0]) {
      return res.json(genericResponse);
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      `UPDATE users
       SET reset_token = $1, reset_token_expires = $2, updated_at = NOW()
       WHERE id = $3`,
      [resetToken, resetExpires, rows[0].id]
    );

    const appUrl = process.env.APP_URL || process.env.CLIENT_URL || '';
    const resetUrl = `${appUrl.replace(/\/$/, '')}/reset-password/${resetToken}`;
    await sendPasswordResetEmail(rows[0].email, resetUrl);

    return res.json(genericResponse);
  } catch (err) {
    logger.error('Forgot password error', { err });
    return res.status(500).json({ error: 'Failed to process password reset request' });
  }
}

async function resetPassword(req, res) {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }
    const pwErrs = validate({ password }, {
      password: [rules.required, rules.minLen(8), rules.maxLen(128)],
    });
    if (pwErrs) return res.status(400).json({ error: 'validation_failed', fields: pwErrs });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const { rowCount } = await pool.query(
      `UPDATE users
       SET password_hash = $1,
           reset_token = NULL,
           reset_token_expires = NULL,
           updated_at = NOW()
       WHERE reset_token = $2
         AND reset_token_expires > NOW()`,
      [passwordHash, token]
    );

    if (!rowCount) {
      return res.status(400).json({ error: 'Reset link is invalid or expired.' });
    }

    return res.json({ message: 'Password reset successful.' });
  } catch (err) {
    logger.error('Reset password error', { err });
    return res.status(500).json({ error: 'Failed to reset password' });
  }
}

// ===== SETTINGS PAGE ENDPOINTS =====
async function getMe(req, res) {
  try {
    return res.json({
      success: true,
      user: formatAuthUser(req.user)
    });
  } catch (err) {
    logger.error('Get me error', { err });
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
}

async function updateProfile(req, res) {
  try {
    const { phone, zip_code, zipcode, display_name_preference } = req.body;
    const finalZip = zip_code || zipcode;

    const VALID_PREFS = ['full_name', 'first_name', 'business_name'];
    const pref = VALID_PREFS.includes(display_name_preference) ? display_name_preference : undefined;

    const { rows } = await pool.query(
      `UPDATE users
       SET phone = COALESCE($1, phone),
           zip_code = COALESCE($2, zip_code),
           display_name_preference = COALESCE($3, display_name_preference),
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, email, first_name, last_name, phone, zip_code, display_name_preference`,
      [phone || null, finalZip || null, pref || null, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    logger.error('Update profile error', { err });
    res.status(500).json({ error: 'Failed to update profile' });
  }
}

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
    const pwErrs = validate({ newPassword }, {
      newPassword: [rules.required, rules.minLen(8), rules.maxLen(128)],
    });
    if (pwErrs) return res.status(400).json({ error: 'validation_failed', fields: pwErrs });
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, req.user.id]);
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    logger.error('Change password error', { err });
    res.status(500).json({ error: 'Failed to change password' });
  }
}

// GET public profile for any user
async function getPublicProfile(req, res) {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT users.id, users.first_name, users.last_name, users.role, users.zip_code,
  hp.profile_headline, hp.bio_long, hp.hourly_rate_min,
  hp.service_radius_miles, hp.rate_preference, hp.tier AS helper_tier,
  hp.availability_json, users.created_at
  FROM users LEFT JOIN helper_profiles hp ON hp.user_id = users.id WHERE users.id = $1 AND users.deleted_at IS NULL`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    logger.error('Public profile error', { err });
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
}


// Resend email verification for logged-in users
async function resendVerification(req, res) {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, email_verified FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    if (rows[0].email_verified) return res.status(400).json({ error: 'Email already verified' });

    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query(
      'UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE id = $3',
      [otp, expiresAt, req.user.id]
    );
    await sendOTPEmail(rows[0].email, otp);
    res.json({ message: 'Verification email sent' });
  } catch (err) {
    logger.error('Resend verification error', { err });
    res.status(500).json({ error: 'Failed to send verification email' });
  }
}
module.exports = {
  register, login, loginWith2FA, requestOTP, verifyOTP, refreshToken, logout,
  checkEmail, checkZip, addToWaitlist,
  startRegistration, acceptTerms, verifyRegistrationOTP, resendRegistrationOTP,
  forgotPassword, resetPassword,
  getMe, updateProfile, changePassword, getPublicProfile, resendVerification,
  formatAuthUser
};
