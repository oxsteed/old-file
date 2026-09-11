'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const db = require('../db');
const logger = require('../utils/logger');
const { generateTokens } = require('../middleware/auth');
const { logAdminAction } = require('../services/auditService');

const RP_NAME = 'OxSteed Admin';
const RP_ID = process.env.WEBAUTHN_RP_ID || (() => {
  try { return new URL(process.env.PUBLIC_APP_URL || process.env.APP_URL || 'https://oxsteed.com').hostname; } catch { return 'oxsteed.com'; }
})();
const ORIGIN = process.env.WEBAUTHN_ORIGIN || (() => {
  try { return new URL(process.env.PUBLIC_APP_URL || process.env.APP_URL || 'https://oxsteed.com').origin; } catch { return 'https://oxsteed.com'; }
})();
const CHALLENGE_TTL_SECONDS = 5 * 60;

function validationError(res, fields) {
  return res.status(400).json({ error: 'Validation failed', fields });
}

function parseMfaToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    return decoded?.isMfaToken ? decoded : null;
  } catch {
    return null;
  }
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

async function saveChallenge(userId, purpose, challenge) {
  await db.query(
    `DELETE FROM admin_passkey_challenges WHERE (user_id = $1 OR user_id IS NULL) AND purpose = $2`,
    [userId || null, purpose]
  );
  await db.query(
    `INSERT INTO admin_passkey_challenges (user_id, challenge, purpose, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes')`,
    [userId || null, challenge, purpose]
  );
}

async function consumeChallenge(userId, purpose, challenge) {
  const result = await db.query(
    `DELETE FROM admin_passkey_challenges
     WHERE id = (
       SELECT id FROM admin_passkey_challenges
       WHERE user_id = $1 AND purpose = $2 AND challenge = $3 AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1
     )
     RETURNING challenge`,
    [userId, purpose, challenge]
  );
  return result.rows[0]?.challenge || null;
}

async function getAdmin(userId) {
  const { rows } = await db.query(
    `SELECT id, first_name, last_name, email, role, is_active, totp_enabled
     FROM users WHERE id = $1 AND role IN ('admin', 'super_admin')`,
    [userId]
  );
  return rows[0] || null;
}

async function listPasskeys(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT id, device_name, created_at, last_used_at
       FROM admin_passkeys WHERE user_id = $1 AND revoked_at IS NULL
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    return res.json({ passkeys: rows.map(safePasskey) });
  } catch (err) { return next(err); }
}

async function registrationOptions(req, res, next) {
  try {
    const admin = await getAdmin(req.user.id);
    if (!admin || !admin.is_active || !admin.totp_enabled) return res.status(403).json({ error: 'Admin TOTP must be enabled before adding a passkey.' });
    const { rows } = await db.query(
      `SELECT credential_id, transports FROM admin_passkeys WHERE user_id = $1 AND revoked_at IS NULL`,
      [admin.id]
    );
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: admin.email,
      userDisplayName: `${admin.first_name || ''} ${admin.last_name || ''}`.trim() || admin.email,
      userID: Buffer.from(String(admin.id)),
      attestationType: 'none',
      timeout: 60_000,
      excludeCredentials: rows.map((row) => ({ id: row.credential_id, transports: normalizeTransports(row.transports) })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    });
    await saveChallenge(admin.id, 'registration', options.challenge);
    return res.json({ options });
  } catch (err) { return next(err); }
}

