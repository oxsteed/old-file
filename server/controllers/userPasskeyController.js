'use strict';

const crypto = require('crypto');
const { setSessionCookies } = require('../utils/authCookies');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const db = require('../db');
const { generateTokens } = require('../middleware/auth');
const { formatAuthUser } = require('./authController');

const RP_NAME = 'OxSteed';
const RP_ID = process.env.WEBAUTHN_RP_ID || (() => {
  try { return new URL(process.env.PUBLIC_APP_URL || process.env.APP_URL || 'https://oxsteed.com').hostname; } catch { return 'oxsteed.com'; }
})();
const ORIGIN = process.env.WEBAUTHN_ORIGIN || (() => {
  try { return new URL(process.env.PUBLIC_APP_URL || process.env.APP_URL || 'https://oxsteed.com').origin; } catch { return 'https://oxsteed.com'; }
})();

const JWT_SECRET = process.env.JWT_SECRET;

function validationError(res, fields) {
  return res.status(400).json({ error: 'Validation failed', fields });
}

function normalizeTransports(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => ['ble', 'hybrid', 'internal', 'nfc', 'usb'].includes(item)).slice(0, 5);
}

function safePasskey(row) {
  return {
    id: row.id,
    deviceName: row.device_name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null,
  };
}

function parsePasskeyToken(token) {
  if (!token || typeof token !== 'string' || !JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    return decoded?.isPasskeyToken ? decoded : null;
  } catch {
    return null;
  }
}

async function saveChallenge(userId, purpose, challenge) {
  await db.query(
    `DELETE FROM user_passkey_challenges WHERE (user_id = $1 OR user_id IS NULL) AND purpose = $2`,
    [userId || null, purpose]
  );
  await db.query(
    `INSERT INTO user_passkey_challenges (user_id, challenge, purpose, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes')`,
    [userId || null, challenge, purpose]
  );
}

async function consumeChallenge(userId, purpose, challenge) {
  const result = await db.query(
    `DELETE FROM user_passkey_challenges
     WHERE id = (
       SELECT id FROM user_passkey_challenges
       WHERE user_id = $1 AND purpose = $2 AND challenge = $3 AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1
     )
     RETURNING challenge`,
    [userId, purpose, challenge]
  );
  return result.rows[0]?.challenge || null;
}

async function getUser(userId) {
  const { rows } = await db.query(
    `SELECT id, first_name, last_name, email, phone, role, is_active,
            login_locked_until, totp_enabled, terms_accepted, email_verified,
            onboarding_completed, onboarding_status, profile_completed,
            tier_selected, w9_completed, contact_completed, membership_tier
     FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] || null;
}

async function listPasskeys(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT id, device_name, created_at, last_used_at
       FROM user_passkeys WHERE user_id = $1 AND revoked_at IS NULL
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    return res.json({ passkeys: rows.map(safePasskey) });
  } catch (err) { return next(err); }
}

async function registrationOptions(req, res, next) {
  try {
    const user = await getUser(req.user.id);
    if (!user || !user.is_active) return res.status(403).json({ error: 'Account is not active.' });
    const { rows } = await db.query(
      `SELECT credential_id, transports FROM user_passkeys WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id]
    );
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: user.email,
      userDisplayName: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email,
      userID: Buffer.from(String(user.id)),
      attestationType: 'none',
      timeout: 60_000,
      excludeCredentials: rows.map((row) => ({ id: row.credential_id, transports: normalizeTransports(row.transports) })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    });
    await saveChallenge(user.id, 'registration', options.challenge);
    return res.json({ options });
  } catch (err) { return next(err); }
}

