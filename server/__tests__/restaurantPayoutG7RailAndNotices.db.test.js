'use strict';

/**
 * G7-1 + G7-13 acceptance suite (Nov 23 audit, Group 7).
 *
 * G7-1 [HIGH]: the payout worker executes transfers with no credit-rail
 * check at execution time (repeat of Nov 7 money-audit #10, restaurant
 * half). approvePayout asserts the rail, but processNextTransfer checks
 * only processorEnabled(). Approve, kill/freeze the rail, drain: the
 * drain must transfer nothing and leave the row pending; rail restored:
 * the drain pays.
 *
 * G7-13: the payout notices the owner most needs arrive blank.
 * payout_draft_created is absent from the catalog and i18n;
 * payout_reversed is cataloged but has no i18n entry and no email
 * fallback. Re-verification on the current tip found a third blank
 * notice the audit misread: payout_deposited has an email button-text
 * entry (i18n.js:1649) but no title/body entry, so tNotif returns
 * empty for it too. All three are asserted here.
 *
 * DB: disposable loopback database credit_statement_test_g7 only; the
 * suite skips otherwise. Run with RESTAURANT_PAYOUT_G7_TEST_DATABASE_URL
 * pointed at it, e.g.:
 *   RESTAURANT_PAYOUT_G7_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test_g7
 *     npx jest __tests__/restaurantPayoutG7RailAndNotices.db.test.js --forceExit
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');

const RAW_URL = process.env.RESTAURANT_PAYOUT_G7_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test_g7$/.test(url.pathname);
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable G7 test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.STRIPE_SECRET_KEY = 'sk_test_g7';
  process.env.PAYOUT_PROCESSOR_ENABLED = 'true';
}

// Stripe is never called for real: the payout service captures the client
// at require time, so the mock must be registered before the require below.
jest.mock('stripe', () => {
  const instance = {
    transfers: {
      create: jest.fn(async () => ({ id: 'tr_test_g7' })),
      retrieve: jest.fn(async () => ({ id: 'tr_test_g7' })),
    },
  };
  const factory = jest.fn(() => instance);
  factory.__instance = instance;
  return factory;
});

// Email is never sent for real: keep the real module shape, stub only the
// provider call so the allow-list / money-critical routing is exercised.
jest.mock('../utils/email', () => {
  const actual = jest.requireActual('../utils/email');
  return { ...actual, sendEmail: jest.fn(async () => ({ success: true })) };
});

const db = require('../db');
const { withTransaction } = require('../utils/transaction');
const payoutService = require('../services/restaurantPayoutService');
const { ensureRestaurantSubBankAccount } = require('../services/oxsteedCreditSubBankService');
const { ensureAccount, postJournalTransaction } = require('../services/oxsteedCreditService');
const { isMoneyCriticalEmailType } = require('../services/notificationService');
const { NOTIFICATION_TYPES } = require('../utils/notificationTypeCatalog');
const { tNotif } = require('../utils/i18n');
const stripeFactory = require('stripe');
const { sendEmail } = require('../utils/email');

const stripeTransfersCreate = stripeFactory.__instance.transfers.create;

const suffix = crypto.randomBytes(4).toString('hex');
const ownerId = crypto.randomUUID();
const managerId = crypto.randomUUID();
const adminId = crypto.randomUUID();
const ownerEmail = `g7-owner-${suffix}@example.test`;
let bizId;
let restaurantId;
const CONNECT_ACCOUNT = 'acct_test_g7';

async function seedUser(id, email) {
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name)
     VALUES ($1, $2, 'x', 'Test', 'User') ON CONFLICT (id) DO NOTHING`,
    [id, email],
  );
}

async function setRail(enabled) {
  await db.query(
    `INSERT INTO feature_flags (key, is_enabled) VALUES ('oxsteed_credit_enabled', $1)
     ON CONFLICT (key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled`,
    [enabled],
  );
}

async function freezeRail() {
  await db.query(
    `INSERT INTO oxsteed_credit_rail_freezes (reason) VALUES ('g7 acceptance: freeze')`,
  );
}

async function clearFreeze() {
  await db.query(
    `UPDATE oxsteed_credit_rail_freezes SET cleared_at = NOW(), clear_reason = 'g7 acceptance: clear'
      WHERE cleared_at IS NULL`,
  );
}

async function setOwnerEmailPrefs({ emailNotifications = true, unsubscribeAll = false } = {}) {
  await db.query(
    `INSERT INTO notification_preferences (user_id, email_notifications, unsubscribe_all)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET email_notifications = EXCLUDED.email_notifications,
       unsubscribe_all = EXCLUDED.unsubscribe_all`,
    [ownerId, emailNotifications, unsubscribeAll],
  );
}

// Test-only seed: the sub-bank balance normally accrues from food-wallet
// orders. Fund it through a real journal posting instead: the ledger
// trigger refuses direct balance writes ("ledger state may only change
// through journal posting"), and the approve path only reads the balance,
// so this keeps the suite about the worker/notice gates, not about order
// settlement. sub_bank_opening_balance debits platform_treasury (which
// may go negative) and credits the restaurant sub-bank.
async function fundSubBank(cents) {
  await withTransaction(db, async (client) => {
    const subBank = await ensureRestaurantSubBankAccount(client, {
      restaurantId, currencyCode: 'USD',
    });
    const treasury = await ensureAccount(client, {
      accountType: 'platform_treasury', currencyCode: 'USD',
    });
    await postJournalTransaction(client, {
      transactionType: 'sub_bank_opening_balance',
      debitAccountId: treasury.id,
      creditAccountId: subBank.id,
      amountCents: cents,
      currencyCode: 'USD',
      idempotencyKey: `g7-opening-balance-${suffix}`,
      referenceType: 'restaurant_sub_bank_opening',
      referenceId: String(restaurantId),
      reason: 'G7 acceptance: fund restaurant sub-bank',
    });
  }, 'g7_fund_sub_bank');
}

async function requestAndApprove(amountCents, keySuffix) {
  const requested = await payoutService.requestPayout({
    restaurantId,
    userId: ownerId,
    amountCents,
    currencyCode: 'USD',
    idempotencyKey: `g7-${keySuffix}-${suffix}`,
  });
  expect(requested.status).toBe('requested');
  const approved = await payoutService.approvePayout({
    payoutId: requested.id,
    adminUserId: adminId,
    reviewNote: 'g7 acceptance',
  });
  expect(approved.status).toBe('approved');
  return approved;
}

async function outboxRow(payoutId) {
  const { rows } = await db.query(
    'SELECT status, attempts, last_error FROM restaurant_payout_outbox WHERE payout_id = $1',
    [payoutId],
  );
  return rows[0];
}

async function payoutRow(payoutId) {
  const { rows } = await db.query(
    'SELECT status, stripe_transfer_id, funds_settled, failure_reason FROM restaurant_payouts WHERE id = $1',
    [payoutId],
  );
  return rows[0];
}

async function latestNotification(userId, type) {
  const { rows } = await db.query(
    `SELECT title, body FROM notifications WHERE user_id = $1 AND type = $2
      ORDER BY created_at DESC LIMIT 1`,
    [userId, type],
  );
  return rows[0] || null;
}

function transferShape(payout, transferId = 'tr_test_g7') {
  return {
    id: transferId,
    amount: Number(payout.amount_cents),
    currency: 'usd',
    destination: CONNECT_ACCOUNT,
    metadata: { restaurant_payout_id: String(payout.id) },
  };
}

ddescribe('G7-1 + G7-13 restaurant payout rail gate and payout notices', () => {
  beforeAll(async () => {
    await seedUser(ownerId, ownerEmail);
    await seedUser(managerId, `g7-manager-${suffix}@example.test`);
    await seedUser(adminId, `g7-admin-${suffix}@example.test`);
    const { rows: bizRows } = await db.query(
      `INSERT INTO businesses (business_name, user_id, is_active)
       VALUES ($1, $2, TRUE) RETURNING id`,
      [`G7 Payout Biz ${suffix}`, ownerId],
    );
    bizId = bizRows[0].id;
    await db.query(
      `INSERT INTO business_members (business_id, member_id, owner_id, role, invite_email, status)
       VALUES ($1, $2, $3, 'manager', $4, 'active')`,
      [bizId, managerId, ownerId, `g7-manager-${suffix}@example.test`],
    );
    const { rows: restRows } = await db.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status, currency_code)
       VALUES ($1, $2, $3, 'active', 'USD') RETURNING id`,
      [bizId, ownerId, `G7 Diner ${suffix}`],
    );
    restaurantId = restRows[0].id;
    await db.query(
      `INSERT INTO restaurant_connect_accounts (restaurant_id, stripe_account_id, payouts_enabled)
       VALUES ($1, $2, TRUE)`,
      [restaurantId, CONNECT_ACCOUNT],
    );
    await setRail(true);
    await fundSubBank(50000);
  });

  afterEach(async () => {
    await setRail(true);
    await clearFreeze();
    await setOwnerEmailPrefs({ emailNotifications: true, unsubscribeAll: false });
    stripeTransfersCreate.mockClear();
    sendEmail.mockClear();
  });

  afterAll(async () => {
    const clean = async (sql, params) => { try { await db.query(sql, params); } catch (_) {} };
    await clean('DELETE FROM restaurant_payout_outbox WHERE payout_id IN (SELECT id FROM restaurant_payouts WHERE restaurant_id = $1)', [restaurantId]);
    await clean('DELETE FROM restaurant_payouts WHERE restaurant_id = $1', [restaurantId]);
    await clean('DELETE FROM notifications WHERE user_id = $1', [ownerId]);
    await clean('DELETE FROM notification_preferences WHERE user_id = $1', [ownerId]);
    await clean('DELETE FROM oxsteed_credit_rail_freezes WHERE reason LIKE $1', ['g7 acceptance:%']);
    await clean('DELETE FROM restaurant_connect_accounts WHERE restaurant_id = $1', [restaurantId]);
    await clean('DELETE FROM food_restaurants WHERE id = $1', [restaurantId]);
    await clean('DELETE FROM business_members WHERE business_id = $1', [bizId]);
    await clean('DELETE FROM businesses WHERE id = $1', [bizId]);
    await clean('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ownerId, managerId, adminId]]);
    await db.end();
  });

  test('G7-1: rail killed after approval — drain transfers nothing, row stays pending; rail restored — drain pays', async () => {
    const payout = await requestAndApprove(2000, 'rail-off');
    expect((await outboxRow(payout.id)).status).toBe('pending');

    await setRail(false);
    const skipped = await payoutService.processNextTransfer();
    expect(skipped.skipped).toBe(true);
    expect(skipped.reason).toBe('credit_rail_suspended');
    expect(stripeTransfersCreate).not.toHaveBeenCalled();
    expect((await outboxRow(payout.id)).status).toBe('pending');
    expect((await payoutRow(payout.id)).status).toBe('approved');

    await setRail(true);
    const paid = await payoutService.processNextTransfer();
    expect(paid.processed).toBe(true);
    expect(paid.transferId).toBe('tr_test_g7');
    expect(stripeTransfersCreate).toHaveBeenCalledTimes(1);
    expect((await outboxRow(payout.id)).status).toBe('completed');
    const after = await payoutRow(payout.id);
    expect(after.status).toBe('processing');
    expect(after.stripe_transfer_id).toBe('tr_test_g7');
  });

  test('G7-1: frozen rail — drain transfers nothing; freeze cleared — drain pays', async () => {
    const payout = await requestAndApprove(2000, 'rail-frozen');
    await freezeRail();

    const skipped = await payoutService.processNextTransfer();
    expect(skipped.skipped).toBe(true);
    expect(skipped.reason).toBe('credit_rail_frozen');
    expect(stripeTransfersCreate).not.toHaveBeenCalled();
    expect((await outboxRow(payout.id)).status).toBe('pending');

    await clearFreeze();
    const paid = await payoutService.processNextTransfer();
    expect(paid.processed).toBe(true);
    expect(paid.transferId).toBe('tr_test_g7');
    expect(stripeTransfersCreate).toHaveBeenCalledTimes(1);
  });

  test('G7-13: manager draft notifies the owner with a titled, non-blank notice and email', async () => {
    const draft = await payoutService.requestPayout({
      restaurantId,
      userId: managerId,
      amountCents: 1500,
      currencyCode: 'USD',
      idempotencyKey: `g7-draft-${suffix}`,
    });
    expect(draft.status).toBe('draft');

    const note = await latestNotification(ownerId, 'payout_draft_created');
    expect(note).not.toBeNull();
    expect(note.title.trim()).not.toBe('');
    expect(note.body.trim()).not.toBe('');
    expect(note.title).toMatch(/draft/i);

    const emailed = sendEmail.mock.calls.filter((c) => c[0]?.subject === note.title);
    expect(emailed.length).toBeGreaterThanOrEqual(1);
    expect(emailed[0][0].to).toBe(ownerEmail);

    const catalog = new Set(NOTIFICATION_TYPES.map((entry) => entry.type));
    expect(catalog.has('payout_draft_created')).toBe(true);
    expect(tNotif('payout_draft_created', 'en').title.trim()).not.toBe('');
    expect(tNotif('payout_draft_created', 'en').body.trim()).not.toBe('');
  });

  test('G7-13: reversal notifies the owner with a titled, non-blank notice and transactional email even with email off', async () => {
    const payout = await requestAndApprove(2000, 'reversed');
    const paid = await payoutService.processNextTransfer();
    expect(paid.transferId).toBe('tr_test_g7');

    await setOwnerEmailPrefs({ emailNotifications: false, unsubscribeAll: true });
    const emailBefore = sendEmail.mock.calls.length;

    const result = await payoutService.applyTransferWebhookEvent({
      eventType: 'transfer.reversed',
      transfer: transferShape(payout),
    });
    expect(result.status).toBe('reversed');
    expect((await payoutRow(payout.id)).status).toBe('reversed');

    const note = await latestNotification(ownerId, 'payout_reversed');
    expect(note).not.toBeNull();
    expect(note.title.trim()).not.toBe('');
    expect(note.body.trim()).not.toBe('');
    expect(note.title).toMatch(/revers/i);

    // Money-critical: the reversal email bypasses the email toggle and the
    // global unsubscribe, because the owner must act on reversed money.
    expect(isMoneyCriticalEmailType('payout_reversed')).toBe(true);
    expect(sendEmail.mock.calls.length).toBeGreaterThan(emailBefore);
    const emailed = sendEmail.mock.calls.slice(emailBefore).filter((c) => c[0]?.subject === note.title);
    expect(emailed.length).toBeGreaterThanOrEqual(1);

    const catalog = new Set(NOTIFICATION_TYPES.map((entry) => entry.type));
    expect(catalog.has('payout_reversed')).toBe(true);
    expect(tNotif('payout_reversed', 'en').title.trim()).not.toBe('');
    expect(tNotif('payout_reversed', 'en').body.trim()).not.toBe('');
  });

  test('G7-13: deposit notifies the owner with a titled, non-blank notice (audit-correction case)', async () => {
    const payout = await requestAndApprove(2000, 'deposited');
    const paid = await payoutService.processNextTransfer();
    expect(paid.transferId).toBe('tr_test_g7');

    const result = await payoutService.applyTransferWebhookEvent({
      eventType: 'transfer.updated',
      transfer: transferShape(payout),
    });
    expect(result.status).toBe('completed');
    const after = await payoutRow(payout.id);
    expect(after.status).toBe('completed');
    expect(after.funds_settled).toBe(true);

    const note = await latestNotification(ownerId, 'payout_deposited');
    expect(note).not.toBeNull();
    expect(note.title.trim()).not.toBe('');
    expect(note.body.trim()).not.toBe('');
    expect(note.title).toMatch(/depos/i);
    expect(tNotif('payout_deposited', 'en').title.trim()).not.toBe('');
    expect(tNotif('payout_deposited', 'en').body.trim()).not.toBe('');
  });

  test('G7-13: draft email is allow-listed but respects the email toggle', async () => {
    await setOwnerEmailPrefs({ emailNotifications: false, unsubscribeAll: false });
    const draft = await payoutService.requestPayout({
      restaurantId,
      userId: managerId,
      amountCents: 1500,
      currencyCode: 'USD',
      idempotencyKey: `g7-draft-toggle-${suffix}`,
    });
    expect(draft.status).toBe('draft');

    // In-app still delivers; email does not (non-transactional).
    const note = await latestNotification(ownerId, 'payout_draft_created');
    expect(note).not.toBeNull();
    expect(note.title.trim()).not.toBe('');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
