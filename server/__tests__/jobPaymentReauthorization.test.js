'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { routeQueries } = require('./helpers/sqlRouter');

jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../services/socketService', () => ({ broadcastToUser: jest.fn() }));
jest.mock('../models/jobModel', () => ({ ...jest.requireActual('../models/jobModel'), setFinancials: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/creditSpendAdapter', () => ({
  spendWithCredit: jest.fn().mockResolvedValue({ hold: { id: '00000000-0000-4000-8000-000000000077' }, idempotencyKey: 'k' }),
}));

const stripe = require('stripe').__mockInstance;
const { AppError } = require('../middleware/errorHandler');
const { sendNotification } = require('../services/notificationService');
const { spendWithCredit } = require('../services/creditSpendAdapter');
const reauth = require('../services/jobPaymentReauthorizationService');
const { applyApprovedChangeOrder } = require('../services/jobChangeOrderFinance');
const { captureAuthorizedPaymentWithClient, captureAuthorizedPayment } = require('../services/paymentCaptureService');
const { handleEvent } = require('../jobs/jobEventOutbox');
const { EVENT_TYPES } = require('../services/jobEventOutbox');

const CUSTOMER = { id: 'cust-1', role: 'customer' };
const JOB_ID = '11111111-1111-4111-8111-111111111111';
const baseJob = (metadata) => ({ id: JOB_ID, client_id: 'cust-1', assigned_helper_id: 'help-1', status: 'in_progress', job_value_cents: 20500, metadata });

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  stripe.paymentIntents.cancel = jest.fn().mockResolvedValue({ status: 'canceled' });
});

describe('completion and capture are blocked until re-authorized', () => {
  test('flags and a pending increase all block', () => {
    expect(() => reauth.assertNoPendingAdjustment(baseJob({ paymentAdjustmentRequired: 'reauthorization_required' }))).toThrow(AppError);
    expect(() => reauth.assertNoPendingAdjustment(baseJob({ creditAdjustmentRequired: true }))).toThrow(/authorize the new price/);
    expect(() => reauth.assertNoPendingAdjustment(baseJob({}), { pending_increase_cents: 100 })).toThrow(AppError);
    expect(() => reauth.assertNoPendingAdjustment(baseJob({ paymentReauthorizedAt: 'x' }), { pending_increase_cents: 0 })).not.toThrow();
  });

  test('capture refuses a payment with an unfunded increase (both capture paths)', async () => {
    const row = { id: 9, status: 'authorized', amount: 180, stripe_payment_intent_id: 'pi_1', stripe_account_id: 'acct', pending_increase_cents: 2500 };
    await expect(captureAuthorizedPaymentWithClient({ query: mockQuery }, row)).rejects.toMatchObject({ code: 'payment_reauthorization_required', statusCode: 409 });
    routeQueries(mockQuery, [[/FROM payments WHERE id = \$1/, { rows: [row] }]]);
    await expect(captureAuthorizedPayment({ paymentId: 9, amount: 180 })).rejects.toMatchObject({ code: 'payment_reauthorization_required' });
    expect(stripe.paymentIntents.capture).not.toHaveBeenCalled();
  });
});

