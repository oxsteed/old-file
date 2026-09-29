'use strict';

// Focused regression tests for the OxSteed Direct audit fixes applied to
// server/controllers/quoteRequestsController.js:
//  - #3  public creation ignores caller-supplied money/status/timestamps and
//        rejects negative integers
//  - #16 admin payment_status is validated against the CHECK constraint list
//  - #26 admin status/amount transition guards (paid->unpaid, cancelled->paid,
//        amount change after confirmed)
//  - #27 public creation idempotency via client_request_id
//  - #53 public creation caps metadata.photoAttachments at 10

const { mockQuery, resetMocks } = require('./setup');
const { createQuoteRequest, updateQuoteRequestAdmin } = require('../controllers/quoteRequestsController');

const validBody = {
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'ada@example.com',
  service_category: 'Electrical',
  service_location: '123 Main Street',
  service_zip_code: '45502',
  details: 'Please provide a quote for this service.',
};

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function insertedRequest() {
  return {
    id: 'request-1',
    public_reference: 'DQ-REQUEST1',
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@example.com',
    service_category: 'Electrical',
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('public createQuoteRequest audit guards', () => {
  test('ignores caller-supplied money, payment status, and lifecycle timestamps', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [insertedRequest()] }) // INSERT
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const res = response();
    await createQuoteRequest({
      body: {
        ...validBody,
        quote_amount_cents: 50000,
        payment_status: 'paid',
        proof_received_at: '2026-01-01T00:00:00.000Z',
        accepted_at: '2026-01-02T00:00:00.000Z',
        completed_at: '2026-01-03T00:00:00.000Z',
        closed_at: '2026-01-04T00:00:00.000Z',
      },
      user: null,
    }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const insertCall = mockQuery.mock.calls.find(([query]) => query.includes('INSERT INTO quote_requests'));
    expect(insertCall).toBeTruthy();
    const params = insertCall[1];
    expect(params[15]).toBeNull(); // quote_amount_cents forced NULL
    expect(params[26]).toBe('unpaid'); // payment_status forced 'unpaid'
    expect(params[31]).toBeNull(); // proof_received_at forced NULL
    expect(params[32]).toBeNull(); // accepted_at forced NULL
    expect(params[33]).toBeNull(); // completed_at forced NULL
    expect(params[34]).toBeNull(); // closed_at forced NULL
  });

  test('rejects more than 10 photo attachments before touching the database', async () => {
    const res = response();
    await createQuoteRequest({
      body: {
        ...validBody,
        metadata: { photoAttachments: Array.from({ length: 11 }, (_, i) => `photo-${i}.jpg`) },
      },
      user: null,
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Too many photo attachments (maximum 10)' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('returns the existing row when a client request id was recently seen', async () => {
    const clientRequestId = 'idem-key-123';
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'request-dup', public_reference: 'DQ-DUP' }] }) // dedupe SELECT
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const res = response();
    await createQuoteRequest({
      body: { ...validBody, client_request_id: clientRequestId },
      user: null,
    }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      duplicate: true,
      requestId: 'request-dup',
      referenceId: 'DQ-DUP',
    }));
    expect(mockQuery.mock.calls.find(([query]) => query.includes('INSERT INTO quote_requests'))).toBeFalsy();
  });

  test('stores the client request id on the new row metadata when no duplicate exists', async () => {
    const clientRequestId = 'idem-key-456';
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // dedupe SELECT (no match)
      .mockResolvedValueOnce({ rows: [insertedRequest()] }) // INSERT
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const res = response();
    await createQuoteRequest({
      body: { ...validBody, client_request_id: clientRequestId },
      user: null,
    }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const insertCall = mockQuery.mock.calls.find(([query]) => query.includes('INSERT INTO quote_requests'));
    const metadata = JSON.parse(insertCall[1][14]);
    expect(metadata.clientRequestId).toBe(clientRequestId);
  });

  test('rejects an overlong client request id', async () => {
    const res = response();
    await createQuoteRequest({
      body: { ...validBody, client_request_id: 'x'.repeat(65) },
      user: null,
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid client request id' });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('admin updateQuoteRequestAdmin audit guards', () => {
  test('rejects a payment status outside the allowed list', async () => {
    const res = response();
    await updateQuoteRequestAdmin({
      params: { id: 'request-1' },
      body: { status: 'reviewing', payment_status: 'wire_fraud' },
      user: { id: 'admin-1' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid payment status' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects negative quote amounts', async () => {
    const res = response();
    await updateQuoteRequestAdmin({
      params: { id: 'request-1' },
      body: { status: 'reviewing', quote_amount_cents: -100 },
      user: { id: 'admin-1' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Integer value must not be negative' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('blocks paid -> unpaid transitions', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ payment_status: 'paid', quote_amount_cents: 5000 }],
    });

    const res = response();
    await updateQuoteRequestAdmin({
      params: { id: 'request-1' },
      body: { status: 'reviewing', payment_status: 'unpaid' },
      user: { id: 'admin-1' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_payment_transition' }));
    expect(mockQuery.mock.calls.find(([query]) => query.startsWith('UPDATE quote_requests'))).toBeFalsy();
  });

  test('blocks cancelled -> paid transitions', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ payment_status: 'cancelled', quote_amount_cents: 5000 }],
    });

    const res = response();
    await updateQuoteRequestAdmin({
      params: { id: 'request-1' },
      body: { status: 'reviewing', payment_status: 'paid' },
      user: { id: 'admin-1' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_payment_transition' }));
    expect(mockQuery.mock.calls.find(([query]) => query.startsWith('UPDATE quote_requests'))).toBeFalsy();
  });

  test('blocks quote amount changes after payment is confirmed', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ payment_status: 'confirmed', quote_amount_cents: 5000 }],
    });

    const res = response();
    await updateQuoteRequestAdmin({
      params: { id: 'request-1' },
      body: { status: 'reviewing', quote_amount_cents: 6000 },
      user: { id: 'admin-1' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_amount_transition' }));
    expect(mockQuery.mock.calls.find(([query]) => query.startsWith('UPDATE quote_requests'))).toBeFalsy();
  });

  test('allows a quote amount update while payment is still unpaid', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ payment_status: 'unpaid', quote_amount_cents: 5000 }] }) // guard SELECT
      .mockResolvedValueOnce({ rows: [{ ...insertedRequest(), quote_amount_cents: 6000 }] }); // UPDATE

    const res = response();
    await updateQuoteRequestAdmin({
      params: { id: 'request-1' },
      body: { status: 'quoted', quote_amount_cents: 6000 },
      user: { id: 'admin-1' },
    }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ quote_amount_cents: 6000 }),
    }));
    expect(mockQuery.mock.calls.find(([query]) => query.startsWith('UPDATE quote_requests'))).toBeTruthy();
  });
});
