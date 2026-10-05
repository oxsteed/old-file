'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { authenticator } = require('@otplib/v12-adapter');
const { decrypt } = require('../utils/encryption');
const { sendOTPEmail } = require('../utils/email');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');

const ACTIONS = Object.freeze(['unfreeze', 'activate', 'pin_set']);
const failure = (code, status = 403) => ({ failure: { code, status } });
function reject(result) {
  if (result.failure) throw new AppError('Card security verification could not be completed.', result.failure.status, result.failure.code);
  return result;
}
function hash(value) {
  const pepper = process.env.OXSTEED_CREDIT_STEPUP_PEPPER || process.env.JWT_SECRET;
  if (!pepper) throw new AppError('Card verification is unavailable.', 503, 'credit_card_security_unavailable');
  return crypto.createHmac('sha256', pepper).update(JSON.stringify(value)).digest('hex');
}
function payloadHash(action, args) {
  return hash([action, args.cardId, action === 'activate' ? String(args.activationCode || '').trim().toUpperCase() : null,
    action === 'pin_set' ? String(args.pin || '').trim() : null,
    action === 'pin_set' ? String(args.currentPin || '').trim() : null, action === 'pin_set' && args.resetPin === true]);
}
function bindingHash(action, args, user) {
  return hash([args.customerId, args.cardId, action, payloadHash(action, args), args.sessionBinding,
    user.email, user.password_hash, user.totp_enabled, user.totp_secret]);
}
async function audit(client, args, action, metadata = {}) {
  await client.query(`INSERT INTO oxsteed_credit_audit_events
    (action_type, actor_user_id, customer_id, resource_type, resource_id, correlation_id, request_ip, metadata)
    VALUES ($1, $2, $2, 'credit_card', $3, $4, $5, $6::jsonb)`,
  [`credit.card.${action}`, args.customerId, args.cardId, args.correlationId || null, args.requestIp || null, JSON.stringify(metadata)]);
}
async function loadContext(client, args) {
  const { rows: users } = await client.query(`SELECT id, email, email_verified, password_hash, totp_enabled,
    totp_secret, is_active, preferred_language FROM users WHERE id = $1 FOR SHARE`, [args.customerId]);
  const user = users[0];
  if (!user || user.is_active !== true || user.email_verified !== true || !args.sessionBinding
    || args.actorUserId !== args.customerId || args.impersonated) return failure('credit_card_security_actor_invalid');
  const { rows } = await client.query(`SELECT c.*, a.status AS account_status FROM oxsteed_credit_cards c
    JOIN oxsteed_credit_accounts a ON a.id = c.account_id
    WHERE c.id = $1 AND c.customer_id = $2 FOR UPDATE OF c`, [args.cardId, args.customerId]);
  if (!rows[0]) return failure('credit_card_not_found', 404);
  await client.query(`INSERT INTO oxsteed_credit_card_security_limits (customer_id) VALUES ($1) ON CONFLICT DO NOTHING`, [args.customerId]);
  const { rows: limits } = await client.query(`SELECT * FROM oxsteed_credit_card_security_limits WHERE customer_id = $1 FOR UPDATE`, [args.customerId]);
  return { user, card: rows[0], limit: limits[0] };
}
function eligible(card, action) {
  if (card.account_status !== 'active' || (card.expires_at && new Date(card.expires_at) <= new Date())) return false;
  if (action === 'unfreeze') return card.status === 'frozen' && card.freeze_origin === 'customer';
  if (action === 'activate') return card.status === 'pending';
  return action === 'pin_set' && card.status === 'active';
}
async function failedAttempt(client, args, code) {
  await client.query(`UPDATE oxsteed_credit_card_security_limits SET
    failures = CASE WHEN locked_until IS NOT NULL AND locked_until <= NOW() THEN 1 ELSE failures + 1 END,
    locked_until = CASE WHEN failures >= 4 AND (locked_until IS NULL OR locked_until > NOW())
      THEN NOW() + INTERVAL '15 minutes' ELSE NULL END WHERE customer_id = $1`, [args.customerId]);
  await audit(client, args, 'verification_failed', { reasonCode: code });
  return failure(code);
}
function locked(limit) { return limit?.locked_until && new Date(limit.locked_until) > new Date(); }

