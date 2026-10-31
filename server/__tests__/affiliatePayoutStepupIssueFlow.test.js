'use strict';

// Audit fix (auth finding 15, issuance track), end-to-end proof through the
// REAL stepup service: a challenge issued from the new endpoint verifies
// under actionType 'affiliate_payout_process', which is exactly what the
// legacy process route's inline handler (and the sibling item-3 step-up on
// the newer route) calls at verify time. The pool is the shared setup mock;
// email delivery is captured from the mocked email service so the emailed
// code can be presented back.
const { mockQuery, resetMocks } = require('./setup');

jest.mock('stripe', () => () => ({}));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/sanctionsScreeningService', () => ({ assertSanctionsClear: jest.fn().mockResolvedValue({ cleared: false }) }));
const mockSend = jest.fn().mockResolvedValue(true);
jest.mock('../services/emailService', () => ({ send: mockSend }));

const {
  issueStepupChallenge,
  verifyStepupChallenge,
  STEPUP_ACTION_TYPES,
  TOTP_STEPUP_ACTION_TYPES,
} = require('../services/stepupChallengeService');
const { issueProcessStepupChallenge } = require('../controllers/affiliatePayoutsController');

let store;
let seq;

function route(payoutRow) {
  store = new Map();
  seq = 0;
  mockQuery.mockImplementation(async (sql, params) => {
    const t = String(sql);
    if (/FROM affiliate_payouts WHERE id/.test(t)) return { rows: payoutRow ? [payoutRow] : [] };
    if (/INSERT INTO oxsteed_credit_stepup_challenges/.test(t)) {
      const row = {
        id: `ch_${++seq}`,
        actor_user_id: params[0],
        action_type: params[1],
        amount_cents: params[2],
        currency_code: params[3],
        code_hash: params[4],
        method: 'email',
        max_attempts: params[5],
        expires_at: params[6],
        attempts: 0,
        consumed_at: null,
        created_at: new Date().toISOString(),
      };
      store.set(row.id, row);
      return { rows: [row] };
    }
    if (/FROM oxsteed_credit_stepup_challenges WHERE id/.test(t)) {
      const row = store.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (/SET consumed_at = NOW\(\) WHERE id/.test(t)) {
      const row = store.get(params[0]);
      if (row) row.consumed_at = new Date().toISOString();
      return { rows: [] };
    }
    if (/SET attempts =/.test(t)) {
      const row = store.get(params[0]);
      if (row) {
        row.attempts = params[1];
        if (params[2]) row.consumed_at = new Date().toISOString();
      }
      return { rows: [] };
    }
    return { rows: [] };
  });
}

function res() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

function issuedCode() {
  const html = mockSend.mock.calls[0][0].html;
  const m = html.match(/(\d{6})/);
  if (!m) throw new Error('no code captured from mocked email');
  return m[1];
}

beforeEach(() => {
  resetMocks();
  mockSend.mockClear();
});

test('a challenge issued from the new endpoint verifies for affiliate_payout_process', async () => {
  route({ id: 9, status: 'pending', net_payout_cents: null, total_commission_cents: 1500, processor_fee_cents: 100 });
  const r = res();
  const next = jest.fn();
  await issueProcessStepupChallenge({ user: { id: 'admin-1', email: 'admin@oxsteed.com' }, params: { payoutId: 9 } }, r, next);
  expect(next).not.toHaveBeenCalled();
  expect(r.status).toHaveBeenCalledWith(201);
  const body = r.json.mock.calls[0][0];
  expect(body.challenge.amountCents).toBe(1400);
  expect(body.challenge.actionType).toBe('affiliate_payout_process');
  expect(body.delivery).toBe('email');
  const stored = store.get(body.challenge.id);
  expect(stored.method).toBe('email');
  expect(stored.amount_cents).toBe(1400);

  const code = issuedCode();
  const verified = await verifyStepupChallenge({
    challengeId: body.challenge.id,
    actorUserId: 'admin-1',
    actionType: 'affiliate_payout_process',
    code,
  });
  expect(verified.verified).toBe(true);

  // Single-use: replaying the same code fails closed.
  await expect(verifyStepupChallenge({
    challengeId: body.challenge.id,
    actorUserId: 'admin-1',
    actionType: 'affiliate_payout_process',
    code,
  })).rejects.toMatchObject({ code: 'credit_stepup_challenge_invalid' });
});

test('net payout wins through the real payable figure', async () => {
  route({ id: 9, status: 'pending', net_payout_cents: 1200, total_commission_cents: 1500, processor_fee_cents: 100 });
  const r = res();
  const next = jest.fn();
  await issueProcessStepupChallenge({ user: { id: 'admin-1', email: 'admin@oxsteed.com' }, params: { payoutId: 9 } }, r, next);
  expect(next).not.toHaveBeenCalled();
  expect(r.json.mock.calls[0][0].challenge.amountCents).toBe(1200);
});

test('a wrong code fails closed without consuming the challenge', async () => {
  route({ id: 9, status: 'pending', net_payout_cents: null, total_commission_cents: 1500, processor_fee_cents: 100 });
  const r = res();
  const next = jest.fn();
  await issueProcessStepupChallenge({ user: { id: 'admin-1', email: 'admin@oxsteed.com' }, params: { payoutId: 9 } }, r, next);
  const challengeId = r.json.mock.calls[0][0].challenge.id;
  const code = issuedCode();
  const wrong = code === '000000' ? '111111' : '000000';
  await expect(verifyStepupChallenge({
    challengeId,
    actorUserId: 'admin-1',
    actionType: 'affiliate_payout_process',
    code: wrong,
  })).rejects.toMatchObject({ code: 'credit_stepup_challenge_invalid' });
  // The real code still verifies afterwards: the wrong guess only counted an attempt.
  const verified = await verifyStepupChallenge({
    challengeId,
    actorUserId: 'admin-1',
    actionType: 'affiliate_payout_process',
    code,
  });
  expect(verified.verified).toBe(true);
});

test('affiliate_payout_process stays email-method by construction', () => {
  expect(STEPUP_ACTION_TYPES).toContain('affiliate_payout_process');
  expect(TOTP_STEPUP_ACTION_TYPES).not.toContain('affiliate_payout_process');
});

test('the legacy process route verifies exactly this action type', () => {
  const src = require('fs').readFileSync(require.resolve('../routes/payoutRoutes.js'), 'utf8');
  const at = src.indexOf('/:payout_id/process');
  expect(at).toBeGreaterThan(-1);
  const block = src.slice(at, at + 1200);
  expect(block).toContain("actionType: 'affiliate_payout_process'");
  expect(block).toContain('PayoutController.processPayout');
});

test('the real issue helper rejects an unknown action type', async () => {
  await expect(issueStepupChallenge({
    actorUserId: 'admin-1',
    actorEmail: 'admin@oxsteed.com',
    actionType: 'no_such_action',
    amountCents: 100,
  })).rejects.toMatchObject({ code: 'credit_stepup_action_invalid' });
});
