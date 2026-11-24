'use strict';

// Group 14 Slice 5b acceptance: reconcile records (706-710).
//   706 Invoice-to-payment matching: a payment record is linked to an
//       invoice by hand (no auto-matching); the matching view pairs the
//       invoice with its settling payment(s).
//   707 Adjustment review (bookkeeper read): a grant-holding bookkeeper
//       reads the pending queue + one adjustment, cannot write, and a
//       stranger gets 403.
//   708 Difference annotations (shared, on statement differences): a
//       bookkeeper annotates a statement entry for another authorized
//       reader to see; private notes stay private.
//   709 Reconciliation checklist: derived steps walk open -> matched ->
//       closed over the existing summary/exceptions/period-close pieces.
//   710 Closeout evidence package: one ZIP bundling period summary +
//       differences + matched adjustments + annotations; every download
//       re-authorized.
// Group 14 is READ-ONLY (D-408): nothing here moves money.
// Runs against a dedicated fresh database (credit_statement_test_g14b).

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const zlib = require('zlib');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP14_SLICE5B_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g14b') {
    throw new Error('Group 14 Slice 5b DB tests require the loopback credit_statement_test_g14b database');
  }
  process.env.DATABASE_URL = dbUrl;
}
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'group14-slice5b-test-secret';

jest.setTimeout(120000);

const describeDb = dbUrl ? describe : describe.skip;
const runId = crypto.randomUUID().slice(0, 8);

