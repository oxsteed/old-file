'use strict';

// Review W5 regression tests: P1-297, P1-344/P2-573/P3-869/P3-872,
// P3-785, P3-790/P3-871, P3-791, P3-842, P3-843, P3-844, P3-845, P3-914, P3-915.
// Some tests reset the module registry, so always look up the live mocks.
require('./setup');
const live = () => require('./setup');
let mockQuery;
let stripeMock;

beforeEach(() => {
  live().resetMocks();
  mockQuery = live().mockQuery;
  stripeMock = require('stripe').__mockInstance;
  delete process.env.DEDICATED_WORKER_PROCESS;
  delete process.env.PAYMENT_CAPTURE_ASYNC;
  delete process.env.STORAGE_CLEANUP_ENABLED;
});

describe('worker topology', () => {
  test('scheduled workers include the previously unwired jobs, once each', () => {
    const { SCHEDULED_WORKERS } = require('../workers/scheduledWorkerSchedule');
    const names = SCHEDULED_WORKERS.map(([n]) => n);
    for (const name of ['publishDueGuideVideos', 'renewSubscriptionCredit', 'clearStaleAvailableNow', 'refreshEtas', 'storageDeletionQueue', 'emailDigestDaily', 'emailDigestWeekly', 'cleanupExpiredPasskeyChallenges']) {
      expect(names).toContain(name);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  test('each scheduled run takes a fenced lock and reports failures', async () => {
    jest.resetModules();
    const lock = jest.fn(async (_name, fn) => fn({ assertActive() {} }));
    jest.doMock('../jobs/jobLockingService', () => ({ withFencedJobLock: lock }));
    const { runScheduledWorkerOnce } = require('../workers/scheduledWorkerSchedule');
    const log = { info: jest.fn(), error: jest.fn() };
    await runScheduledWorkerOnce(['demo', async () => { throw new Error('boom'); }, 60000, {}], { log });
    expect(lock).toHaveBeenCalledWith('scheduled-worker:demo', expect.any(Function), 60);
    expect(log.error).toHaveBeenCalledWith('Scheduled worker failed', expect.objectContaining({ worker: 'demo' }));
    jest.dontMock('../jobs/jobLockingService');
  });

  test('the API starts the scheduled workers unless a dedicated worker is declared', () => {
    jest.resetModules();
    const start = jest.fn(() => ({ stop: jest.fn() }));
    jest.doMock('../workers/scheduledWorkerSchedule', () => ({ startScheduledWorkers: start }));
    const { BackgroundWorkers } = require('../bootstrap/backgroundWorkers');
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const a = new BackgroundWorkers({ log }).start();
    expect(start).toHaveBeenCalledTimes(1);
    a.stop();
    process.env.DEDICATED_WORKER_PROCESS = 'true';
    const b = new BackgroundWorkers({ log }).start();
    expect(start).toHaveBeenCalledTimes(1);
    b.stop();
    jest.dontMock('../workers/scheduledWorkerSchedule');
  });
});

describe('P3-842 Checkr webhook', () => {
  test('a completed report notifies through the notification service', async () => {
    jest.resetModules();
    const sendNotification = jest.fn().mockResolvedValue({ success: true });
    jest.doMock('../services/notificationService', () => ({ sendNotification }));
    const { mockQuery: q } = require('./setup');
    const crypto = require('crypto');
    const controller = require('../controllers/verificationController');
    process.env.CHECKR_WEBHOOK_SECRET = 'checkr-secret';
    const body = Buffer.from(JSON.stringify({ id: 'evt-checkr-1', created_at: new Date().toISOString(), type: 'report.completed', data: { object: { id: 'rep-1', candidate_id: 'cand-1', adjudication: 'clear' } } }));
    const sig = crypto.createHmac('sha256', 'checkr-secret').update(body).digest('hex');
    q.mockImplementation(async (sql) => (/RETURNING user_id/.test(sql) ? { rows: [{ user_id: 'u-1' }] } : { rows: [{ preferred_language: 'en' }] }));
    const res = { json: jest.fn() };
    const next = jest.fn();
    await controller.checkrWebhook({ headers: { 'x-checkr-signature': sig }, body }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-1', type: 'background_check_passed', idempotencyKey: 'checkr-report:rep-1' }));
    jest.dontMock('../services/notificationService');
  });

  test('rejects stale Checkr envelopes before touching report state', async () => {
    jest.resetModules();
    const controller = require('../controllers/verificationController');
    process.env.CHECKR_WEBHOOK_SECRET = 'checkr-secret';
    const crypto = require('crypto');
    const body = Buffer.from(JSON.stringify({ id: 'evt-stale', created_at: new Date(Date.now() - 2 * 86400000).toISOString(), type: 'report.completed', data: { object: { id: 'rep-stale' } } }));
    const sig = crypto.createHmac('sha256', 'checkr-secret').update(body).digest('hex');
    const next = jest.fn();
    await controller.checkrWebhook({ headers: { 'x-checkr-signature': sig }, body }, { json: jest.fn() }, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'stale_webhook', status: 400 }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

});

describe('email delivery', () => {
  test('P3-845: money failures are emailed as transactional', () => {
    const { isMoneyCriticalEmailType } = require('../services/notificationService');
    expect(isMoneyCriticalEmailType('payment_failed')).toBe(true);
    expect(isMoneyCriticalEmailType('oxsteed_credit_withdrawal_failed')).toBe(true);
    expect(isMoneyCriticalEmailType('oxsteed_credit_reconciliation_failed')).toBe(true);
    expect(isMoneyCriticalEmailType('bid_accepted')).toBe(false);
  });

  test('P3-844: sendEmailOrThrow throws when delivery is not confirmed', async () => {
    const { sendEmailOrThrow } = jest.requireActual('../utils/email');
    await expect(sendEmailOrThrow({ to: 'a@example.com', subject: 'x', text: 'y' })).rejects.toMatchObject({ name: 'EmailDeliveryError' });
  });

  test('P3-843: without SMTP, emailService routes through Resend and throws on failure', async () => {
    jest.resetModules();
    const sendEmail = jest.fn().mockResolvedValueOnce({ success: true, id: 'em_1' }).mockResolvedValueOnce({ success: false, error: 'rejected' });
    const actual = jest.requireActual('../utils/email');
    jest.doMock('../utils/email', () => ({ ...actual, sendEmail }));
    delete process.env.SMTP_HOST;
    const emailService = require('../services/emailService');
    await expect(emailService.send({ to: 'a@example.com', subject: 'Hi', html: '<p>Hello</p>' })).resolves.toMatchObject({ provider: 'resend', messageId: 'em_1' });
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: 'a@example.com', text: 'Hello' });
    await expect(emailService.send({ to: 'a@example.com', subject: 'Hi', html: '<p>x</p>' })).rejects.toThrow('rejected');
    jest.dontMock('../utils/email');
  });
});

describe('P3-791 escrow completion', () => {
  test('reconciles a missed authorization from Stripe', async () => {
    const { reconcileJobAuthorizationFromStripe } = require('../services/paymentCaptureService');
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'p-1', amount: 50, stripe_payment_intent_id: 'pi_1', stripe_account_id: 'acct_1', status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'p-1', amount: 50, stripe_payment_intent_id: 'pi_1', stripe_account_id: 'acct_1', status: 'authorized' }] }) };
    stripeMock.paymentIntents.retrieve.mockResolvedValueOnce({ id: 'pi_1', status: 'requires_capture' });
    await expect(reconcileJobAuthorizationFromStripe(client, 7)).resolves.toMatchObject({ status: 'authorized' });
    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledWith('pi_1', { stripeAccount: 'acct_1' });
  });

  test('returns null when Stripe has no capturable authorization', async () => {
    const { reconcileJobAuthorizationFromStripe } = require('../services/paymentCaptureService');
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'p-2', stripe_payment_intent_id: 'pi_2', stripe_account_id: 'acct_1', status: 'pending' }] }) };
    stripeMock.paymentIntents.retrieve.mockResolvedValueOnce({ id: 'pi_2', status: 'requires_payment_method' });
    await expect(reconcileJobAuthorizationFromStripe(client, 8)).resolves.toBeNull();
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});

