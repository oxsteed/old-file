'use strict';

const fs = require('fs');
const path = require('path');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/bookingSlotEngine', () => ({ computeSlots: jest.fn() }));
jest.mock('../utils/storage', () => ({
  uploadFile: jest.fn(),
  getSignedDownloadUrl: jest.fn(),
}));

const policiesCtrl = require('../controllers/helperCancellationPoliciesController');
const mainAppContracts = require('../models/mainAppContractsModel');
const mainAppCtrl = require('../controllers/mainAppController');

function mockResponse() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const USER_A = '00000000-0000-4000-8000-000000000111';
const USER_B = '00000000-0000-4000-8000-000000000222';

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('custom off-platform payment_details validation', () => {
  const sanitize = policiesCtrl.sanitizePaymentDetails;

  test('accepts a valid array, trims values, and drops unknown fields', () => {
    expect(
      sanitize([
        {
          label: '  Mobile money  ',
          handle: ' +123456 ',
          link_url: 'https://pay.example.com/u123',
          instructions: ' Send the receipt after paying ',
          provider: 'ignored-brand',
        },
        { label: 'Bank transfer' },
      ])
    ).toEqual([
      {
        label: 'Mobile money',
        handle: '+123456',
        link_url: 'https://pay.example.com/u123',
        instructions: 'Send the receipt after paying',
      },
      { label: 'Bank transfer' },
    ]);
  });

  test('treats undefined as absent and null as cleared', () => {
    expect(sanitize(undefined)).toBeUndefined();
    expect(sanitize(null)).toEqual([]);
  });

  test('rejects a non-array value', () => {
    expect(() => sanitize('https://pay.example.com')).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  test('rejects more than 5 entries', () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({ label: `Method ${i + 1}` }));
    expect(() => sanitize(entries)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  test('rejects a missing label', () => {
    expect(() => sanitize([{ handle: 'abc' }])).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => sanitize([{ label: '   ' }])).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  test('rejects a label longer than 60 characters', () => {
    expect(() => sanitize([{ label: 'x'.repeat(61) }])).toThrow(
      expect.objectContaining({ statusCode: 400 })
    );
  });

  test('rejects an invalid link_url but accepts http and https', () => {
    expect(() => sanitize([{ label: 'Pay', link_url: 'not-a-url' }])).toThrow(
      expect.objectContaining({ statusCode: 400 })
    );
    expect(() => sanitize([{ label: 'Pay', link_url: 'ftp://files.example.com/x' }])).toThrow(
      expect.objectContaining({ statusCode: 400 })
    );
    expect(() => sanitize([{ label: 'Pay', link_url: 'x'.repeat(494) + '.com' }])).toThrow(
      expect.objectContaining({ statusCode: 400 })
    );
    expect(sanitize([{ label: 'Pay', link_url: 'http://pay.example.com/x' }])).toEqual([
      { label: 'Pay', link_url: 'http://pay.example.com/x' },
    ]);
  });

  test('rejects handle and instructions over their limits', () => {
    expect(() => sanitize([{ label: 'Pay', handle: 'x'.repeat(101) }])).toThrow(
      expect.objectContaining({ statusCode: 400 })
    );
    expect(() => sanitize([{ label: 'Pay', instructions: 'x'.repeat(501) }])).toThrow(
      expect.objectContaining({ statusCode: 400 })
    );
  });

  test('updatePolicies surfaces a 400 AppError for invalid payment_details', async () => {
    const req = {
      user: { id: USER_A },
      body: {
        custom_enabled: true,
        custom_policy: { payment_details: [{ label: '' }] },
      },
    };
    const next = jest.fn();
    await policiesCtrl.updatePolicies(req, mockResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('updatePolicies stores sanitized payment_details', async () => {
    const storedPolicy = {
      id: 7,
      helper_id: USER_A,
      oxsteed_enabled: true,
      custom_enabled: true,
      custom_policy: {},
      updated_at: new Date('2026-09-28T12:00:00Z'),
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT previous: no row yet
      .mockResolvedValueOnce({ rows: [] }) // UPDATE: no row to update
      .mockResolvedValueOnce({ rows: [storedPolicy] }); // INSERT policy
    const req = {
      user: { id: USER_A },
      body: {
        custom_enabled: true,
        custom_policy: {
          payment_details: [{ label: '  Mobile money ', extra: 'dropped' }],
        },
      },
    };
    const res = mockResponse();
    const next = jest.fn();
    await policiesCtrl.updatePolicies(req, res, next);
    expect(next).not.toHaveBeenCalled();
    const insertParams = mockQuery.mock.calls[2][1];
    expect(insertParams[3].payment_details).toEqual([{ label: 'Mobile money' }]);
    // A history entry records the newly added payment method
    const historyParams = mockQuery.mock.calls[3][1];
    expect(historyParams[0]).toBe(USER_A);
    expect(JSON.parse(historyParams[1])).toEqual([
      { kind: 'payment_method_added', label: 'Mobile money' },
      { kind: 'custom_enabled' },
    ]);
  });
});

describe('off-platform payment request audit events', () => {
  const baseRequestRow = {
    id: 501,
    source_type: 'service_booking',
    source_id: 'booking-1',
    payer_id: USER_A,
    payee_id: USER_B,
    business_id: null,
    amount_cents: 9900,
    currency_code: 'USD',
    status: 'requested',
    settlement_mode: 'external_pending',
    external_provider: null,
    processor_payment_id: null,
    description: null,
    idempotency_key: null,
    expires_at: null,
    metadata: {},
    created_at: new Date('2026-09-28T12:00:00Z'),
    updated_at: new Date('2026-09-28T12:00:00Z'),
  };

  test('creating a payment request writes a created event with the acting user', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...baseRequestRow, was_inserted: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 10 }] });
    const row = await mainAppContracts.createPaymentRequest({
      requesterId: USER_B,
      payerId: USER_A,
      payeeId: USER_B,
      amountCents: 9900,
      currencyCode: 'usd',
      settlementMode: 'external_pending',
    });
    expect(row.id).toBe(501);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [eventSql, eventParams] = mockQuery.mock.calls[1];
    expect(eventSql).toMatch(/INSERT INTO main_app_payment_request_events/);
    expect(eventParams[0]).toBe(501);
    expect(eventParams[1]).toBe(USER_B);
    expect(eventParams[2]).toBe('created');
    expect(JSON.parse(eventParams[3])).toEqual({
      amount_cents: 9900,
      currency_code: 'USD',
      settlement_mode: 'external_pending',
      external_provider: null,
    });
  });

  test('an idempotent replay does not write a second created event', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...baseRequestRow, was_inserted: false }] });
    await mainAppContracts.createPaymentRequest({
      requesterId: USER_B,
      payerId: USER_A,
      payeeId: USER_B,
      amountCents: 9900,
      idempotencyKey: 'idem-1',
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/INSERT INTO main_app_payment_requests/);
  });

  test('submitting proof writes a proof_submitted event', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...baseRequestRow }] })
      .mockResolvedValueOnce({ rows: [{ id: 11 }] });
    const row = await mainAppContracts.submitPaymentProof({
      requestId: 501,
      userId: USER_A,
      proofLink: 'https://example.com/receipt.png',
    });
    expect(row.id).toBe(501);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [eventSql, eventParams] = mockQuery.mock.calls[1];
    expect(eventSql).toMatch(/INSERT INTO main_app_payment_request_events/);
    expect(eventParams.slice(0, 3)).toEqual([501, USER_A, 'proof_submitted']);
  });

  test('submitting proof for an ineligible request writes no event', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const row = await mainAppContracts.submitPaymentProof({ requestId: 501, userId: USER_A });
    expect(row).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('confirming writes a confirmed event', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...baseRequestRow, status: 'confirmed' }] })
      .mockResolvedValueOnce({ rows: [{ id: 12 }] });
    const row = await mainAppContracts.confirmPaymentRequest({
      requestId: 501,
      userId: USER_B,
      note: 'Received',
    });
    expect(row.id).toBe(501);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [eventSql, eventParams] = mockQuery.mock.calls[1];
    expect(eventSql).toMatch(/INSERT INTO main_app_payment_request_events/);
    expect(eventParams.slice(0, 3)).toEqual([501, USER_B, 'confirmed']);
  });

  test('logPaymentRequestEvent rejects unknown event types', async () => {
    await expect(
      mainAppContracts.logPaymentRequestEvent({ paymentRequestId: 501, eventType: 'hacked' })
    ).rejects.toThrow(/Unsupported payment request event type/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('getPaymentRequestEvents returns display names without emails, oldest first', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          event_type: 'created',
          details: { amount_cents: 9900 },
          created_at: new Date('2026-09-28T12:00:00Z'),
          actor_user_id: USER_B,
          first_name: 'Emile',
          last_name: 'Lubin',
        },
        {
          id: 2,
          event_type: 'confirmed',
          details: {},
          created_at: new Date('2026-09-28T12:05:00Z'),
          actor_user_id: null,
          first_name: null,
          last_name: null,
        },
      ],
    });
    const events = await mainAppContracts.getPaymentRequestEvents(501);
    expect(mockQuery.mock.calls[0][0]).toMatch(/ORDER BY e\.created_at ASC/);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      id: '1',
      eventType: 'created',
      details: { amount_cents: 9900 },
      createdAt: '2026-09-28T12:00:00.000Z',
      actorUserId: USER_B,
      actorName: 'Emile L.',
    });
    expect(events[0]).not.toHaveProperty('email');
    expect(events[1].actorName).toBeNull();
    expect(events[1].actorUserId).toBeNull();
  });

  test('the event log is only ever inserted into, never updated or deleted', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 20 }] })
      .mockResolvedValueOnce({ rows: [] });
    await mainAppContracts.logPaymentRequestEvent({
      paymentRequestId: 501,
      actorUserId: USER_A,
      eventType: 'note_added',
      details: { note: 'Called the helper' },
    });
    await mainAppContracts.getPaymentRequestEvents(501);
    const statements = mockQuery.mock.calls.map((call) => call[0]);
    expect(statements.some((sql) => /INSERT INTO main_app_payment_request_events/.test(sql))).toBe(true);
    expect(
      statements.some((sql) => /UPDATE main_app_payment_request_events|DELETE FROM main_app_payment_request_events/.test(sql))
    ).toBe(false);
  });
});

