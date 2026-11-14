'use strict';

// Notifications audit (2026-11-06), Track A: a notice that failed to send
// must never be recorded as sent, and every credit notice must leave an
// in-app row. Repro/verification tests on a real PostgreSQL.
//
// Item 1: KYC re-verification (notified_at), payout-destination
// verification (verification_sent_at), cash-out-held notices.
// Item 8/56: sendUserNotice inserts an in-app notifications row on every
// call and persists the email delivery result there.
// Item 45: the three sendUserNotice sites that discarded the result.
// Item 47: cash-out settle() checks the settlement-notify result.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CREDIT_NOTICE_SENT_GATING_TEST_DATABASE_URL');
if (database) {
  process.env.DATABASE_URL = database;
  process.env.OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS = String(50_000_000_000);
  process.env.OXSTEED_BANK_PAYOUT_ENABLED = 'true';
  process.env.OXSTEED_BANK_PAYOUT_SOURCE_ACCOUNT = 'TEST-SOURCE-ACCOUNT';
}
const describeDatabase = database ? describe : describe.skip;

jest.mock('../utils/email', () => ({ sendEmail: jest.fn() }));
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn() }));

const crypto = require('crypto');

jest.setTimeout(180000);

test('notice sent-gating tests require an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('credit notice sent-gating (notifications audit items 1, 8, 45, 47)', () => {
  let pool;
  let notices;
  let kyc;
  let logger;
  let warnSpy;
  const createdUsers = [];
  const createdRequirements = [];

  async function createUser(role, extra = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, country, preferred_language)
       VALUES ($1, $2, 'synthetic-unusable', $3, $4, $5, $6, $7)`,
      [id, `m4ns-${role}-${id}@example.invalid`, extra.first || 'Marie', extra.last || 'Test', role, extra.country || 'US', extra.lang || 'en']
    );
    createdUsers.push(id);
    return id;
  }

  beforeAll(async () => {
    pool = require('../db');
    notices = require('../services/creditCompliance/notices');
    kyc = require('../services/creditCompliance/kycRequirementsService');
    logger = require('../utils/logger');
  });

  beforeEach(() => {
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    jest.restoreAllMocks();
    if (createdRequirements.length) {
      await pool.query('DELETE FROM credit_kyc_requirements WHERE id = ANY($1::uuid[])', [createdRequirements]);
      createdRequirements.length = 0;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('item 1: KYC re-verification is only marked notified when the notice was sent', () => {
    test('a failed notice leaves notified_at NULL so the next run retries it', async () => {
      const userId = await createUser('customer');
      const { rows: [req] } = await pool.query(
        `INSERT INTO credit_kyc_requirements (user_id, trigger, source_id, required_tier)
         VALUES ($1, 'manual', 'test-item-1', 2) RETURNING id`,
        [userId]
      );
      createdRequirements.push(req.id);
      // The shared test database may hold other suites' open requirements;
      // runPeriodicTriggers sweeps all of them, so restore their flags.
      const { rows: preExisting } = await pool.query(
        `SELECT id FROM credit_kyc_requirements WHERE status = 'open' AND notified_at IS NULL AND id <> $1`,
        [req.id]
      );
      const preExistingIds = preExisting.map((r) => r.id);
      const sendSpy = jest.spyOn(notices, 'sendUserNotice').mockResolvedValue({ sent: false, error: 'resend down' });
      try {
        const out = await kyc.runPeriodicTriggers();
        expect(out.notified).toBe(0);
        const { rows } = await pool.query('SELECT notified_at FROM credit_kyc_requirements WHERE id = $1', [req.id]);
        expect(rows[0].notified_at).toBeNull();
        expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ userId, key: 'reverification_required' }));

        sendSpy.mockResolvedValue({ sent: true });
        const out2 = await kyc.runPeriodicTriggers();
        expect(out2.notified).toBe(preExistingIds.length + 1);
        const { rows: after } = await pool.query('SELECT notified_at FROM credit_kyc_requirements WHERE id = $1', [req.id]);
        expect(after[0].notified_at).not.toBeNull();
      } finally {
        sendSpy.mockRestore();
        if (preExistingIds.length) {
          await pool.query('UPDATE credit_kyc_requirements SET notified_at = NULL WHERE id = ANY($1::uuid[])', [preExistingIds]);
        }
      }
    });
  });

  describe('item 1: payout-destination verification mail', () => {
    test('a failed verification notice leaves verification_sent_at NULL', async () => {
      const userId = await createUser('helper', { country: 'HT' });
      const destinations = require('../services/creditPayoutDestinationService');
      const sendSpy = jest.spyOn(notices, 'sendUserNotice').mockResolvedValue({ sent: false, error: 'resend down' });
      try {
        const dest = await destinations.addDestination({
          user: { id: userId },
          input: {
            countryCode: 'HT', currencyCode: 'HTG', holderName: 'Marie Test', bankName: 'Banque Test',
            bankCode: 'BT01', accountNumber: `HT${crypto.randomInt(1e9, 9.99e9)}`, verificationMethod: 'one_time_code',
          },
        });
        expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ userId, key: 'destination_one_time_code' }));
        const { rows } = await pool.query('SELECT verification_sent_at FROM credit_payout_destinations WHERE id = $1', [dest.id]);
        expect(rows[0].verification_sent_at).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
          'credit_payout_destination.verification_notice_failed',
          expect.objectContaining({ destinationId: String(dest.id) })
        );
      } finally {
        sendSpy.mockRestore();
      }
    });
  });
});
