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
  try {
    const { email, password, full_name } = req.body;
    if (!email || !password || !full_name)
      return res.status(400).json({ error: 'Email, password, and full name required' });

    // Split full_name into first_name and last_name for schema compatibility
    const nameParts = full_name.trim().split(/\s+/);
    const first_name = nameParts[0];
    const last_name = nameParts.slice(1).join(' ') || first_name;

    const password_hash = await bcrypt.hash(password, 12);
    const otp = generateOTP();
    const otp_expires = otpExpiry();

    // Check for duplicate
    const dup = await pool.query(
      'SELECT id FROM users WHERE email = $1', [email]);
    if (dup.rows.length)
      return res.status(409).json({ error: 'Email already registered' });

    // upsert into pending_registrations
    const result = await pool.query(`
      INSERT INTO pending_registrations
        (email, password_hash, first_name, last_name, role, otp_code, otp_expires_at)
      VALUES ($1,$2,$3,$4,'helper',$5,$6)
      ON CONFLICT (email) DO UPDATE SET
        password_hash  = EXCLUDED.password_hash,
        first_name     = EXCLUDED.first_name,
        last_name      = EXCLUDED.last_name,
        otp_code       = EXCLUDED.otp_code,
        otp_expires_at = EXCLUDED.otp_expires_at,
        otp_verified   = false
      RETURNING id
    `, [email, password_hash, first_name, last_name, otp, otp_expires]);

    await sendOTPEmail(email, otp);

    res.status(201).json({
      message: 'OTP sent to email',
      registrationId: result.rows[0].id
    });
  } catch (err) {
    console.error('startRegistration error:', err);
    res.status(500).json({ error: 'Registration failed', detail: err.message });
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
    `UPDATE pending_registrations SET otp_verified = true WHERE id = $1`,
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

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM pending_registrations
       WHERE email = $1 AND role = 'helper' AND otp_verified = true`,
      [email]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Email not verified or no pending registration' });
    }

    const reg = rows[0];

    // create user — defaults: membership_tier = 'tier1', onboarding_status = 'verified_pending_onboarding'
    const userResult = await client.query(`
      INSERT INTO users (email, password_hash, first_name, last_name, role,
                         membership_tier, onboarding_status, onboarding_completed, email_verified)
      VALUES ($1,$2,$3,$4,'helper','tier1','verified_pending_onboarding',false,true)
      RETURNING id, email, first_name, last_name, role, membership_tier, onboarding_status
    `, [reg.email, reg.password_hash, reg.first_name, reg.last_name]);

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
        full_name: (user.first_name + ' ' + user.last_name).trim(),
        role: user.role,
        membership_tier: user.membership_tier,
        onboarding_step: user.onboarding_status
      },
      ...tokens
    });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (e) { /* ignore rollback error */ }
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
  const userId = req.user.id;
  const {
    phone, address_line1, address_line2,
    city, state, zip_code, date_of_birth,
    bio, profile_photo_url, skills
  } = req.body;

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
      id_verified     = false,
      onboarding_status = 'onboarding_in_progress'
    WHERE id = $1 AND role = 'helper'
  `, [userId]);

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
      background_check_passed  = false,
      onboarding_status        = 'onboarding_in_progress'
    WHERE id = $1 AND role = 'helper'
  `, [userId]);

  res.json({ message: 'Background check submitted', onboarding_step: 'background_submitted' });
}

// ── 8. Get Onboarding Status ─────────────────────────────
// GET /api/helper-registration/onboarding/status
// Auth required
async function getOnboardingStatus(req, res) {
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
