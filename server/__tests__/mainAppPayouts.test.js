'use strict';

const { mockQuery, resetMocks } = require('./setup');
jest.mock('../services/bookingSlotEngine', () => ({ computeSlots: jest.fn() }));
const mockUploadFile = jest.fn();
const mockGetSignedDownloadUrl = jest.fn();
jest.mock('../utils/storage', () => ({
  uploadFile: (...args) => mockUploadFile(...args),
  getSignedDownloadUrl: (...args) => mockGetSignedDownloadUrl(...args),
}));
const slotEngine = require('../services/bookingSlotEngine');
const ctrl = require('../controllers/mainAppController');

function mockResponse() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  mockGetSignedDownloadUrl.mockResolvedValue('https://signed.example.com/payment-proof');
});

describe('main app payout guardrails', () => {
  test('records pending payout requests without claiming payout completion', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          earned_cents: 20000,
          job_pending_cents: 0,
          paid_cents: 0,
          requested_cents: 2500,
          available_cents: 17500,
          currency_code: 'USD',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 101,
          amount_cents: 12500,
          currency_code: 'USD',
          payout_method: 'bank_transfer',
          status: 'pending',
          note: null,
          requested_at: new Date('2026-06-30T12:00:00Z'),
          processed_at: null,
          cancelled_at: null,
        }],
      });
    const req = {
      user: { id: '00000000-0000-4000-8000-000000000999' },
      body: {
        amountCents: 12500,
        currencyCode: 'USD',
        payoutMethod: 'bank_transfer',
      },
    };
    const res = mockResponse();
    const next = jest.fn();

    await ctrl.requestPayout(req, res, next);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      contract: expect.objectContaining({ moneyMoved: false }),
      request: expect.objectContaining({
        amountCents: 12500,
        status: 'pending',
      }),
      message: expect.stringContaining('No payout has been completed'),
    }));
    expect(mockQuery.mock.calls[1][0]).toMatch(/INSERT INTO main_app_payout_requests/);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects payout requests above available completed-job balance', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        available_cents: 500,
        currency_code: 'USD',
      }],
    });
    const req = {
      user: { id: '00000000-0000-4000-8000-000000000999' },
      body: { amountCents: 12500, payoutMethod: 'bank_transfer' },
    };
    const res = mockResponse();
    const next = jest.fn();

    await ctrl.requestPayout(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'insufficient_withdrawable_balance' }),
    }));
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('main app protected payment request records', () => {
  test('uploads payment proof to participant-scoped private storage', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 501 }] });
    mockUploadFile.mockResolvedValueOnce(
      'main-app-payment-proofs/501/00000000-0000-4000-8000-000000000111/private-proof.png'
    );
    const req = {
      params: { requestId: '501' },
      user: { id: '00000000-0000-4000-8000-000000000111' },
      file: {
        buffer: Buffer.from('proof'),
        originalname: 'receipt.png',
        mimetype: 'image/png',
        size: 5,
      },
    };
    const res = mockResponse();
    const next = jest.fn();

    await ctrl.uploadPaymentProof(req, res, next);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('payer_id = $2 OR payee_id = $2'),
      [501, req.user.id]
    );
    expect(mockUploadFile).toHaveBeenCalledWith(
      req.file.buffer,
      `main-app-payment-proofs/501/${req.user.id}`,
      'receipt.png',
      'image/png'
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      attachment: expect.objectContaining({
        url: 'https://signed.example.com/payment-proof',
        key: expect.stringContaining('main-app-payment-proofs/501/'),
      }),
      downloadExpiresInSeconds: 900,
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('returns only a short-lived signed link for stored private proof', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 501,
        source_type: 'job',
        source_id: 'job-1',
        payer_id: '00000000-0000-4000-8000-000000000111',
        payee_id: '00000000-0000-4000-8000-000000000999',
        amount_cents: 2500,
        currency_code: 'USD',
        status: 'requested',
        settlement_mode: 'manual_direct',
        metadata: {
          proofAttachment: {
            url: 'private://main-app-payment-proofs/501/user/private-proof.png',
            key: 'main-app-payment-proofs/501/user/private-proof.png',
            name: 'receipt.png',
            type: 'image/png',
          },
        },
        created_at: new Date('2026-06-30T12:00:00Z'),
        updated_at: new Date('2026-06-30T12:00:00Z'),
      }],
    });
    const req = {
      query: {},
      user: { id: '00000000-0000-4000-8000-000000000111' },
    };
    const res = mockResponse();
    const next = jest.fn();

    await ctrl.listPaymentRequests(req, res, next);

    expect(mockGetSignedDownloadUrl).toHaveBeenCalledWith(
      'main-app-payment-proofs/501/user/private-proof.png',
      900
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      paymentRequests: [
        expect.objectContaining({
          proofLink: 'https://signed.example.com/payment-proof',
          proofAttachment: expect.objectContaining({
            url: 'https://signed.example.com/payment-proof',
            key: 'main-app-payment-proofs/501/user/private-proof.png',
          }),
        }),
      ],
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('records payment requests without creating charges or settlement', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 501,
        source_type: 'service_booking',
        source_id: 'booking-1',
        payer_id: '00000000-0000-4000-8000-000000000111',
        payee_id: '00000000-0000-4000-8000-000000000999',
        business_id: 7,
        amount_cents: 9900,
        currency_code: 'USD',
        status: 'requested',
        settlement_mode: 'external_pending',
        external_provider: null,
        processor_payment_id: null,
        description: 'Demo-safe service deposit',
        idempotency_key: 'idem-1',
        expires_at: null,
        created_at: new Date('2026-06-30T12:00:00Z'),
        updated_at: new Date('2026-06-30T12:00:00Z'),
      }],
    });
    const req = {
      get: jest.fn((name) => (name === 'Idempotency-Key' ? 'idem-1' : undefined)),
      user: { id: '00000000-0000-4000-8000-000000000999' },
      body: {
        sourceType: 'service_booking',
        sourceId: 'booking-1',
        payerId: '00000000-0000-4000-8000-000000000111',
        businessId: 7,
        amountCents: 9900,
        description: 'Demo-safe service deposit',
      },
    };
    const res = mockResponse();
    const next = jest.fn();

    await ctrl.createPaymentRequest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      contract: expect.objectContaining({
        moneyMoved: false,
        processorPaymentCreated: false,
      }),
      paymentRequest: expect.objectContaining({
        amountCents: 9900,
        status: 'requested',
        settlementMode: 'external_pending',
      }),
      message: expect.stringContaining('No card charge'),
    }));
    expect(mockQuery.mock.calls[0][0]).toMatch(/INSERT INTO main_app_payment_requests/);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects fabricated payment records between unrelated users', async () => {
    const req = {
      get: jest.fn(),
      user: { id: '00000000-0000-4000-8000-000000000999' },
      body: {
        sourceType: 'job',
        sourceId: 'job-1',
        payerId: '00000000-0000-4000-8000-000000000111',
        payeeId: '00000000-0000-4000-8000-000000000222',
        amountCents: 2500,
        settlementMode: 'manual_direct',
      },
    };
    const res = mockResponse();
    const next = jest.fn();

    await ctrl.createPaymentRequest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({
        code: 'validation_failed',
        fields: expect.objectContaining({ participants: expect.any(String) }),
      }),
    }));
    expect(mockQuery).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects insecure payment proof links when creating a payment request', async () => {
    const req = {
      get: jest.fn(),
      user: { id: '00000000-0000-4000-8000-000000000999' },
      body: {
        sourceType: 'job',
        payerId: '00000000-0000-4000-8000-000000000999',
        payeeId: '00000000-0000-4000-8000-000000000111',
        amountCents: 2500,
        settlementMode: 'manual_direct',
        proofLink: 'http://example.com/receipt.png',
      },
    };
    const res = mockResponse();
    const next = jest.fn();

    await ctrl.createPaymentRequest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({
        code: 'validation_failed',
        fields: expect.objectContaining({ proofLink: expect.stringContaining('HTTPS') }),
      }),
    }));
    expect(mockQuery).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('confirms a payment receipt for the recipient in-app', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 501,
        source_type: 'service_booking',
        source_id: 'booking-1',
        payer_id: '00000000-0000-4000-8000-000000000111',
        payee_id: '00000000-0000-4000-8000-000000000999',
        business_id: 7,
        amount_cents: 9900,
        currency_code: 'USD',
        status: 'confirmed',
        settlement_mode: 'manual_direct',
        external_provider: 'cash_app',
        processor_payment_id: null,
        description: 'Demo-safe service deposit',
        idempotency_key: 'idem-1',
        expires_at: null,
        metadata: {
          proofLink: 'https://example.com/proof.png',
          proofAttachment: {
            url: 'https://example.com/proof.png',
            key: 'user-uploads/receipt.png',
            name: 'receipt.png',
            type: 'image/png',
            sizeBytes: 12345,
          },
          confirmationCode: 'ABC123',
          confirmationNote: 'Received at the front desk',
          confirmedAt: '2026-06-30T12:00:00.000Z',
          confirmedByUserId: '00000000-0000-4000-8000-000000000999',
        },
        created_at: new Date('2026-06-30T12:00:00Z'),
        updated_at: new Date('2026-06-30T12:00:00Z'),
      }],
    });
    const req = {
      params: { requestId: '501' },
      user: { id: '00000000-0000-4000-8000-000000000999' },
      body: {
        confirmationCode: 'ABC123',
        proofLink: 'https://example.com/proof.png',
        note: 'Received at the front desk',
      },
    };
    const res = mockResponse();
    const next = jest.fn();

    await ctrl.confirmPaymentRequest(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      contract: expect.objectContaining({
        moneyMoved: false,
        processorPaymentCreated: false,
        receiptConfirmed: true,
      }),
      paymentRequest: expect.objectContaining({
        status: 'confirmed',
        confirmationCode: 'ABC123',
        proofLink: 'https://example.com/proof.png',
        proofAttachment: expect.objectContaining({
          url: 'https://example.com/proof.png',
          name: 'receipt.png',
          type: 'image/png',
        }),
        confirmationNote: 'Received at the front desk',
      }),
      message: expect.stringContaining('confirmed in the app'),
    }));
    expect(mockQuery.mock.calls[0][0]).toMatch(/UPDATE main_app_payment_requests/);
    expect(next).not.toHaveBeenCalled();
  });

  test('lets the payer submit proof without confirming their own payment', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 501,
        source_type: 'service_booking',
        source_id: 'booking-1',
        payer_id: '00000000-0000-4000-8000-000000000111',
        payee_id: '00000000-0000-4000-8000-000000000999',
        business_id: 7,
        amount_cents: 9900,
        currency_code: 'USD',
        status: 'requested',
        settlement_mode: 'manual_direct',
        metadata: {
          proofLink: 'https://example.com/payer-proof.png',
          proofSubmittedAt: '2026-06-30T12:00:00.000Z',
          proofSubmittedByUserId: '00000000-0000-4000-8000-000000000111',
        },
        created_at: new Date('2026-06-30T12:00:00Z'),
        updated_at: new Date('2026-06-30T12:00:00Z'),
      }],
    });
    const req = {
      params: { requestId: '501' },
      user: { id: '00000000-0000-4000-8000-000000000111' },
      body: { proofLink: 'https://example.com/payer-proof.png' },
    };
    const res = mockResponse();
    const next = jest.fn();

    await ctrl.submitPaymentProof(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      contract: expect.objectContaining({
        moneyMoved: false,
        proofSubmitted: true,
      }),
      paymentRequest: expect.objectContaining({
        status: 'requested',
        proofLink: 'https://example.com/payer-proof.png',
        proofSubmittedByUserId: '00000000-0000-4000-8000-000000000111',
      }),
    }));
    expect(mockQuery.mock.calls[0][0]).toMatch(/payer_id = \$2/);
    expect(mockQuery.mock.calls[0][0]).not.toMatch(/status = 'confirmed'/);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects insecure proof links before storing payer proof', async () => {
    const req = {
      params: { requestId: '501' },
      user: { id: '00000000-0000-4000-8000-000000000111' },
      body: { proofLink: 'http://example.com/payer-proof.png' },
    };
    const res = mockResponse();
    const next = jest.fn();

    await ctrl.submitPaymentProof(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({
        code: 'validation_failed',
        fields: expect.objectContaining({ proofLink: expect.stringContaining('HTTPS') }),
      }),
    }));
    expect(mockQuery).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('main app promo launch scope', () => {
  test('returns promo vouchers scoped to restaurant-credit food orders', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 42,
          code: 'FOOD10',
          title: 'FOOD10',
          description: '10% off food credit orders',
          discount_type: 'percentage',
          discount_value: 10,
          end_date: null,
          category: 'food',
          status: 'active',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const req = { user: { id: '00000000-0000-4000-8000-000000000999' } };
    const res = mockResponse();
    const next = jest.fn();

    await ctrl.getPromoWallet(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      compatibility: expect.objectContaining({
        serviceBookingCheckout: 'coming_soon',
        jobProtectedPayments: 'coming_soon',
      }),
      promos: [expect.objectContaining({
        code: 'FOOD10',
        category: 'food',
        applicabilityNote: expect.stringContaining('restaurant-credit food orders'),
        supportedScopes: ['food.restaurant_credit'],
      })],
    }));
    expect(next).not.toHaveBeenCalled();
  });
});

