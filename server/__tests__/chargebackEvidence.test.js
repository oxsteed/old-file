'use strict';

// Review P3-814: chargebacks are tracked with deadlines, evidence is staged
// on open and submitted (by admin or automatically before the deadline).
const { mockQuery, resetMocks } = require('./setup');

const mockDisputesUpdate = jest.fn();
jest.mock('stripe', () => () => ({ disputes: { update: mockDisputesUpdate } }));
jest.mock('../services/reconciliationExceptions', () => ({ recordException: jest.fn().mockResolvedValue(1) }));
jest.mock('../jobs/jobLockingService', () => ({
  withFencedJobLock: async (_name, fn) => fn({ assertActive() {}, db: require('../db') }),
}));

const svc = require('../services/chargebackEvidenceService');
const { runChargebackEvidenceDeadline } = require('../jobs/chargebackEvidenceDeadline');

const dispute = {
  id: 'dp_1', charge: 'ch_1', payment_intent: 'pi_1', amount: 5000, currency: 'usd', reason: 'fraudulent',
  status: 'needs_response', evidence_details: { due_by: Math.floor(Date.now() / 1000) + 7 * 86400, has_evidence: false, submission_count: 0 },
};

beforeEach(() => { resetMocks(); mockDisputesUpdate.mockReset(); });

function routeDb(extra = {}) {
  mockQuery.mockImplementation(async (sql, params) => {
    const t = String(sql);
    if (t.includes('INSERT INTO stripe_chargebacks')) return { rows: [{ id: 9, stripe_dispute_id: 'dp_1', stripe_status: 'needs_response', stripe_charge_id: 'ch_1', stripe_payment_intent_id: 'pi_1', evidence_staged_at: null, evidence_submitted_at: null, ...extra.row }] };
    if (t.includes('FROM payments p')) return { rows: [{ id: 3, job_id: 'j1', title: 'Fix sink', description: 'Leak', job_status: 'completed', completed_at: '2026-10-01T10:00:00Z', completion_confirmed_at: '2026-10-01T12:00:00Z', customer_email: 'c@x.com', customer_first: 'Ana', customer_last: 'Lee' }] };
    if (t.includes('FROM work_agreements')) return { rows: [] };
    if (t.includes('UPDATE stripe_chargebacks')) return { rows: [{ id: 9, evidence_submitted_at: params?.[2] ? new Date() : null }] };
    if (t.includes('SELECT * FROM stripe_chargebacks')) return { rows: extra.due || [] };
    return { rows: [] };
  });
}

test('webhook records the dispute and stages evidence without submitting', async () => {
  routeDb();
  mockDisputesUpdate.mockResolvedValue({ id: 'dp_1' });
  await svc.handleDisputeWebhook(dispute, null);
  expect(mockDisputesUpdate).toHaveBeenCalledWith('dp_1', expect.objectContaining({ submit: false, evidence: expect.objectContaining({
    customer_email_address: 'c@x.com',
    customer_name: 'Ana Lee',
    service_date: '2026-10-01',
    uncategorized_text: expect.stringContaining('Customer confirmed completion'),
  }) }), undefined);
});

test('connected-account disputes are updated on that account', async () => {
  routeDb({ row: { stripe_account_id: 'acct_7' } });
  mockDisputesUpdate.mockResolvedValue({});
  await svc.handleDisputeWebhook(dispute, 'acct_7');
  expect(mockDisputesUpdate.mock.calls[0][2]).toEqual({ stripeAccount: 'acct_7' });
});

test('deadline job auto-submits evidence close to the deadline', async () => {
  const soon = new Date(Date.now() + 3600000).toISOString();
  routeDb({ due: [{ id: 9, stripe_dispute_id: 'dp_1', stripe_status: 'needs_response', evidence_due_by: soon, evidence_staged_at: new Date().toISOString(), stripe_charge_id: 'ch_1' }] });
  mockDisputesUpdate.mockResolvedValue({});
  const out = await runChargebackEvidenceDeadline();
  expect(out.submitted).toBe(1);
  expect(mockDisputesUpdate).toHaveBeenCalledWith('dp_1', expect.objectContaining({ submit: true }), undefined);
});

test('auto-submit can be turned off, leaving evidence staged only', async () => {
  process.env.CHARGEBACK_AUTO_SUBMIT = 'false';
  const soon = new Date(Date.now() + 3600000).toISOString();
  routeDb({ due: [{ id: 9, stripe_dispute_id: 'dp_1', stripe_status: 'needs_response', evidence_due_by: soon, evidence_staged_at: null, stripe_charge_id: 'ch_1' }] });
  mockDisputesUpdate.mockResolvedValue({});
  const out = await runChargebackEvidenceDeadline();
  delete process.env.CHARGEBACK_AUTO_SUBMIT;
  expect(out.staged).toBe(1);
  expect(mockDisputesUpdate).toHaveBeenCalledWith('dp_1', expect.objectContaining({ submit: false }), undefined);
});

test('Stripe failure records the error and raises', async () => {
  routeDb();
  mockDisputesUpdate.mockRejectedValue(new Error('boom'));
  await expect(svc.pushEvidence({ id: 9, stripe_dispute_id: 'dp_1', stripe_status: 'needs_response' }, { submit: true })).rejects.toMatchObject({ code: 'dispute_evidence_failed' });
  expect(mockQuery.mock.calls.some(([sql]) => /last_error = \$2/.test(String(sql)))).toBe(true);
});

test('closed disputes refuse new evidence', async () => {
  await expect(svc.pushEvidence({ id: 9, stripe_status: 'won' }, { submit: true })).rejects.toMatchObject({ code: 'dispute_not_open' });
});
