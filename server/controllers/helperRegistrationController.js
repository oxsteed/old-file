// server/controllers/helperRegistrationController.js
const crypto = require('crypto');
const pool = require('../db');
const bcrypt = require('bcrypt');
const { generateTokens } = require('../middleware/auth');
const { formatAuthUser } = require('./authController');
const { sendOTPEmail } = require('../utils/email');
const { encrypt, hashTIN, maskTIN } = require('../utils/encryption');
const { TERMS_CONFIG } = require('../constants/termsConfig');

// ── helpers ──────────────────────────────────────────────
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
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
    console.error('getCategories error:', err);
    return res.status(500).json({ error: 'Failed to load categories' });
  }
}

// ── 1. Start Registration ────────────────────────────────
// POST /api/helper-registration/start
async function startRegistration(req, res) {
  try {
        const { email, password, firstName, lastName, phone, zip, ageConfirmed } = req.body;
        if (!email || !password || !firstName || !lastName || !phone || !zip)
            return res.status(400).json({ error: 'Email, password, first name, last name, phone, and zip required' });

    
    // Check for existing user
    const dup = await pool.query(
      'SELECT id FROM users WHERE email = $1', [email]);
    if (dup.rows.length)
      return res.status(409).json({ error: 'Email already registered' });

    const password_hash = await bcrypt.hash(password, 12);
    const otp = generateOTP();
    const otp_expires = otpExpiry();

    // Generate a unique token for this registration
    const token = crypto.randomBytes(32).toString('hex');

    // Delete any existing pending registration for this email, then insert fresh
    await pool.query(
      'DELETE FROM pending_registrations WHERE email = $1 AND (role = $2 OR role IS NULL)',
      [email, 'helper']
    );

    const result = await pool.query(`
      INSERT INTO pending_registrations
                  (token, email, password_hash, first_name, last_name, phone, zip_code, role, otp_code, otp_expires_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,'helper',$8,$9)
                RETURNING token
            `, [token, email, password_hash, firstName, lastName, phone, zip, otp, otp_expires]);

    await sendOTPEmail(email, otp);

    res.status(201).json({
      message: 'OTP sent to email',
                token: result.rows[0].token,
    });
  } catch (err) {
    console.error('startRegistration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
}

// ── 2. Verify OTP ────────────────────────────────────────
// POST /api/helper-registration/verify-otp
async function verifyOTP(req, res) {
  try {
    const { token, otp } = req.body;
    if (!token || !otp)
      return res.status(400).json({ error: 'Token and OTP required' });

    const { rows } = await pool.query(
      `SELECT id, otp_code, otp_expires_at
       FROM pending_registrations
       WHERE token = $1 AND role = 'helper'`,
      [token]
    );

    if (!rows.length)
      return res.status(404).json({ error: 'No pending registration found' });

    const reg = rows[0];
    if (reg.otp_code !== otp)
      return res.status(400).json({ error: 'Invalid OTP' });
    if (new Date(reg.otp_expires_at) < new Date())
      return res.status(400).json({ error: 'OTP expired' });

    // Mark as verified by clearing OTP (consumed) and setting otp_attempts to -1 as verified flag
    await pool.query(
      `UPDATE pending_registrations SET otp_code = NULL, otp_attempts = -1 WHERE id = $1`,
      [reg.id]
    );

    res.json({ message: 'Email verified', registrationId: reg.id });
  } catch (err) {
    console.error('verifyOTP error:', err);
    res.status(500).json({ error: 'OTP verification failed' });
  }
}

// ── 3. Resend OTP ────────────────────────────────────────
// POST /api/helper-registration/resend-otp
async function resendOTP(req, res) {
  try {
    const { email, token } = req.body;
    if (!email && !token) {
      return res.status(400).json({ error: 'Email or token required' });
    }

    const otp = generateOTP();
    const otp_expires = otpExpiry();

    const lookup = token
      ? { where: 'token = $3', value: token }
      : { where: 'email = $3', value: email };

    const { rows } = await pool.query(
      `UPDATE pending_registrations
       SET otp_code = $1, otp_expires_at = $2, otp_attempts = 0
       WHERE ${lookup.where} AND role = 'helper'
       RETURNING email`,
      [otp, otp_expires, lookup.value]
    );

    if (!rows.length)
      return res.status(404).json({ error: 'No pending registration found' });

    await sendOTPEmail(rows[0].email, otp);
    res.json({ message: 'New OTP sent' });
  } catch (err) {
    console.error('resendOTP error:', err);
    res.status(500).json({ error: 'Resend OTP failed' });
  }
}

// ── 4. Complete Registration (creates user row) ──────────
// POST /api/helper-registration/complete
async function completeRegistration(req, res) {
  const { email, token } = req.body;
  if (!email && !token) return res.status(400).json({ error: 'Email or token required' });

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // otp_attempts = -1 means OTP was verified
    const lookupClause = token
      ? 'token = $1'
      : 'email = $1';

    const { rows } = await client.query(
      `SELECT * FROM pending_registrations
       WHERE ${lookupClause} AND role = 'helper' AND otp_attempts = -1`,
      [token || email]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Email not verified or no pending registration' });
    }

    const reg = rows[0];

    // create user — defaults: membership_tier = 'tier1', onboarding_status = 'verified_pending_onboarding'
    const userResult = await client.query(`
      INSERT INTO users (email, password_hash, first_name, last_name, phone, zip_code, role,
                         membership_tier, onboarding_status, onboarding_completed, email_verified)
      VALUES ($1,$2,$3,$4,$5,$6,'helper','tier1','verified_pending_onboarding',false,true)
      RETURNING id, email, first_name, last_name, phone, zip_code, role, membership_tier, onboarding_status
    `, [reg.email, reg.password_hash, reg.first_name, reg.last_name, reg.phone || null, reg.zip_code || null]);

    const user = userResult.rows[0];

    // Mark pending row as consumed and remove it.
    await client.query('DELETE FROM pending_registrations WHERE id = $1', [reg.id]);

    await client.query('COMMIT');

    const tokens = generateTokens(user);
    const { rows: fullRows } = await pool.query(
      `SELECT id, first_name, last_name, email, phone, role, email_verified, is_verified,
       onboarding_status, onboarding_completed, contact_completed, profile_completed,
       tier_selected, w9_completed, terms_accepted, membership_tier, id_verified,
       background_check_passed, city, state, zip_code
       FROM users WHERE id = $1`,
      [user.id]
    );
    res.status(201).json({
      message: 'Registration complete',
      user: formatAuthUser(fullRows[0]),
      ...tokens
    });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
    }
    console.error('completeRegistration error:', err);
    res.status(500).json({ error: 'Registration completion failed' });
  } finally {
    if (client) client.release();
  }
}