describe('main app service fallback-data contracts', () => {
  test('returns public service packages from backend package table', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 44,
        business_id: 12,
        name: 'Spring tune-up',
        description: 'Seasonal maintenance package',
        service_id: 8,
        services: [{ serviceId: '8', quantity: 1 }],
        total_sessions: 2,
        price_cents: 14900,
        original_price_cents: 17900,
        validity_days: 90,
        sort_order: 1,
        is_active: true,
        created_at: new Date('2026-06-30T12:00:00Z'),
        updated_at: new Date('2026-06-30T12:00:00Z'),
      }],
    });
    const req = { query: { businessId: '12' } };
    const res = mockResponse();
    const next = jest.fn();

    await ctrl.getServicePackages(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      contract: expect.objectContaining({ version: 'main-service-packages-v1' }),
      packages: [expect.objectContaining({
        id: '44',
        businessId: 12,
        priceCents: 14900,
      })],
    }));
    expect(mockQuery.mock.calls[0][0]).toMatch(/FROM business_service_packages/);
    expect(next).not.toHaveBeenCalled();
  });

  test('returns service availability from slot engine with contract metadata', async () => {
    slotEngine.computeSlots.mockResolvedValueOnce({
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-02T00:00:00.000Z',
      available_slots: [{ start_time: '09:00', end_time: '10:00', price_cents: 5000 }],
    });
    const req = {
      query: {
        businessId: '12',
        serviceId: '8',
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-02T00:00:00.000Z',
      },
    };
    const res = mockResponse();
    const next = jest.fn();

    await ctrl.getServiceAvailability(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      contract: expect.objectContaining({ version: 'main-service-availability-v1' }),
      available_slots: [expect.objectContaining({ start_time: '09:00' })],
    }));
    expect(slotEngine.computeSlots).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 12,
      serviceId: 8,
    }));
    expect(next).not.toHaveBeenCalled();
  });
});