async function verifyRegistration(req, res, next) {
  const response = req.body?.response;
  const deviceName = String(req.body?.deviceName || 'Passkey').trim();
  const password = req.body?.password;
  if (!response || typeof response !== 'object') return validationError(res, { response: 'WebAuthn response is required' });
  if (deviceName.length < 1 || deviceName.length > 120) return validationError(res, { deviceName: 'Device name must be 1 to 120 characters' });
  // Step-up: require current password to register a new passkey.
  // This ensures a stolen session alone cannot plant a lasting credential.
  if (!password) return validationError(res, { password: 'Current password is required to register a passkey' });
  try {
    const user = await getUser(req.user.id);
    if (!user || !user.is_active) return res.status(403).json({ error: 'Account is not active.' });
    const { rows: pwRows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!pwRows[0]?.password_hash || !(await bcrypt.compare(password, pwRows[0].password_hash))) {
      return res.status(403).json({ error: 'Current password is incorrect.' });
    }
    const { rows: challenges } = await db.query(
      `SELECT challenge FROM user_passkey_challenges
       WHERE user_id = $1 AND purpose = 'registration' AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`, [user.id]
    );
    if (!challenges[0]) return res.status(400).json({ error: 'Passkey registration expired. Start again.' });
    const consumedChallenge = await consumeChallenge(user.id, 'registration', challenges[0].challenge);
    if (!consumedChallenge) return res.status(400).json({ error: 'Passkey registration expired. Start again.' });
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: consumedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) return res.status(400).json({ error: 'Passkey verification failed.' });
    const info = verification.registrationInfo;
    const credentialId = response.id;
    // If this credential was previously revoked, hard-delete the revoked row
    // so re-registration succeeds.
    await db.query(
      `DELETE FROM user_passkeys WHERE user_id = $1 AND credential_id = $2 AND revoked_at IS NOT NULL`,
      [user.id, credentialId]
    );
    await db.query(
      `INSERT INTO user_passkeys (user_id, credential_id, public_key, counter, transports, device_name, backed_up, device_type, aaguid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        user.id, credentialId, Buffer.from(info.credential.publicKey), info.credential.counter,
        normalizeTransports(response.response?.transports), deviceName,
        info.credential.backedUp ?? null, info.credential.deviceType ?? null, info.aaguid ?? null,
      ]
    );
    return res.status(201).json({ passkey: { deviceName, createdAt: new Date().toISOString() } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This passkey is already registered.' });
    return next(err);
  }
}

async function revokePasskey(req, res, next) {
  try {
    const result = await db.query(
      `UPDATE user_passkeys SET revoked_at = NOW()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Passkey not found.' });
    return res.json({ revoked: true });
  } catch (err) { return next(err); }
}

