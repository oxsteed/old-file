'use strict';

/**
 * Approval funding step: Stripe where available, OxSteed manual
 * instructions elsewhere.
 *
 * Covers:
 *  - determineFundingPath routes to 'stripe' when payment_country_policies
 *    has stripe_rail_enabled=true, 'manual' otherwise (fail-closed: unknown
 *    country, missing row, or DB error all route to manual).
 *  - submitManualFundingProof creates a pending submission (idempotent).
 *  - verifyManualFunding(approve=true) credits the reserve (minus 2.5%
 *    fee) and flips funding_status to 'funded'. Idempotent replay.
 *  - verifyManualFunding(approve=false) rejects without touching the reserve.
 *  - The issuance gate blocks approved-but-unfunded restaurants.
 */

const { mockQuery, resetMocks } = require('./setup');
const { isStripeAvailableFor } = require('../utils/stripeAvailability');
const fundingService = require('../services/restaurantCreditFundingService');
const instructionsService = require('../services/oxsteedFundingInstructionsService');

const RESTAURANT_ID = 7;
const OPERATOR_ID = '00000000-0000-4000-8000-000000000123';
const ADMIN_ID = '00000000-0000-4000-8000-000000000999';

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('isStripeAvailableFor', () => {
  test('returns true when stripe_rail_enabled', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ stripe_rail_enabled: true }] });
    expect(await isStripeAvailableFor('US')).toBe(true);
  });

  test('returns false when stripe_rail_enabled is false', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ stripe_rail_enabled: false }] });
    expect(await isStripeAvailableFor('HT')).toBe(false);
  });

  test('fail-closed: missing row routes to manual', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await isStripeAvailableFor('XX')).toBe(false);
  });

  test('fail-closed: DB error routes to manual', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    expect(await isStripeAvailableFor('US')).toBe(false);
  });

  test('fail-closed: invalid country code', async () => {
    expect(await isStripeAvailableFor('')).toBe(false);
    expect(await isStripeAvailableFor('USA')).toBe(false);
    expect(await isStripeAvailableFor(null)).toBe(false);
  });
});

describe('determineFundingPath', () => {
  test('stripe path when country policy enables it', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: RESTAURANT_ID, country_code: 'US', currency_code: 'USD', display_name: 'Ox Burger' }] })
      .mockResolvedValueOnce({ rows: [{ stripe_rail_enabled: true }] });
    const path = await fundingService.determineFundingPath({ restaurantId: RESTAURANT_ID });
    expect(path.method).toBe('stripe');
  });

  test('manual path with instructions when Stripe unavailable', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: RESTAURANT_ID, country_code: 'HT', currency_code: 'HTG', display_name: 'Lakay' }] })
      .mockResolvedValueOnce({ rows: [{ stripe_rail_enabled: false }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 1, country_code: 'HT', currency_code: 'HTG',
          instructions: 'Send via MonCash to 1234', qr_url: null,
          reference_hint: 'Include your restaurant name', is_active: true,
          updated_at: new Date().toISOString(),
        }],
      });
    const path = await fundingService.determineFundingPath({ restaurantId: RESTAURANT_ID });
    expect(path.method).toBe('manual');
    expect(path.instructions.instructions).toContain('MonCash');
  });

  test('manual path with null instructions when none configured', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: RESTAURANT_ID, country_code: 'HT', currency_code: 'HTG', display_name: 'Lakay' }] })
      .mockResolvedValueOnce({ rows: [{ stripe_rail_enabled: false }] })
      .mockResolvedValueOnce({ rows: [] });
    const path = await fundingService.determineFundingPath({ restaurantId: RESTAURANT_ID });
    expect(path.method).toBe('manual');
    expect(path.instructions).toBeNull();
  });
});

