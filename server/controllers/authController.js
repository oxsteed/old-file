// Phase 2 — Auth controller (register, login, OTP, refresh, logout)
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

module.exports = { register, login, requestOTP, verifyOTP, refreshToken, logout };