// ── 5. Submit Onboarding Profile ─────────────────────────
// PUT /api/helper-registration/onboarding/profile
// Auth required — user must be logged in
async function submitOnboardingProfile(req, res) {
  try {
    const userId = req.user.id;
    const { phone, city, state, zip_code, bio, skills } = req.body;

    if (!phone || !city || !state || !zip_code)
      return res.status(400).json({ error: 'Required profile fields missing' });

    await pool.query(`
      UPDATE users SET
        phone            = $1,
        city             = $2,
        state            = $3,
        zip_code         = $4,
        bio              = $5,
        skills           = $6,
        profile_completed = true,
        contact_completed = true,
        onboarding_status = 'onboarding_in_progress'
      WHERE id = $7 AND role = 'helper'
    `, [phone, city, state, zip_code,
        bio || null, JSON.stringify(skills || []), userId]);

    res.json({ message: 'Profile saved', onboarding_step: 'profile_complete' });
  } catch (err) {
    console.error('submitOnboardingProfile error:', err);
    res.status(500).json({ error: 'Profile save failed' });
  }
}

// ── 6. Submit ID Verification ────────────────────────────
// PUT /api/helper-registration/onboarding/id-verification
// Auth required
async function submitIdVerification(req, res) {
  try {
    const userId = req.user.id;
    const { id_document_url } = req.body;

    if (!id_document_url)
      return res.status(400).json({ error: 'ID document URL required' });

    await pool.query(`
      UPDATE users SET
        id_verified     = false,
        onboarding_status = 'onboarding_in_progress'
      WHERE id = $1 AND role = 'helper'
    `, [userId]);

    res.json({ message: 'ID submitted for review', onboarding_step: 'id_submitted' });
  } catch (err) {
    console.error('submitIdVerification error:', err);
    res.status(500).json({ error: 'ID verification submission failed' });
  }
}

// ── 7. Submit Background Check ───────────────────────────
// PUT /api/helper-registration/onboarding/background-check
// Auth required
async function submitBackgroundCheck(req, res) {
  try {
    const userId = req.user.id;
    const { background_check_consent } = req.body;

    if (!background_check_consent)
      return res.status(400).json({ error: 'Background check consent required' });

    await pool.query(`
      UPDATE users SET
        background_check_passed  = false,
        onboarding_status        = 'onboarding_in_progress'
      WHERE id = $1 AND role = 'helper'
    `, [userId]);

    res.json({ message: 'Background check submitted', onboarding_step: 'background_submitted' });
  } catch (err) {
    console.error('submitBackgroundCheck error:', err);
    res.status(500).json({ error: 'Background check submission failed' });
  }
}