async function renamePasskey(req, res, next) {
  try {
    const deviceName = String(req.body?.deviceName || '').trim();
    if (!deviceName || deviceName.length > 120) {
      return validationError(res, { deviceName: 'Device name must be 1 to 120 characters' });
    }
    const result = await db.query(
      `UPDATE user_passkeys SET device_name = $1
       WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL RETURNING id`,
      [deviceName, req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Passkey not found.' });
    return res.json({ renamed: true, deviceName });
  } catch (err) { return next(err); }
}

async function authenticationOptions(req, res, next) {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return validationError(res, { email: 'Email is required' });
    const { rows: users } = await db.query(
      `SELECT id, is_active FROM users WHERE LOWER(email) = $1 LIMIT 1`,
      [email]
    );
    const user = users[0];
    // Return the same generic message whether the user is unknown, inactive,
    // or has no passkeys, to avoid account enumeration.
    const noPasskeyMsg = 'No passkey sign-in available for this email.';
    if (!user || !user.is_active) return res.status(404).json({ error: noPasskeyMsg });
    const { rows } = await db.query(
      `SELECT credential_id, transports FROM user_passkeys WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id]
    );
    if (!rows.length) return res.status(404).json({ error: noPasskeyMsg });
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: rows.map((row) => ({ id: row.credential_id, transports: normalizeTransports(row.transports) })),
      userVerification: 'required',
      timeout: 60_000,
    });
    await saveChallenge(user.id, 'authentication', options.challenge);
    const token = jwt.sign(
      { id: user.id, isPasskeyToken: true },
      JWT_SECRET,
      { expiresIn: '5m' }
    );
    return res.json({ options, token });
  } catch (err) { return next(err); }
}

async function issueUserSession(user, req, res) {
  const tokens = generateTokens(user, { authMethod: 'passkey' });
  const hashedRefresh = crypto.createHash('sha256').update(tokens.refreshToken).digest('hex');
  await db.query(`INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval '7 days')`, [user.id, hashedRefresh]);
  await db.query(`UPDATE users SET last_login_at = NOW(), last_login_ip = $1 WHERE id = $2`, [req.ip || null, user.id]).catch(() => {});
  await db.query(`INSERT INTO user_login_history (user_id, ip_address, user_agent, success) VALUES ($1, $2, $3, TRUE)`, [user.id, req.ip || null, req.headers['user-agent'] || null]).catch(() => {});

  // Set cookies for web clients (parity with password login). The refresh
  // cookie must be oxsteed_rt (read by /auth/refresh); it was previously set
  // as 'oxsteed_refresh', which nothing reads.
  setSessionCookies(res, tokens);

  return res.json({ success: true, user: formatAuthUser(user), accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
}

async function verifyAuthentication(req, res, next) {
  const response = req.body?.response;
  const token = parsePasskeyToken(req.body?.token);
  if (!token) return res.status(401).json({ error: 'Invalid or expired passkey session.' });
  if (!response || typeof response !== 'object' || typeof response.id !== 'string') return validationError(res, { response: 'WebAuthn response is required' });
  try {
    const user = await getUser(token.id);
    if (!user || !user.is_active) return res.status(401).json({ error: 'Invalid or expired passkey session.' });
    // Parity with password login: respect account lockout.
    if (user.login_locked_until && new Date(user.login_locked_until) > new Date()) {
      return res.status(423).json({ error: 'Account is temporarily locked. Try again later.' });
    }
    const { rows } = await db.query(
      `SELECT id, credential_id, public_key, counter, transports
       FROM user_passkeys WHERE user_id = $1 AND credential_id = $2 AND revoked_at IS NULL`,
      [user.id, response.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Passkey is not registered for this account.' });
    const { rows: challenges } = await db.query(
      `SELECT challenge FROM user_passkey_challenges
       WHERE user_id = $1 AND purpose = 'authentication' AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`, [user.id]
    );
    if (!challenges[0]) return res.status(400).json({ error: 'Passkey authentication expired. Start again.' });
    const consumedChallenge = await consumeChallenge(user.id, 'authentication', challenges[0].challenge);
    if (!consumedChallenge) return res.status(400).json({ error: 'Passkey authentication expired. Start again.' });
    const stored = rows[0];
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: consumedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
      credential: {
        id: stored.credential_id,
        publicKey: new Uint8Array(stored.public_key),
        counter: Number(stored.counter),
        transports: normalizeTransports(stored.transports),
      },
    });
    if (!verification.verified) return res.status(401).json({ error: 'Passkey verification failed.' });
    const nextCounter = Number(verification.authenticationInfo.newCounter);
    if (nextCounter <= Number(stored.counter)) return res.status(401).json({ error: 'Passkey counter validation failed.' });
    await db.query(`UPDATE user_passkeys SET counter = $1, last_used_at = NOW() WHERE id = $2`, [nextCounter, stored.id]);
    // Parity with password login: if TOTP is enabled, require it.
    if (user.totp_enabled) {
      const mfaToken = jwt.sign(
        { id: user.id, isMfaToken: true, authMethod: 'passkey' },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );
      return res.status(200).json({
        requiresTwoFactor: true,
        mfaToken,
        message: 'Please provide your 2FA code to complete login.',
      });
    }
    // Terms acceptance check (parity with password login).
    if (!user.terms_accepted) {
      return res.status(403).json({ error: 'Terms must be accepted before signing in.', code: 'terms_required' });
    }
    return issueUserSession(user, req, res);
  } catch (err) { return next(err); }
}

module.exports = {
  listPasskeys,
  registrationOptions,
  verifyRegistration,
  revokePasskey,
  renamePasskey,
  authenticationOptions,
  verifyAuthentication,
};
