'use strict';

const { mockQuery, resetMocks } = require('./setup');

// Webhook delivery now re-validates the target hostname at send time and
// fails closed when DNS cannot be resolved. Resolve the test webhook host
// to a public IP so delivery tests exercise the fetch path.
jest.mock('dns', () => {
  const actual = jest.requireActual('dns');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      lookup: jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
    },
  };
});

jest.mock('../services/paymentQueue', () => ({
  QUEUES: {
    PAYMENT_CAPTURE: 'queue:payment-capture',
    STRIPE_WEBHOOK: 'queue:stripe-webhook',
    NOTIFICATIONS: 'queue:notifications',
  },
  listDeadLetterJobs: jest.fn(),
  requeueDeadLetterJob: jest.fn(),
}));

jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn().mockResolvedValue({ persisted: true }),
}));

const paymentQueue = require('../services/paymentQueue');
const { logAdminAction } = require('../services/auditService');
const incidentStore = require('../services/incidentStore');
const controller = require('../controllers/opsActionsController');

function responseDouble() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

function reqDouble(overrides = {}) {
  return {
    params: {},
    query: {},
    body: {},
    user: { id: 'admin-uuid-1' },
    headers: {},
    ...overrides,
  };
}

const DELIVERY_ID = '11111111-1111-4111-8111-111111111111';
const WEBHOOK_ID = '22222222-2222-4222-8222-222222222222';
const DELIVERY_ROW = {
  id: DELIVERY_ID,
  webhook_id: WEBHOOK_ID,
  event_type: 'order.created',
  payload: { orderId: 7 },
  http_status_code: 500,
  response_body: 'upstream error',
  attempt_number: 2,
  error_message: null,
  next_retry_at: '2026-09-29T21:00:00.000Z',
  completed_at: null,
};
const WEBHOOK_ROW = {
  id: WEBHOOK_ID,
  webhook_url: 'https://hooks.example.test/deliver',
  custom_headers: { 'X-Custom': 'yes' },
  timeout_seconds: 10,
  is_active: true,
};

const originalFetch = global.fetch;

