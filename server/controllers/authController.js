// Phase 2 - Auth controller (3-step registration, login, OTP, refresh, logout)
// + Customer Registration Flow (3-step)
// + 2FA (TOTP) support on login
// OxSteed v2
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { authenticator } = require('@otplib/v12-adapter');
const pool = require('../db');
const { userIdEq } = require('../utils/schemaProbe');
const { generateTokens } = require('../middleware/auth');
const { sendOTPEmail, sendPasswordResetEmail } = require('../utils/email');
const { sendOTPSMS } = require('../utils/sms');
const { TERMS_CONFIG } = require('../constants/termsConfig');
const { encrypt, decrypt, hashIP } = require('../utils/encryption');
const { getEffectiveTier, isTrialActive, trialDaysLeft, trialDefaults } = require('../utils/trial');
const { validate, rules } = require('../utils/validate');
const countriesUtil = require('../utils/countries');
const logger = require('../utils/logger');
const tokenRevocationService = require('../services/tokenRevocationService');
const { AppError } = require('../middleware/errorHandler');
const { grantFreeTrialToUser } = require('./templateController');
const { checkAndAlertNewLogin } = require('../services/loginAlertService');
const { invalidateGuestHistoryAccessCodesForEmail } = require('../services/guestProfileChatVerification');
const { logSecurityEvent, extractRequestDetails } = require('../services/auditLoggerService');
const modeRoleUtil = require('../utils/modeRole');
const SALT_ROUNDS = 12;
const TERMS_IP_HASH_MAX_LEN = 45;
const JWT_SECRET = process.env.JWT_SECRET;
const SUPPORTED_LANGUAGE_CODES = new Set(['en', 'es', 'fr', 'ht', 'ar']);

// Modes a user may self-select when signing up through the unified /join flow.
// Mirrors the CHECK constraint on pending_registrations.default_mode (mig 270).
const SELF_SELECTABLE_MODES = Object.freeze([
  'customer',
  'investor',
  'helper',
  'logistics',
  'business_owner',
  'restaurant_customer',
  'restaurant_owner',
  'restaurant_manager',
  'restaurant_staff',
  'restaurant_runner',
  'consultant',
  'tool_owner',
  'franchise_applicant',
  'life_only',
]);

// Modes that imply users.role='helper' at the DB level so existing
// role-based RBAC keeps working. Everything else maps to 'customer'.
const MODES_REQUIRING_HELPER_ROLE = new Set([
  'helper',
  'business_owner',
  'restaurant_owner',
  'restaurant_manager',
  'restaurant_staff',
  'restaurant_runner',
  'consultant',
  'tool_owner',
]);

function normalizeDefaultMode(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().toLowerCase();
  return SELF_SELECTABLE_MODES.includes(s) ? s : null;
}

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

function normalizeSupportedLanguage(raw, fallback = undefined) {
  const parsed = String(raw || '')
    .split(',')[0]
    .trim()
    .split(/[-_]/)[0]
    .toLowerCase();

  return SUPPORTED_LANGUAGE_CODES.has(parsed) ? parsed : fallback;
}

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
    bio:                   user.bio || null,
    profile_photo_url:     user.profile_photo_url || null,
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
    didit_enforcement_required: !!user.didit_enforcement_required,
    preferred_language:    user.preferred_language || 'en',
    id_verified:           !!user.id_verified,
    background_check_passed: !!user.background_check_passed,
    city:                  user.city,
    state:                 user.state,
    zip_code:              user.zip_code,
    address_line1:         user.address_line1 || null,
    address_line2:         user.address_line2 || null,
    country:               user.country || 'US',
    display_name_preference: user.display_name_preference || 'first_name',
    business_name:         user.business_name || null,
    is_listed:             user.is_listed !== undefined ? !!user.is_listed : true,
    allow_guest_contact:   user.allow_guest_contact !== undefined ? !!user.allow_guest_contact : true,
    allow_booking:         user.allow_booking !== undefined ? !!user.allow_booking : true,
    allow_scheduling:      user.allow_scheduling !== undefined ? !!user.allow_scheduling : true,
    allow_live_chat:       user.allow_live_chat !== undefined ? !!user.allow_live_chat : true,
    stripe_account_id:     user.stripe_account_id || user.connect_stripe_account_id || null,
    stripe_charges_enabled: user.stripe_charges_enabled !== undefined
      ? !!user.stripe_charges_enabled
      : !!user.connect_charges_enabled,
    stripe_payouts_enabled: user.stripe_payouts_enabled !== undefined
      ? !!user.stripe_payouts_enabled
      : !!user.connect_payouts_enabled,
    stripe_connect_ready:  user.stripe_connect_ready !== undefined
      ? !!user.stripe_connect_ready
      : !!user.connect_charges_enabled,
    stripe_connect_onboarded: user.stripe_connect_onboarded !== undefined
      ? !!user.stripe_connect_onboarded
      : !!user.connect_onboarding_complete,
    default_mode:          user.default_mode || null,
    logistics_role:        user.logistics_role || null,
    internal_access_route: user.internal_access_route || null,
  };
}

