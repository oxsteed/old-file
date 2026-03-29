// server/controllers/helperRegistrationController.js

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');
const pool   = require('../db');

// ── Token generator ────────────────────────────────────────────────

function generateTokens(userId) {
  const accessToken = jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
  const refreshToken = jwt.sign(
    { id: userId },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
  return { accessToken, refreshToken };
}

// ── Shared user formatter ──────────────────────────────────────────

function formatUser(user) {
  if (!user) return null;
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
    contact_completed:     !!user.contact_completed,
    profile_completed:     !!user.profile_completed,
    tier_selected:         !!user.tier_selected,
    w9_completed:          !!user.w9_completed,
    terms_accepted:        !!user.terms_accepted,
    membership_tier:       user.membership_tier,
    id_verified:           !!user.id_verified,
    background_check_passed: !!user.background_check_passed,
    city:                  user.city,
    state:                 user.state,
    zip_code:              user.zip_code
  };
}

// ── STEP 1: Start Registration (PUBLIC) ────────────────────────────
// POST /helper/register/start
// Body: { email, first_name, last_name, password }

async function startHelperRegistration(req, res) {
  try {
    const { email, first_name, last_name, password } = req.body;

    if (!email || !first_name || !last_name || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email, first name, last name, and password are required'
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists. Please log in.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await pool.query(
      `INSERT INTO pending_registrations
         (email, first_name, last_name, password_hash, account_created)
       VALUES ($1, $2, $3, $4, FALSE)
       ON CONFLICT (email) DO UPDATE
         SET first_name = EXCLUDED.first_name,
             last_name  = EXCLUDED.last_name,
             password_hash = EXCLUDED.password_hash,
             account_created = FALSE,
             otp_verified = FALSE,
             otp_code = NULL,
             otp_expires_at = NULL,
             otp_attempts = 0`,
      [normalizedEmail, first_name.trim(), last_name.trim(), passwordHash]
    );

    return res.json({ success: true, message: 'Registration started', email: normalizedEmail });
  } catch (err) {
    console.error('startHelperRegistration:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── STEP 2: Send OTP (PUBLIC) ──────────────────────────────────────
// POST /helper/register/send-otp
// Body: { email }

async function sendOTP(req, res) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { rows } = await pool.query(
      'SELECT id, account_created FROM pending_registrations WHERE email = $1',
      [normalizedEmail]
    );
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No pending registration found. Start registration first.'
      });
    }
    if (rows[0].account_created) {
      return res.status(400).json({
        success: false,
        message: 'Account already created. Please log in.'
      });
    }

    const otpCode      = crypto.randomInt(100000, 999999).toString();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `UPDATE pending_registrations
       SET otp_code = $1, otp_expires_at = $2, otp_attempts = 0, otp_verified = FALSE
       WHERE email = $3`,
      [otpCode, otpExpiresAt, normalizedEmail]
    );

    // Send email using the project's existing email utility
    try {
      const { sendOTPEmail } = require('../utils/email');
      await sendOTPEmail(normalizedEmail, otpCode);
    } catch (emailErr) {
      console.error('Email send failed:', emailErr.message);
      console.log('[DEV FALLBACK] OTP for', normalizedEmail, ':', otpCode);
    }

    return res.json({ success: true, message: 'Verification code sent' });
  } catch (err) {
    console.error('sendOTP:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── STEP 3: Resend OTP (PUBLIC) ────────────────────────────────────
// POST /helper/register/resend-otp
// Body: { email }

async function resendHelperOTP(req, res) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { rows } = await pool.query(
      'SELECT id, account_created FROM pending_registrations WHERE email = $1',
      [normalizedEmail]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No pending registration found' });
    }
    if (rows[0].account_created) {
      return res.status(400).json({ success: false, message: 'Account already created. Please log in.' });
    }

    const otpCode      = crypto.randomInt(100000, 999999).toString();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `UPDATE pending_registrations
       SET otp_code = $1, otp_expires_at = $2, otp_attempts = 0
       WHERE email = $3`,
      [otpCode, otpExpiresAt, normalizedEmail]
    );

    try {
      const { sendOTPEmail } = require('../utils/email');
      await sendOTPEmail(normalizedEmail, otpCode);
    } catch (emailErr) {
      console.error('Email send failed:', emailErr.message);
      console.log('[DEV FALLBACK] Resend OTP for', normalizedEmail, ':', otpCode);
    }

    return res.json({ success: true, message: 'New verification code sent' });
  } catch (err) {
    console.error('resendHelperOTP:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── STEP 4: Verify OTP — CREATES REAL USER + RETURNS TOKENS (PUBLIC) ──
// POST /helper/register/verify-otp
// Body: { email, otp }
// IMPORTANT: This is the step that creates the real users row.
// Helper is logged in immediately after with LIMITED access.

async function verifyOTP(req, res) {
  const client = await pool.connect();
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP code are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT * FROM pending_registrations WHERE email = $1 FOR UPDATE',
      [normalizedEmail]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'No pending registration found. Start registration first.'
      });
    }

    const pending = rows[0];

    // If already created, return existing user + fresh tokens
    if (pending.account_created && pending.user_id) {
      await client.query('ROLLBACK');
      const { rows: userRows } = await pool.query(
        `SELECT * FROM users WHERE id = $1`,
        [pending.user_id]
      );
      if (userRows.length > 0) {
        const tokens = generateTokens(userRows[0].id);
        return res.json({
          success: true,
          message: 'Already verified. Logged in.',
          user: formatUser(userRows[0]),
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken
        });
      }
    }

    // Check attempt limit
    if ((pending.otp_attempts || 0) >= 5) {
      await client.query('ROLLBACK');
      return res.status(429).json({
        success: false,
        message: 'Too many attempts. Request a new verification code.'
      });
    }

    // Increment attempts
    await client.query(
      'UPDATE pending_registrations SET otp_attempts = otp_attempts + 1 WHERE email = $1',
      [normalizedEmail]
    );

    // Validate OTP
    if (!pending.otp_code || pending.otp_code !== otp.trim()) {
      await client.query('COMMIT');
      return res.status(400).json({ success: false, message: 'Invalid verification code' });
    }

    if (!pending.otp_expires_at || new Date() > new Date(pending.otp_expires_at)) {
      await client.query('COMMIT');
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired. Please request a new one.'
      });
    }

    // Create the real user with LIMITED access (onboarding_completed = false)
    const { rows: newRows } = await client.query(
      `INSERT INTO users (
        first_name, last_name, email, password_hash, role,
        email_verified, is_verified,
        onboarding_status, onboarding_completed,
        contact_completed, profile_completed, tier_selected,
        w9_completed, terms_accepted,
        membership_tier, id_verified, background_check_passed
      ) VALUES (
        $1, $2, $3, $4, 'helper',
        TRUE, TRUE,
        'verified_pending_onboarding', FALSE,
        FALSE, FALSE, FALSE,
        FALSE, FALSE,
        'tier1', FALSE, FALSE
      )
      ON CONFLICT (email) DO NOTHING
      RETURNING *`,
      [
        pending.first_name,
        pending.last_name,
        normalizedEmail,
        pending.password_hash
      ]
    );

    let newUser;
    if (newRows.length === 0) {
      const { rows: existing } = await client.query(
        'SELECT * FROM users WHERE email = $1',
        [normalizedEmail]
      );
      newUser = existing[0];
    } else {
      newUser = newRows[0];
    }

    // Mark pending as done
    await client.query(
      `UPDATE pending_registrations
       SET otp_verified = TRUE, account_created = TRUE, user_id = $1,
           otp_attempts = 0
       WHERE email = $2`,
      [newUser.id, normalizedEmail]
    );

    await client.query('COMMIT');

    const tokens = generateTokens(newUser.id);

    return res.status(201).json({
      success: true,
      message: 'Email verified. Helper account created. Complete onboarding to unlock full access.',
      user: formatUser(newUser),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('verifyOTP:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    client.release();
  }
}

// ── STEP 5: Update Contact Info (AUTHENTICATED — LIMITED ACCESS) ───
// POST /helper/register/update-contact
// Headers: Authorization: Bearer <accessToken>
// Body: { phone, city, state, zip_code }

async function updateContactInfo(req, res) {
  try {
    const { phone, city, state, zip_code } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone is required' });
    }

    const { rows } = await pool.query(
      `UPDATE users
       SET phone = $1, city = $2, state = $3, zip_code = $4,
           contact_completed = TRUE,
           onboarding_status = 'onboarding_in_progress'
       WHERE id = $5
       RETURNING *`,
      [phone.trim(), city?.trim() || null, state?.trim() || null,
       zip_code?.trim() || null, req.user.id]
    );

    return res.json({ success: true, message: 'Contact info saved', user: formatUser(rows[0]) });
  } catch (err) {
    console.error('updateContactInfo:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── STEP 6: Complete Profile Step (AUTHENTICATED — LIMITED ACCESS) ─
// POST /helper/register/profile
// Headers: Authorization: Bearer <accessToken>
// Body: { bio, skills, service_area }

async function completeProfileStep(req, res) {
  try {
    const { bio, skills, service_area } = req.body;

    const { rows } = await pool.query(
      `UPDATE users
       SET bio = $1, skills = $2, service_area = $3,
           profile_completed = TRUE,
           onboarding_status = 'onboarding_in_progress'
       WHERE id = $4
       RETURNING *`,
      [bio?.trim() || null, skills || null, service_area?.trim() || null, req.user.id]
    );

    return res.json({ success: true, message: 'Profile step completed', user: formatUser(rows[0]) });
  } catch (err) {
    // If bio/skills/service_area columns don't exist, log a clear error
    if (err.message && err.message.includes('column')) {
      console.error('completeProfileStep column error — add bio, skills, service_area columns to users table:', err.message);
      return res.status(500).json({
        success: false,
        message: 'Profile columns missing in users table. Run: ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT, ADD COLUMN IF NOT EXISTS skills TEXT, ADD COLUMN IF NOT EXISTS service_area TEXT;'
      });
    }
    console.error('completeProfileStep:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── STEP 7: Select Tier (AUTHENTICATED — LIMITED ACCESS) ──────────
// POST /helper/register/tier
// Headers: Authorization: Bearer <accessToken>
// Body: { membership_tier: 'tier1' | 'tier2' }

async function selectTierStep(req, res) {
  try {
    const { membership_tier } = req.body;
    if (!membership_tier || !['tier1', 'tier2'].includes(membership_tier)) {
      return res.status(400).json({
        success: false,
        message: 'membership_tier must be tier1 or tier2'
      });
    }

    const { rows } = await pool.query(
      `UPDATE users
       SET membership_tier = $1, tier_selected = TRUE,
           onboarding_status = 'onboarding_in_progress'
       WHERE id = $2
       RETURNING *`,
      [membership_tier, req.user.id]
    );

    const label = membership_tier === 'tier2' ? 'Pro Helper' : 'Standard Helper';
    return res.json({ success: true, message: `Tier selected: ${label}`, user: formatUser(rows[0]) });
  } catch (err) {
    console.error('selectTierStep:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── STEP 8: Complete W-9 Step (AUTHENTICATED — LIMITED ACCESS) ────
// POST /helper/register/w9
// Headers: Authorization: Bearer <accessToken>
// Body: { w9_name, w9_tin_last4, w9_address } (optional fields)

async function completeW9Step(req, res) {
  try {
    const { rows } = await pool.query(
      `UPDATE users
       SET w9_completed = TRUE,
           onboarding_status = 'onboarding_in_progress'
       WHERE id = $1
       RETURNING *`,
      [req.user.id]
    );

    return res.json({ success: true, message: 'W-9 step completed', user: formatUser(rows[0]) });
  } catch (err) {
    console.error('completeW9Step:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── STEP 9: Accept Terms (AUTHENTICATED — LIMITED ACCESS) ─────────
// POST /helper/register/accept-terms
// Headers: Authorization: Bearer <accessToken>
// Body: { accepted: true }

async function acceptTermsStep(req, res) {
  try {
    if (!req.body.accepted) {
      return res.status(400).json({ success: false, message: 'You must accept the terms' });
    }

    const { rows } = await pool.query(
      `UPDATE users
       SET terms_accepted = TRUE,
           onboarding_status = 'onboarding_in_progress'
       WHERE id = $1
       RETURNING *`,
      [req.user.id]
    );

    return res.json({ success: true, message: 'Terms accepted', user: formatUser(rows[0]) });
  } catch (err) {
    console.error('acceptTermsStep:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── STEP 10: Finalize Registration (AUTHENTICATED — LIMITED ACCESS) ─
// POST /helper/register/finalize
// Headers: Authorization: Bearer <accessToken>
// Checks all flags. If all complete, sets onboarding_completed = TRUE.

async function finalizeRegistration(req, res) {
  try {
    const { rows: check } = await pool.query(
      `SELECT profile_completed, tier_selected, w9_completed, terms_accepted
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (check.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const u = check[0];
    if (!u.profile_completed || !u.tier_selected || !u.w9_completed || !u.terms_accepted) {
      return res.status(400).json({
        success: false,
        code: 'HELPER_ONBOARDING_INCOMPLETE',
        message: 'Complete all onboarding steps before finalizing',
        onboarding: {
          profile_completed: !!u.profile_completed,
          tier_selected:     !!u.tier_selected,
          w9_completed:      !!u.w9_completed,
          terms_accepted:    !!u.terms_accepted
        }
      });
    }

    const { rows } = await pool.query(
      `UPDATE users
       SET onboarding_completed = TRUE,
           onboarding_status = 'onboarding_complete'
       WHERE id = $1
       RETURNING *`,
      [req.user.id]
    );

    return res.json({
      success: true,
      message: 'Onboarding complete. You now have full helper access.',
      user: formatUser(rows[0])
    });
  } catch (err) {
    console.error('finalizeRegistration:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── Service Categories (PUBLIC) ────────────────────────────────────
async function getCategories(req, res) {
  const categories = [
    'Home Repair', 'Cleaning', 'Landscaping', 'Moving', 'Painting',
    'Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'Handyman',
    'Pet Care', 'Tutoring', 'Tech Support', 'Auto Services', 'Other'
  ];
  return res.json({ success: true, categories });
}

module.exports = {
  startHelperRegistration,
  sendOTP,
  resendHelperOTP,
  verifyOTP,
  updateContactInfo,
  completeProfileStep,
  selectTierStep,
  completeW9Step,
  acceptTermsStep,
  finalizeRegistration,
  getCategories,
  // Aliases for route compatibility
  updateContact: updateContactInfo,
  saveHelperProfile: completeProfileStep,
  selectTier: selectTierStep,
  submitW9: completeW9Step,
  helperAcceptTerms: acceptTermsStep
};