beforeEach(() => {
  resetMocks();
  paymentQueue.listDeadLetterJobs.mockReset();
  paymentQueue.requeueDeadLetterJob.mockReset();
  logAdminAction.mockClear();
  incidentStore.recordIncident.mockClear();
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('listDeadLetter', () => {
  test('rejects an unknown queue key with 400', async () => {
    const res = responseDouble();
    await controller.listDeadLetter(reqDouble({ query: { queue: 'queue:nope' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(paymentQueue.listDeadLetterJobs).not.toHaveBeenCalled();
  });

  test('lists jobs for a known queue key', async () => {
    const jobs = [{ id: 'job-1', status: 'dead-lettered' }];
    paymentQueue.listDeadLetterJobs.mockResolvedValue(jobs);
    const res = responseDouble();
    await controller.listDeadLetter(
      reqDouble({ query: { queue: 'queue:notifications', limit: '10' } }),
      res
    );
    expect(paymentQueue.listDeadLetterJobs).toHaveBeenCalledWith('queue:notifications', '10');
    expect(res.json).toHaveBeenCalledWith({ queue: 'queue:notifications', jobs });
  });
});

describe('requeueDeadLetter', () => {
  test('rejects an unknown queue key with 400', async () => {
    const res = responseDouble();
    await controller.requeueDeadLetter(
      reqDouble({ params: { jobId: 'job-1' }, body: { queue: 'queue:nope' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(paymentQueue.requeueDeadLetterJob).not.toHaveBeenCalled();
  });

  test('returns 404 when the dead-lettered job is missing', async () => {
    paymentQueue.requeueDeadLetterJob.mockResolvedValue(null);
    const res = responseDouble();
    await controller.requeueDeadLetter(
      reqDouble({ params: { jobId: 'missing' }, body: { queue: 'queue:stripe-webhook' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  test('requeue success writes an audit row', async () => {
    const recovered = { id: 'job-1', status: 'pending', attempts: 0 };
    paymentQueue.requeueDeadLetterJob.mockResolvedValue(recovered);
    const res = responseDouble();
    await controller.requeueDeadLetter(
      reqDouble({ params: { jobId: 'job-1' }, body: { queue: 'queue:payment-capture' } }),
      res
    );
    expect(paymentQueue.requeueDeadLetterJob).toHaveBeenCalledWith('queue:payment-capture', 'job-1');
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin-uuid-1',
        action: 'ops_dead_letter_requeued',
        targetType: 'queue_job',
        targetId: 'job-1',
      })
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, job: recovered });
  });
});

describe('retryWebhookDelivery', () => {
  const joinRow = (overrides = {}) => ({ ...DELIVERY_ROW, ...WEBHOOK_ROW, ...overrides });

  test('rejects a non-UUID delivery id with 400', async () => {
    const res = responseDouble();
    await controller.retryWebhookDelivery(reqDouble({ params: { deliveryId: 'not-a-uuid' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('returns 404 when the delivery row is missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = responseDouble();
    await controller.retryWebhookDelivery(reqDouble({ params: { deliveryId: DELIVERY_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 409 when the delivery already completed', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [joinRow({ completed_at: '2026-09-29T20:00:00.000Z' })],
    });
    const res = responseDouble();
    await controller.retryWebhookDelivery(reqDouble({ params: { deliveryId: DELIVERY_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('retry success posts to the webhook URL with merged headers and audits', async () => {
    const updatedRow = { ...DELIVERY_ROW, attempt_number: 3, completed_at: '2026-09-29T22:00:00.000Z' };
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM webhook_delivery_log d')) return { rows: [joinRow()] };
      if (text.includes('UPDATE webhook_delivery_log')) return { rows: [updatedRow] };
      return { rows: [] };
    });
    global.fetch.mockResolvedValue({ status: 200, text: async () => 'accepted' });

    const res = responseDouble();
    await controller.retryWebhookDelivery(reqDouble({ params: { deliveryId: DELIVERY_ID } }), res);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://hooks.example.test/deliver');
    expect(options.method).toBe('POST');
    expect(options.body).toBe(JSON.stringify(DELIVERY_ROW.payload));
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-OxSteed-Event': 'order.created',
      'X-Custom': 'yes',
    });
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin-uuid-1',
        action: 'ops_webhook_delivery_retried',
        targetType: 'webhook_delivery',
        targetId: DELIVERY_ID,
      })
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, delivery: updatedRow });
  });
});

describe('attemptWebhookRedelivery backoff math', () => {
  test('caps the backoff at 24 hours for very high attempt counts', async () => {
    let capturedParams = null;
    mockQuery.mockImplementation(async (sql, params) => {
      capturedParams = params;
      return { rows: [{ ...DELIVERY_ROW, attempt_number: 101 }] };
    });
    global.fetch.mockResolvedValue({ status: 500, text: async () => 'still failing' });

    const updated = await controller.attemptWebhookRedelivery(
      { ...DELIVERY_ROW, attempt_number: 100 },
      WEBHOOK_ROW
    );

    expect(updated.attempt_number).toBe(101);
    // 5th param is the backoff in seconds: 24h * 3600
    expect(capturedParams[5]).toBe(24 * 60 * 60);
  });

  test('uses exponential backoff below the cap', async () => {
    let capturedParams = null;
    mockQuery.mockImplementation(async (sql, params) => {
      capturedParams = params;
      return { rows: [{ ...DELIVERY_ROW, attempt_number: 3 }] };
    });
    global.fetch.mockResolvedValue({ status: 500, text: async () => 'still failing' });

    const updated = await controller.attemptWebhookRedelivery(DELIVERY_ROW, WEBHOOK_ROW);

    expect(updated.attempt_number).toBe(3);
    // 2^3 minutes = 8 minutes = 480 seconds
    expect(capturedParams[5]).toBe(480);
  });
});

describe('runWebhookRetryWorker', () => {
  const worker = require('../jobs/webhookRetryWorker');

  function installPoolDispatch({ dueRows, webhookRow, helperUpdatedRow }) {
    mockQuery.mockImplementation(async (sql, params) => {
      const text = String(sql);
      if (text.includes('INSERT INTO cron_job_locks')) {
        return { rows: [{ lock_id: 'job_lock:webhook-retry' }] };
      }
      if (text.includes('FROM webhook_delivery_log d')) return { rows: dueRows };
      if (text.includes('FROM business_webhooks')) return { rows: webhookRow ? [webhookRow] : [] };
      if (text.includes("retry budget exhausted")) return { rows: [] };
      if (text.includes('UPDATE webhook_delivery_log')) return { rows: [helperUpdatedRow] };
      return { rows: [] };
    });
  }

  test('delivers due rows and leaves the lock flow alone', async () => {
    const updatedRow = { ...DELIVERY_ROW, completed_at: '2026-09-29T22:01:00.000Z' };
    installPoolDispatch({ dueRows: [DELIVERY_ROW], webhookRow: WEBHOOK_ROW, helperUpdatedRow: updatedRow });
    global.fetch.mockResolvedValue({ status: 200, text: async () => 'ok' });

    const result = await worker.runWebhookRetryWorker();

    expect(result.locked).toBe(true);
    expect(result.inspected).toBe(1);
    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(0);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://hooks.example.test/deliver',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('marks permanent failure at the attempt cap and records an incident', async () => {
    const dueRow = { ...DELIVERY_ROW, attempt_number: 7 };
    const failedRow = { ...dueRow, attempt_number: 8, completed_at: null };
    installPoolDispatch({ dueRows: [dueRow], webhookRow: WEBHOOK_ROW, helperUpdatedRow: failedRow });
    global.fetch.mockResolvedValue({ status: 502, text: async () => 'bad gateway' });

    const result = await worker.runWebhookRetryWorker();

    expect(result.failed).toBe(1);
    expect(result.exhausted).toBe(1);
    const exhaustionCalls = mockQuery.mock.calls.filter((call) =>
      String(call[0]).includes('retry budget exhausted')
    );
    expect(exhaustionCalls).toHaveLength(1);
    expect(exhaustionCalls[0][1]).toEqual([dueRow.id]);
    expect(incidentStore.recordIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'webhook_delivery_failed',
        severity: 'warning',
        details: { deliveryId: dueRow.id },
      })
    );
  });

  test('skips deliveries whose parent webhook row is gone', async () => {
    installPoolDispatch({ dueRows: [DELIVERY_ROW], webhookRow: null, helperUpdatedRow: DELIVERY_ROW });
    global.fetch.mockResolvedValue({ status: 200, text: async () => 'ok' });

    const result = await worker.runWebhookRetryWorker();

    expect(result.inspected).toBe(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('routes/opsActions', () => {
  test('exposes the three ops routes', () => {
    const router = require('../routes/opsActions');
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        'GET /queues/dead-letter',
        'POST /queues/dead-letter/:jobId/requeue',
        'POST /webhooks/:deliveryId/retry',
      ])
    );
  });
});
