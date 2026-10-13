'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { routeQueries } = require('./helpers/sqlRouter');

jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../services/socketService', () => ({ broadcastToUser: jest.fn() }));
jest.mock('../models/jobModel', () => ({ ...jest.requireActual('../models/jobModel'), setFinancials: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/creditSpendAdapter', () => ({
  spendWithCredit: jest.fn().mockResolvedValue({ hold: { id: 77 }, idempotencyKey: 'k' }),
}));

const { sendNotification } = require('../services/notificationService');
const { setFinancials } = require('../models/jobModel');
const { spendWithCredit } = require('../services/creditSpendAdapter');
const outbox = require('../jobs/jobEventOutbox');
const { enqueueJobEvent, EVENT_TYPES } = require('../services/jobEventOutbox');
const { maintainJobRevisionPartitions, partitionMonth, retentionMonths } = require('../jobs/jobRevisionMaintenance');
const { applyApprovedChangeOrder } = require('../services/jobChangeOrderFinance');

const JOB = { id: 'job-1', client_id: 'cust-1', title: 'Fence', status: 'published', revision: 2, version: 6, deleted_at: null };

beforeEach(() => { resetMocks(); jest.clearAllMocks(); });

describe('job event outbox: enqueue', () => {
  test('coalescing events upsert on the pending coalesce key', async () => {
    const calls = routeQueries(mockQuery, []);
    const client = { query: mockQuery };
    await enqueueJobEvent(client, { jobId: 'job-1', eventType: EVENT_TYPES.MATERIAL_CHANGE, payload: { changed_fields: ['title'] } });
    expect(calls[0].sql).toMatch(/ON CONFLICT/);
    expect(calls[0].params).toContain('job-1');
  });
});