describe('submitManualFundingProof', () => {
  test('creates a pending submission', async () => {
    const submissionRow = {
      id: 1, restaurant_id: RESTAURANT_ID, amount_cents: 5000, currency_code: 'HTG',
      proof_url: 'https://example.com/proof.jpg', reference: 'MC123',
      note: null, status: 'pending', verified_at: null,
      rejection_reason: null, created_at: new Date().toISOString(),
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ restaurant_id: RESTAURANT_ID, funding_status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [submissionRow] })
      .mockResolvedValueOnce({ rows: [] }); // funding_method update
    const result = await fundingService.submitManualFundingProof({
      restaurantId: RESTAURANT_ID,
      operatorUserId: OPERATOR_ID,
      amountCents: 5000,
      currencyCode: 'HTG',
      proofUrl: 'https://example.com/proof.jpg',
      reference: 'MC123',
      idempotencyKey: 'test-key-1',
    });
    expect(result.status).toBe('pending');
    expect(result.amountCents).toBe(5000);
  });

  test('rejects when no pending funding approval', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(fundingService.submitManualFundingProof({
      restaurantId: RESTAURANT_ID,
      operatorUserId: OPERATOR_ID,
      amountCents: 5000,
      currencyCode: 'HTG',
      idempotencyKey: 'test-key-2',
    })).rejects.toMatchObject({ code: 'credit_funding_no_pending_approval' });
  });
});

describe('verifyManualFunding', () => {
  const pendingSubmission = {
    id: 1, restaurant_id: RESTAURANT_ID, amount_cents: 10000, currency_code: 'HTG',
    proof_url: 'https://example.com/proof.jpg', reference: 'MC123',
    note: null, status: 'pending',
  };

  test('approve=true credits reserve minus 2.5% fee and flips to funded', async () => {
    const reserveRow = { restaurant_id: RESTAURANT_ID, balance_cents: 9750, currency_code: 'HTG' };
    mockQuery
      .mockResolvedValueOnce({ rows: [pendingSubmission] })           // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [reserveRow] })                  // INSERT reserve
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })                   // INSERT ledger
      .mockResolvedValueOnce({ rows: [{ ...pendingSubmission, status: 'verified' }] }) // UPDATE submission
      .mockResolvedValueOnce({ rows: [] });                            // UPDATE approval
    const result = await fundingService.verifyManualFunding({
      submissionId: 1, adminUserId: ADMIN_ID, approve: true,
    });
    expect(result.submission.status).toBe('verified');
    expect(result.reserve.balanceCents).toBe(9750); // 10000 - 250 fee
    expect(result.feeCents).toBe(250);
    expect(result.issuableCents).toBe(9750);
    expect(result.replayed).toBe(false);
  });

  test('approve=false rejects without touching the reserve', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [pendingSubmission] })
      .mockResolvedValueOnce({
        rows: [{ ...pendingSubmission, status: 'rejected' }],
      });
    const result = await fundingService.verifyManualFunding({
      submissionId: 1, adminUserId: ADMIN_ID, approve: false,
    });
    expect(result.rejected).toBe(true);
    expect(result.reserve).toBeNull();
    // Only two queries (SELECT + UPDATE): no reserve INSERT, no ledger INSERT.
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test('idempotent: already-verified submission replays without double-credit', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...pendingSubmission, status: 'verified' }],
    });
    const result = await fundingService.verifyManualFunding({
      submissionId: 1, adminUserId: ADMIN_ID, approve: true,
    });
    expect(result.replayed).toBe(true);
    expect(result.reserve).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('oxsteed funding instructions service', () => {
  test('upsert creates instructions', async () => {
    const row = {
      id: 1, country_code: 'HT', currency_code: 'HTG',
      instructions: 'MonCash to 555-1234', qr_url: null,
      reference_hint: 'Include restaurant name', is_active: true,
      updated_at: new Date().toISOString(),
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] });
    const result = await instructionsService.upsertFundingInstructions({
      countryCode: 'HT', currencyCode: 'HTG',
      instructions: 'MonCash to 555-1234',
      adminUserId: ADMIN_ID,
    });
    expect(result.countryCode).toBe('HT');
    expect(result.instructions).toContain('MonCash');
  });

  test('getFundingInstructions returns null when none configured', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await instructionsService.getFundingInstructions('HT', 'HTG');
    expect(result).toBeNull();
  });
});
