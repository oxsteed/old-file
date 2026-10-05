'use strict';

const { mockQuery, resetMocks } = require('./setup');
jest.unmock('../utils/transaction');
jest.mock('bcrypt', () => ({ compare: jest.fn().mockResolvedValue(true) }));
const bcrypt = require('bcrypt');
const { sendOTPEmail } = require('../utils/email');
const security = require('../services/oxsteedCreditCardSecurity');
const service = require('../services/oxsteedCreditCardService');
const recovery = require('../services/oxsteedCreditCardRecovery');
const { authenticator } = require('@otplib/v12-adapter');
const { encrypt } = require('../utils/encryption');

const userId = '11111111-1111-4111-8111-111111111111';
const cardId = '99999999-9999-4999-8999-999999999999';
const grantId = '22222222-2222-4222-8222-222222222222';
const args = { customerId: userId, actorUserId: userId, cardId, sessionBinding: 'synthetic-session',
  idempotencyKey: 'synthetic-operation', stepupChallengeId: grantId, stepupCode: '123456' };
let user, card, grant, limit, previous, calls;
beforeEach(() => {
  resetMocks(); calls = [];
  bcrypt.compare.mockResolvedValue(true);
  sendOTPEmail.mockResolvedValue({ success: true });
  user = { id: userId, email: 'test@example.invalid', email_verified: true, password_hash: 'synthetic-hash', is_active: true, totp_enabled: false };
  card = { id: cardId, customer_id: userId, status: 'frozen', freeze_origin: 'customer', account_status: 'active' };
  limit = {}; previous = [];
  grant = { id: grantId, customer_id: userId, card_id: cardId, action: 'unfreeze',
    binding_hash: security.bindingHash('unfreeze', args, user), code_hash: security.hash(['card-code', '123456']),
    attempts: 0, expires_at: new Date(Date.now() + 600000), delivered_at: new Date() };
  mockQuery.mockImplementation(async (sql, values) => {
    calls.push([sql, values]);
    if (sql.includes('FROM users')) return { rows: [user] };
    if (sql.includes('account_status FROM')) return { rows: card ? [card] : [] };
    if (sql.includes('SELECT * FROM oxsteed_credit_card_security_limits')) return { rows: [limit] };
    if (sql.includes('SELECT * FROM oxsteed_credit_card_security_operations')) return { rows: previous };
    if (sql.includes('SELECT * FROM oxsteed_credit_card_security_challenges')) return { rows: grant ? [grant] : [] };
    if (sql.includes('INSERT INTO oxsteed_credit_card_security_challenges')) return { rows: [{ id: grantId, expires_at: new Date(Date.now() + 600000) }] };
    return { rows: [] };
  });
});
const committed = () => expect(calls.map(([sql]) => sql)).toContain('COMMIT');
const callback = () => jest.fn().mockResolvedValue({ card: { id: cardId, status: 'active', credential: 'one-time-synthetic' } });

