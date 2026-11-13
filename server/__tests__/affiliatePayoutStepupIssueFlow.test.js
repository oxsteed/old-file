'use strict';

// Domain 6 finding 6 (2026-11-13): the affiliate maker step-up was email
// OTP while the checker proof is TOTP. affiliate_payout_process now
// belongs to TOTP_STEPUP_ACTION_TYPES, so the maker proves with the
// authenticator app like every other admin money move.
//
// End-to-end proof through the REAL stepup service: a challenge issued
// from the dedicated endpoint verifies under actionType
// 'affiliate_payout_process' with a current TOTP code, sends no email,
// and is single-use. The pool is the shared setup mock with a stateful
// in-memory pg fake and REAL TOTP math (the setup-mocked adapter
// delegates to the actual @otplib implementation), following
// creditStepupTotp.test.js.
//
// Gate check (verified in code before building): a TOTP-listed action
// invoked by a TOTP-less admin fails closed with a clear error, and the
// maker cannot reach the route at all without TOTP enrolled:
// requireAdmin rejects admin/super_admin sessions without TOTP (403
// admin_2fa_required, redirect /admin/2fa-setup), and
// issueStepupChallenge's TOTP branch throws credit_stepup_totp_not_enabled.
// No unenrolled maker is hard-blocked without an enrollment affordance.
const { mockQuery, resetMocks } = require('./setup');
const crypto = require('crypto');
const { encrypt } = require('../utils/encryption');
const { authenticator } = require('@otplib/v12-adapter');

jest.mock('stripe', () => () => ({}));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/sanctionsScreeningService', () => ({ assertSanctionsClear: jest.fn().mockResolvedValue({ cleared: false }) }));
const mockSend = jest.fn().mockResolvedValue(true);
jest.mock('../services/emailService', () => ({ send: mockSend }));