async function issueChallenge(args) {
  const { action } = args;
  if (!ACTIONS.includes(action)) throw new AppError('Invalid card security action.', 400, 'credit_card_security_action_invalid');
  const code = String(crypto.randomInt(100000, 1000000));
  const issued = reject(await withTransaction(pool, async client => {
    const context = await loadContext(client, args);
    if (context.failure) return context;
    const { user, card, limit } = context;
    if (locked(limit)) return failure('credit_card_security_locked', 429);
    if (!eligible(card, action)) return failure('credit_card_security_action_blocked', 409);
    if (limit.last_sent_at && Date.now() - new Date(limit.last_sent_at).getTime() < 60000) return failure('credit_card_security_cooldown', 429);
    if (typeof args.password !== 'string' || args.password.length > 1024 || !user.password_hash
      || !(await bcrypt.compare(args.password, user.password_hash))) return failedAttempt(client, args, 'credit_card_security_password_invalid');
    if (user.totp_enabled && (!/^\d{6}$/.test(String(args.mfaCode || ''))
      || !authenticator.verify({ token: String(args.mfaCode), secret: decrypt(user.totp_secret) }))) return failedAttempt(client, args, 'credit_card_security_mfa_required');
    await client.query(`UPDATE oxsteed_credit_card_security_challenges SET consumed_at = NOW()
      WHERE customer_id = $1 AND consumed_at IS NULL`, [args.customerId]);
    const { rows } = await client.query(`INSERT INTO oxsteed_credit_card_security_challenges
      (customer_id, card_id, action, binding_hash, code_hash, expires_at)
      VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '10 minutes') RETURNING id, expires_at`,
    [args.customerId, args.cardId, action, bindingHash(action, args, user), hash(['card-code', code])]);
    await client.query(`UPDATE oxsteed_credit_card_security_limits SET last_sent_at = NOW() WHERE customer_id = $1`, [args.customerId]);
    await audit(client, args, 'verification_requested', { action, method: user.totp_enabled ? 'password_mfa_email' : 'password_email' });
    return { challenge: { id: rows[0].id, expiresAt: rows[0].expires_at }, email: user.email, language: user.preferred_language };
  }, 'credit_card_security_issue'));
  let delivered = false;
  try {
    const result = await sendOTPEmail(issued.email, code, issued.language || 'en');
    delivered = result?.success === true;
  } catch { /* Do not log codes, passwords, destinations, or provider responses. */ }
  await withTransaction(pool, async client => {
    await client.query(`UPDATE oxsteed_credit_card_security_challenges SET
      delivered_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
      consumed_at = CASE WHEN $2 THEN consumed_at ELSE NOW() END WHERE id = $1`, [issued.challenge.id, delivered]);
    if (!delivered) await audit(client, args, 'verification_failed', { reasonCode: 'credit_card_security_delivery_unavailable' });
  }, 'credit_card_security_delivery');
  if (!delivered) throw new AppError('Verification email could not be delivered.', 503, 'credit_card_security_delivery_unavailable');
  return { challenge: issued.challenge, delivery: 'email' };
}

// Verification failure is returned inside the transaction, then thrown AFTER
// commit. Attempt counts and security evidence must not roll back on rejection.
async function runVerified(args, action, operation) {
  if (!args.idempotencyKey || String(args.idempotencyKey).length > 160) throw new AppError('An idempotency key is required.', 400, 'credit_idempotency_key_required');
  const result = await withTransaction(pool, async client => {
    const context = await loadContext(client, args);
    if (context.failure) return context;
    const { user, card, limit } = context;
    const fingerprint = payloadHash(action, args);
    const { rows: previous } = await client.query(`SELECT * FROM oxsteed_credit_card_security_operations
      WHERE customer_id = $1 AND request_key = $2`, [args.customerId, args.idempotencyKey]);
    if (previous[0]) {
      if (previous[0].card_id !== args.cardId || previous[0].action !== action || previous[0].payload_hash !== fingerprint)
        return failure('credit_idempotency_conflict', 409);
      // Never persist or redisplay one-time credentials on retries.
      const replay = { ...previous[0].result, replayed: true };
      if (replay.card) replay.card = { ...replay.card, status: card.status, freezeOrigin: card.freeze_origin || null };
      return replay;
    }
    if (!eligible(card, action)) return failure('credit_card_security_action_blocked', 409);
    if (locked(limit)) return failure('credit_card_security_locked', 429);
    const { rows } = await client.query(`SELECT * FROM oxsteed_credit_card_security_challenges WHERE id = $1 FOR UPDATE`, [args.stepupChallengeId || null]);
    const challenge = rows[0];
    if (!challenge || challenge.customer_id !== args.customerId || challenge.card_id !== args.cardId
      || challenge.action !== action || challenge.binding_hash !== bindingHash(action, args, user)
      || challenge.consumed_at || !challenge.delivered_at || new Date(challenge.expires_at) <= new Date() || challenge.attempts >= 5)
      return failedAttempt(client, args, 'credit_card_security_challenge_invalid');
    const presented = hash(['card-code', String(args.stepupCode || '').trim()]);
    if (!/^[a-f0-9]{64}$/i.test(challenge.code_hash)
      || !crypto.timingSafeEqual(Buffer.from(challenge.code_hash, 'hex'), Buffer.from(presented, 'hex'))) {
      await client.query(`UPDATE oxsteed_credit_card_security_challenges SET attempts = attempts + 1,
        consumed_at = CASE WHEN attempts >= 4 THEN NOW() ELSE consumed_at END WHERE id = $1`, [challenge.id]);
      return failedAttempt(client, args, 'credit_card_security_code_invalid');
    }
    const value = await operation(client);
    await client.query(`UPDATE oxsteed_credit_card_security_challenges SET consumed_at = NOW() WHERE id = $1`, [challenge.id]);
    await client.query(`UPDATE oxsteed_credit_card_security_limits SET failures = 0, locked_until = NULL WHERE customer_id = $1`, [args.customerId]);
    await audit(client, args, 'verification_succeeded', { action, method: user.totp_enabled ? 'password_mfa_email' : 'password_email' });
    const persisted = JSON.parse(JSON.stringify(value));
    if (persisted.card) { delete persisted.card.credential; delete persisted.card.activationCode; }
    await client.query(`INSERT INTO oxsteed_credit_card_security_operations
      (customer_id, request_key, card_id, action, payload_hash, result) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [args.customerId, args.idempotencyKey, args.cardId, action, fingerprint, JSON.stringify(persisted)]);
    return value;
  }, 'credit_card_security_action');
  return reject(result);
}

module.exports = { ACTIONS, issueChallenge, runVerified, payloadHash, bindingHash, eligible, hash };
