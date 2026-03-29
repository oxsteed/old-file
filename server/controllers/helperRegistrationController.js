// server/controllers/helperRegistrationController.js
const pool = require('../db');
const bcrypt = require('bcrypt');
const { generateTokens } = require('../middleware/auth');
const { sendOTPEmail } = require('../utils/email');

// ── helpers ──────────────────────────────────────────────
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function otpExpiry() {
  return new Date(Date.now() + 10 * 60 * 1000); // 10 min
}

// ── 1. Start Registration ────────────────────────────────
// POST /api/helper-registration/start
async function startRegistration(req, res) {
  const { email, password, full_name } = req.body;
  if (!email || !password || !full_name)
    return res.status(400).json({ error: 'Email, password, and full name required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // duplicate guard
    const dup = await client.query(
      'SELECT id FROM users WHERE email = $1', [email]);
    if (dup.rows.length)
      return res.status(409).json({ error: 'Email already registered' });

    const password_hash = await bcrypt.hash(password, 12);
    const otp = generateOTP();
    const otp_expires = otpExpiry();

    // upsert into pending_registrations
    const result = await client.query(`
      INSERT INTO pending_registrations
        (email, password_hash, full_name, role, otp_code, otp_expires_at)
      VALUES ($1,$2,$3,'helper',$4,$5)
      ON CONFLICT (email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        full_name     = EXCLUDED.full_name,
        otp_code      = EXCLUDED.otp_code,
        otp_expires_at= EXCLUDED.otp_expires_at,
        email_verified = false
      RETURNING id
    `, [email, password_hash, full_name, otp, otp_expires]);

    await client.query('COMMIT');
    await sendOTPEmail(email, otp);

    res.status(201).json({
      message: 'OTP sent to email',
      registrationId: result.rows[0].id
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('startRegistration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  } finally {
    client.release();
  }
}

// ── 2. Verify OTP ────────────────────────────────────────
// POST /api/helper-registration/verify-otp
async function verifyOTP(req, res) {
  const { email, otp } = req.body;
  if (!email || !otp)
    return res.status(400).json({ error: 'Email and OTP required' });

  const { rows } = await pool.query(
    `SELECT id, otp_code, otp_expires_at
     FROM pending_registrations
     WHERE email = $1 AND role = 'helper'`,
    [email]
  );

  if (!rows.length)
    return res.status(404).json({ error: 'No pending registration found' });

  const reg = rows[0];
  if (reg.otp_code !== otp)
    return res.status(400).json({ error: 'Invalid OTP' });
  if (new Date(reg.otp_expires_at) < new Date())
    return res.status(400).json({ error: 'OTP expired' });

  await pool.query(
    `UPDATE pending_registrations SET email_verified = true WHERE id = $1`,
    [reg.id]
  );

  res.json({ message: 'Email verified', registrationId: reg.id });
}

// ── 3. Resend OTP ────────────────────────────────────────
// POST /api/helper-registration/resend-otp
async function resendOTP(req, res) {
  const { email } = req.body;
  if (!email)
    return res.status(400).json({ error: 'Email required' });

  const otp = generateOTP();
  const otp_expires = otpExpiry();

  const { rowCount } = await pool.query(
    `UPDATE pending_registrations
     SET otp_code = $1, otp_expires_at = $2
     WHERE email = $3 AND role = 'helper'`,
    [otp, otp_expires, email]
  );

  if (!rowCount)
    return res.status(404).json({ error: 'No pending registration found' });

  await sendOTPEmail(email, otp);
  res.json({ message: 'New OTP sent' });
}

// ── 4. Complete Registration (creates user row) ──────────
// POST /api/helper-registration/complete
async function completeRegistration(req, res) {
  const { email } = req.body;
  if (!email)
    return res.status(400).json({ error: 'Email required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM pending_registrations
       WHERE email = $1 AND role = 'helper' AND email_verified = true`,
      [email]
    );
    if (!rows.length)
      return res.status(400).json({ error: 'Email not verified or no pending registration' });

    const reg = rows[0];

    // create user — defaults: membership_tier = 'free', onboarding_step = 'registered'
    const userResult = await client.query(`
      INSERT INTO users (email, password_hash, full_name, role, membership_tier, onboarding_step)
      VALUES ($1,$2,$3,'helper','free','registered')
      RETURNING id, email, full_name, role, membership_tier, onboarding_step
    `, [reg.email, reg.password_hash, reg.full_name]);

    const user = userResult.rows[0];

    // clean up pending row
    await client.query(
      'DELETE FROM pending_registrations WHERE id = $1', [reg.id]);

    await client.query('COMMIT');

    const tokens = generateTokens(user);

    res.status(201).json({
      message: 'Registration complete',
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        membership_tier: user.membership_tier,
        onboarding_step: user.onboarding_step
      },
      ...tokens
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('completeRegistration error:', err);
    res.status(500).json({ error: 'Registration completion failed' });
  } finally {
    client.release();
  }
}

// ── 5. Submit Onboarding Profile ─────────────────────────
// PUT /api/helper-registration/onboarding/profile
// Auth required — user must be logged in
async function submitOnboardingProfile(req, res) {
  const userId = req.user.id;
  const {
    phone, address_line1, address_line2,
    city, state, zip_code, date_of_birth,
    bio, profile_photo_url, skills
  } = req.body;

  if (!phone || !address_line1 || !city || !state || !zip_code || !date_of_birth)
    return res.status(400).json({ error: 'Required profile fields missing' });

  await pool.query(`
    UPDATE users SET
      phone            = $1,
      address_line1    = $2,
      address_line2    = $3,
      city             = $4,
      state            = $5,
      zip_code         = $6,
      date_of_birth    = $7,
      bio              = $8,
      profile_photo_url= $9,
      skills           = $10,
      onboarding_step  = 'profile_complete'
    WHERE id = $11 AND role = 'helper'
  `, [phone, address_line1, address_line2, city, state, zip_code,
      date_of_birth, bio, profile_photo_url,
      JSON.stringify(skills || []), userId]);

  res.json({ message: 'Profile saved', onboarding_step: 'profile_complete' });
}

// ── 6. Submit ID Verification ────────────────────────────
// PUT /api/helper-registration/onboarding/id-verification
// Auth required
async function submitIdVerification(req, res) {
  const userId = req.user.id;
  const { id_document_url } = req.body;

  if (!id_document_url)
    return res.status(400).json({ error: 'ID document URL required' });

  await pool.query(`
    UPDATE users SET
      id_document_url = $1,
      id_verified     = false,
      onboarding_step = 'id_submitted'
    WHERE id = $2 AND role = 'helper'
  `, [id_document_url, userId]);

  res.json({ message: 'ID submitted for review', onboarding_step: 'id_submitted' });
}

// ── 7. Submit Background Check ───────────────────────────
// PUT /api/helper-registration/onboarding/background-check
// Auth required
async function submitBackgroundCheck(req, res) {
  const userId = req.user.id;
  const { background_check_consent } = req.body;

  if (!background_check_consent)
    return res.status(400).json({ error: 'Background check consent required' });

  await pool.query(`
    UPDATE users SET
      background_check_consent = $1,
      background_check_passed  = false,
      onboarding_step          = 'background_submitted'
    WHERE id = $2 AND role = 'helper'
  `, [true, userId]);

  res.json({ message: 'Background check submitted', onboarding_step: 'background_submitted' });
}

// ── 8. Get Onboarding Status ─────────────────────────────
// GET /api/helper-registration/onboarding/status
// Auth required
async function getOnboardingStatus(req, res) {
  const userId = req.user.id;
  const { rows } = await pool.query(
    `SELECT onboarding_step, membership_tier, id_verified,
            background_check_passed, profile_photo_url, bio, skills
     FROM users WHERE id = $1 AND role = 'helper'`,
    [userId]
  );

  if (!rows.length)
    return res.status(404).json({ error: 'Helper not found' });

  const u = rows[0];
  res.json({
    onboarding_step:         u.onboarding_step,
    membership_tier:         u.membership_tier,
    id_verified:             u.id_verified,
    background_check_passed: u.background_check_passed,
    profile_complete:        u.onboarding_step !== 'registered',
    canBrowseJobs:           true,                          // all tiers
    canApplyToJobs:          ['active','premium'].includes(u.membership_tier),
    canAppearInSearch:       u.membership_tier === 'premium'
  });
}

module.exports = {
  startRegistration,
  verifyOTP,
  resendOTP,
  completeRegistration,
  submitOnboardingProfile,
  submitIdVerification,
  submitBackgroundCheck,
  getOnboardingStatus
};
