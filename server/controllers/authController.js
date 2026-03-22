// Phase 2 — Auth controller (register, login, OTP, refresh, logout)
// + Customer Registration Flow (3-step)
// OxSteed v2

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db');
const { generateTokens } = require('../middleware/auth');
const { sendOTPEmail } = require('../utils/email');
const { sendOTPSMS } = require('../utils/sms');

const SALT_ROUNDS = 12;

async function register(req, res) {
  try {
    const { email, password, first_name, last_name, phone, role, language } = req.body;
    if (!email || !password || !first_name || !last_name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const referralCode = crypto.randomBytes(6).toString('hex');
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, phone, role, preferred_language, referral_code)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, email, role, tier`,
      [email.toLowerCase(), passwordHash, first_name, last_name, phone || null, role || 'customer', language || 'en', referralCode]
    );
    const user = rows[0];
    const tokens = generateTokens(user);
    await pool.query(
      'INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval \'7 days\')',
      [user.id, tokens.refreshToken]
    );
    res.status(201).json({ user: { id: user.id, email: user.email, role: user.role }, ...tokens });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
}
async function login(req, res) {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query(
      'SELECT id, email, password_hash, role, tier, is_active FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Invalid credentials' });
    const user = rows[0];
    if (!user.is_active) return res.status(403).json({ error: 'Account deactivated' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const tokens = generateTokens(user);
    await pool.query(
      'INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval \'7 days\')',
      [user.id, tokens.refreshToken]
    );
    res.json({ user: { id: user.id, email: user.email, role: user.role, tier: user.tier }, ...tokens });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
}

async function requestOTP(req, res) {
  try {
    const { email, phone } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query(
      'UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE email = $3',
      [otp, expiresAt, email.toLowerCase()]
    );
    if (phone) await sendOTPSMS(phone, otp);
    else await sendOTPEmail(email, otp);
    res.json({ message: 'OTP sent' });
  } catch (err) {
    console.error('OTP error:', err);
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
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
}

async function refreshToken(req, res) {
  try {
    const { refreshToken: token } = req.body;
    const { rows } = await pool.query(
      'SELECT s.user_id, u.email, u.role, u.tier FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.refresh_token = $1 AND s.is_valid = true AND s.expires_at > NOW()',
      [token]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Invalid refresh token' });
    await pool.query('UPDATE sessions SET is_valid = false WHERE refresh_token = $1', [token]);
    const tokens = generateTokens(rows[0]);
    await pool.query(
      'INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval \'7 days\')',
      [rows[0].user_id, tokens.refreshToken]
    );
    res.json(tokens);
  } catch (err) {
    console.error('Refresh error:', err);
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

// ===== NEW CUSTOMER REGISTRATION FLOW (3-Step) =====

async function checkEmail(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (rows.length > 0) return res.status(409).json({ available: false, error: 'Email already registered' });
    res.json({ available: true });
  } catch (err) {
    console.error('Check email error:', err);
    res.status(500).json({ error: 'Failed to check email' });
  }
}

async function checkZip(req, res) {
  try {
    const { zip } = req.body;
    if (!zip) return res.status(400).json({ error: 'Zip code required' });
    const { rows } = await pool.query(
      'SELECT id, name FROM markets WHERE $1 = ANY(zip_codes) AND is_active = true', [zip]
    );
    if (rows.length === 0) return res.json({ inMarket: false });
    res.json({ inMarket: true, market: rows[0] });
  } catch (err) {
    console.error('Check zip error:', err);
    res.status(500).json({ error: 'Failed to check zip code' });
  }
}

async function addToWaitlist(req, res) {
  try {
    const { email, zip } = req.body;
    if (!email || !zip) return res.status(400).json({ error: 'Email and zip code required' });
    const ipHash = crypto.createHash('sha256').update(req.ip || 'unknown').digest('hex');
    await pool.query(
      `INSERT INTO waitlist (email, zip_code, ip_hash) VALUES ($1, $2, $3) ON CONFLICT (email, zip_code) DO NOTHING`,
      [email.toLowerCase(), zip, ipHash]
    );
    res.json({ message: 'Added to waitlist' });
  } catch (err) {
    console.error('Waitlist error:', err);
    res.status(500).json({ error: 'Failed to add to waitlist' });
  }
}

// Step 1 -> Step 2: Validate basic info, create pending registration
async function startRegistration(req, res) {
  try {
    const { email, password, firstName, lastName, phone, zip, ageConfirmed } = req.body;
    if (!email || !password || !firstName || !lastName || !phone || !zip) {
      return res.status(400).json({ error: 'All fields required' });
    }
    if (!ageConfirmed) {
      return res.status(400).json({ error: 'Age confirmation required' });
    }
    // Validate phone (basic US format check)
    const phoneClean = phone.replace(/\D/g, '');
    if (phoneClean.length < 10 || phoneClean.length > 11) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }
    const formattedPhone = phoneClean.length === 11 ? '+' + phoneClean : '+1' + phoneClean;
    // Check email uniqueness
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    // Check zip is in active market
    const market = await pool.query(
      'SELECT id FROM markets WHERE $1 = ANY(zip_codes) AND is_active = true', [zip]
    );
    if (market.rows.length === 0) {
      return res.status(400).json({ error: 'Service not available in your area' });
    }
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const token = crypto.randomBytes(32).toString('hex');
    // Clean up any old pending registrations for this email
    await pool.query('DELETE FROM pending_registrations WHERE email = $1', [email.toLowerCase()]);
    await pool.query(
      `INSERT INTO pending_registrations (token, email, password_hash, first_name, last_name, phone, zip_code, age_confirmed)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [token, email.toLowerCase(), passwordHash, firstName, lastName, formattedPhone, zip, ageConfirmed]
    );
    res.json({ token, message: 'Basic info validated' });
  } catch (err) {
    console.error('Start registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
}

// Step 2 -> Step 3: Record terms acceptance, send OTP
async function acceptTerms(req, res) {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });
    const { rows } = await pool.query(
      'SELECT * FROM pending_registrations WHERE token = $1 AND expires_at > NOW()', [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Invalid or expired registration' });
    const pending = rows[0];
    const termsVersion = '2026-03-20';
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const userAgent = req.headers['user-agent'] || '';
    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query(
      `UPDATE pending_registrations
      SET terms_accepted_at = NOW(), terms_version = $2, terms_acceptance_ip = $3, terms_acceptance_ua = $4,
          otp_code = $5, otp_expires_at = $6, otp_attempts = 0
      WHERE token = $1`,
      [token, termsVersion, ip, userAgent, otp, otpExpires]
    );
    await sendOTPEmail(pending.email, otp);
    res.json({ message: 'Terms accepted, OTP sent' });
  } catch (err) {
    console.error('Accept terms error:', err);
    res.status(500).json({ error: 'Failed to accept terms' });
  }
}