describe('P1-297 connected-account QR checkout', () => {
  test('the Connect contract accepts checkout events', () => {
    const contract = require('../config/stripeWebhookContract');
    expect(contract.connect.events).toEqual(expect.arrayContaining(['checkout.session.completed', 'checkout.session.expired']));
  });

  test('QR sessions are marked succeeded or expired; others are ignored', async () => {
    const { handleConnectedCheckoutEvent } = require('../controllers/webhookController');
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const qr = { id: 'cs_1', payment_status: 'paid', amount_total: 500, metadata: { qr_payment: 'true' } };
    await expect(handleConnectedCheckoutEvent({ type: 'checkout.session.completed', data: { object: qr } })).resolves.toBe('succeeded');
    expect(mockQuery.mock.calls[0][0]).toContain("SET status = 'succeeded'");
    await expect(handleConnectedCheckoutEvent({ type: 'checkout.session.expired', data: { object: qr } })).resolves.toBe('expired');
    expect(mockQuery.mock.calls[1][1]).toEqual(['cs_1', 'expired']);
    await expect(handleConnectedCheckoutEvent({ type: 'checkout.session.completed', data: { object: { id: 'cs_2', metadata: {} } } })).resolves.toBe('ignored');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe('P3-785 affiliate payouts move money', () => {
  let PayoutController;
  beforeEach(() => { PayoutController = require('../controllers/PayoutController'); });
  test('a verified Stripe payout method gets a Connect transfer', async () => {
    stripeMock.transfers = { create: jest.fn().mockResolvedValue({ id: 'tr_1' }) };
    const t = await PayoutController._sendAffiliatePayoutTransfer({ id: 9, stripe_account_id: 'acct_9', payout_method_status: 'verified', net_payout_cents: 1234 }, 'stripe');
    expect(t.id).toBe('tr_1');
    expect(stripeMock.transfers.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 1234, destination: 'acct_9' }), { idempotencyKey: 'affiliate-payout:9' });
  });
  test.each([
    [{ id: 1, stripe_account_id: 'acct', payout_method_status: 'pending', net_payout_cents: 10 }, 'stripe', 409],
    [{ id: 1, stripe_account_id: null, payout_method_status: 'verified', net_payout_cents: 10 }, 'stripe', 422],
    [{ id: 1, stripe_account_id: 'acct', payout_method_status: 'verified', net_payout_cents: 10 }, 'paypal', 422],
    [{ id: 1, stripe_account_id: 'acct', payout_method_status: 'verified', net_payout_cents: 0 }, 'stripe', 422],
  ])('refuses unsafe payouts %#', async (payout, processor, status) => {
    await expect(PayoutController._sendAffiliatePayoutTransfer(payout, processor)).rejects.toMatchObject({ payoutStatus: status });
  });
});

describe('P3-914 storage deletion queue', () => {
  test('replaced files are queued by key and not deleted while cleanup is off', async () => {
    const svc = require('../services/storageCleanupService');
    await expect(svc.enqueueStorageDeletion('business-covers/a.jpg', 'business_cover_replaced')).resolves.toBe(true);
    expect(mockQuery.mock.calls[0][1].slice(0, 2)).toEqual(['business-covers/a.jpg', 'business_cover_replaced']);
    await expect(svc.processStorageDeletionQueue()).resolves.toMatchObject({ skipped: true });
    await expect(svc.enqueueStorageDeletion('data:image/png;base64,xx', 'x')).resolves.toBe(false);
  });

  test('due rows are deleted unless still referenced', async () => {
    process.env.STORAGE_CLEANUP_ENABLED = 'true';
    jest.resetModules();
    const deleteFile = jest.fn().mockResolvedValue();
    const actual = jest.requireActual('../utils/storage');
    jest.doMock('../utils/storage', () => ({ ...actual, deleteFile }));
    const { mockQuery: q } = require('./setup');
    q.mockImplementation(async (sql, params) => {
      if (/FROM storage_deletion_queue/.test(sql) && /SELECT/.test(sql)) return { rows: [{ id: 1, storage_key: 'k/old.jpg' }, { id: 2, storage_key: 'k/kept.jpg' }] };
      if (/LIKE/.test(sql)) return { rows: params[0] === 'k/kept.jpg' ? [{ 1: 1 }] : [] };
      return { rows: [], rowCount: 1 };
    });
    const svc = require('../services/storageCleanupService');
    await expect(svc.processStorageDeletionQueue()).resolves.toMatchObject({ deleted: 1, kept: 1, failed: 0 });
    expect(deleteFile).toHaveBeenCalledWith('k/old.jpg');
    expect(deleteFile).not.toHaveBeenCalledWith('k/kept.jpg');
    jest.dontMock('../utils/storage');
  });
});

describe('P3-915 delivery proof uploads without ClamAV', () => {
  test('the guard no longer requires ClamAV unless policy demands a malware scan', async () => {
    jest.resetModules();
    jest.doMock('../services/fileScanService', () => ({ isConfigured: () => false, malwareScanRequired: () => false }));
    const { mockQuery: q } = require('./setup');
    q.mockResolvedValueOnce({ rows: [{ id: 'job-1' }] });
    const ctrl = require('../controllers/localDeliveryProofController');
    const next = jest.fn();
    await ctrl.uploadGuard({ params: { id: 'job-1' }, user: { id: 'u' } }, {}, next);
    expect(next).toHaveBeenCalledWith();
    jest.dontMock('../services/fileScanService');
  });
});