// LOGIN - Updated to support 2FA
async function login(req, res, next) {
  try {
    const { email, password, rememberMe, termsAgreed, agreementName, operatingMode, defaultMode, default_mode } = req.body;
    const requestedOperatingModeRaw = operatingMode ?? defaultMode ?? default_mode;
    const requestedOperatingMode = normalizeDefaultMode(requestedOperatingModeRaw);
    if (requestedOperatingModeRaw !== undefined && requestedOperatingModeRaw !== null && requestedOperatingMode === null) {
      throw new AppError(
        'Invalid operating mode',
        400,
        'invalid_mode',
        { operatingMode: `Must be one of: ${SELF_SELECTABLE_MODES.join(', ')}` },
      );
    }

    const errs = validate(req.body, {
      email:    [rules.required, rules.email],
      password: [rules.required],
    });
    if (errs) {
      throw new AppError('Validation failed', 400, 'validation_failed', errs);
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const preCheckUser = await pool.query('SELECT role FROM users WHERE email = $1', [normalizedEmail]);
    const isAdminUser = preCheckUser.rows.length > 0 && ['admin', 'super_admin'].includes(preCheckUser.rows[0].role);
    if (!isAdminUser && !termsAgreed) {
      throw new AppError(
        'You must agree to the Terms of Service and Privacy Policy to sign in',
        400, 'validation_failed',
        { termsAgreed: 'Required' }
      );
    }
    if (!isAdminUser) {
      const nameTrimmed = String(agreementName || '').trim();
      const nameWords   = nameTrimmed.split(/\s+/).filter(Boolean);
      const nameValid   =
        nameTrimmed.length >= 5 &&
        nameWords.length >= 2 &&
        nameWords.every((w) => /^[A-Za-zÀ-ÖØ-öø-ÿ''-]+$/.test(w));
      if (!nameValid) {
        throw new AppError(
          'Please enter your full name (first and last name) as your digital signature',
          400, 'validation_failed',
          { agreementName: 'Full name required (first and last name)' }
        );
      }
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.password_hash, u.role, u.is_active,
              u.email_verified, u.is_verified,
              u.onboarding_status, u.onboarding_completed,
              u.contact_completed, u.profile_completed,
              u.tier_selected, u.w9_completed, u.terms_accepted,
              u.membership_tier, u.id_verified, u.background_check_passed,
              u.city, u.state, u.zip_code, u.totp_enabled,
              u.trial_started_at, u.trial_ends_at, u.didit_status, u.didit_verified_at,
              u.default_mode,
              COALESCE(u.didit_enforcement_required, FALSE) AS didit_enforcement_required,
              ca.stripe_account_id AS connect_stripe_account_id,
              ca.charges_enabled AS connect_charges_enabled,
              ca.payouts_enabled AS connect_payouts_enabled,
              ca.onboarding_complete AS connect_onboarding_complete
       FROM users u
       LEFT JOIN connect_accounts ca ON ca.user_id = u.id
       WHERE u.email = $1`,
      [normalizedEmail]
    );
    if (!rows[0]) {
      throw new AppError('Invalid email or password', 401, 'auth_failed');
    }

    let user = rows[0];
    if (!user.is_active) {
      throw new AppError('Your account has been deactivated', 403, 'account_deactivated');
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw new AppError('Invalid email or password', 401, 'auth_failed');
    }

    // Signature must match the name on the account (case- and whitespace-insensitive)
    if (!isAdminUser) {
      const normalize = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
      const accountName = normalize(`${user.first_name} ${user.last_name}`);
      const enteredName = normalize(agreementName);
      if (!accountName || enteredName !== accountName) {
        throw new AppError(
          'The name you entered does not match the name on your account. Please use your full name exactly as registered.',
          400, 'signature_name_mismatch',
          { agreementName: 'Name does not match account' }
        );
      }
    }

    if (user.totp_enabled) {
      const mfaToken = jwt.sign(
        { id: user.id, isMfaToken: true, rememberMe: rememberMe === true },
        JWT_SECRET,
        { expiresIn: '15m' }
      );
      return res.status(200).json({
        requiresTwoFactor: true,
        mfaToken: mfaToken,
        message: 'Please provide your 2FA code to complete login.'
      });
    }
    if (!isAdminUser && requestedOperatingMode && requestedOperatingMode !== user.default_mode) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updatedUser = await modeRoleUtil.applyModeSwitch(client, user.id, requestedOperatingMode);
        if (!updatedUser) {
          await client.query('ROLLBACK');
          throw new AppError('Mode changed during sign in. Please try again.', 409, 'state_conflict');
        }
        await modeRoleUtil.invalidateUserSessions(client, user.id);
        await client.query('COMMIT');
        user = updatedUser;
      } catch (modeErr) {
        try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
        throw modeErr;
      } finally {
        client.release();
      }
    }

    const tokens = generateTokens(user);
    const hashedRefresh = crypto.createHash('sha256').update(tokens.refreshToken).digest('hex');
    const sessionSql = rememberMe
      ? "INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval '30 days')"
      : "INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval '7 days')";
    await pool.query(sessionSql, [user.id, hashedRefresh]);

    // Log terms agreement for legal/compliance record
    try {
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.socket?.remoteAddress
        || req.ip
        || null;
      const ua = req.headers['user-agent'] || null;
      await pool.query(
        `INSERT INTO login_agreements (user_id, full_name, ip_address, user_agent)
         VALUES ($1, $2, $3, $4)`,
        [user.id, String(agreementName).trim(), ip, ua]
      );
    } catch (logErr) {
      logger.warn('Failed to record login agreement', { userId: user.id, error: logErr.message });
    }

    // Record user_consents so TermsGate only re-triggers when versions are
    // bumped, not on every login. The status query uses DISTINCT ON ordered
    // by accepted_at DESC, so a new row per login is the correct pattern.
    try {
      const consentIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.socket?.remoteAddress || req.ip || null;
      const consentUa = req.headers['user-agent'] || null;
      const ipHash = hashIP(consentIp);
      for (const type of ['terms_of_service', 'privacy_policy']) {
        const version = TERMS_CONFIG[type]?.version;
        if (!version) continue;
        await pool.query(
          `INSERT INTO user_consents (user_id, consent_type, version, ip_hash, user_agent)
           VALUES ($1, $2, $3, $4, $5)`,
          [user.id, type, version, ipHash, consentUa]
        );
      }
    } catch (consentErr) {
      logger.warn('Failed to record login consent', { userId: user.id, error: consentErr.message });
    }

    // Record login history and update last_login_at (non-fatal)
    try {
      const loginIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.socket?.remoteAddress || req.ip || null;
      const loginUa = req.headers['user-agent'] || null;

      // Write last_login_at unconditionally — column exists since migration 001.
      await pool.query(
        `UPDATE users SET last_login_at = NOW() WHERE id = $1`,
        [user.id]
      ).catch(() => {});

      // last_login_ip was added in migration 154; write separately so a missing
      // column doesn't prevent last_login_at from being recorded.
      await pool.query(
        `UPDATE users SET last_login_ip = $1 WHERE id = $2`,
        [loginIp, user.id]
      ).catch(() => {});

      await pool.query(
        `INSERT INTO user_login_history (user_id, ip_address, user_agent, success) VALUES ($1, $2, $3, TRUE)`,
        [user.id, loginIp, loginUa]
      ).catch(() => {}); // table may not exist yet on older deploys
    } catch (_) {}

    // FIX #6: Send alert if login is from new/unfamiliar IP (fire-and-forget, don't block response)
    const alertIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket?.remoteAddress || req.ip || null;
    const alertUa = req.headers['user-agent'] || null;
    checkAndAlertNewLogin(user.id, alertIp, alertUa).catch(() => {});

    res.json({
      success: true,
      message: 'Login successful',
      user: formatAuthUser(user),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });
  } catch (err) {
    next(err);
  }
}

// Complete login after 2FA verification
async function loginWith2FA(req, res, next) {
  try {
    // Accept both API naming conventions so native and web clients can share
    // this endpoint without a silent contract mismatch.
    const mfaToken = req.body.mfaToken || req.body.mfa_token;
    const token = req.body.token;
    const isBackupCode = req.body.isBackupCode ?? req.body.is_backup_code ?? false;
    if (!mfaToken) {
      return res.status(400).json({ error: 'MFA token required' });
    }

    let userId;
    let rememberMe = false;
    try {
      const decoded = jwt.verify(mfaToken, JWT_SECRET);
      if (!decoded.isMfaToken) throw new Error('Invalid token type');
      userId = decoded.id;
      rememberMe = decoded.rememberMe === true;
      req.internalAccessId = decoded.internalAccessId || null;
      req.internalAccessRoute = decoded.internalAccessRoute || null;
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired MFA token' });
    }

    if (!token) {
      return res.status(400).json({ error: '2FA code required' });
    }

    const { rows: auditRows } = await pool.query(
      `SELECT COUNT(*) FROM two_factor_audit_log 
       WHERE user_id = $1 AND success = false 
       AND created_at > NOW() - INTERVAL '15 minutes'`,
      [userId]
    );
    if (parseInt(auditRows[0].count) >= 5) {
      return res.status(429).json({ error: 'Too many failed 2FA attempts. Please try again in 15 minutes.' });
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

    if (req.internalAccessId && req.internalAccessRoute) {
      const routeField = req.internalAccessRoute === 'operations'
        ? 'operations_enabled'
        : req.internalAccessRoute === 'compliance'
          ? 'compliance_enabled'
          : req.internalAccessRoute === 'admin_portal'
            ? 'admin_portal_enabled'
          : null;
      if (!routeField) {
        return res.status(401).json({ error: 'Invalid internal-access MFA session' });
      }

      const { rows: accessRows } = await pool.query(
        `SELECT id, is_active, ${routeField} AS route_enabled
         FROM logistics_internal_access_credentials
         WHERE id = $1 AND user_id = $2
         LIMIT 1`,
        [req.internalAccessId, userId]
      );
      if (!accessRows[0] || !accessRows[0].is_active || !accessRows[0].route_enabled) {
        return res.status(401).json({ error: 'Internal-access approval is no longer valid.' });
      }
    }

    let verified = false;
    if (isBackupCode) {
      const codes = user.backup_codes || [];
      let matchedCode = null;
      for (let i = 0; i < codes.length; i++) {
        if (await bcrypt.compare(token.toLowerCase().trim(), codes[i])) {
          matchedCode = codes[i];
          break;
        }
      }
      if (matchedCode) {
        const updatedCodes = codes.filter(code => code !== matchedCode);
        const { rows: updateRows } = await pool.query(
          'UPDATE users SET backup_codes = $1 WHERE id = $2 AND $3 = ANY(backup_codes) RETURNING id',
          [updatedCodes, userId, matchedCode]
        );
        verified = updateRows.length > 0;
      }
    } else {
      const decryptedSecret = decrypt(user.totp_secret);
      authenticator.options = { window: 1 };
      verified = authenticator.verify({
        secret: decryptedSecret,
        token: token
      });
    }
    if (!verified) {
      await pool.query(
        'INSERT INTO two_factor_audit_log (user_id, action, ip_address, user_agent, success) VALUES ($1, $2, $3, $4, $5)',
        [userId, isBackupCode ? 'backup_code_failed' : 'totp_verify_failed', hashIP(req.ip), req.headers['user-agent'], false]
      );
      return res.status(401).json({ error: 'Invalid 2FA code' });
    }
    const tokens = generateTokens(user);
    const hashedRefresh = crypto.createHash('sha256').update(tokens.refreshToken).digest('hex');
    const sessionSql = rememberMe
      ? "INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval '30 days')"
      : "INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval '7 days')";
    await pool.query(sessionSql, [user.id, hashedRefresh]);

    // Record last_login_at and login history (non-fatal)
    try {
      const loginIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.socket?.remoteAddress || req.ip || null;
      const loginUa = req.headers['user-agent'] || null;
      await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]).catch(() => {});
      await pool.query(`UPDATE users SET last_login_ip = $1 WHERE id = $2`, [loginIp, user.id]).catch(() => {});
      await pool.query(
        `INSERT INTO user_login_history (user_id, ip_address, user_agent, success) VALUES ($1, $2, $3, TRUE)`,
        [user.id, loginIp, loginUa]
      ).catch(() => {});
    } catch (_) {}

    // FIX #6: Send alert if login is from new/unfamiliar IP (fire-and-forget)
    checkAndAlertNewLogin(user.id, req.ip, req.headers['user-agent']).catch(() => {});

    const { rows: fullRows } = await pool.query(
     `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.role, u.email_verified, u.is_verified,
       u.onboarding_status, u.onboarding_completed, u.contact_completed, u.profile_completed,
       u.tier_selected, u.w9_completed, u.terms_accepted, u.membership_tier, u.id_verified,
       u.background_check_passed, u.city, u.state, u.zip_code,
       u.preferred_language, u.default_mode,
       u.trial_started_at, u.trial_ends_at, u.didit_status, u.didit_verified_at,
       COALESCE(u.didit_enforcement_required, FALSE) AS didit_enforcement_required,
       u.logistics_role,
       ca.stripe_account_id AS connect_stripe_account_id,
       ca.charges_enabled AS connect_charges_enabled,
       ca.payouts_enabled AS connect_payouts_enabled,
       ca.onboarding_complete AS connect_onboarding_complete
       FROM users u
       LEFT JOIN connect_accounts ca ON ca.user_id = u.id
       WHERE u.id = $1`,
      [user.id]
    );
    if (fullRows[0] && req.internalAccessRoute) {
      fullRows[0].internal_access_route = req.internalAccessRoute;
    }
    res.json({
      success: true,
      message: 'Login successful',
      user: formatAuthUser(fullRows[0]),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });
  } catch (err) {
    logger.error('Login 2FA error', { error: err.message, stack: err.stack });
    next(err);
  }
}

async function requestOTP(req, res) {
  try {
    const { email, phone } = req.body;
    // Verify user exists before generating or sending anything.
    // Return the same response regardless to avoid email enumeration.
    const { rows: userRows } = await pool.query(
      'SELECT id, preferred_language FROM users WHERE email = $1', [email.toLowerCase()]
    );
    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    if (userRows[0]) {
      const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');
      await pool.query(
        'UPDATE users SET otp_code = $1, otp_expires_at = $2, otp_attempts = 0, otp_locked_until = NULL WHERE email = $3',
        [hashedOtp, expiresAt, email.toLowerCase()]
      );
      if (phone) await sendOTPSMS(phone, otp);
      else await sendOTPEmail(email, otp, userRows[0].preferred_language);
    }
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
      'SELECT id, otp_code, otp_expires_at, otp_attempts, otp_locked_until FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    // Return same 400 for missing user to prevent account enumeration.
    if (!rows[0]) return res.status(400).json({ error: 'Invalid or expired OTP' });
    const user = rows[0];

    if (user.otp_locked_until && new Date(user.otp_locked_until) > new Date()) {
      return res.status(429).json({ error: 'Account locked due to too many failed attempts. Try again in 1 hour.', lockUntil: user.otp_locked_until });
    }

    const expired = new Date(user.otp_expires_at) < new Date();
    const bufA = Buffer.from(user.otp_code || '');
    const hashedIncomingOtp = (typeof otp === 'string' && otp.length > 0) 
      ? crypto.createHash('sha256').update(otp).digest('hex') 
      : '';
    const bufB = Buffer.from(hashedIncomingOtp);
    const otpValid = bufA.length > 0 && bufA.length === bufB.length &&
      crypto.timingSafeEqual(bufA, bufB);

    if (!otpValid || expired) {
      const newAttempts = (user.otp_attempts || 0) + 1;
      if (newAttempts >= 3) {
        await pool.query(
          "UPDATE users SET otp_attempts = $1, otp_locked_until = NOW() + interval '1 hour' WHERE id = $2",
          [newAttempts, user.id]
        );
        return res.status(429).json({ error: 'Too many failed attempts. Locked for 1 hour.' });
      }
      await pool.query('UPDATE users SET otp_attempts = $1 WHERE id = $2', [newAttempts, user.id]);
      return res.status(400).json({ error: 'Invalid or expired OTP', attemptsRemaining: 3 - newAttempts });
    }
    const { rows: verifyRows } = await pool.query(
      'UPDATE users SET email_verified = true, otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0, otp_locked_until = NULL WHERE id = $1 AND otp_code = $2 RETURNING id',
      [user.id, user.otp_code]
    );
    if (verifyRows.length === 0) {
      return res.status(400).json({ error: 'OTP verification failed. Please try again.' });
    }
    res.json({ message: 'Email verified' });
  } catch (err) {
    logger.error('Verify OTP error', { err });
    res.status(500).json({ error: 'Verification failed' });
  }
}

async function refreshToken(req, res, next) {
  try {
    const { refreshToken: token } = req.body;
    if (!token) {
      throw new AppError('Refresh token is required', 401, 'no_token');
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const { rows: sessionRows } = await pool.query(
      'SELECT s.user_id FROM sessions s WHERE s.refresh_token = $1 AND s.is_valid = true AND s.expires_at > NOW()',
      [hashedToken]
    );
    if (!sessionRows[0]) {
      throw new AppError('Your session has expired. Please log in again.', 401, 'token_expired');
    }

    const { rows: invalidateRows } = await pool.query(
      'UPDATE sessions SET is_valid = false WHERE refresh_token = $1 RETURNING id',
      [hashedToken]
    );
    if (invalidateRows.length === 0) {
      throw new AppError('Session invalidation failed', 401, 'session_error');
    }

    const { rows: userRows } = await pool.query(
      `SELECT id, first_name, last_name, email, phone, role,
              email_verified, is_verified,
              onboarding_status, onboarding_completed,
              contact_completed, profile_completed,
              tier_selected, w9_completed, terms_accepted,
              membership_tier, id_verified, background_check_passed,
              city, state, zip_code,
              preferred_language,
              trial_started_at, trial_ends_at, didit_status, didit_verified_at,
              default_mode,
              COALESCE(didit_enforcement_required, FALSE) AS didit_enforcement_required
       FROM users WHERE id = $1`,
      [sessionRows[0].user_id]
    );
    if (!userRows[0]) {
      throw new AppError('User not found', 401, 'user_not_found');
    }
    const user = userRows[0];
    const tokens = generateTokens(user);
    const hashedRefresh = crypto.createHash('sha256').update(tokens.refreshToken).digest('hex');
    await pool.query(
      "INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval '7 days')",
      [user.id, hashedRefresh]
    );
    res.json({
      success: true,
      user: formatAuthUser(user),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res) {
  try {
    const { refreshToken: token } = req.body;
    let didInvalidateSession = false;
    let userId = null;
    const hadRefreshToken = !!token;

    if (token) {
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
      const { rows: invalidateRows } = await pool.query(
        'UPDATE sessions SET is_valid = false WHERE refresh_token = $1 RETURNING id',
        [hashedToken]
      );
      if (invalidateRows.length > 0) {
        didInvalidateSession = true;
        // Revoke the refresh token immediately
        const tokenId = crypto.createHash('sha256').update(token).digest('hex');
        await tokenRevocationService.revokeRefreshToken(tokenId);
      }
    }

    const authHeader = req.headers.authorization || '';
    const hadAccessTokenHeader = authHeader.startsWith('Bearer ');
    if (authHeader.startsWith('Bearer ')) {
      const accessToken = authHeader.slice(7);
      try {
        const decoded = jwt.verify(accessToken, JWT_SECRET);
        if (decoded?.id) {
          userId = decoded.id;
          const { rows: invalidateRows } = await pool.query(
            `UPDATE sessions SET is_valid = false WHERE ${userIdEq('user_id')} RETURNING id`,
            [String(decoded.id)]
          );
          if (invalidateRows.length > 0) {
            didInvalidateSession = true;
            // Revoke the access token immediately
            const tokenId = crypto.createHash('sha256').update(accessToken).digest('hex');
            await tokenRevocationService.revokeAccessToken(tokenId);
          }
        }
      } catch (err) {
        if (err?.code === 'token_revocation_unavailable') throw err;
        // Ignore invalid or expired access tokens here; refresh-token logout should still work.
      }
    }

    // Require at least one credential (refresh token OR access-token header),
    // but make logout idempotent once a credential is provided.
    if (!hadRefreshToken && !hadAccessTokenHeader) {
      return res.status(400).json({ error: 'Refresh token or access token required' });
    }

    // Revoke all user tokens on logout
    if (userId) {
      await tokenRevocationService.revokeAllUserTokens(userId);
    }

    res.json({ message: 'Logged out' });
  } catch (err) {
    logger.error('Logout error', { err });
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
    const zip = String(req.body?.zip || '').trim();
    // Deprecated non-blocking probe. Signup is international, so postal/ZIP
    // availability is no longer used to gate account creation.
    res.json({ inMarket: true, supported: true, available: true, zip: zip || null });
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
    const {
      email, password, firstName, lastName, phone, zip,
      addressLine1, address_line1, city, state, country,
      ageConfirmed, ref,
      defaultMode, default_mode,
    } = req.body;
    // Accept either camelCase or snake_case; null means "no preference recorded"
    // and is fine — the existing customer-only flow doesn't send this field.
    const modePref = normalizeDefaultMode(defaultMode ?? default_mode);
    // If a value was sent but didn't validate, reject so the user knows.
    if ((defaultMode ?? default_mode) !== undefined && (defaultMode ?? default_mode) !== null && modePref === null) {
      return res.status(400).json({
        error: 'validation_failed',
        fields: { defaultMode: `Must be one of: ${SELF_SELECTABLE_MODES.join(', ')}` },
      });
    }
    // role written to pending_registrations.role — derived from mode so
    // existing role-based RBAC works on day one for helper-mode signups.
    const dbRole = modePref && MODES_REQUIRING_HELPER_ROLE.has(modePref) ? 'helper' : 'customer';
    const line1 = String(addressLine1 ?? address_line1 ?? '').trim();
    const cityTrim = String(city || '').trim();
    // Country defaults to 'US' so existing US-only clients (helper signup,
    // older builds) keep working without sending a country field.
    const countryCode = countriesUtil.normalizeCountry(country, 'US');
    const rawState = String(state || '').trim();
    const regionList = countriesUtil.getRegions(countryCode);
    const regionRequired = countriesUtil.hasRegions(countryCode);
    const postalRequired = countriesUtil.requiresPostalCode(countryCode);
    const usesRegionCodes = Array.isArray(regionList)
      && regionList.every((region) => /^[A-Z]{2,3}$/.test(String(region)));
    // Code-based region lists (US, CA, AU, IN) normalize to uppercase.
    // Name-based lists (GB, DE, FR) must keep exact casing to validate.
    const stateTrim = usesRegionCodes ? rawState.toUpperCase() : rawState;
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
      ref: ref ? String(ref).trim() : null,
    };

    const errs = validate(normalized, {
      email: [rules.required, rules.email, rules.maxLen(254)],
      password: [rules.required, rules.minLen(8), rules.maxLen(128)],
      firstName: [rules.required, rules.minLen(1), rules.maxLen(100), rules.noScript],
      lastName: [rules.required, rules.minLen(1), rules.maxLen(100), rules.noScript],
      phone: [rules.required, rules.phone, rules.maxLen(20)],
      addressLine1: [rules.required, rules.minLen(1), rules.maxLen(255), rules.noScript],
      city: [rules.required, rules.minLen(1), rules.maxLen(100), rules.noScript],
      country: [rules.required, rules.country],
      state: regionRequired
        ? [rules.required, rules.maxLen(100), rules.regionFor(countryCode), rules.noScript]
        : [rules.maxLen(100), rules.regionFor(countryCode), rules.noScript],
      zip: postalRequired
        ? [rules.required, rules.maxLen(20), rules.postalFor(countryCode), rules.noScript]
        : [rules.maxLen(20), rules.postalFor(countryCode), rules.noScript],
    });
    if (errs) return res.status(400).json({ error: 'validation_failed', fields: errs });

    if (!normalized.ageConfirmed) return res.status(400).json({ error: 'Age confirmation required' });
    const phoneClean = normalized.phone.replace(/\D/g, '');
    // International phone numbers can be 7–15 digits per E.164. Keep the old
    // 10/11-digit US auto-prefix only when country is US.
    if (phoneClean.length < 7 || phoneClean.length > 15) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }
    let formattedPhone;
    if (countryCode === 'US') {
      if (phoneClean.length !== 10 && phoneClean.length !== 11) {
        return res.status(400).json({ error: 'Invalid phone number' });
      }
      formattedPhone = phoneClean.length === 11 ? '+' + phoneClean : '+1' + phoneClean;
    } else {
      // For non-US, accept whatever the user sent - prefix with the country's
      // dial code if they didn't include one. Always store in E.164-ish form.
      const dial = countriesUtil.getDialCode(countryCode);
      formattedPhone = String(normalized.phone).startsWith('+')
        ? '+' + phoneClean
        : (dial ? `+${dial}${phoneClean}` : '+' + phoneClean);
    }
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalized.email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' });
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const token = crypto.randomBytes(32).toString('hex');
    const normalizedState = stateTrim || null;
    const normalizedZip = normalized.zip || null;
    const { rows: insertRows } = await pool.query(
      `INSERT INTO pending_registrations (
         token, email, password_hash, first_name, last_name, phone, zip_code,
         address_line1, city, state, country,
         age_confirmed, role, referral_ref, default_mode
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (email) DO UPDATE SET
         token = $1, password_hash = $3, first_name = $4, last_name = $5, phone = $6, zip_code = $7,
         address_line1 = $8, city = $9, state = $10, country = $11,
         age_confirmed = $12, role = $13, referral_ref = $14, default_mode = $15, updated_at = NOW()
       RETURNING id`,
      [
        token, normalized.email, passwordHash, normalized.firstName, normalized.lastName, formattedPhone, normalizedZip,
        normalized.addressLine1, normalized.city, normalizedState, normalized.country,
        normalized.ageConfirmed, dbRole, normalized.ref, modePref,
      ],
    );
    if (insertRows.length === 0) {
      return res.status(500).json({ error: 'Failed to save registration' });
    }
    res.json({ token, message: 'Basic info validated' });
  } catch (err) {
    if (err?.code === '22001') {
      return res.status(400).json({ error: 'One or more registration fields are too long' });
    }
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
    const rawIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    // Legacy schemas still define terms_acceptance_ip as VARCHAR(45).
    const ip = hashIP(rawIp)?.slice(0, TERMS_IP_HASH_MAX_LEN) || null;
    const userAgent = req.headers['user-agent'] || '';
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const otpExpires = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query(
      'UPDATE pending_registrations SET terms_accepted_at = NOW(), terms_version = $2, terms_acceptance_ip = $3, terms_acceptance_ua = $4, otp_code = $5, otp_expires_at = $6, otp_attempts = 0 WHERE token = $1',
      [token, termsVersion, ip, userAgent, otpHash, otpExpires]
    );
    await sendOTPEmail(pending.email, otp, resolveRequestLanguage(req));
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
    const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');
    if (pending.otp_code !== hashedOTP || new Date(pending.otp_expires_at) < new Date()) {
      const newAttempts = pending.otp_attempts + 1;
      if (newAttempts >= 3) {
        const { rows: lockRows } = await pool.query(
          "UPDATE pending_registrations SET otp_attempts = $2, otp_locked_until = NOW() + interval '1 hour' WHERE token = $1 RETURNING id",
          [token, newAttempts]
        );
        if (lockRows.length > 0) {
          return res.status(429).json({ error: 'Too many failed attempts. Locked for 1 hour.' });
        }
      }
      const { rows: updateRows } = await pool.query(
        'UPDATE pending_registrations SET otp_attempts = $2 WHERE token = $1 RETURNING id',
        [token, newAttempts]
      );
      if (updateRows.length === 0) {
        return res.status(404).json({ error: 'Registration token expired' });
      }
      return res.status(400).json({ error: 'Invalid or expired OTP', attemptsRemaining: 3 - newAttempts });
    }
    const referralCode = crypto.randomBytes(6).toString('hex');
    const { trial_started_at, trial_ends_at } = await trialDefaults();

    // Resolve referrer from pending.referral_ref
    let referrerId = null;
    if (pending.referral_ref) {
      const { rows: refRows } = await pool.query(
        `SELECT id FROM users WHERE referral_code = $1`, [pending.referral_ref]
      );
      if (refRows.length) referrerId = refRows[0].id;
    }

    const addr1 = (pending.address_line1 || '').trim() || null;
    const cityU = (pending.city || '').trim() || null;
    const countryU = countriesUtil.normalizeCountry(pending.country, 'US');
    // Re-apply the same casing rule used at signup, to be consistent across
    // legacy rows that may have been written before migration 117 ran.
    const rawState = (pending.state || '').trim();
    const stateU = rawState
      ? (countriesUtil.hasRegions(countryU) ? rawState.toUpperCase() : rawState)
      : null;
    const preferredCurrency = countriesUtil.getDefaultCurrency(countryU);

    // Carry the user's chosen mode through; derive role from it via the
    // single source of truth in modeRole.js. Falls back to 'customer'/legacy
    // role for pending rows that pre-date migration 270.
    const pendingDefaultMode = normalizeDefaultMode(pending.default_mode);
    const derivedRole = pendingDefaultMode
      ? modeRoleUtil.roleForMode(pendingDefaultMode)
      : (pending.role && ['customer', 'helper'].includes(pending.role) ? pending.role : 'customer');
    const pendingRole = derivedRole;

    const userResult = await pool.query(
      `INSERT INTO users (
         email, password_hash, first_name, last_name, phone, zip_code, city, state, address_line1,
         country, preferred_currency,
         role, age_confirmed, email_verified,
         terms_accepted_at, terms_version, terms_acceptance_ip, terms_acceptance_ua, referral_code,
         trial_started_at, trial_ends_at, referred_by,
         onboarding_status, onboarding_completed, profile_completed, tier_selected, terms_accepted,
         contact_completed, membership_tier, default_mode
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,
         $10,$11,
         $21,$12,true,
         $13,$14,$15,$16,$17,
         $18,$19,$20,
         'onboarding_complete', TRUE, TRUE, TRUE, TRUE,
         TRUE, 'tier1', $22
       ) RETURNING *`,
      [
        pending.email, pending.password_hash, pending.first_name, pending.last_name, pending.phone, pending.zip_code,
        cityU, stateU, addr1,
        countryU, preferredCurrency,
        pending.age_confirmed,
        pending.terms_accepted_at, pending.terms_version, pending.terms_acceptance_ip, pending.terms_acceptance_ua, referralCode,
        trial_started_at, trial_ends_at, referrerId,
        pendingRole, pendingDefaultMode,
      ]
    );
    const user = userResult.rows[0];
    invalidateGuestHistoryAccessCodesForEmail(user.email).catch((claimErr) =>
      logger.warn('Failed to invalidate guest chat access codes after verified registration', { userId: user.id, error: claimErr.message })
    );
    const { rows: delRows } = await pool.query('DELETE FROM pending_registrations WHERE token = $1 RETURNING id', [token]);
    if (delRows.length === 0) {
      logger.warn('Pending registration cleanup failed', { token, userId: user.id });
    }

    // If the chosen mode is a helper-class mode (helper / business_owner /
    // consultant / tool_owner), seed the helper_profiles row so the user can
    // immediately start using helper features. is_listed=FALSE keeps them
    // out of the public directory until they explicitly go online.
    if (pendingRole === 'helper') {
      await pool.query(
        `INSERT INTO helper_profiles (user_id, is_listed)
         VALUES ($1, FALSE)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id],
      );
    }

    // Increment referrer count + grant reward (non-fatal)
    if (referrerId) {
      pool.query(
        `UPDATE users SET referrals_count = referrals_count + 1 WHERE id = $1`, [referrerId]
      ).catch(err => logger.error('Failed to increment referrals_count', { err }));
      const { grantReferralReward } = require('./referralController');
      grantReferralReward(referrerId, user.id);
    }

    // Grant 1-year free trial on all paid templates (fire-and-forget)
    grantFreeTrialToUser(user.id).catch(err =>
      logger.error('Template free trial grant failed on registration', { userId: user.id, err: err.message })
    );

    // Seed user_consents so TermsGate doesn't fire immediately after signup.
    // We already recorded terms acceptance in pending_registrations; mirror it
    // here so the version-comparison logic in TermsGate is satisfied.
    try {
      const regIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.socket?.remoteAddress || req.ip || null;
      const regUa = req.headers['user-agent'] || null;
      const regIpHash = hashIP(regIp);
      for (const type of ['terms_of_service', 'privacy_policy']) {
        const version = TERMS_CONFIG[type]?.version;
        if (!version) continue;
        await pool.query(
          `INSERT INTO user_consents (user_id, consent_type, version, ip_hash, user_agent)
           VALUES ($1, $2, $3, $4, $5)`,
          [user.id, type, version, regIpHash, regUa]
        );
      }
    } catch (consentErr) {
      logger.warn('Failed to seed registration consent', { userId: user.id, error: consentErr.message });
    }

    const tokens = generateTokens(user);
    const hashedRefresh = crypto.createHash('sha256').update(tokens.refreshToken).digest('hex');
    await pool.query(
      "INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval '7 days')",
      [user.id, hashedRefresh]
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
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const otpExpires = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query(
      'UPDATE pending_registrations SET otp_code = $2, otp_expires_at = $3, otp_attempts = 0 WHERE token = $1',
      [token, otpHash, otpExpires]
    );
    await sendOTPEmail(pending.email, otp, resolveRequestLanguage(req));
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
      'SELECT id, email, preferred_language FROM users WHERE email = $1 AND deleted_at IS NULL',
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
    await sendPasswordResetEmail(rows[0].email, resetUrl, rows[0].preferred_language);

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
    const { rows: resetUsers } = await pool.query(
      `SELECT id FROM users
       WHERE reset_token = $1
         AND reset_token_expires > NOW()`,
      [token],
    );
    if (resetUsers.length === 0) {
      return res.status(400).json({ error: 'Reset link is invalid or expired.' });
    }

    try {
      await tokenRevocationService.revokeAllUserTokens(resetUsers[0].id);
    } catch (err) {
      if (err?.code === 'token_revocation_unavailable') {
        return res.status(503).json({
          error: 'Password reset is temporarily unavailable. Please retry.',
          code: 'token_revocation_unavailable',
          retryable: true,
        });
      }
      throw err;
    }

    const { rows } = await pool.query(
      `UPDATE users
       SET password_hash = $1,
           reset_token = NULL,
           reset_token_expires = NULL,
           updated_at = NOW()
       WHERE id = $3
         AND reset_token = $2
         AND reset_token_expires > NOW()
       RETURNING id`,
      [passwordHash, token, resetUsers[0].id]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Reset link is invalid or expired.' });
    }

    // FIX #10 & #11: Audit log password reset
    const { ipAddress, userAgent } = extractRequestDetails(req);
    logSecurityEvent('password_reset', {
      userId: rows[0].id,
      resourceType: 'user_account',
      resourceId: rows[0].id,
      details: { method: 'token' },
      ipAddress,
      userAgent,
      status: 'success'
    }).catch(() => {});

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
  const client = await pool.connect();
  try {
    const { phone, zip_code, zipcode, display_name_preference, default_mode, preferred_language, bio, profile_photo_url,
      address_line1, address_line2, city, state, country } = req.body;
    // Address: each field is optional. Omitted (undefined/null) leaves it untouched;
    // provided (even '') sets it, with '' clearing to NULL. Country, when
    // provided, must be a supported code and is rejected when empty/invalid;
    // omitted keeps the stored country. State and postal code validate against
    // the effective country (provided or stored), mirroring registration rules.
    let countryCode;
    if (country !== undefined && country !== null) {
      const upper = String(country).trim().toUpperCase();
      if (!countriesUtil.isValidCountry(upper)) {
        return res.status(400).json({ error: 'invalid_country' });
      }
      countryCode = upper;
    }
    const effectiveCountry = countryCode || req.user.country || 'US';

    function addressText(raw, max, errorCode) {
      if (raw === undefined || raw === null) return undefined;
      const v = String(raw).trim();
      if (v.length > max) return { error: errorCode };
      return { value: v === '' ? null : v };
    }

    const line1 = addressText(address_line1, 255, 'address_line1_too_long');
    const line2 = addressText(address_line2, 255, 'address_line2_too_long');
    const cityVal = addressText(city, 100, 'city_too_long');
    for (const parsed of [line1, line2, cityVal]) {
      if (parsed && parsed.error) return res.status(400).json({ error: parsed.error });
    }

    let stateValue;
    if (state !== undefined && state !== null) {
      const rawState = String(state).trim();
      if (rawState.length > 100) {
        return res.status(400).json({ error: 'state_too_long' });
      }
      if (rawState === '') {
        stateValue = null;
      } else {
        const regionList = countriesUtil.getRegions(effectiveCountry);
        const usesRegionCodes = Array.isArray(regionList)
          && regionList.every((r) => /^[A-Z]{2,3}$/.test(String(r)));
        const normalizedState = usesRegionCodes ? rawState.toUpperCase() : rawState;
        if (countriesUtil.hasRegions(effectiveCountry)
          && !countriesUtil.isValidRegion(effectiveCountry, normalizedState)) {
          return res.status(400).json({ error: 'invalid_state' });
        }
        stateValue = normalizedState;
      }
    }

    let zipValue;
    const rawZip = zip_code !== undefined ? zip_code : zipcode;
    if (rawZip !== undefined && rawZip !== null) {
      const v = String(rawZip).trim();
      if (v.length > 20) {
        return res.status(400).json({ error: 'postal_code_too_long' });
      }
      if (v !== '' && !countriesUtil.isValidPostal(effectiveCountry, v)) {
        return res.status(400).json({ error: 'invalid_postal_code' });
      }
      zipValue = v === '' ? null : v;
    }
    const requestedMode = default_mode === undefined || default_mode === null
      ? null
      : String(default_mode);
    const currentRole = req.user.role;
    const currentMode = req.user.default_mode || (
      ['admin', 'super_admin'].includes(currentRole)
        ? 'admin'
        : ['helper', 'helper_pro', 'broker'].includes(currentRole)
          ? 'helper'
          : 'customer'
    );

    if (requestedMode && !modeRoleUtil.isValidMode(requestedMode)) {
      return res.status(400).json({ error: 'invalid_mode' });
    }

    const VALID_PREFS = ['full_name', 'first_name', 'business_name'];
    const pref = VALID_PREFS.includes(display_name_preference) ? display_name_preference : undefined;
    const preferredLang = normalizeSupportedLanguage(preferred_language);

    // Bio: optional, trimmed, max 500 chars. Provided (even empty) means set it.
    let bioValue;
    if (bio !== undefined && bio !== null) {
      bioValue = String(bio).trim();
      if (bioValue.length > 500) {
        return res.status(400).json({ error: 'bio_too_long' });
      }
    }
    // Photo URL: undefined/null = leave unchanged; '' = clear; otherwise must be http(s) and <= 500 chars.
    let photoValue;
    if (profile_photo_url !== undefined && profile_photo_url !== null) {
      const trimmed = String(profile_photo_url).trim();
      if (trimmed === '') {
        photoValue = null;
      } else {
        if (trimmed.length > 500 || !/^https?:\/\//i.test(trimmed)) {
          return res.status(400).json({ error: 'invalid_profile_photo_url' });
        }
        photoValue = trimmed;
      }
    }

    // default_mode through updateProfile is a convenience for clients that
    // want to do everything in one PATCH. The actual switch goes through
    // applyModeSwitch so role + default_mode + helper_profiles row + session
    // invalidation all happen atomically — same code path as /switch-role.
    let updatedUser = null;
    let didModeSwitch = false;
    let modeTokens = null;
    await client.query('BEGIN');
    if (requestedMode && requestedMode !== currentMode) {
      if (requestedMode === 'admin' && !['admin', 'super_admin'].includes(currentRole)) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'mode_not_granted',
          message: 'Admin mode is only available to administrators.',
        });
      }

      if (modeRoleUtil.isGrantedMode(requestedMode) && !['admin', 'super_admin'].includes(currentRole)) {
        const memberRole = ({
          business_manager: 'manager',
          business_representative: 'representative',
          business_employee: 'employee',
          business_support_agent: 'support_agent',
        })[requestedMode];
        const { rows: memberships } = await client.query(
          `SELECT id FROM business_members
             WHERE user_id = $1 AND role = $2 AND status = 'active'
             LIMIT 1`,
          [req.user.id, memberRole],
        );
        if (memberships.length === 0) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'mode_not_granted',
            message: `You don't have an active "${memberRole}" membership on any workspace.`,
          });
        }
      }

      updatedUser = await modeRoleUtil.applyModeSwitch(client, req.user.id, requestedMode);
      if (!updatedUser) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'state_conflict' });
      }
      didModeSwitch = true;
    }

    const setFragments = [
      'phone = COALESCE($1, phone)',
      'display_name_preference = COALESCE($2, display_name_preference)',
      'preferred_language = COALESCE($3, preferred_language)',
    ];
    const updateParams = [phone || null, pref || null, preferredLang || null];
    if (bioValue !== undefined) {
      setFragments.push(`bio = $${updateParams.length + 1}`);
      updateParams.push(bioValue || null);
    }
    if (photoValue !== undefined) {
      if (photoValue === null) {
        setFragments.push('profile_photo_url = NULL');
      } else {
        setFragments.push(`profile_photo_url = $${updateParams.length + 1}`);
        updateParams.push(photoValue);
      }
    }
    const addressSets = [
      ['address_line1', line1 && line1.value],
      ['address_line2', line2 && line2.value],
      ['city', cityVal && cityVal.value],
      ['state', stateValue],
      ['zip_code', zipValue],
      ['country', countryCode],
    ];
    for (const [column, value] of addressSets) {
      if (value === undefined) continue;
      if (value === null) {
        setFragments.push(`${column} = NULL`);
      } else {
        setFragments.push(`${column} = $${updateParams.length + 1}`);
        updateParams.push(value);
      }
    }
    updateParams.push(req.user.id);
    const { rows } = await client.query(
      `UPDATE users
       SET ${setFragments.join(',\n           ')},
           updated_at = NOW()
       WHERE id = $${updateParams.length}
       RETURNING *`,
      updateParams
    );
    const finalRow = didModeSwitch && updatedUser
      ? { ...updatedUser, ...rows[0] }
      : rows[0];

    if (didModeSwitch) {
      const tokens = generateTokens(finalRow);
      const hashedRefresh = crypto.createHash('sha256').update(tokens.refreshToken).digest('hex');
      await modeRoleUtil.invalidateUserSessions(client, req.user.id);
      await client.query(
        "INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval '7 days')",
        [finalRow.id, hashedRefresh],
      );
      modeTokens = tokens;
    }
    await client.query('COMMIT');

    res.json({
      success: true,
      user: formatAuthUser(finalRow),
      mode_switched: didModeSwitch,
      ...(modeTokens || {}),
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    logger.error('Update profile error', { err: err.message });
    if (err.code === '23514' && /OxSteed Credit/.test(err.message || '')) {
      return res.status(409).json({
        error: 'credit_customer_mode_locked',
        message: 'This account has OxSteed Credit activity and must remain in Customer mode.',
      });
    }
    res.status(500).json({ error: 'Failed to update profile' });
  } finally {
    client.release();
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

    // Rotate credentials only after the revocation store confirms it can
    // invalidate existing tokens. Otherwise a successful password change can
    // leave an old bearer token active until its normal expiry.
    try {
      await tokenRevocationService.revokeAllUserTokens(req.user.id);
    } catch (err) {
      if (err?.code === 'token_revocation_unavailable') {
        return res.status(503).json({
          error: 'Password change is temporarily unavailable. Please retry.',
          code: 'token_revocation_unavailable',
          retryable: true,
        });
      }
      throw err;
    }
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, req.user.id]);

    // FIX #10 & #11: Audit log password change
    const { ipAddress, userAgent } = extractRequestDetails(req);
    logSecurityEvent('password_changed', {
      userId: req.user.id,
      resourceType: 'user_account',
      resourceId: req.user.id,
      details: { method: 'authenticated_change' },
      ipAddress,
      userAgent,
      status: 'success'
    }).catch(() => {});

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    logger.error('Change password error', { err });
    res.status(500).json({ error: 'Failed to change password' });
  }
}

