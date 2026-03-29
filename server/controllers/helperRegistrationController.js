// Helper Registration Controller
// Handles the full helper registration flow (new 5-step spec)
// OxSteed v2

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { encrypt } = require('../utils/encryption');
const pool = require('../db');
const { generateTokens } = require('../middleware/auth');
const { sendOTPEmail, sendWelcomeEmail } = require('../utils/email');

const SALT_ROUNDS = 12;

// ── GET CATEGORIES ────────────────────────────────────────
async function getCategories(req, res) {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, slug, icon FROM categories WHERE is_active = true ORDER BY sort_order ASC'
    );
    res.json({ categories: rows });
  } catch (err) {
    console.error('Get categories error:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
}

// ── STEP 1: Validate basic info, create pending helper registration ──
async function startHelperRegistration(req, res) {
  try {
    const { email, password, firstName, lastName, phone, zip, ageConfirmed } = req.body;
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: 'All fields required' });
    }
    if (!ageConfirmed) {
      return res.status(400).json({ error: 'Age confirmation required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const token = crypto.randomBytes(32).toString('hex');

    // Clean up any previous pending registration for this email
    await pool.query(
      'DELETE FROM pending_registrations WHERE email = $1 AND role = $2',
      [email.toLowerCase(), 'helper']
    );

    const phoneClean = phone ? phone.replace(/\D/g, '') : '0000000000';
    const formattedPhone = phoneClean.length === 11 ? '+' + phoneClean : '+1' + phoneClean;

    await pool.query(
      `INSERT INTO pending_registrations (
         token, email, password_hash, first_name, last_name,
         phone, zip_code, age_confirmed, role
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'helper')`,
      [
        token,
        email.toLowerCase(),
        passwordHash,
        firstName,
        lastName,
        formattedPhone,
        zip || '00000',
        ageConfirmed
      ]
    );

    res.json({ token, message: 'Basic info validated' });
  } catch (err) {
    console.error('Start helper registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
}

// ── SEND OTP (called after account setup, before email verification) ──
async function sendOTP(req, res) {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });

    const { rows } = await pool.query(
      "SELECT * FROM pending_registrations WHERE token = $1 AND role = 'helper' AND expires_at > NOW()",
      [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Invalid or expired registration' });

    const pending = rows[0];
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(
      'UPDATE pending_registrations SET otp_code = $2, otp_expires_at = $3, otp_attempts = 0 WHERE token = $1',
      [token, otp, otpExpires]
    );

    await sendOTPEmail(pending.email, otp);
    res.json({ message: 'Verification code sent' });
  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
}

// ── VERIFY OTP (email verification step) ──
async function verifyOTP(req, res) {
  try {
    const { token, otp } = req.body;
    if (!token || !otp) return res.status(400).json({ error: 'Token and code required' });

    const { rows } = await pool.query(
      "SELECT * FROM pending_registrations WHERE token = $1 AND role = 'helper' AND expires_at > NOW()",
      [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Invalid or expired registration' });

    const pending = rows[0];

    if (pending.otp_locked_until && new Date(pending.otp_locked_until) > new Date()) {
      return res.status(429).json({
        error: 'Too many attempts. Try again later.',
        lockoutUntil: pending.otp_locked_until
      });
    }

    if (pending.otp_code !== otp || new Date(pending.otp_expires_at) < new Date()) {
      const newAttempts = (pending.otp_attempts || 0) + 1;
      if (newAttempts >= 5) {
        await pool.query(
          `UPDATE pending_registrations
           SET otp_attempts = $2,
               otp_locked_until = NOW() + interval '1 hour'
           WHERE token = $1`,
          [token, newAttempts]
        );
        return res.status(429).json({ error: 'Too many failed attempts. Locked for 1 hour.' });
      }

      await pool.query(
        'UPDATE pending_registrations SET otp_attempts = $2 WHERE token = $1',
        [token, newAttempts]
      );

      return res.status(400).json({
        error: 'Invalid or expired code',
        attemptsRemaining: 5 - newAttempts
      });
    }

    // Mark email as verified on the pending record
    await pool.query(
      'UPDATE pending_registrations SET otp_code = NULL, otp_attempts = 0 WHERE token = $1',
      [token]
    );

    res.json({ message: 'Email verified' });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
}

// ── UPDATE CONTACT (phone/zip — collected in Step 4) ──
async function updateContact(req, res) {
  try {
    const { token, phone, zip } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });

    const { rows } = await pool.query(
      "SELECT * FROM pending_registrations WHERE token = $1 AND role = 'helper' AND expires_at > NOW()",
      [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Invalid or expired registration' });

    const phoneClean = phone ? phone.replace(/\D/g, '') : '';
    const formattedPhone = phoneClean.length === 11 ? '+' + phoneClean : '+1' + phoneClean;

    await pool.query(
      'UPDATE pending_registrations SET phone = $2, zip_code = $3 WHERE token = $1',
      [token, formattedPhone, zip || '00000']
    );

    res.json({ message: 'Contact info updated' });
  } catch (err) {
    console.error('Update contact error:', err);
    res.status(500).json({ error: 'Failed to update contact info' });
  }
}

// ── STEP 2 → 3: Save helper profile details ──────────────
async function saveHelperProfile(req, res) {
  try {
    const {
      token,
      profileHeadline,
      bio,
      serviceCategories,
      availability,
      serviceRadius,
      ratePreference,
      hourlyRate
    } = req.body;

    if (!token) return res.status(400).json({ error: 'Token required' });

    const { rows } = await pool.query(
      "SELECT * FROM pending_registrations WHERE token = $1 AND role = 'helper' AND expires_at > NOW()",
      [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Invalid or expired registration' });

    if (!serviceCategories || serviceCategories.length < 1) {
      return res.status(400).json({ error: 'At least 1 service category required' });
    }

    if (serviceCategories.length > 8) {
      return res.status(400).json({ error: 'Maximum 8 categories allowed' });
    }

    await pool.query(
      `UPDATE pending_registrations
       SET profile_headline = $2,
           bio = $3,
           service_categories = $4,
           availability_json = $5,
           service_radius = $6,
           rate_preference = $7,
           hourly_rate = $8
       WHERE token = $1`,
      [
        token,
        (profileHeadline || '').trim() || null,
        bio || null,
        serviceCategories,
        JSON.stringify(availability || {}),
        serviceRadius || 10,
        ratePreference || 'per_job',
        hourlyRate || null
      ]
    );

    res.json({ message: 'Profile saved' });
  } catch (err) {
    console.error('Save helper profile error:', err);
    res.status(500).json({ error: 'Failed to save profile' });
  }
}

// ── STEP 3 → 4: Save tier selection ──────────────────────
async function selectTier(req, res) {
  try {
    const { token, tier } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });

    if (!['free', 'basic', 'pro'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier selection' });
    }

    const { rows } = await pool.query(
      "SELECT * FROM pending_registrations WHERE token = $1 AND role = 'helper' AND expires_at > NOW()",
      [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Invalid or expired registration' });

    await pool.query(
      'UPDATE pending_registrations SET selected_tier = $2 WHERE token = $1',
      [token, tier]
    );

    res.json({ message: 'Tier selected', tier });
  } catch (err) {
    console.error('Select tier error:', err);
    res.status(500).json({ error: 'Failed to save tier selection' });
  }
}

// ── STEP 4: Submit W-9 (Tier 2/3 only) ───────────────────
async function submitW9(req, res) {
  try {
    const {
      token,
      legalName,
      businessName,
      taxClassification,
      tin,
      address,
      signatureData,
      certify
    } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token required' });
    }

    if (!legalName || !taxClassification || !tin || !address || !signatureData || !certify) {
      return res.status(400).json({ error: 'All W-9 fields required' });
    }

    const { rows } = await pool.query(
      "SELECT * FROM pending_registrations WHERE token = $1 AND role = 'helper' AND expires_at > NOW()",
      [token]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired registration' });
    }

    // Encrypt TIN using shared utility
    const tinEncrypted = encrypt(tin);

    const tinLast4 = tin.replace(/\D/g, '').slice(-4);
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const userAgent = req.headers['user-agent'] || '';

    const w9Payload = JSON.stringify({
      legalName,
      businessName: businessName || null,
      taxClassification,
      tinEncrypted,
      tinLast4,
      address,
      signatureData,
      ip,
      userAgent,
      signedAt: new Date().toISOString()
    });

    await pool.query(
      `UPDATE pending_registrations
       SET availability_json = COALESCE(availability_json, '{}'::jsonb) || $2::jsonb
       WHERE token = $1`,
      [token, JSON.stringify({ w9Pending: w9Payload })]
    );

    res.json({ message: 'W-9 submitted', tinLast4 });
  } catch (err) {
    console.error('W9 submit error:', err);
    res.status(500).json({ error: 'Failed to submit W-9' });
  }
}

// -- HELPER ACCEPT TERMS --
async function helperAcceptTerms(req, res) {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });
    const { rows } = await pool.query(
      'SELECT * FROM pending_registrations WHERE token = $1 AND role = \'helper\' AND expires_at > NOW()',
      [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Invalid or expired registration' });
    await pool.query(
      'UPDATE pending_registrations SET terms_accepted = true WHERE token = $1',
      [token]
    );
    res.json({ message: 'Terms accepted' });
  } catch (err) {
    console.error('Helper accept terms error:', err);
    res.status(500).json({ error: 'Failed to accept terms' });
  }
}

// -- RESEND HELPER OTP --
async function resendHelperOTP(req, res) {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });
    const { rows } = await pool.query(
      'SELECT * FROM pending_registrations WHERE token = $1 AND role = \'helper\' AND expires_at > NOW()',
      [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Invalid or expired registration' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await pool.query(
      'UPDATE pending_registrations SET otp = $1 WHERE token = $2',
      [otp, token]
    );
    await sendOTPEmail(rows[0].email, otp);
    res.json({ message: 'OTP resent' });
  } catch (err) {
    console.error('Resend helper OTP error:', err);
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
}

// -- FINALIZE REGISTRATION --
async function finalizeRegistration(req, res) {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });
    const { rows } = await pool.query(
      'SELECT * FROM pending_registrations WHERE token = $1 AND role = \'helper\' AND expires_at > NOW()',
      [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Invalid or expired registration' });
    const reg = rows[0];
    const passwordHash = await bcrypt.hash(reg.password, SALT_ROUNDS);
    const userResult = await pool.query(
      'INSERT INTO users (email, password, role, is_verified) VALUES ($1, $2, \'helper\', true) RETURNING id',
      [reg.email, passwordHash]
    );
    await pool.query('DELETE FROM pending_registrations WHERE token = $1', [token]);
    const user = { id: userResult.rows[0].id, email: reg.email, role: 'helper' };
    const tokens = generateTokens(user);
    res.json({ message: 'Registration complete', ...tokens });
  } catch (err) {
    console.error('Finalize registration error:', err);
    res.status(500).json({ error: 'Failed to finalize registration' });
  }
}

module.exports = {
  getCategories,
  startHelperRegistration,
  sendOTP,
  verifyOTP,
  updateContact,
  saveHelperProfile,
  selectTier,
  submitW9,
  finalizeRegistration,
  resendHelperOTP,
  helperAcceptTerms

};