describe('migration 578 immutability rules', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../migrations/578_off_platform_payment_audit.sql'),
    'utf8'
  );

  test('creates the events table with the full event type set', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS main_app_payment_request_events/);
    for (const type of ['created', 'proof_submitted', 'confirmed', 'cancelled', 'expired', 'note_added', 'viewed']) {
      expect(sql).toContain(`'${type}'`);
    }
  });

  test('installs DO INSTEAD NOTHING rules for UPDATE and DELETE', () => {
    expect(sql).toMatch(/CREATE RULE payment_request_events_no_update AS ON UPDATE TO main_app_payment_request_events/);
    expect(sql).toMatch(/CREATE RULE payment_request_events_no_delete AS ON DELETE TO main_app_payment_request_events/);
    expect(sql.match(/DO INSTEAD NOTHING/g)).toHaveLength(2);
  });
});

describe('getPaymentRequest detail endpoint', () => {
  const baseRow = {
    id: 501,
    requester_id: USER_B,
    source_type: 'service_booking',
    source_id: 'booking-1',
    payer_id: USER_A,
    payee_id: USER_B,
    business_id: null,
    amount_cents: 9900,
    currency_code: 'USD',
    status: 'requested',
    settlement_mode: 'external_pending',
    external_provider: null,
    processor_payment_id: null,
    description: 'Yard work',
    idempotency_key: null,
    expires_at: null,
    metadata: {},
    created_at: new Date('2026-09-28T12:00:00Z'),
    updated_at: new Date('2026-09-28T12:00:00Z'),
  };

  test('a participant can view the request with its audit events', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [baseRow] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            event_type: 'created',
            details: { amount_cents: 9900 },
            created_at: new Date('2026-09-28T12:00:00Z'),
            actor_user_id: USER_B,
            first_name: 'Emile',
            last_name: 'Lubin',
          },
        ],
      });
    const req = { params: { requestId: '501' }, user: { id: USER_A } };
    const res = mockResponse();
    const next = jest.fn();
    await mainAppCtrl.getPaymentRequest(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentRequest: expect.objectContaining({ id: '501', status: 'requested' }),
        events: [
          expect.objectContaining({ eventType: 'created', actorName: 'Emile L.' }),
        ],
      })
    );
  });

  test('a non-participant gets 403 and no events are loaded', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...baseRow, requester_id: USER_A, payer_id: USER_A, payee_id: USER_B }],
    });
    const req = { params: { requestId: '501' }, user: { id: 'ffffffff-ffff-4000-8000-000000000000' } };
    const res = mockResponse();
    const next = jest.fn();
    await mainAppCtrl.getPaymentRequest(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  test('an unknown request returns 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = { params: { requestId: '999' }, user: { id: USER_A } };
    const res = mockResponse();
    await mainAppCtrl.getPaymentRequest(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('an invalid request id returns 400', async () => {
    const req = { params: { requestId: 'abc' }, user: { id: USER_A } };
    const res = mockResponse();
    await mainAppCtrl.getPaymentRequest(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