// SECURITY: Change email with dual verification (old + new email confirm required)
async function changeEmail(req, res, next) {
  try {
    const { newEmail, password } = req.body;

    // Validate input
    const errs = validate({ newEmail, password }, {
      newEmail: [rules.required, rules.email, rules.maxLen(254)],
      password: [rules.required],
    });
    if (errs) {
      return next(new AppError('Validation failed', 400, 'validation_failed', errs));
    }

    const newEmailLower = newEmail.toLowerCase();

    // Verify password
    const { rows: userRows } = await pool.query(
      'SELECT id, email, password_hash, preferred_language FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!userRows[0]) {
      return next(new AppError('User not found', 404, 'user_not_found'));
    }

    const passwordValid = await bcrypt.compare(password, userRows[0].password_hash);
    if (!passwordValid) {
      return next(new AppError('Incorrect password', 401, 'invalid_password'));
    }

    const oldEmail = userRows[0].email;

    // Check email not already in use
    const { rows: existingEmail } = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND id != $2',
      [newEmailLower, req.user.id]
    );
    if (existingEmail.length > 0) {
      return next(new AppError('Email already in use', 409, 'email_taken', {
        newEmail: 'This email is already registered'
      }));
    }

    // Generate verification tokens for both old and new email
    const oldEmailToken = crypto.randomBytes(32).toString('hex');
    const newEmailToken = crypto.randomBytes(32).toString('hex');
    const oldTokenHash = crypto.createHash('sha256').update(oldEmailToken).digest('hex');
    const newTokenHash = crypto.createHash('sha256').update(newEmailToken).digest('hex');

    // Store pending email change (not applied yet)
    await pool.query(
      `UPDATE users
       SET pending_email = $1,
           email_change_old_token = $2,
           email_change_new_token = $3,
           email_change_requested_at = NOW()
       WHERE id = $4`,
      [newEmailLower, oldTokenHash, newTokenHash, req.user.id]
    );

    // Send verification email to OLD email (prevent hijacking)
    const preferredLanguage = userRows[0].preferred_language || 'en';
    try {
      await sendPasswordResetEmail(oldEmail, {
        type: 'email_change_confirmation',
        token: oldEmailToken,
        newEmail: newEmailLower,
        actionUrl: `${process.env.CLIENT_URL}/confirm-email-change?token=${oldEmailToken}&type=old`
      }, preferredLanguage);
    } catch (emailErr) {
      logger.warn('Failed to send email change confirmation to old email', { userId: req.user.id, error: emailErr.message });
    }

    // Send verification email to NEW email
    try {
      await sendPasswordResetEmail(newEmailLower, {
        type: 'email_change_confirmation',
        token: newEmailToken,
        oldEmail: oldEmail,
        actionUrl: `${process.env.CLIENT_URL}/confirm-email-change?token=${newEmailToken}&type=new`
      }, preferredLanguage);
    } catch (emailErr) {
      logger.warn('Failed to send email change confirmation to new email', { userId: req.user.id, error: emailErr.message });
    }

    res.json({
      message: 'Verification emails sent to both addresses. Confirm email change in both to proceed.',
      pendingEmail: newEmailLower,
    });
  } catch (err) {
    next(err);
  }
}