// Step 3: Verify OTP, create user account, log in
async function verifyRegistrationOTP(req, res) {
  try {
    const { token, otp } = req.body;
    if (!token || !otp) return res.status(400).json({ error: 'Token and OTP required' });
    const { rows } = await pool.query(
      'SELECT * FROM pending_registrations WHERE token = $1 AND expires_at > NOW()', [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Invalid or expired registration' });
    const pending = rows[0];
    // Check lockout
    if (pending.otp_locked_until && new Date(pending.otp_locked_until) > new Date()) {
      return res.status(429).json({ error: 'Too many attempts. Try again later.', lockoutUntil: pending.otp_locked_until });
    }
    // Verify OTP
    if (pending.otp_code !== otp || new Date(pending.otp_expires_at) < new Date()) {
      const newAttempts = pending.otp_attempts + 1;
      if (newAttempts >= 3) {
        await pool.query(
          `UPDATE pending_registrations SET otp_attempts = $2, otp_locked_until = NOW() + interval '1 hour' WHERE token = $1`,
          [token, newAttempts]
        );
        return res.status(429).json({ error: 'Too many failed attempts. Locked for 1 hour.' });
      }
      await pool.query('UPDATE pending_registrations SET otp_attempts = $2 WHERE token = $1', [token, newAttempts]);
      return res.status(400).json({ error: 'Invalid or expired OTP', attemptsRemaining: 3 - newAttempts });
    }
    // OTP verified - create user account
    const referralCode = crypto.randomBytes(6).toString('hex');
    const userResult = await pool.query(
      `INSERT INTO users (
        email, password_hash, first_name, last_name, phone, zip_code,
        role, age_confirmed, email_verified,
        terms_accepted_at, terms_version, terms_acceptance_ip, terms_acceptance_ua,
        referral_code
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12,$13)
      RETURNING id, email, role, tier`,
      [
        pending.email, pending.password_hash, pending.first_name, pending.last_name,
        pending.phone, pending.zip_code, 'customer', pending.age_confirmed,
        pending.terms_accepted_at, pending.terms_version,
        pending.terms_acceptance_ip, pending.terms_acceptance_ua, referralCode
      ]
    );
    const user = userResult.rows[0];
    // Delete pending registration
    await pool.query('DELETE FROM pending_registrations WHERE token = $1', [token]);
    // Generate tokens and create session
    const tokens = generateTokens(user);
    await pool.query(
      'INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval \'7 days\')',
      [user.id, tokens.refreshToken]
    );
    res.status(201).json({
      user: { id: user.id, email: user.email, role: user.role, tier: user.tier },
      ...tokens
    });
  } catch (err) {
    console.error('Verify registration OTP error:', err);
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
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query(
      'UPDATE pending_registrations SET otp_code = $2, otp_expires_at = $3, otp_attempts = 0 WHERE token = $1',
      [token, otp, otpExpires]
    );
    await sendOTPEmail(pending.email, otp);
    res.json({ message: 'OTP resent' });
  } catch (err) {
    console.error('Resend OTP error:', err);
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
}

module.exports = {
  register, login, requestOTP, verifyOTP, refreshToken, logout,
  // New customer registration flow
  checkEmail, checkZip, addToWaitlist,
  startRegistration, acceptTerms, verifyRegistrationOTP, resendRegistrationOTP
};
