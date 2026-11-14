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

  describe('item 45: wind-down redemption-paid notice', () => {
    const CUR = 'HTG';
    let admin1;
    let admin2;
    let railWasEnabled;
    let planId;
    let holderId;
    let instructionId;

    beforeAll(async () => {
      const { rows: flag } = await pool.query(`SELECT is_enabled FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`);
      railWasEnabled = flag[0]?.is_enabled === true;
      await pool.query(
        `INSERT INTO feature_flags (key, is_enabled) SELECT 'oxsteed_credit_enabled', TRUE WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'oxsteed_credit_enabled')`
      );
      await pool.query(`UPDATE feature_flags SET is_enabled = TRUE WHERE key = 'oxsteed_credit_enabled'`);
      admin1 = await createUser('super_admin', { first: 'Admin', last: 'Maker' });
      admin2 = await createUser('super_admin', { first: 'Admin', last: 'Checker' });
    });

    afterAll(async () => {
      try {
        if (holderId) await pool.query('DELETE FROM credit_wind_down_holders WHERE id = $1', [holderId]);
        if (instructionId) await pool.query('DELETE FROM credit_bank_payout_instructions WHERE id = $1', [instructionId]);
        if (planId) await pool.query('DELETE FROM credit_wind_down_plans WHERE id = $1', [planId]);
      } catch { /* best-effort test cleanup */ }
      await pool.query(`UPDATE feature_flags SET is_enabled = $1 WHERE key = 'oxsteed_credit_enabled'`, [railWasEnabled]);
    });

    test('a failed redemption-paid notice is recorded instead of discarded', async () => {
      const credit = require('../services/oxsteedCreditService');
      const helperId = await createUser('helper', { country: 'HT', lang: 'ht' });
      const customerId = await createUser('customer', { country: 'HT' });
      const { rows: [partner] } = await pool.query(
        `INSERT INTO oxsteed_credit_partners (status, settlement_currency_code, created_by) VALUES ('active', 'HTG', $1) RETURNING id`,
        [admin1]
      );
      const partnerId = String(partner.id);
      const { rows: [agreement] } = await pool.query(
        `INSERT INTO oxsteed_credit_partner_agreements (partner_id, version, status, starts_at, allowed_order_types, allowed_categories, created_by, approved_by)
         VALUES ($1, 1, 'active', NOW() - INTERVAL '1 day', '{}', '{}', $2, $3) RETURNING id`,
        [partnerId, admin1, admin2]
      );
      await pool.query(
        `INSERT INTO credit_participants (partner_id, participant_type, user_id, status, didit_verified, didit_verified_at, allowed_surfaces)
         VALUES ($1, 'helper', $2, 'active', TRUE, NOW(), '{jobs}')`,
        [partnerId, helperId]
      );
      let payableId;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const wallet = await credit.ensureAccount(client, { accountType: 'customer_wallet', customerId, currencyCode: CUR });
        const treasury = await credit.ensureAccount(client, { accountType: 'platform_treasury', currencyCode: CUR });
        const pay = await credit.ensureAccount(client, { accountType: 'partner_payable', partnerId, currencyCode: CUR });
        payableId = pay.id;
        await credit.postJournalTransaction(client, {
          transactionType: 'load', debitAccountId: treasury.id, creditAccountId: wallet.id, amountCents: 300000, currencyCode: CUR,
          idempotencyKey: `m4ns-wd-load-${helperId}`, actorType: 'admin', actorUserId: admin1, reason: 'test funding', description: 'test funding',
          referenceType: 'test', referenceId: helperId,
        });
        await credit.postJournalTransaction(client, {
          transactionType: 'purchase', debitAccountId: wallet.id, creditAccountId: pay.id, amountCents: 250000, currencyCode: CUR, partnerId, agreementId: agreement.id,
          idempotencyKey: `m4ns-wd-purchase-${helperId}`, actorType: 'customer', actorUserId: customerId, reason: 'test wages', referenceType: 'test', referenceId: helperId,
        });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      const destinations = require('../services/creditPayoutDestinationService');
      const dest = await destinations.addDestination({
        user: { id: helperId },
        input: {
          countryCode: 'HT', currencyCode: CUR, holderName: 'Rose Test', bankName: 'Banque Test',
          bankCode: 'BT01', accountNumber: `HT${crypto.randomInt(1e9, 9.99e9)}`, verificationMethod: 'micro_deposit',
        },
      });
      await pool.query(
        `UPDATE credit_payout_destinations SET status = 'verified', verified_at = NOW(), cooling_off_until = NOW() - INTERVAL '1 day' WHERE id = $1`,
        [dest.id]
      );
      const deadline = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
      ({ rows: [{ id: planId }] } = await pool.query(
        `INSERT INTO credit_wind_down_plans (reason, redemption_deadline, requested_by, approved_by)
         VALUES ('Test: licence surrendered, orderly exit', $1, $2, $3) RETURNING id`,
        [deadline, admin1, admin2]
      ));
      ({ rows: [{ id: instructionId }] } = await pool.query(
        `INSERT INTO credit_bank_payout_instructions
           (idempotency_key, purpose, destination_id, user_id, country_code, currency_code, amount_minor, payment_reference)
         VALUES ($1, 'redemption', $2, $3, 'HT', 'HTG', 250000, 'OXSTEED WDTEST') RETURNING id`,
        [`m4ns-wd-instruction-${crypto.randomUUID()}`, dest.id, helperId]
      ));
      ({ rows: [{ id: holderId }] } = await pool.query(
        `INSERT INTO credit_wind_down_holders
           (plan_id, account_id, account_type, holder_user_id, partner_id, currency_code, snapshot_balance_minor,
            status, destination_id, instruction_id, attempts)
         VALUES ($1, $2, 'partner_payable', $3, $4, 'HTG', 250000, 'instructed', $5, $6, 1) RETURNING id`,
        [planId, payableId, helperId, partnerId, dest.id, instructionId]
      ));
      const { reserveFunds } = require('../services/oxsteedCreditReservationService');
      const reserveClient = await pool.connect();
      let reservationId;
      try {
        ({ reservation: { id: reservationId } } = await reserveFunds(reserveClient, {
          accountId: payableId, reservationType: 'wind_down_redemption', referenceType: 'credit_wind_down_holder',
          referenceId: `${holderId}:1`, amountCents: 250000,
        }));
      } finally {
        reserveClient.release();
      }
      await pool.query('UPDATE credit_wind_down_holders SET reservation_id = $2 WHERE id = $1', [holderId, reservationId]);

      const wd = require('../services/creditCompliance/windDownService');
      const sendSpy = jest.spyOn(notices, 'sendUserNotice').mockImplementation(async (args) => (
        args.key === 'wind_down_redemption_sent' ? { sent: false, error: 'resend down' } : { sent: true }
      ));
      const settleClient = await pool.connect();
      try {
        // The real caller (bank settlePurpose) runs this inside a
        // transaction; the journal's debit/credit check needs both
        // entries in the same transaction.
        await settleClient.query('BEGIN');
        await wd.settleRedemptionInstruction(settleClient, { id: instructionId, amount_minor: 250000, destination_id: dest.id }, 'paid');
        await settleClient.query('COMMIT');
      } catch (error) {
        await settleClient.query('ROLLBACK');
        throw error;
      } finally {
        settleClient.release();
        sendSpy.mockRestore();
      }
      const { rows: [holder] } = await pool.query('SELECT status FROM credit_wind_down_holders WHERE id = $1', [holderId]);
      expect(holder.status).toBe('paid');
      expect(warnSpy).toHaveBeenCalledWith(
        'credit_wind_down.redemption_notice_failed',
        expect.objectContaining({ holderId: String(holderId) })
      );
    });
  });
});