async function verifyRegistration(req, res, next) {
  const response = req.body?.response;
  const deviceName = String(req.body?.deviceName || 'Admin passkey').trim();
  if (!response || typeof response !== 'object') return validationError(res, { response: 'WebAuthn response is required' });
  if (deviceName.length < 1 || deviceName.length > 120) return validationError(res, { deviceName: 'Device name must be 1 to 120 characters' });
  try {
    const admin = await getAdmin(req.user.id);
    if (!admin || !admin.is_active || !admin.totp_enabled) return res.status(403).json({ error: 'Admin TOTP must be enabled before adding a passkey.' });
    const { rows: challenges } = await db.query(
      `SELECT challenge FROM admin_passkey_challenges
       WHERE user_id = $1 AND purpose = 'registration' AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`, [admin.id]
    );
    if (!challenges[0]) return res.status(400).json({ error: 'Passkey registration expired. Start again.' });
    const consumedChallenge = await consumeChallenge(admin.id, 'registration', challenges[0].challenge);
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
    await db.query(
      `INSERT INTO admin_passkeys (user_id, credential_id, public_key, counter, transports, device_name)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [admin.id, credentialId, Buffer.from(info.credential.publicKey), info.credential.counter, normalizeTransports(response.response?.transports), deviceName]
    );
    void logAdminAction({ adminId: admin.id, action: 'admin_passkey_registered', targetType: 'admin_passkey', targetId: credentialId, description: deviceName, req });
    return res.status(201).json({ passkey: { deviceName, createdAt: new Date().toISOString() } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This passkey is already registered.' });
    return next(err);
  }
}

async function revokePasskey(req, res, next) {
  try {
    const result = await db.query(
      `UPDATE admin_passkeys SET revoked_at = NOW()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Passkey not found.' });
    void logAdminAction({ adminId: req.user.id, action: 'admin_passkey_revoked', targetType: 'admin_passkey', targetId: req.params.id, req });
    return res.json({ revoked: true });
  } catch (err) { return next(err); }
}

async function authenticationOptions(req, res, next) {
  try {
    const mfa = parseMfaToken(req.body?.mfaToken || req.body?.mfa_token);
    if (!mfa) return res.status(401).json({ error: 'Invalid or expired MFA session.' });
    const admin = await getAdmin(mfa.id);
    if (!admin || !admin.is_active || !admin.totp_enabled) return res.status(401).json({ error: 'Invalid or expired MFA session.' });
    const { rows } = await db.query(
      `SELECT credential_id, transports FROM admin_passkeys WHERE user_id = $1 AND revoked_at IS NULL`,
      [admin.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No passkeys are registered for this admin account.' });
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: rows.map((row) => ({ id: row.credential_id, transports: normalizeTransports(row.transports) })),
      userVerification: 'required',
      timeout: 60_000,
    });
    await saveChallenge(admin.id, 'authentication', options.challenge);
    return res.json({ options });
  } catch (err) { return next(err); }
}

async function issueAdminSession(admin, req, res) {
  const tokens = generateTokens(admin, { authMethod: 'passkey' });
  const hashedRefresh = crypto.createHash('sha256').update(tokens.refreshToken).digest('hex');
  await db.query(`INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval '7 days')`, [admin.id, hashedRefresh]);
  await db.query(`UPDATE users SET last_login_at = NOW(), last_login_ip = $1 WHERE id = $2`, [req.ip || null, admin.id]).catch(() => {});
  await db.query(`INSERT INTO user_login_history (user_id, ip_address, user_agent, success) VALUES ($1, $2, $3, TRUE)`, [admin.id, req.ip || null, req.headers['user-agent'] || null]).catch(() => {});
  return res.json({ success: true, user: admin, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
}

async function verifyAuthentication(req, res, next) {
  const response = req.body?.response;
  const mfa = parseMfaToken(req.body?.mfaToken || req.body?.mfa_token);
  if (!mfa) return res.status(401).json({ error: 'Invalid or expired MFA session.' });
  if (!response || typeof response !== 'object' || typeof response.id !== 'string') return validationError(res, { response: 'WebAuthn response is required' });
  try {
    const admin = await getAdmin(mfa.id);
    if (!admin || !admin.is_active || !admin.totp_enabled) return res.status(401).json({ error: 'Invalid or expired MFA session.' });
    const { rows } = await db.query(
      `SELECT id, credential_id, public_key, counter, transports
       FROM admin_passkeys WHERE user_id = $1 AND credential_id = $2 AND revoked_at IS NULL`,
      [admin.id, response.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Passkey is not registered for this admin account.' });
    const { rows: challenges } = await db.query(
      `SELECT challenge FROM admin_passkey_challenges
       WHERE user_id = $1 AND purpose = 'authentication' AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`, [admin.id]
    );
    if (!challenges[0]) return res.status(400).json({ error: 'Passkey authentication expired. Start again.' });
    const consumedChallenge = await consumeChallenge(admin.id, 'authentication', challenges[0].challenge);
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
    if (Number(stored.counter) > 0 && nextCounter <= Number(stored.counter)) return res.status(401).json({ error: 'Passkey counter validation failed.' });
    await db.query(`UPDATE admin_passkeys SET counter = $1, last_used_at = NOW() WHERE id = $2`, [nextCounter, stored.id]);
    void logAdminAction({ adminId: admin.id, action: 'admin_passkey_login', targetType: 'admin_passkey', targetId: stored.id, req });
    return issueAdminSession(admin, req, res);
  } catch (err) { return next(err); }
}

module.exports = {
  listPasskeys,
  registrationOptions,
  verifyRegistration,
  revokePasskey,
  authenticationOptions,
  verifyAuthentication,
  _config: { RP_ID, ORIGIN },
};