// Minimal ZIP reader over the central directory (archiver output): the
// closeout package is DEFLATE-compressed, so entry bytes are inflated
// from the central-directory sizes, never scanned for.
function readZip(buffer) {
  const eocd = buffer.length - 22;
  if (buffer.subarray(eocd, eocd + 4).toString('latin1') !== 'PK\x05\x06') {
    throw new Error('closeout package is not a ZIP (no end-of-central-directory)');
  }
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < entries; i += 1) {
    if (buffer.subarray(offset, offset + 4).toString('latin1') !== 'PK\x01\x02') {
      throw new Error('closeout package has a corrupt central directory');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    files[name] = method === 8 ? zlib.inflateRawSync(compressed) : Buffer.from(compressed);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function parseZipBuffer(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
  res.on('error', callback);
}

describeDb('Group 14 Slice 5b: reconcile records (706-710)', () => {
  let pool;
  let app;
  let creditService;
  let owner;
  let manager;
  let stranger;
  let bookkeeper;
  let plainAdmin;
  let superAdmin;
  let proposer;
  let customer;
  let businessId;
  let restaurantId;
  let locPrimary;
  let locSecond;
  let otherRestaurantId;
  let locOtherRestaurant;
  let partnerId;
  let partnerPayableId;
  let treasuryId;
  let walletId;
  let loadTxId;
  let excAId;
  let excBId;
  let adjPendingId;
  let adjMatchedId;
  let businessDocId;
  let invoiceId;

  // The test period: [now - 2d, now + 1d).
  const periodStart = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const periodEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const periodQuery = `periodStart=${periodStart.toISOString()}&periodEnd=${periodEnd.toISOString()}&currencyCode=USD`;

  beforeAll(async () => {
    pool = require('../db');
    creditService = require('../services/oxsteedCreditService');
    app = express();
    app.use(express.json());
    // The real routers, mounted exactly as in server/index.js.
    app.use('/api/businesses', require('../routes/businesses'));
    app.use('/api/agent', require('../routes/agentCreditAdjustments'));
    app.use('/api/statements/exports', require('../routes/statementExports'));
    app.use('/api', require('../routes/statementInvestigation'));
    app.use('/api/restaurants/:restaurantId/credit-reconciliation', require('../routes/creditLocationReconciliation'));
    app.use(require('../middleware/errorHandler').errorHandler);

    owner = await makeUser();
    manager = await makeUser();
    stranger = await makeUser();
    customer = await makeUser();
    bookkeeper = await makeUser('admin');
    plainAdmin = await makeUser('admin');
    superAdmin = await makeUser('super_admin');
    proposer = await makeUser('super_admin');

    // The bookkeeper holds a finance-read grant (D-424): the grant row,
    // not the role label, is what authorizes the 707 read.
    await pool.query(
      `INSERT INTO admin_permission_grants (grantor_id, grantee_id, permissions, expires_at, notes)
       VALUES ($1, $2, '["view_financials"]'::jsonb, NOW() + INTERVAL '30 days', 'Group 14 Slice 5b fixture')`,
      [superAdmin.id, bookkeeper.id],
    );

    const { rows: [business] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active)
       VALUES ($1, 'Fixture Business', FALSE, TRUE) RETURNING id`,
      [owner.id],
    );
    businessId = business.id;
    // The bookkeeper is the business's active manager member (708's
    // second authorized reader; managers hold payouts.view by default).
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'manager', $4, 'active', NOW())`,
      [businessId, owner.id, manager.id, manager.email],
    );
    const { rows: [restaurant] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status)
       VALUES ($1, $2, 'Fixture Kitchen', 'active') RETURNING id`,
      [businessId, owner.id],
    );
    restaurantId = restaurant.id;
    ({ rows: [{ id: locPrimary }] } = await pool.query(
      `SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary = TRUE`,
      [restaurantId],
    ));
    locPrimary = Number(locPrimary);
    locSecond = await makeLocation(restaurantId, 'Uptown');

    const { rows: [business2] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active)
       VALUES ($1, 'Second Business', FALSE, TRUE) RETURNING id`,
      [stranger.id],
    );
    const { rows: [restaurant2] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status)
       VALUES ($1, $2, 'Second Kitchen', 'active') RETURNING id`,
      [business2.id, stranger.id],
    );
    otherRestaurantId = restaurant2.id;
    ({ rows: [{ id: locOtherRestaurant }] } = await pool.query(
      `SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary = TRUE`,
      [otherRestaurantId],
    ));
    locOtherRestaurant = Number(locOtherRestaurant);

    const { rows: [partner] } = await pool.query(
      `INSERT INTO oxsteed_credit_partners (restaurant_id, status, created_by)
       VALUES ($1, 'active', $2) RETURNING id`,
      [restaurantId, superAdmin.id],
    );
    partnerId = partner.id;
    await pool.query(
      `INSERT INTO oxsteed_credit_partner_agreements (partner_id, version, status, starts_at, created_by, approved_by)
       VALUES ($1, 1, 'active', NOW() - INTERVAL '30 days', $2, $3)`,
      [partner.id, superAdmin.id, proposer.id],
    );

    walletId = await ensureCreditAccount({ accountType: 'customer_wallet', customerId: customer.id });
    partnerPayableId = await ensureCreditAccount({ accountType: 'partner_payable', partnerId });
    treasuryId = await ensureCreditAccount({ accountType: 'platform_treasury' });
    // The load goes through the journal service (a direct insert trips the
    // issuance trigger, which requires an administrator identity + reason).
    loadTxId = await postLoad(100000);

    // Exceptions: excA on the primary location (open), excB on the second
    // location (open). excA carries the matched adjustment and the seeded
    // annotation; excB carries neither, so the checklist differs per
    // location.
    excAId = await seedException({
      domain: 'payment_refund', referenceId: `food-order:9001-${runId}`, severity: 'warning', status: 'open',
      summary: 'Wallet debit not found for cancelled/refunded food order',
      details: { restaurantId, locationId: locPrimary, orderReferenceId: `9001-${runId}` },
    });
    excBId = await seedException({
      domain: 'payment_refund', referenceId: `food-order:9002-${runId}`, severity: 'warning', status: 'open',
      summary: 'Second location wallet debit not found',
      details: { restaurantId, locationId: locSecond, orderReferenceId: `9002-${runId}` },
    });

    // 707: one pending adjustment in the queue (proposed by a super-admin).
    const { rows: [adjPending] } = await pool.query(
      `INSERT INTO credit_adjustments
         (customer_id, amount_cents, currency_code, reason,
          proposed_by, status, idempotency_key)
       VALUES ($1, -200, 'USD', 'Pending review adjustment', $2, 'pending', $3)
       RETURNING id`,
      [customer.id, proposer.id, `g14b-adj-pending-${runId}`],
    );
    adjPendingId = adjPending.id;
    // 709/710: one applied adjustment matched to excA.
    const { rows: [adjMatched] } = await pool.query(
      `INSERT INTO credit_adjustments
         (customer_id, reconciliation_exception_id, amount_cents, currency_code, reason,
          proposed_by, status, applied_at, idempotency_key)
       VALUES ($1, $2, 500, 'USD', 'Goodwill credit for the missing refund', $3, 'applied', NOW(), $4)
       RETURNING id`,
      [customer.id, excAId, superAdmin.id, `g14b-adj-matched-${runId}`],
    );
    adjMatchedId = adjMatched.id;
    // One seeded annotation on excA, by the participant (688).
    await pool.query(
      `INSERT INTO oxsteed_credit_reconciliation_annotations
         (exception_id, author_type, author_user_id, body)
       VALUES ($1, 'participant', $2, 'Checked with the kitchen; till balanced.')`,
      [excAId, owner.id],
    );

    // 708: a business statement document with one receivable entry.
    businessDocId = await insertBusinessDocument();

    // 706: one business invoice, total $100.00, unpaid.
    const created = await postAs(owner, `/api/businesses/${businessId}/invoices`, {
      client_name: 'Acme Corp',
      line_items: [{ type: 'item', description: 'Monthly service', quantity: 1, unit_price: 100 }],
      status: 'draft',
    }).expect(201);
    invoiceId = created.body.invoice.id;
    expect(Number(created.body.invoice.total)).toBe(100);
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  async function makeUser(role = 'customer') {
    const id = crypto.randomUUID();
    const email = `t${id}@example.invalid`;
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, totp_enabled)
       VALUES ($1, $2, 'x', 'Test', 'Fixture', $3, TRUE, TRUE, TRUE)`,
      [id, email, role],
    );
    return { id, email, role };
  }

  async function makeLocation(restaurant, name) {
    const { rows: [row] } = await pool.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, is_primary, status)
       VALUES ($1, $2, FALSE, 'active') RETURNING id`,
      [restaurant, name],
    );
    return Number(row.id);
  }

  async function ensureCreditAccount({ accountType, customerId = null, partnerId = null }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const account = await creditService.ensureAccount(client, {
        accountType, customerId, partnerId, currencyCode: 'USD',
      });
      await client.query('COMMIT');
      return account.id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function postLoad(amountCents) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { transaction } = await creditService.postJournalTransaction(client, {
        currencyCode: 'USD',
        transactionType: 'load',
        debitAccountId: treasuryId,
        creditAccountId: walletId,
        amountCents,
        actorType: 'admin',
        actorUserId: superAdmin.id,
        reason: 'Fixture load',
        referenceType: 'admin_load',
        referenceId: 'g14b-fixture-load',
        description: 'Fixture load',
        idempotencyKey: `g14b-load-${runId}`,
      });
      await client.query('COMMIT');
      return transaction.id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function seedLedgerTx({ type, amountCents, debitAccountId, creditAccountId, referenceType, referenceId, metadata }) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO oxsteed_credit_transactions
         (id, transaction_type, status, debit_account_id, credit_account_id,
          amount_cents, currency_code, idempotency_key, reference_type, reference_id,
          actor_type, actor_user_id, partner_id, metadata, posted_at, created_at)
       VALUES ($1, $2, 'posted', $3, $4, $5, 'USD', $6, $7, $8, 'admin', $9, $10, $11::jsonb, NOW(), NOW())`,
      [id, type, debitAccountId, creditAccountId, amountCents,
        `g14b-${id}`, referenceType, referenceId, superAdmin.id, partnerId,
        JSON.stringify(metadata)],
    );
    return id;
  }

  async function seedException({ domain, referenceId, severity, status, summary, details }) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO reconciliation_exceptions
         (id, domain, reference_id, severity, status, summary, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [id, domain, referenceId, severity, status, summary, JSON.stringify(details)],
    );
    return id;
  }

  async function insertBusinessDocument() {
    const id = crypto.randomUUID();
    const document = {
      id, version: 1, kind: 'monthly', product: 'business',
      businessId, ownerName: 'Fixture Business', accountLabel: 'Business receivables',
      currencyCode: 'USD', period: { from: '2026-07-01', to: '2026-07-31' },
      generatedAt: '2026-08-01T00:00:00.000Z',
      openingPayableCents: 0, invoicedCents: 5000, collectedOrAdjustedCents: 0,
      cancelledCents: 0, closingPayableCents: 5000,
      receivables: {
        movements: [{
          sourceHistoryId: `g14b-1-${runId}`, recordedAt: '2026-07-15T00:00:00.000Z',
          invoicedCents: 5000, collectedOrAdjustedCents: 0, cancelledCents: 0,
          outstandingAfterCents: 5000,
        }],
      },
    };
    document.contentHash = require('../services/creditStatementService').hashDocument(document);
    await pool.query(
      `INSERT INTO settlement_statement_documents
         (id, product, scope_business_id, currency_code, period_from, period_to, generated_at, document, content_hash)
       VALUES ($1, 'business', $2, 'USD', '2026-07-01', '2026-07-31', NOW(), $3, $4)`,
      [id, businessId, JSON.stringify(document), document.contentHash],
    );
    return id;
  }

  const tokenFor = (user) => require('../middleware/auth').generateTokens(user).accessToken;
  const authAs = (user, req) => req.set('Authorization', `Bearer ${tokenFor(user)}`);
  const getAs = (user, path) => authAs(user, request(app).get(path));
  const postAs = (user, path, body) => authAs(user, request(app).post(path).send(body || {}));
  const reconBase = () => `/api/restaurants/${restaurantId}/credit-reconciliation`;
  const entryId = `history:g14b-1-${runId}`;

  // 706: link an existing payment record to an invoice by hand; the
  // matching view pairs the invoice with its settling payment.
  test('706: manual reference links to the invoice and the matching view pairs them', async () => {
    const linked = await postAs(owner, `/api/businesses/${businessId}/invoices/${invoiceId}/link-payment`, {
      paymentType: 'manual_reference', paymentReference: `CHK-1042-${runId}`, amount: 40,
    }).expect(201);
    expect(linked.body.payment).toMatchObject({
      paymentType: 'manual_reference', paymentReference: `CHK-1042-${runId}`, amount: 40, currencyCode: 'USD',
    });

    const view = await getAs(owner, `/api/businesses/${businessId}/invoices/${invoiceId}/payments`).expect(200);
    expect(view.body.invoice).toMatchObject({ id: invoiceId, total: 100, amountPaid: 0 });
    expect(view.body.payments).toHaveLength(1);
    expect(view.body.payments[0].paymentReference).toBe(`CHK-1042-${runId}`);
    expect(view.body.linkedTotal).toBe(40);
    expect(view.body.remaining).toBe(60);
    expect(view.body.fullyMatched).toBe(false);
  });

  test('706: a real credit transaction links; an unknown one is 404 and a duplicate is 409', async () => {
    const linked = await postAs(owner, `/api/businesses/${businessId}/invoices/${invoiceId}/link-payment`, {
      paymentType: 'credit_transaction', paymentReference: loadTxId, amount: 60,
    }).expect(201);
    expect(linked.body.payment.paymentType).toBe('credit_transaction');

    const view = await getAs(owner, `/api/businesses/${businessId}/invoices/${invoiceId}/payments`).expect(200);
    expect(view.body.linkedTotal).toBe(100);
    expect(view.body.remaining).toBe(0);
    expect(view.body.fullyMatched).toBe(true);

    await postAs(owner, `/api/businesses/${businessId}/invoices/${invoiceId}/link-payment`, {
      paymentType: 'credit_transaction', paymentReference: loadTxId, amount: 1,
    }).expect(409);
    await postAs(owner, `/api/businesses/${businessId}/invoices/${invoiceId}/link-payment`, {
      paymentType: 'credit_transaction', paymentReference: crypto.randomUUID(), amount: 1,
    }).expect(404);
    await postAs(owner, `/api/businesses/${businessId}/invoices/${invoiceId}/link-payment`, {
      paymentType: 'stripe_payment_intent', paymentReference: 'not-an-intent', amount: 1,
    }).expect(400);
    const stripe = await postAs(owner, `/api/businesses/${businessId}/invoices/${invoiceId}/link-payment`, {
      paymentType: 'stripe_payment_intent', paymentReference: 'pi_3QrTest123', amount: 1,
    }).expect(409);
    expect(stripe.body.code).toBe('business_invoice_payment_over_total');
  });

  test('706: mark-paid does NOT auto-match — no link is created by paying, and a stranger gets 404', async () => {
    const paid = await postAs(owner, `/api/businesses/${businessId}/invoices/${invoiceId}/pay`, { amount: 100 }).expect(200);
    expect(paid.body.invoice.status).toBe('paid');
    expect(Number(paid.body.invoice.amount_paid)).toBe(100);

    const view = await getAs(owner, `/api/businesses/${businessId}/invoices/${invoiceId}/payments`).expect(200);
    expect(view.body.payments).toHaveLength(2);
    expect(view.body.payments.map((row) => row.paymentType).sort()).toEqual(['credit_transaction', 'manual_reference']);
    expect(view.body.invoice.amountPaid).toBe(100);

    await getAs(stranger, `/api/businesses/${businessId}/invoices/${invoiceId}/payments`).expect(404);
    await postAs(stranger, `/api/businesses/${businessId}/invoices/${invoiceId}/link-payment`, {
      paymentType: 'manual_reference', paymentReference: 'CHK-9999', amount: 1,
    }).expect(404);
  });

  // 707: the bookkeeper reads the queue (list + detail) on the grant;
  // cannot write; a stranger and a grant-less admin cannot read.
  test('707: bookkeeper reads the pending queue and one adjustment; write attempts are 403', async () => {
    const queue = await getAs(bookkeeper, '/api/agent/credit-adjustments/pending').expect(200);
    expect(queue.body.readOnly).toBe(true);
    const ids = queue.body.adjustments.map((row) => row.id);
    expect(ids).toContain(adjPendingId);
    const pending = queue.body.adjustments.find((row) => row.id === adjPendingId);
    expect(pending).toMatchObject({ status: 'pending', amountCents: -200, reason: 'Pending review adjustment' });

    const detail = await getAs(bookkeeper, `/api/agent/credit-adjustments/${adjPendingId}`).expect(200);
    expect(detail.body.adjustment).toMatchObject({ id: adjPendingId, status: 'pending' });
    expect(detail.body.readOnly).toBe(true);
    await getAs(bookkeeper, `/api/agent/credit-adjustments/${crypto.randomUUID()}`).expect(404);

    await postAs(bookkeeper, '/api/agent/credit-adjustments', {
      customerId: customer.id, amountCents: 100, currencyCode: 'USD',
      reason: 'Bookkeeper must not propose', idempotencyKey: `g14b-bookkeeper-propose-${runId}`,
    }).expect(403);
    await postAs(bookkeeper, `/api/agent/credit-adjustments/${adjPendingId}/approve`, {}).expect(403);
    await postAs(bookkeeper, `/api/agent/credit-adjustments/${adjPendingId}/reject`, { rejectReason: 'no' }).expect(403);
  });

  test('707: a grant-less admin gets 403, a stranger gets 403, anonymous gets 401', async () => {
    const plain = await getAs(plainAdmin, '/api/agent/credit-adjustments/pending').expect(403);
    expect(plain.body.code).toBe('credit_adjustment_read_forbidden');
    await getAs(stranger, '/api/agent/credit-adjustments/pending').expect(403);
    await request(app).get('/api/agent/credit-adjustments/pending').expect(401);

    // A writer still reads as a writer: readOnly is false for super-admin.
    const writer = await getAs(superAdmin, '/api/agent/credit-adjustments/pending').expect(200);
    expect(writer.body.readOnly).toBe(false);
    expect(writer.body.adjustments.map((row) => row.id)).toContain(adjPendingId);
  });

  // 708: shared annotations on a statement difference; private notes stay
  // private.
  test('708: owner annotates the entry and the manager (bookkeeper) sees it; a stranger gets 404', async () => {
    const added = await postAs(owner, `/api/statements/${businessDocId}/entries/${encodeURIComponent(entryId)}/annotations`, {
      body: 'This receivable looks $50 high against the invoice.',
    }).expect(201);
    expect(added.body.annotation).toMatchObject({
      product: 'business', documentId: businessDocId, entryId,
      body: 'This receivable looks $50 high against the invoice.',
    });
    expect(added.body.annotation.authorUserId).toBe(owner.id);

    const asManager = await getAs(manager, `/api/statements/${businessDocId}/entries/${encodeURIComponent(entryId)}/annotations`).expect(200);
    expect(asManager.body.annotations).toHaveLength(1);
    expect(asManager.body.annotations[0].body).toBe('This receivable looks $50 high against the invoice.');
    expect(asManager.body.annotations[0].authorName).toBe('Test Fixture');

    const second = await postAs(manager, `/api/statements/${businessDocId}/entries/${encodeURIComponent(entryId)}/annotations`, {
      body: 'Confirmed against invoice INV-2026-0001.',
    }).expect(201);
    expect(second.body.annotation.authorUserId).toBe(manager.id);

    const asOwner = await getAs(owner, `/api/statements/${businessDocId}/entries/${encodeURIComponent(entryId)}/annotations`).expect(200);
    expect(asOwner.body.annotations).toHaveLength(2);

    await getAs(stranger, `/api/statements/${businessDocId}/entries/${encodeURIComponent(entryId)}/annotations`).expect(404);
    await postAs(stranger, `/api/statements/${businessDocId}/entries/${encodeURIComponent(entryId)}/annotations`, {
      body: 'Should never land.',
    }).expect(404);
    await postAs(owner, `/api/statements/${businessDocId}/entries/${encodeURIComponent(entryId)}/annotations`, {
      body: '   ',
    }).expect(400);
  });

  test('708: private entry notes stay private — the manager cannot see the owner’s note', async () => {
    const saved = await postAs(owner, '/api/statements/exports/notes', {
      product: 'business', documentId: businessDocId, entryId, note: 'Owner-only working note.',
    }).expect(200);
    expect(saved.body.data.note).toBe('Owner-only working note.');

    const asOwner = await getAs(owner, `/api/statements/exports/notes?product=business&documentId=${businessDocId}&entryId=${encodeURIComponent(entryId)}`).expect(200);
    expect(asOwner.body.data).toHaveLength(1);

    const asManager = await getAs(manager, `/api/statements/exports/notes?product=business&documentId=${businessDocId}&entryId=${encodeURIComponent(entryId)}`).expect(200);
    expect(asManager.body.data).toHaveLength(0);
  });

  // 709: the checklist walks open -> matched -> closed.
  test('709: primary location checklist is open with matched + annotated steps done; second location is fully pending', async () => {
    const primary = await getAs(owner, `${reconBase()}/checklist?locationId=${locPrimary}&${periodQuery}`).expect(200);
    expect(primary.body.status).toBe('open');
    const byKey = Object.fromEntries(primary.body.steps.map((step) => [step.key, step]));
    expect(byKey.review_summary.status).toBe('done');
    expect(byKey.review_differences.status).toBe('pending');
    expect(byKey.review_differences.detail.openExceptionCount).toBe(1);
    expect(byKey.match_adjustments.status).toBe('done');
    expect(byKey.match_adjustments.detail.matchedExceptionCount).toBe(1);
    expect(byKey.annotate_differences.status).toBe('done');
    expect(byKey.annotate_differences.detail.annotatedExceptionCount).toBe(1);
    expect(byKey.record_period_close.status).toBe('pending');
    expect(primary.body.settlementApproval.approvedByThisReview).toBe(false);

    const second = await getAs(owner, `${reconBase()}/checklist?locationId=${locSecond}&${periodQuery}`).expect(200);
    expect(second.body.status).toBe('open');
    const secondByKey = Object.fromEntries(second.body.steps.map((step) => [step.key, step]));
    expect(secondByKey.match_adjustments.status).toBe('pending');
    expect(secondByKey.match_adjustments.detail.unmatchedExceptionCount).toBe(1);
    expect(secondByKey.annotate_differences.status).toBe('pending');
    expect(secondByKey.annotate_differences.detail.unannotatedExceptionCount).toBe(1);

    // Another restaurant's location cannot be probed.
    await getAs(owner, `${reconBase()}/checklist?locationId=${locOtherRestaurant}&${periodQuery}`).expect(404);
  });

  test('709: resolving the difference moves the checklist to matched; recording the review closes it', async () => {
    await pool.query(`UPDATE reconciliation_exceptions SET status = 'resolved', resolved_at = NOW() WHERE id = $1`, [excAId]);

    const matched = await getAs(owner, `${reconBase()}/checklist?locationId=${locPrimary}&${periodQuery}`).expect(200);
    expect(matched.body.status).toBe('matched');
    const byKey = Object.fromEntries(matched.body.steps.map((step) => [step.key, step]));
    expect(byKey.review_differences.status).toBe('done');
    expect(byKey.record_period_close.status).toBe('pending');

    const recorded = await postAs(owner, `${reconBase()}/period-close`, {
      locationId: locPrimary, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), currencyCode: 'USD',
    }).expect(201);
    expect(recorded.body.review).toBeTruthy();

    const closed = await getAs(owner, `${reconBase()}/checklist?locationId=${locPrimary}&${periodQuery}`).expect(200);
    expect(closed.body.status).toBe('closed');
    expect(Object.fromEntries(closed.body.steps.map((step) => [step.key, step])).record_period_close.status).toBe('done');
  });

  // 710: the closeout evidence package bundles all four pieces; every
  // download re-authorizes. Seeds its own open difference (excC) with a
  // matched adjustment and an annotation, so the test is independent of
  // the 709 test resolving excA above.
  test('710: package contains summary + differences + matched adjustments + annotations, and re-downloads', async () => {
    const excCId = await seedException({
      domain: 'payment_refund', referenceId: `food-order:9003-${runId}`, severity: 'warning', status: 'open',
      summary: 'Closeout package difference',
      details: { restaurantId, locationId: locPrimary, orderReferenceId: `9003-${runId}` },
    });
    const { rows: [adjC] } = await pool.query(
      `INSERT INTO credit_adjustments
         (customer_id, reconciliation_exception_id, amount_cents, currency_code, reason,
          proposed_by, status, applied_at, idempotency_key)
       VALUES ($1, $2, 250, 'USD', 'Closeout package adjustment', $3, 'applied', NOW(), $4)
       RETURNING id`,
      [customer.id, excCId, superAdmin.id, `g14b-adj-c-${runId}`],
    );
    await pool.query(
      `INSERT INTO oxsteed_credit_reconciliation_annotations
         (exception_id, author_type, author_user_id, body)
       VALUES ($1, 'participant', $2, 'Closeout package annotation.')`,
      [excCId, owner.id],
    );
    // The review already exists from the 709 test; the record call is
    // idempotent and returns the existing review.
    await postAs(owner, `${reconBase()}/period-close`, {
      locationId: locPrimary, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), currencyCode: 'USD',
    }).expect((res) => expect([200, 201]).toContain(res.status));

    const first = await postAs(owner, `${reconBase()}/closeout-package`, {
      locationId: locPrimary, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), currencyCode: 'USD',
    }).buffer(true).parse(parseZipBuffer).expect(200);
    expect(first.headers['content-type']).toBe('application/zip');
    expect(first.headers['content-disposition']).toMatch(/closeout-evidence-.*\.zip/);
    const files = readZip(first.body);
    expect(Object.keys(files).sort()).toEqual([
      'adjustments.json', 'annotations.json', 'differences.json', 'manifest.json', 'summary.json',
    ]);

    const manifest = JSON.parse(files['manifest.json'].toString('utf8'));
    expect(manifest.package).toBe('closeout-evidence');
    expect(manifest.restaurantId).toBe(Number(restaurantId));
    expect(manifest.locationId).toBe(locPrimary);
    expect(manifest.parts).toHaveLength(5);
    expect(manifest.counts.differences).toBe(1);
    expect(manifest.counts.matchedAdjustments).toBe(1);
    expect(manifest.counts.annotations).toBe(1);
    expect(manifest.settlementApproval.approvedByThisReview).toBe(false);

    const summary = JSON.parse(files['summary.json'].toString('utf8'));
    expect(summary.currencyCode).toBe('USD');
    expect(summary.periodCloseReview).toBeTruthy();

    const differences = JSON.parse(files['differences.json'].toString('utf8'));
    expect(differences).toHaveLength(1);
    expect(differences[0].id).toBe(excCId);
    expect(differences[0].annotations).toHaveLength(1);
    expect(differences[0].adjustments).toHaveLength(1);
    expect(differences[0].adjustments[0].id).toBe(adjC.id);

    const adjustments = JSON.parse(files['adjustments.json'].toString('utf8'));
    expect(adjustments.map((row) => row.id)).toContain(adjC.id);
    const annotations = JSON.parse(files['annotations.json'].toString('utf8'));
    expect(annotations).toHaveLength(1);
    expect(annotations[0].body).toBe('Closeout package annotation.');

    // Re-download works for the owner; a stranger gets 404.
    const second = await postAs(owner, `${reconBase()}/closeout-package`, {
      locationId: locPrimary, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), currencyCode: 'USD',
    }).buffer(true).parse(parseZipBuffer).expect(200);
    expect(readZip(second.body)['manifest.json']).toBeTruthy();

    await postAs(stranger, `${reconBase()}/closeout-package`, {
      locationId: locPrimary, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), currencyCode: 'USD',
    }).expect(404);
    const otherRestaurantBase = `/api/restaurants/${otherRestaurantId}/credit-reconciliation`;
    await postAs(owner, `${otherRestaurantBase}/closeout-package`, {
      locationId: locOtherRestaurant, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), currencyCode: 'USD',
    }).expect(404);
  });
});