// ── 8. Get Onboarding Status ─────────────────────────────
// GET /api/helper-registration/onboarding/status
// Auth required
async function getOnboardingStatus(req, res) {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `SELECT onboarding_status, membership_tier, id_verified,
              background_check_passed, bio, skills,
              profile_completed, contact_completed, tier_selected,
              w9_completed, terms_accepted, onboarding_completed
       FROM users WHERE id = $1 AND role = 'helper'`,
      [userId]
    );

    if (!rows.length)
      return res.status(404).json({ error: 'Helper not found' });

    const u = rows[0];

    // Map onboarding_status to step for API consumers
    let onboarding_step = 'registered';
    if (u.onboarding_completed) onboarding_step = 'active';
    else if (u.profile_completed) onboarding_step = 'profile_complete';
    if (u.onboarding_status === 'onboarding_complete') onboarding_step = 'active';

    res.json({
      onboarding_step:         onboarding_step,
      membership_tier:         u.membership_tier,
      id_verified:             u.id_verified,
      background_check_passed: u.background_check_passed,
      profile_complete:        !!u.profile_completed,
      canBrowseJobs:           true,
      canApplyToJobs:          u.membership_tier === 'tier2' || u.onboarding_completed,
      canAppearInSearch:       u.membership_tier === 'tier2' && u.onboarding_completed
    });
  } catch (err) {
    console.error('getOnboardingStatus error:', err);
    res.status(500).json({ error: 'Failed to get onboarding status' });
  }
}

// ── 9. Submit Profile (token-based, called by frontend Step4) ──────
// POST /api/helper-registration/profile
async function submitProfile(req, res) {
  try {
    const userId = req.user.id;
    const { profileHeadline, bio, serviceCategories, serviceRadius, ratePreference, hourlyRate } = req.body;

    await pool.query(`
      UPDATE users SET
        bio = $1,
        skills = $2,
        profile_completed = true,
        onboarding_status = 'onboarding_in_progress'
      WHERE id = $3 AND role = 'helper'
    `, [bio || null, JSON.stringify(serviceCategories || []), userId]);

    res.json({ message: 'Profile saved', onboarding_step: 'profile_complete' });
  } catch (err) {
    console.error('submitProfile error:', err);
    res.status(500).json({ error: 'Profile save failed' });
  }
}

// ── 10. Update Contact Info (token-based, called by frontend Step4) ──
// POST /api/helper-registration/update-contact
async function updateContact(req, res) {
  try {
    const userId = req.user.id;
    const { phone, zip } = req.body;

    if (!phone || !zip) return res.status(400).json({ error: 'Phone and zip required' });

    // Look up city/state from zip using zippopotam or just store zip
    await pool.query(`
      UPDATE users SET
        phone = $1,
        zip_code = $2,
        contact_completed = true
      WHERE id = $3 AND role = 'helper'
    `, [phone, zip, userId]);

    res.json({ message: 'Contact updated' });
  } catch (err) {
    console.error('updateContact error:', err);
    res.status(500).json({ error: 'Contact update failed' });
  }
}

// ── 11. Upload Profile Photo ────────────────────────────────
// POST /api/helper-registration/profile-photo
async function uploadProfilePhoto(req, res) {
  try {
    const userId = req.user.id;
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

    // Store as base64 data URL for now (swap to S3/CDN later)
    const base64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;
    const dataUrl = `data:${mimeType};base64,${base64}`;

    await pool.query(
      'UPDATE users SET profile_photo_url = $1 WHERE id = $2 AND role = $3',
      [dataUrl, userId, 'helper']
    );
    await pool.query(
      `INSERT INTO helper_profiles (user_id, profile_photo_url)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET profile_photo_url = $2, updated_at = now()`,
      [userId, dataUrl]
    );
    res.json({ message: 'Photo uploaded', photoUrl: dataUrl });
  } catch (err) {
    console.error('uploadProfilePhoto error:', err);
    res.status(500).json({ error: 'Photo upload failed' });
  }
}