// The shared setup mocks the adapter (verify always true). These helpers
// implement real RFC 6238 TOTP math in the test so the service is exercised
// against a faithful authenticator contract (window of +-1 time-step),
// without depending on the ESM-only adapter under Jest.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(bytes) {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  }
  return out;
}
function base32Decode(input) {
  let bits = '';
  for (const char of String(input).toUpperCase().replace(/=+$/, '')) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('invalid base32');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totpToken(secretBase32, epochMs, stepSeconds = 30, digits = 6) {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(epochMs / 1000 / stepSeconds);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}
function installTotpFake() {
  authenticator.verify.mockImplementation(({ secret, token }) => {
    const now = Date.now();
    return [-1, 0, 1].some((step) => totpToken(secret, now + step * 30000) === String(token));
  });
}

const {
  issueStepupChallenge,
  verifyStepupChallenge,
  STEPUP_ACTION_TYPES,
  TOTP_STEPUP_ACTION_TYPES,
} = require('../services/stepupChallengeService');
const { issueProcessStepupChallenge } = require('../controllers/affiliatePayoutsController');

const TEST_SECRET = base32Encode(crypto.randomBytes(20));
const ADMIN_ID = 'admin-1';
const NO_TOTP_ADMIN_ID = 'admin-no-totp';

let store;
let users;
let counters;
let seq;

function rowToDb(row) {
  return {
    id: row.id,
    actor_user_id: row.actorUserId,
    action_type: row.actionType,
    amount_cents: row.amountCents,
    currency_code: row.currencyCode,
    code_hash: row.codeHash,
    method: row.method,
    attempts: row.attempts,
    max_attempts: row.maxAttempts,
    expires_at: row.expiresAt,
    consumed_at: row.consumedAt,
    created_at: row.createdAt,
  };
}

function route(payoutRow) {
  store = new Map();
  users = new Map();
  counters = new Map();
  seq = 0;
  users.set(ADMIN_ID, { totpSecret: encrypt(TEST_SECRET), totpEnabled: true });
  users.set(NO_TOTP_ADMIN_ID, { totpSecret: null, totpEnabled: false });
  mockQuery.mockImplementation(async (sql, params = []) => {
    const t = String(sql);
    if (/^\s*BEGIN|^\s*COMMIT|^\s*ROLLBACK/.test(t)) return { rows: [] };
    if (/FROM affiliate_payouts WHERE id/.test(t)) return { rows: payoutRow ? [payoutRow] : [] };
    if (/INSERT INTO oxsteed_credit_stepup_challenges/.test(t)) {
      const isTotp = t.includes("'totp'");
      const row = {
        id: `ch_${++seq}`,
        actorUserId: params[0],
        actionType: params[1],
        amountCents: params[2],
        currencyCode: params[3],
        codeHash: isTotp ? null : params[4],
        method: isTotp ? 'totp' : 'email',
        attempts: 0,
        maxAttempts: isTotp ? params[4] : params[5],
        expiresAt: isTotp ? params[5] : params[6],
        consumedAt: null,
        createdAt: new Date().toISOString(),
      };
      if (row.expiresAt instanceof Date) row.expiresAt = row.expiresAt.toISOString();
      store.set(row.id, row);
      return { rows: [rowToDb(row)] };
    }
    if (/FROM oxsteed_credit_stepup_challenges WHERE id/.test(t)) {
      const row = store.get(params[0]);
      return { rows: row ? [rowToDb(row)] : [] };
    }
    if (/UPDATE oxsteed_credit_stepup_challenges/.test(t) && t.includes('SET attempts')) {
      const row = store.get(params[0]);
      if (row) {
        row.attempts = params[1];
        if (params[2]) row.consumedAt = new Date().toISOString();
      }
      return { rows: [] };
    }
    if (/UPDATE oxsteed_credit_stepup_challenges/.test(t) && t.includes('SET consumed_at = NOW()')) {
      const row = store.get(params[0]);
      if (row) row.consumedAt = new Date().toISOString();
      return { rows: [] };
    }
    if (/SELECT totp_secret FROM users/.test(t)) {
      const user = users.get(params[0]);
      return { rows: user ? [{ totp_secret: user.totpSecret }] : [] };
    }
    if (/COALESCE\(totp_enabled/.test(t)) {
      const user = users.get(params[0]);
      return { rows: user ? [{ totp_enabled: user.totpEnabled }] : [] };
    }
    if (/FROM admin_totp_stepup_counters WHERE user_id/.test(t)) {
      const max = counters.get(params[0]);
      return { rows: max == null ? [] : [{ max_counter: max }] };
    }
    if (/INSERT INTO admin_totp_stepup_counters/.test(t)) {
      counters.set(params[0], params[1]);
      return { rows: [] };
    }
    return { rows: [] };
  });
}

function res() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

function currentTotp() {
  return totpToken(TEST_SECRET, Date.now());
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  mockSend.mockClear();
  installTotpFake();
});

test('a challenge issued from the new endpoint verifies for affiliate_payout_process with TOTP', async () => {
  route({ id: 9, status: 'pending', net_payout_cents: null, total_commission_cents: 1500, processor_fee_cents: 100 });
  const r = res();
  const next = jest.fn();
  await issueProcessStepupChallenge({ user: { id: ADMIN_ID, email: 'admin@oxsteed.com' }, params: { payoutId: 9 } }, r, next);
  expect(next).not.toHaveBeenCalled();
  expect(r.status).toHaveBeenCalledWith(201);
  const body = r.json.mock.calls[0][0];
  expect(body.challenge.amountCents).toBe(1400);
  expect(body.challenge.actionType).toBe('affiliate_payout_process');
  expect(body.delivery).toBe('totp');
  const stored = store.get(body.challenge.id);
  expect(stored.method).toBe('totp');
  expect(stored.amountCents).toBe(1400);
  // No email is sent for a TOTP challenge.
  expect(mockSend).not.toHaveBeenCalled();

  const verified = await verifyStepupChallenge({
    challengeId: body.challenge.id,
    actorUserId: ADMIN_ID,
    actionType: 'affiliate_payout_process',
    code: currentTotp(),
    expectedAmountCents: 1400,
  });
  expect(verified.verified).toBe(true);

  // Single-use: replaying the same challenge fails closed.
  await expect(verifyStepupChallenge({
    challengeId: body.challenge.id,
    actorUserId: ADMIN_ID,
    actionType: 'affiliate_payout_process',
    code: currentTotp(),
    expectedAmountCents: 1400,
  })).rejects.toMatchObject({ code: 'credit_stepup_challenge_invalid' });
});

test('net payout wins through the real payable figure', async () => {
  route({ id: 9, status: 'pending', net_payout_cents: 1200, total_commission_cents: 1500, processor_fee_cents: 100 });
  const r = res();
  const next = jest.fn();
  await issueProcessStepupChallenge({ user: { id: ADMIN_ID, email: 'admin@oxsteed.com' }, params: { payoutId: 9 } }, r, next);
  expect(next).not.toHaveBeenCalled();
  expect(r.json.mock.calls[0][0].challenge.amountCents).toBe(1200);
});

test('a wrong code fails closed without consuming the challenge', async () => {
  route({ id: 9, status: 'pending', net_payout_cents: null, total_commission_cents: 1500, processor_fee_cents: 100 });
  const r = res();
  const next = jest.fn();
  await issueProcessStepupChallenge({ user: { id: ADMIN_ID, email: 'admin@oxsteed.com' }, params: { payoutId: 9 } }, r, next);
  const challengeId = r.json.mock.calls[0][0].challenge.id;
  const code = currentTotp();
  const wrong = code === '000000' ? '111111' : '000000';
  await expect(verifyStepupChallenge({
    challengeId,
    actorUserId: ADMIN_ID,
    actionType: 'affiliate_payout_process',
    code: wrong,
    expectedAmountCents: 1400,
  })).rejects.toMatchObject({ code: 'credit_stepup_challenge_invalid' });
  // The real code still verifies afterwards: the wrong guess only counted an attempt.
  const verified = await verifyStepupChallenge({
    challengeId,
    actorUserId: ADMIN_ID,
    actionType: 'affiliate_payout_process',
    code,
    expectedAmountCents: 1400,
  });
  expect(verified.verified).toBe(true);
});

test('issuing for a TOTP-less admin fails closed with a clear error', async () => {
  route({ id: 9, status: 'pending', net_payout_cents: null, total_commission_cents: 1500, processor_fee_cents: 100 });
  await expect(issueStepupChallenge({
    actorUserId: NO_TOTP_ADMIN_ID,
    actorEmail: 'nototp@oxsteed.com',
    actionType: 'affiliate_payout_process',
    amountCents: 1400,
  })).rejects.toMatchObject({ code: 'credit_stepup_totp_not_enabled' });
  expect(mockSend).not.toHaveBeenCalled();
});

test('affiliate_payout_process is TOTP-method by construction', () => {
  expect(STEPUP_ACTION_TYPES).toContain('affiliate_payout_process');
  expect(TOTP_STEPUP_ACTION_TYPES).toContain('affiliate_payout_process');
});

test('the newer process route verifies exactly this action type', () => {
  const src = require('fs').readFileSync(require.resolve('../routes/affiliatePayouts.js'), 'utf8');
  const at = src.indexOf('/:payoutId/process');
  expect(at).toBeGreaterThan(-1);
  const block = src.slice(at, at + 1200);
  expect(block).toContain("actionType: 'affiliate_payout_process'");
  expect(block).toContain('affiliatePayoutsController.processPayout');
});

test('the real issue helper rejects an unknown action type', async () => {
  await expect(issueStepupChallenge({
    actorUserId: ADMIN_ID,
    actorEmail: 'admin@oxsteed.com',
    actionType: 'no_such_action',
    amountCents: 100,
  })).rejects.toMatchObject({ code: 'credit_stepup_action_invalid' });
});