describe('job event outbox: worker', () => {
  test('material change notifies flagged bidders in keyset chunks and respects the hourly cap', async () => {
    process.env.JOB_EDIT_NOTIFY_MAX_PER_HOUR = '6';
    routeQueries(mockQuery, [
      [/FROM jobs WHERE id = \$1/, { rows: [JOB] }],
      [/FROM bids b\s+WHERE b.job_id/, (sql, params) => (params[1] ? { rows: [] } : {
        rows: [{ id: 'b1', helper_id: 'h1' }, { id: 'b2', helper_id: 'h2' }],
      })],
      [/FROM notifications/, { rows: [{ user_id: 'h2', n: 6 }] }],
    ]);
    await outbox.handleEvent({ id: 1, job_id: 'job-1', event_type: EVENT_TYPES.MATERIAL_CHANGE, payload: { changed_fields: ['budget_max_cents'] } });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0][0]).toMatchObject({
      userId: 'h1', type: 'job_updated_reconfirm', idempotencyKey: 'job-revision:job-1:2:h1',
    });
  });

  test('deleted jobs are skipped silently', async () => {
    routeQueries(mockQuery, [[/FROM jobs WHERE id = \$1/, { rows: [{ ...JOB, deleted_at: new Date() }] }]]);
    await outbox.handleEvent({ id: 1, job_id: 'job-1', event_type: EVENT_TYPES.MATERIAL_CHANGE, payload: {} });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test('failed delivery is retried with backoff, then marked failed after max attempts', async () => {
    const calls = routeQueries(mockQuery, [[/UPDATE job_event_outbox/, { rowCount: 1 }]]);
    expect(await outbox.finishJobEvent({ id: 1, attempts: 1, lease_token: 't' }, new Error('boom'))).toBe('pending');
    expect(calls[0].params[0]).toBe('pending');
    expect(await outbox.finishJobEvent({ id: 1, attempts: outbox.MAX_ATTEMPTS, lease_token: 't' }, new Error('boom'))).toBe('failed');
    expect(await outbox.finishJobEvent({ id: 1, attempts: 1, lease_token: 't' })).toBe('sent');
  });

  test('a lost lease reports stale instead of overwriting another worker', async () => {
    routeQueries(mockQuery, [[/UPDATE job_event_outbox/, { rowCount: 0 }]]);
    expect(await outbox.finishJobEvent({ id: 1, attempts: 1, lease_token: 'old' })).toBe('stale');
  });

  test('claim uses SKIP LOCKED and a lease token', async () => {
    const calls = routeQueries(mockQuery, [[/WITH candidates/, { rows: [] }]]);
    await outbox.claimJobEvents(50);
    expect(calls[0].sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(calls[0].params[0]).toBe(50);
  });
});

describe('job revision partitions', () => {
  test('partition names parse and retention has a 12-month floor', () => {
    expect(partitionMonth('job_revisions_2024_03').toISOString()).toBe('2024-03-01T00:00:00.000Z');
    expect(partitionMonth('job_revisions_default')).toBeNull();
    process.env.JOB_REVISION_RETENTION_MONTHS = '3';
    expect(retentionMonths()).toBe(36);
    process.env.JOB_REVISION_RETENTION_MONTHS = '24';
    expect(retentionMonths()).toBe(24);
    delete process.env.JOB_REVISION_RETENTION_MONTHS;
  });

  test('creates future partitions and drops only those past retention', async () => {
    const calls = routeQueries(mockQuery, [
      [/ensure_job_revision_partitions/, { rows: [{ created: 1 }] }],
      [/FROM pg_inherits/, { rows: [
        { relname: 'job_revisions_2022_01' }, { relname: 'job_revisions_2026_09' }, { relname: 'job_revisions_default' },
      ] }],
    ]);
    const result = await maintainJobRevisionPartitions(new Date('2026-10-12T00:00:00Z'));
    expect(result).toEqual({ created: 1, dropped: ['job_revisions_2022_01'] });
    expect(calls.some((c) => /DETACH PARTITION "job_revisions_2022_01"/.test(c.sql))).toBe(true);
    expect(calls.some((c) => /job_revisions_2026_09/.test(c.sql))).toBe(false);
  });
});

describe('approved change order money', () => {
  const agreement = { id: 'ag-1', job_id: 'job-1', helper_id: 'h1' };
  const co = (delta) => ({ id: 'co-1', price_change_cents: delta });
  function wire({ job, payment = null, hold = null }) {
    return routeQueries(mockQuery, [
      [/SELECT \* FROM jobs WHERE id = \$1 FOR UPDATE/, { rows: [job] }],
      [/FROM payments WHERE job_id/, { rows: payment ? [payment] : [] }],
      [/FROM oxsteed_credit_holds WHERE id = \$1 FOR UPDATE/, { rows: hold ? [hold] : [] }],
      [/UPDATE oxsteed_credit_reserve|UPDATE oxsteed_credit_/, { rows: [{ id: 1 }], rowCount: 1 }],
      [/SELECT version, revision FROM jobs/, { rows: [{ version: 7, revision: 2 }] }],
    ]);
  }

  test('decrease lowers the capture amount on an authorized card payment', async () => {
    const calls = wire({
      job: { ...JOB, job_value_cents: 20000, metadata: {} },
      payment: { id: 9, amount: '200.00', status: 'authorized', metadata: {} },
    });
    const { adjustment } = await applyApprovedChangeOrder({ query: mockQuery }, { agreement, changeOrder: co(-5000), actorId: 'cust-1' });
    expect(setFinancials).toHaveBeenCalledWith('job-1', 150, false, expect.anything());
    expect(adjustment).toMatchObject({ payment_action: 'capture_reduced', to_value_cents: 15000, capture_target_cents: 15000 });
    const pay = calls.find((c) => /UPDATE payments SET amount = \$2/.test(c.sql));
    expect(pay.params.slice(0, 3)).toEqual([9, 150, 15000]);
    expect(calls.some((c) => /INSERT INTO job_revisions/.test(c.sql))).toBe(true);
    expect(calls.some((c) => /INSERT INTO job_event_outbox/.test(c.sql))).toBe(true);
  });

  test('increase above the authorization is recorded for re-authorization, not over-captured', async () => {
    const calls = wire({
      job: { ...JOB, job_value_cents: 20000, metadata: {} },
      payment: { id: 9, amount: '200.00', status: 'authorized', metadata: {} },
    });
    const { adjustment } = await applyApprovedChangeOrder({ query: mockQuery }, { agreement, changeOrder: co(3000), actorId: 'cust-1' });
    expect(adjustment.payment_action).toBe('reauthorization_required');
    const pay = calls.find((c) => /pending_increase_cents = \$2/.test(c.sql));
    expect(pay.params.slice(0, 3)).toEqual([9, 3000, 20000]);
    expect(calls.some((c) => /paymentAdjustmentRequired/.test(JSON.stringify(c.params)))).toBe(true);
  });

  test('Credit collateral hold is replaced at the new price (fail-closed)', async () => {
    wire({
      job: { ...JOB, job_value_cents: 20000, metadata: { creditCollateralHoldId: 5 } },
      hold: { id: 5, status: 'active', amount_cents: 20000, customer_id: 'cust-1', partner_id: 3, reserve_id: 1 },
    });
    const { adjustment } = await applyApprovedChangeOrder({ query: mockQuery }, { agreement, changeOrder: co(1000), actorId: 'cust-1' });
    expect(spendWithCredit).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 21000, mode: 'hold', referenceType: 'job_escrow_collateral' }));
    expect(adjustment).toMatchObject({ credit_action: 'hold_replaced', credit_hold_id: 77 });
    spendWithCredit.mockRejectedValueOnce(new Error('insufficient credit'));
    wire({
      job: { ...JOB, job_value_cents: 20000, metadata: { creditCollateralHoldId: 5 } },
      hold: { id: 5, status: 'active', amount_cents: 20000, customer_id: 'cust-1', partner_id: 3, reserve_id: 1 },
    });
    await expect(applyApprovedChangeOrder({ query: mockQuery }, { agreement, changeOrder: co(1000), actorId: 'cust-1' })).rejects.toThrow('insufficient credit');
  });

  test('a change order cannot take the price to zero', async () => {
    wire({ job: { ...JOB, job_value_cents: 1000, metadata: {} } });
    await expect(applyApprovedChangeOrder({ query: mockQuery }, { agreement, changeOrder: co(-1000), actorId: 'cust-1' }))
      .rejects.toMatchObject({ status: 422 });
  });

  test('without an agreed price the change order is refused', async () => {
    wire({ job: { ...JOB, job_value_cents: null, job_value: null, metadata: {} } });
    await expect(applyApprovedChangeOrder({ query: mockQuery }, { agreement, changeOrder: co(500), actorId: 'cust-1' }))
      .rejects.toMatchObject({ code: 'change_order_no_agreed_price' });
  });
});