// ── 12. Save selected tier ───────────────────────────────
// POST /api/helper-registration/tier
async function saveTier(req, res) {
  try {
    const userId = req.user.id;
    const { tier } = req.body;
    const allowed = new Set(['free', 'basic', 'pro', 'tier1', 'tier2']);
    if (!allowed.has(String(tier || ''))) {
      return res.status(400).json({ error: 'Invalid tier selection' });
    }

    const normalized = (tier === 'pro' || tier === 'basic' || tier === 'tier2') ? 'tier2' : 'tier1';

    await pool.query(
      `UPDATE users
       SET tier_selected = TRUE,
           membership_tier = $1,
           updated_at = NOW()
       WHERE id = $2 AND role = 'helper'`,
      [normalized, userId]
    );

    await pool.query(
      `INSERT INTO helper_profiles (user_id, tier)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET tier = $2, updated_at = NOW()`,
      [userId, normalized === 'tier2' ? 'pro' : 'free']
    );

    return res.json({ message: 'Tier saved', membership_tier: normalized });
  } catch (err) {
    console.error('saveTier error:', err);
    return res.status(500).json({ error: 'Failed to save tier' });
  }
}

// ── 13. Save W9 information ──────────────────────────────
// POST /api/helper-registration/w9
async function saveW9(req, res) {
  try {
    const userId = req.user.id;
    const {
      legalName,
      businessName,
      taxClassification,
      tin,
      address,
      signatureData,
      certify
    } = req.body;

    if (!legalName || !taxClassification || !tin || !address || !signatureData || !certify) {
      return res.status(400).json({ error: 'Missing required W9 fields' });
    }

    const sanitizedTIN = String(tin).replace(/\D/g, '');
    if (sanitizedTIN.length < 9) {
      return res.status(400).json({ error: 'TIN must be at least 9 digits' });
    }

    await pool.query(
      `INSERT INTO w9_records
       (user_id, legal_name, business_name, tax_classification, ssn_last4, tin_encrypted, tin_verified,
        address, signature_data, signed_at, ip_address, user_agent, year_applicable)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7, $8, NOW(), $9, $10, $11)`,
      [
        userId,
        legalName,
        businessName || null,
        taxClassification,
        maskTIN(sanitizedTIN).slice(-4),
        encrypt(sanitizedTIN),
        address,
        signatureData,
        req.ip || 'unknown',
        req.headers['user-agent'] || '',
        new Date().getUTCFullYear()
      ]
    );

    await pool.query(
      `UPDATE users
       SET w9_completed = TRUE,
           w9_on_file = TRUE,
           tax_id_last4 = $1,
           w9_submitted_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [maskTIN(sanitizedTIN).slice(-4), userId]
    );

    // Keep deterministic hash available for anti-duplicate checks if needed later.
    await pool.query(
      `UPDATE w9_records
       SET tin_verified = CASE WHEN tin_verified THEN TRUE ELSE FALSE END
       WHERE user_id = $1`,
      [userId]
    );
    hashTIN(sanitizedTIN);

    return res.json({ message: 'W9 saved successfully' });
  } catch (err) {
    console.error('saveW9 error:', err);
    return res.status(500).json({ error: 'Failed to save W9 information' });
  }
}

// ── 14. Accept terms for helper onboarding ───────────────
// POST /api/helper-registration/accept-terms
async function acceptTerms(req, res) {
  try {
    const userId = req.user.id;
    const termsVersion = TERMS_CONFIG?.terms_of_service?.version || '2026-03-20';
    await pool.query(
      `UPDATE users
       SET terms_accepted = TRUE,
           terms_accepted_at = NOW(),
           terms_version = $1,
           terms_acceptance_ip = $2,
           terms_acceptance_ua = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [termsVersion, req.ip || 'unknown', req.headers['user-agent'] || '', userId]
    );
    return res.json({ message: 'Terms accepted' });
  } catch (err) {
    console.error('acceptTerms helper error:', err);
    return res.status(500).json({ error: 'Failed to accept terms' });
  }
}

// ── 15. Finalize helper onboarding ───────────────────────
// POST /api/helper-registration/finalize
async function finalizeRegistration(req, res) {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `UPDATE users
       SET onboarding_completed = TRUE,
           onboarding_status = 'onboarding_complete',
           updated_at = NOW()
       WHERE id = $1 AND role = 'helper'
       RETURNING id`,
      [userId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Helper account not found' });
    }
    return res.json({ message: 'Helper registration finalized' });
  } catch (err) {
    console.error('finalizeRegistration error:', err);
    return res.status(500).json({ error: 'Failed to finalize registration' });
  }
}

// ── 16. Legacy payment step (no-op compatibility) ────────
// POST /api/helper-registration/payment
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
  savePaymentStep
};