describe('state endpoint data', () => {
  test('customer sees amounts; other users get 404', async () => {
    routeQueries(mockQuery, [
      [/SELECT id, client_id, assigned_helper_id, status, metadata, job_value_cents FROM jobs/, { rows: [baseJob({ paymentAdjustmentRequired: 'reauthorization_required' })] }],
      [/FROM payments WHERE job_id/, { rows: [{ id: 9, amount: '180.00', metadata: {}, pending_increase_cents: 2500, capture_amount_cents: 18000 }] }],
    ]);
    const state = await reauth.getReauthorizationState(JOB_ID, CUSTOMER);
    expect(state).toMatchObject({ required: true, can_authorize: true, requirement: { card: 'reauthorization_required', authorized_cents: 18000, target_cents: 20500 } });
    await expect(reauth.getReauthorizationState(JOB_ID, { id: 'stranger' })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('unconfirmed intent is repriced in place', () => {
  test('updates the Stripe amount and fee, clears the flag, and records the attempt', async () => {
    stripe.paymentIntents.retrieve.mockResolvedValueOnce({ id: 'pi_1', status: 'requires_payment_method' });
    stripe.paymentIntents.update.mockResolvedValueOnce({ id: 'pi_1', amount: 20500 });
    const calls = routeQueries(mockQuery, [
      [/SELECT \* FROM jobs WHERE id = \$1 FOR UPDATE/, { rows: [baseJob({ paymentAdjustmentRequired: 'intent_reprice_required', paymentAdjustmentChangeOrderId: 'co-1' })] }],
      [/FROM payments WHERE job_id/, { rows: [{ id: 9, status: 'pending', amount: '180.00', metadata: {}, capture_amount_cents: 20500, pending_increase_cents: 2500, stripe_payment_intent_id: 'pi_1', stripe_account_id: 'acct' }] }],
      [/COALESCE\(MAX\(attempt\)/, { rows: [{ n: 1 }] }],
      [/INSERT INTO job_payment_reauthorizations/, { rows: [{ id: 3, method: 'card', kind: 'reprice', status: 'authorized', amount_cents: 20500 }] }],
      [/INSERT INTO job_event_outbox/, { rows: [{ id: 1 }] }],
    ]);
    const result = await reauth.startCardReauthorization({ jobId: JOB_ID, user: CUSTOMER });
    expect(result.status).toBe('repriced');
    expect(stripe.paymentIntents.update).toHaveBeenCalledWith('pi_1', expect.objectContaining({ amount: 20500, application_fee_amount: expect.any(Number) }),
      expect.objectContaining({ stripeAccount: 'acct', idempotencyKey: `job-payment-reprice:${JOB_ID}:1` }));
    expect(calls.some((c) => /- 'paymentAdjustmentRequired'/.test(c.sql))).toBe(true);
    expect(calls.find((c) => /UPDATE payments SET amount = \$2/.test(c.sql)).params.slice(0, 2)).toEqual([9, 205]);
  });

  test('only the customer can start, and only when required', async () => {
    routeQueries(mockQuery, [[/SELECT \* FROM jobs WHERE id = \$1 FOR UPDATE/, { rows: [baseJob({})] }]]);
    await expect(reauth.startCardReauthorization({ jobId: JOB_ID, user: { id: 'help-1' } })).rejects.toMatchObject({ statusCode: 403 });
    await expect(reauth.startCardReauthorization({ jobId: JOB_ID, user: CUSTOMER })).rejects.toMatchObject({ code: 'payment_reauthorization_not_required' });
  });
});

describe('OxSteed Credit collateral', () => {
  const agreement = { id: 'ag-1', job_id: JOB_ID, helper_id: 'help-1' };
  const hold = { id: 5, status: 'active', amount_cents: 18000, account_id: 1, customer_id: 'cust-1', partner_id: 3 };

  test('insufficient Credit at approval keeps the old hold and asks the customer, instead of failing the approval', async () => {
    spendWithCredit.mockRejectedValueOnce(new AppError('Insufficient available OxSteed Credit', 409, 'credit_insufficient_funds'));
    const calls = routeQueries(mockQuery, [
      [/SELECT \* FROM jobs WHERE id = \$1 FOR UPDATE/, { rows: [{ ...baseJob({ creditCollateralHoldId: 5 }), job_value_cents: 18000 }] }],
      [/FROM oxsteed_credit_holds WHERE id = \$1 FOR UPDATE/, { rows: [hold] }],
      [/UPDATE oxsteed_credit_accounts/, { rows: [{ id: 1 }] }],
      [/SELECT version, revision FROM jobs/, { rows: [{ version: 3, revision: 2 }] }],
    ]);
    const { adjustment } = await applyApprovedChangeOrder({ query: mockQuery }, { agreement, changeOrder: { id: 'co-2', price_change_cents: 2500 }, actorId: 'cust-1' });
    expect(adjustment.credit_action).toBe('credit_reauthorization_required');
    expect(calls.some((c) => /ROLLBACK TO SAVEPOINT change_order_credit/.test(c.sql))).toBe(true);
    const flag = calls.find((c) => /creditAdjustmentRequired/.test(JSON.stringify(c.params || [])));
    expect(JSON.parse(flag.params[1])).toMatchObject({ creditAdjustmentRequired: true, creditAdjustmentAmountCents: 20500 });
  });

  test('customer re-places the hold after adding Credit; impersonation is refused', async () => {
    const calls = routeQueries(mockQuery, [
      [/SELECT \* FROM jobs WHERE id = \$1 FOR UPDATE/, { rows: [baseJob({ creditCollateralHoldId: 5, creditAdjustmentRequired: true, creditAdjustmentAmountCents: 20500 })] }],
      [/COALESCE\(MAX\(attempt\)/, { rows: [{ n: 2 }] }],
      [/FROM oxsteed_credit_holds WHERE id = \$1 FOR UPDATE/, { rows: [hold] }],
      [/UPDATE oxsteed_credit_accounts/, { rows: [{ id: 1 }] }],
      [/INSERT INTO job_payment_reauthorizations/, (sql, params) => ({ rows: [{ id: 4, method: 'credit', kind: 'credit_hold', status: 'authorized', amount_cents: params[4] }] })],
      [/INSERT INTO job_event_outbox/, { rows: [{ id: 1 }] }],
    ]);
    const result = await reauth.authorizeWithCredit({ jobId: JOB_ID, user: CUSTOMER });
    expect(result).toMatchObject({ status: 'authorized', attempt: { method: 'credit', amount_cents: 20500 } });
    expect(spendWithCredit).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 20500, mode: 'hold', idempotencyKey: `credit-spend:jobs:job_escrow_collateral:${JOB_ID}:reauth:2` }));
    expect(calls.some((c) => /- 'creditAdjustmentRequired'/.test(c.sql))).toBe(true);
    await expect(reauth.authorizeWithCredit({ jobId: JOB_ID, user: CUSTOMER, isImpersonated: true })).rejects.toMatchObject({ code: 'impersonation_blocked' });
  });

  test('a later decrease clears the card flag and cancels the open attempt', async () => {
    const calls = routeQueries(mockQuery, [
      [/SELECT \* FROM jobs WHERE id = \$1 FOR UPDATE/, { rows: [baseJob({ paymentAdjustmentRequired: 'reauthorization_required' })] }],
      [/FROM payments WHERE job_id/, { rows: [{ id: 9, amount: '180.00', status: 'authorized', metadata: { authorized_amount_cents: 18000 } }] }],
      [/UPDATE job_payment_reauthorizations SET status = 'canceled'/, { rows: [{ id: 6, stripe_payment_intent_id: 'pi_open', stripe_account_id: 'acct' }] }],
      [/SELECT version, revision FROM jobs/, { rows: [{ version: 3, revision: 2 }] }],
    ]);
    const { adjustment } = await applyApprovedChangeOrder({ query: mockQuery }, { agreement, changeOrder: { id: 'co-3', price_change_cents: -3000 }, actorId: 'cust-1' });
    expect(adjustment.payment_action).toBe('capture_reduced');
    expect(calls.some((c) => /- 'paymentAdjustmentRequired'/.test(c.sql))).toBe(true);
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith('pi_open', {}, expect.objectContaining({ stripeAccount: 'acct' }));
  });
});

describe('webhooks and notifications', () => {
  test('ordinary job intents are left to the normal handler', async () => {
    await expect(reauth.applyReauthorizationWebhook('payment_intent.amount_capturable_updated', { id: 'pi_x', metadata: { job_id: JOB_ID } })).resolves.toBe(false);
  });

  test('cancel of an open attempt marks it canceled; once authorized the normal handler applies', async () => {
    routeQueries(mockQuery, [[/SELECT \* FROM job_payment_reauthorizations WHERE stripe_payment_intent_id/, { rows: [{ id: 2, job_id: JOB_ID, status: 'pending' }] }]]);
    await expect(reauth.applyReauthorizationWebhook('payment_intent.canceled', { id: 'pi_r', metadata: { job_reauthorization: 'true' } })).resolves.toBe(true);
    routeQueries(mockQuery, [[/SELECT \* FROM job_payment_reauthorizations WHERE stripe_payment_intent_id/, { rows: [{ id: 2, job_id: JOB_ID, status: 'authorized' }] }]]);
    await expect(reauth.applyReauthorizationWebhook('payment_intent.canceled', { id: 'pi_r', metadata: { job_reauthorization: 'true' } })).resolves.toBe(false);
  });

  test('outbox tells the customer about a decline or expiry, and both parties on success', async () => {
    routeQueries(mockQuery, [[/FROM jobs WHERE id = \$1/, { rows: [{ ...baseJob({}), deleted_at: null }] }]]);
    await handleEvent({ id: 1, job_id: JOB_ID, event_type: EVENT_TYPES.PAYMENT_REAUTH_FAILED, payload: { attempt_id: '7', reason: 'expired' } });
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'cust-1', type: 'job_payment_reauth_failed', title: 'Payment authorization expired' }));
    sendNotification.mockClear();
    await handleEvent({ id: 2, job_id: JOB_ID, event_type: EVENT_TYPES.PAYMENT_REAUTHORIZED, payload: { attempt_id: '7', customer_id: 'cust-1', helper_id: 'help-1' } });
    expect(sendNotification.mock.calls.map((c) => c[0].userId)).toEqual(['cust-1', 'help-1']);
  });
});