test('wrong email code persists failed attempt and evidence before rejecting', async () => {
  const action = callback();
  await expect(security.runVerified({ ...args, stepupCode: '654321' }, 'unfreeze', action)).rejects.toMatchObject({ code: 'credit_card_security_code_invalid' });
  committed(); expect(calls.some(([sql]) => sql.includes('attempts = attempts + 1'))).toBe(true);
  expect(calls.some(([sql, values]) => sql.includes('audit_events') && values[0] === 'credit.card.verification_failed')).toBe(true);
  expect(action).not.toHaveBeenCalled();
});
test.each(['expired', 'consumed', 'undelivered', 'wrong-card', 'wrong-action', 'changed-session', 'changed-password', 'exhausted'])('rejects %s grant without domain mutation', async kind => {
  if (kind === 'expired') grant.expires_at = new Date(0);
  if (kind === 'consumed') grant.consumed_at = new Date();
  if (kind === 'undelivered') grant.delivered_at = null;
  if (kind === 'wrong-card') grant.card_id = grantId;
  if (kind === 'wrong-action') grant.action = 'activate';
  if (kind === 'changed-password') user.password_hash = 'changed-hash';
  if (kind === 'exhausted') grant.attempts = 5;
  const action = callback();
  await expect(security.runVerified({ ...args, ...(kind === 'changed-session' ? { sessionBinding: 'other' } : {}) }, 'unfreeze', action))
    .rejects.toMatchObject({ code: 'credit_card_security_challenge_invalid' });
  committed(); expect(action).not.toHaveBeenCalled();
});
test.each(['lost', 'stolen', 'revoked', 'expired', 'pending'])('cannot unfreeze %s card', async status => {
  card.status = status;
  await expect(service.unfreezeCard(args)).rejects.toMatchObject({ code: 'credit_card_security_action_blocked' });
});
test.each([null, 'admin', 'system'])('cannot override freeze origin %s', async origin => {
  card.freeze_origin = origin;
  await expect(service.unfreezeCard(args)).rejects.toMatchObject({ code: 'credit_card_security_action_blocked' });
});
test('account restrictions, inactive user and impersonation fail closed', async () => {
  card.account_status = 'suspended';
  await expect(service.unfreezeCard(args)).rejects.toMatchObject({ code: 'credit_card_security_action_blocked' });
  user.is_active = false;
  await expect(service.unfreezeCard(args)).rejects.toMatchObject({ code: 'credit_card_security_actor_invalid' });
  user.is_active = true;
  await expect(service.unfreezeCard({ ...args, impersonated: true })).rejects.toMatchObject({ code: 'credit_card_security_actor_invalid' });
});
test('payload binding prevents using a PIN grant for a different new PIN', async () => {
  card.status = 'active'; grant.action = 'pin_set';
  grant.binding_hash = security.bindingHash('pin_set', { ...args, pin: '1234', resetPin: true }, user);
  await expect(service.setCardPin({ ...args, pin: '5678', resetPin: true })).rejects.toMatchObject({ code: 'credit_card_security_challenge_invalid' });
});
test('valid operation consumes grant and persists only a sanitized receipt', async () => {
  const action = callback();
  const result = await security.runVerified(args, 'unfreeze', action);
  expect(result.card.credential).toBe('one-time-synthetic');
  const receipt = calls.find(([sql]) => sql.includes('INSERT INTO oxsteed_credit_card_security_operations'));
  expect(receipt[1][5]).not.toContain('one-time-synthetic');
  expect(calls.some(([sql]) => sql.includes('challenges SET consumed_at'))).toBe(true); committed();
});
test('response loss retry never rediscloses credential or reports obsolete active status', async () => {
  previous = [{ card_id: cardId, action: 'unfreeze', payload_hash: security.payloadHash('unfreeze', args), result: { card: { id: cardId, status: 'active' } } }];
  card.status = 'lost'; const action = callback();
  const result = await security.runVerified(args, 'unfreeze', action);
  expect(result).toMatchObject({ replayed: true, card: { status: 'lost' } }); expect(result.card.credential).toBeUndefined();
  expect(action).not.toHaveBeenCalled();
});
test('conflicting idempotency payload is rejected', async () => {
  previous = [{ card_id: cardId, action: 'activate', payload_hash: 'wrong' }];
  await expect(security.runVerified(args, 'unfreeze', callback())).rejects.toMatchObject({ code: 'credit_idempotency_conflict' });
});
test('failed mutation rolls back grant consumption and operation receipt', async () => {
  await expect(security.runVerified(args, 'unfreeze', async () => { throw new Error('synthetic unavailable'); })).rejects.toThrow('synthetic unavailable');
  expect(calls.map(([sql]) => sql)).toContain('ROLLBACK');
  expect(calls.some(([sql]) => sql.includes('security_operations\n') && sql.includes('INSERT'))).toBe(false);
});
test('invalid password is counted even though challenge request is rejected', async () => {
  bcrypt.compare.mockResolvedValue(false);
  await expect(security.issueChallenge({ ...args, action: 'unfreeze', password: 'synthetic' })).rejects.toMatchObject({ code: 'credit_card_security_password_invalid' });
  committed(); expect(sendOTPEmail).not.toHaveBeenCalled();
});
test('enrolled MFA is required before email issuance', async () => {
  user.totp_enabled = true; user.totp_secret = encrypt('SYNTHETIC'); authenticator.verify.mockReturnValue(false);
  await expect(security.issueChallenge({ ...args, action: 'unfreeze', password: 'synthetic', mfaCode: '123456' })).rejects.toMatchObject({ code: 'credit_card_security_mfa_required' });
  expect(sendOTPEmail).not.toHaveBeenCalled(); committed();
});
test('failed email burns challenge and never logs or returns code', async () => {
  sendOTPEmail.mockResolvedValue({ success: false });
  await expect(security.issueChallenge({ ...args, action: 'unfreeze', password: 'synthetic' })).rejects.toMatchObject({ code: 'credit_card_security_delivery_unavailable' });
  expect(calls.some(([sql, values]) => sql.includes('delivered_at = CASE') && values[0] === grantId && values[1] === false)).toBe(true);
  expect(calls.some(([sql, values]) => sql.includes('audit_events') && values[0] === 'credit.card.verification_failed'
    && values[5].includes('credit_card_security_delivery_unavailable'))).toBe(true);
});
test('email challenge response contains only identifier and expiry', async () => {
  const result = await security.issueChallenge({ ...args, action: 'unfreeze', password: 'synthetic' });
  expect(Object.keys(result.challenge).sort()).toEqual(['expiresAt', 'id']);
  expect(JSON.stringify(result)).not.toContain(user.email);
});
test('customer history excludes internal audit context', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: cardId }] }).mockResolvedValueOnce({ rows: [{ id: 1, customer_id: userId, actor_user_id: userId,
    action_type: 'credit.card.lost', reason: 'private review', request_ip: '192.0.2.1', metadata: { internal: true } }] });
  const result = await recovery.listHistory({ cardId, customerId: userId });
  expect(result.events[0].actor).toBe('you'); expect(JSON.stringify(result)).not.toContain('private review');
  expect(JSON.stringify(result)).not.toContain('192.0.2.1');
});
test('staff retry requires authorization and reason', async () => {
  await expect(recovery.retryReplacement({ cardId, reason: 'review' })).rejects.toMatchObject({ code: 'credit_card_retry_forbidden' });
  await expect(recovery.retryReplacement({ ...args, isAdmin: true })).rejects.toMatchObject({ code: 'credit_card_retry_reason_required' });
});