// Confirm email change (verify both old and new email tokens)
async function confirmEmailChange(req, res, next) {
  try {
    const { oldToken, newToken } = req.body;

    if (!oldToken || !newToken) {
      return next(new AppError('Both tokens required', 400, 'validation_failed', {
        tokens: 'Must confirm from both old and new email'
      }));
    }

    const oldTokenHash = crypto.createHash('sha256').update(oldToken).digest('hex');
    const newTokenHash = crypto.createHash('sha256').update(newToken).digest('hex');

    // Verify both tokens match and are not expired (valid for 24 hours)
    const { rows } = await pool.query(
      `SELECT id, email, pending_email, email_change_requested_at
       FROM users
       WHERE id = $1
         AND email_change_old_token = $2
         AND email_change_new_token = $3
         AND email_change_requested_at > NOW() - interval '24 hours'`,
      [req.user.id, oldTokenHash, newTokenHash]
    );

    if (!rows[0]) {
      return next(new AppError('Invalid or expired confirmation tokens', 401, 'invalid_tokens'));
    }

    const user = rows[0];
    const oldEmail = user.email;
    const newEmail = user.pending_email;

    // Apply email change atomically
    await pool.query(
      `UPDATE users
       SET email = $1,
           email_verified = TRUE,
           pending_email = NULL,
           email_change_old_token = NULL,
           email_change_new_token = NULL,
           email_change_requested_at = NULL,
           updated_at = NOW()
       WHERE id = $2`,
      [newEmail, req.user.id]
    );

    // Log security event
    logger.info('Email changed', {
      userId: req.user.id,
      oldEmail: oldEmail,
      newEmail: newEmail,
      ipAddress: req.ip
    });

    res.json({
      message: 'Email changed successfully',
      email: newEmail
    });
  } catch (err) {
    next(err);
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
  users.created_at
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
      'SELECT id, email, preferred_language, email_verified FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    if (rows[0].email_verified) return res.status(400).json({ error: 'Email already verified' });

    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');
    await pool.query(
      'UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE id = $3',
      [hashedOtp, expiresAt, req.user.id]
    );
    await sendOTPEmail(rows[0].email, otp, rows[0].preferred_language);
    res.json({ message: 'Verification email sent' });
  } catch (err) {
    logger.error('Resend verification error', { err });
    res.status(500).json({ error: 'Failed to send verification email' });
  }
}
// Switch a user's account-type / mode. This endpoint replaces what was
// previously a customer↔helper toggle. The wire format accepts either:
//
//   { mode: 'business_owner' }        ← new unified shape
//   { target_role: 'helper' }         ← legacy shape, preserved so older
//                                       clients keep working
//
// Internally a single concept (default_mode) drives a derived users.role.
// The role mapping is owned by server/utils/modeRole.js — this controller
// just orchestrates the transaction + token rotation.
//
// Granted modes (business_manager / representative / employee / support_agent)
// are NOT auto-switched into when a membership is granted; they're only
// reachable here if the caller explicitly asks for one AND we've verified
// they hold the underlying membership.
async function switchRole(req, res) {
  const client = await pool.connect();
  try {
    const { mode: requestedMode, target_role: legacyTargetRole } = req.body;
    const userId = req.user.id;
    const currentRole = req.user.role;
    const currentMode = req.user.default_mode || (
      ['admin', 'super_admin'].includes(currentRole)
        ? 'admin'
        : ['helper', 'helper_pro', 'broker'].includes(currentRole)
          ? 'helper'
          : 'customer'
    );

    // Resolve the requested mode. Legacy callers send target_role — map it.
    let newMode = requestedMode;
    if (!newMode && legacyTargetRole) {
      if (legacyTargetRole === 'helper') newMode = 'helper';
      else if (legacyTargetRole === 'customer') newMode = 'customer';
      // unknown legacy values fall through to validation
    }
    if (!modeRoleUtil.isValidMode(newMode)) {
      return res.status(400).json({
        error: 'invalid_mode',
        message: `Mode must be one of: ${Object.keys(modeRoleUtil.MODE_ROLE_MAP).join(', ')}`,
      });
    }

    // Self-selectable modes are available to every authenticated user. Granted
    // workspace modes require proof of the underlying membership, while admin
    // mode is reserved for users who already have an administrative role.
    if (newMode === 'admin' && currentRole !== 'admin' && currentRole !== 'super_admin') {
      return res.status(403).json({
        error: 'mode_not_granted',
        message: 'Admin mode is only available to administrators.',
      });
    }

    // Granted modes require proof of the underlying membership. Anyone with
    // an active business_members row of the right role qualifies. Admins
    // bypass.
    if (modeRoleUtil.isGrantedMode(newMode) && currentRole !== 'admin' && currentRole !== 'super_admin') {
      const memberRole = ({
        business_manager: 'manager',
        business_representative: 'representative',
        business_employee: 'employee',
        business_support_agent: 'support_agent',
      })[newMode];
      const { rows: memb } = await client.query(
        `SELECT id FROM business_members
          WHERE user_id = $1 AND role = $2 AND status = 'active'
          LIMIT 1`,
        [userId, memberRole],
      );
      if (memb.length === 0) {
        return res.status(403).json({
          error: 'mode_not_granted',
          message: `You don't have an active "${memberRole}" membership on any workspace.`,
        });
      }
    }

    if (newMode === currentMode) {
      // No-op — return the current user shape so clients can rely on the
      // response regardless of whether the switch was needed.
      return res.json({
        success: true,
        user: formatAuthUser(req.user),
      });
    }

    await client.query('BEGIN');
    const updatedUser = await modeRoleUtil.applyModeSwitch(client, userId, newMode);
    if (!updatedUser) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'state_conflict', message: 'Mode changed during switch. Please try again.' });
    }
    const tokens = generateTokens(updatedUser);
    const hashedRefresh = crypto.createHash('sha256').update(tokens.refreshToken).digest('hex');
    // Create the replacement session before commit. This keeps the user mode
    // update and its fresh refresh token atomic instead of returning a 500
    // after the role has already changed.
    await modeRoleUtil.invalidateUserSessions(client, userId);
    await client.query(
      "INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval '7 days')",
      [updatedUser.id, hashedRefresh],
    );
    await client.query('COMMIT');

    logger.info('Mode switch', { userId, fromMode: currentMode, toMode: newMode, fromRole: currentRole, toRole: updatedUser.role });
    return res.json({
      success: true,
      user: formatAuthUser(updatedUser),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    logger.error('Switch mode error', { err: err.message, code: err.code });
    if (err.code === 'invalid_mode') return res.status(400).json({ error: 'invalid_mode' });
    if (err.code === 'user_not_found') return res.status(404).json({ error: 'user_not_found' });
    if (err.code === '23514' && /OxSteed Credit/.test(err.message || '')) {
      return res.status(409).json({
        error: 'credit_customer_mode_locked',
        message: 'This account has OxSteed Credit activity and must remain in Customer mode.',
      });
    }
    res.status(500).json({ error: 'Failed to switch mode' });
  } finally {
    client.release();
  }
}

module.exports = {
  login, loginWith2FA, requestOTP, verifyOTP, refreshToken, logout,
  checkEmail, checkZip, addToWaitlist,
  startRegistration, acceptTerms, verifyRegistrationOTP, resendRegistrationOTP,
  forgotPassword, resetPassword,
  getMe, updateProfile, changePassword, changeEmail, confirmEmailChange, getPublicProfile, resendVerification,
  switchRole,
  formatAuthUser
};
