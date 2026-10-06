'use strict';

// Synthetic migrated PostgreSQL only. Real authentication, finance standing,
// source writers, support service and archive routes; private provider bytes
// are held in an isolated in-memory object store.
jest.unmock('pg');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');
const database = disposableDatabaseOptIn('STATEMENT_SELF_SERVICE_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
process.env.JWT_SECRET = 'synthetic-statement-self-service-jwt-key';
process.env.STATEMENT_ARTIFACT_BUCKET = 'synthetic-statement-private';
process.env.STATEMENT_ARTIFACT_PREFIX = 'synthetic-self-service';
const describeDatabase = database ? describe : describe.skip;
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Readable } = require('stream');
const pool = require('../db');
const { hashDocument } = require('../services/creditStatementService');
const artifacts = require('../services/statementArtifactService');
const amendments = require('../services/statementAmendmentService');
const walletService = require('../services/foodWalletService');
const supportController = require('../controllers/supportController');
const { authenticate } = require('../middleware/auth');
jest.setTimeout(120000);

test('self-service integration requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

function fakeStorage() {
  const objects = new Map();
  return { objects, uploadFile: async (key, bytes) => { objects.set(key, Buffer.from(bytes)); return key; },
    getObjectStream: async key => objects.has(key) ? Readable.from([objects.get(key)]) : null,
    getSignedDownloadUrl: async key => `https://signed.invalid/${key}?exp=${Math.floor(Date.now() / 1000) + 300}` };
}
async function user(role = 'customer') {
  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, didit_status, created_at)
    VALUES ($1,$2,'synthetic-unusable','Synthetic','Statement',$3,TRUE,TRUE,'verified','2026-01-01')`, [id, `${id}@example.invalid`, role]);
  return { id, role };
}
function token(actor) { return jwt.sign({ id: actor.id, role: actor.role }, process.env.JWT_SECRET); }
function headers(actor) { return { Authorization: `Bearer ${token(actor)}` }; }
async function business(owner) {
  return (await pool.query("INSERT INTO businesses(user_id,business_name,created_at) VALUES ($1,'Synthetic statement entity','2026-01-01') RETURNING id", [owner.id])).rows[0].id;
}
async function member(businessId, owner, actor, role) {
  await pool.query(`INSERT INTO business_members(business_id,owner_id,member_id,role,invite_email,status,accepted_at)
    VALUES ($1,$2,$3,$4,$5,'active',now())`, [businessId, owner.id, actor.id, role, `${actor.id}@example.invalid`]);
}
async function restaurant(businessId, owner) {
  return (await pool.query(`INSERT INTO food_restaurants(business_id,owner_user_id,display_name,currency_code,status)
    VALUES ($1,$2,'Synthetic statement restaurant','USD','active') RETURNING id`, [businessId, owner.id])).rows[0].id;
}
async function original(product, scope, owner, storage, currency = 'USD') {
  const document = { id: crypto.randomUUID(), version: 2, kind: 'monthly', product, currencyCode: currency,
    period: { from: '2026-07-01', to: '2026-07-31' }, generatedAt: '2026-08-01T00:00:00Z', ownerName: 'Synthetic owner', accountLabel: 'Synthetic account',
    openingBalanceCents: 0, totalCreditsCents: 0, totalDebitsCents: 0, closingBalanceCents: 0, transactionCount: 0, transactions: [],
    openingPayableCents: 0, postedEarningsCents: 0, settledPayoutsCents: 0, statusRemovalsCents: 0, closingPayableCents: 0,
    earnings: [], settled: [], removed: [], movements: [], earningsCount: 0, settledCount: 0, removedCount: 0,
    receivables: { openingOutstandingCents: 0, invoicedCents: 0, collectedOrAdjustedCents: 0, cancelledCents: 0, closingOutstandingCents: 0, invoices: [], invoiceCount: 0, movements: [] },
    payables: { expenses: [], expenseTotalCents: 0, expenseCount: 0 } };
  document.contentHash = hashDocument(document);
  const column = product === 'business' ? 'scope_business_id' : product === 'helper_earnings' ? 'scope_helper_user_id' : 'scope_restaurant_id';
  await pool.query(`INSERT INTO settlement_statement_documents(id,product,${column},currency_code,period_from,period_to,generated_at,document,content_hash)
    VALUES ($1,$2,$3,$4,'2026-07-01','2026-07-31',$5,$6,$7)`, [document.id, product, scope, currency, document.generatedAt, JSON.stringify(document), document.contentHash]);
  const snapshotId = crypto.randomUUID();
  await pool.query(`INSERT INTO statement_snapshots(id,issuance_key,product,account_id,account_uuid,currency_code,period_from,period_to,cutoff_at,
    row_count,total_credits_minor,total_debits_minor,opening_minor,closing_minor,source_hash,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,'2026-07-01','2026-07-31',now(),0,0,0,0,0,$7,now())`,
    [snapshotId, `stmt:v1:${product}:${scope}:${currency}:2026-07-01:2026-07-31:${owner.id}`, product,
      product === 'helper_earnings' ? null : scope, product === 'helper_earnings' ? scope : null, currency, document.contentHash]);
  const bytes = Buffer.from(`%PDF-1.7\n% synthetic ${document.id}\n`);
  await artifacts.publishOriginal({ snapshotId, language: 'en', pdfBytes: bytes, storage, settlementDocumentId: document.id });
  return { id: document.id, document, bytes, snapshotId, scope };
}
async function addVersion(fixture, proposer, approver, revision, previous, storage) {
  const proposalId = crypto.randomUUID(); const id = crypto.randomUUID();
  await pool.query(`INSERT INTO statement_amendment_proposals(id,issuance_key,product,account_id,account_uuid,currency_code,period_from,period_to,
    settlement_document_id,reason,status,proposed_by,decided_by,decided_at)
    VALUES ($1,$2,$3,$4,$5,'USD','2026-07-01','2026-07-31',$6,'Synthetic reviewed correction','approved',$7,$8,now())`,
    [proposalId, `synthetic:${proposalId}`, fixture.document.product, fixture.document.product === 'helper_earnings' ? null : fixture.scope,
      fixture.document.product === 'helper_earnings' ? fixture.scope : null, fixture.id, proposer.id, approver.id]);
  const document = { ...fixture.document, id, version: revision + 1, amendment: { reason: 'Synthetic reviewed correction', decidedBy: approver.id } };
  document.contentHash = hashDocument(document);
  const artifact = await artifacts.publishRendition({ snapshotId: fixture.snapshotId, language: 'en', label: `amended-v${revision}`,
    pdfBytes: Buffer.from(`%PDF-1.7\n% synthetic amended ${id}\n`), storage, settlementDocumentId: fixture.id });
  await pool.query(`INSERT INTO statement_amendment_versions(id,settlement_original_document_id,proposal_id,revision_number,amendment_type,presentation,
    document,content_hash,artifact_id,supersedes_version_id,prior_version_closing_minor,revised_closing_minor,continuity_status)
    VALUES ($1,$2,$3,$4,'clerical','restated',$5,$6,$7,$8,0,0,'continuous')`, [id,fixture.id,proposalId,revision,JSON.stringify(document),document.contentHash,artifact.id,previous]);
  return id;
}

describeDatabase('R09/R10/R12 real self-service API integration', () => {
  let app, storage, owner, manager, staff, stranger, helper, proposer, approver, businessId, restaurantId, documents, versions;
  beforeAll(async () => {
    [owner,manager,staff,stranger,helper,proposer,approver] = await Promise.all(['customer','customer','customer','customer','helper','admin','admin'].map(user));
    businessId = await business(owner); restaurantId = await restaurant(businessId, owner);
    await member(businessId,owner,manager,'manager'); await member(businessId,owner,staff,'employee');
    storage = fakeStorage(); app = express(); app.use(express.json());
    app.use('/api/statement-archive', require('../routes/statementArchive')({ storage }));
    app.use('/api/statements', require('../routes/statementRenditions'));
    app.use('/api', require('../routes/statementInvestigation'));
    app.get('/api/support/my-tickets/:ticketId', authenticate, supportController.getMyTicket);
    app.use((error,_req,res,_next) => res.status(error.statusCode || error.status || 500).json({ code: error.code, error: error.message }));
    documents = await Promise.all([original('business',businessId,owner,storage),original('restaurant_settlement',restaurantId,owner,storage),original('helper_earnings',helper.id,helper,storage)]);
    const v1 = await addVersion(documents[0],proposer,approver,1,null,storage);
    const v2 = await addVersion(documents[0],proposer,approver,2,v1,storage);
    versions = [v1,v2];
  });
  afterAll(async () => { await pool.end(); });

  test('all settlement owners can list/read/download originals, and strangers cannot', async () => {
    for (const fixture of documents) {
      const actor = fixture.document.product === 'helper_earnings' ? helper : owner;
      const list = await request(app).get('/api/statement-archive/archive').query({ product: fixture.document.product }).set(headers(actor)).expect(200);
      expect(list.body.items.some(item => item.id === fixture.id && item.revision === 1)).toBe(true);
      const detail = await request(app).get(`/api/statement-archive/archive/${fixture.id}`).set(headers(actor)).expect(200);
      expect(detail.body.document.totals.closingMinor).toBe(0);
      const download = await request(app).get(`/api/statement-archive/archive/${fixture.id}/download`).set(headers(actor)).expect(200);
      expect(download.body).toEqual(fixture.bytes);
      await request(app).get(`/api/statement-archive/archive/${fixture.id}`).set(headers(stranger)).expect(404);
      await request(app).get(`/api/statement-archive/archive/${fixture.id}/download`).set(headers(stranger)).expect(404);
    }
  });

  test('current finance managers have merchant access, staff are denied, and removal revokes reads/downloads/versions', async () => {
    for (const fixture of documents.slice(0,2)) {
      await request(app).get(`/api/statement-archive/archive/${fixture.id}`).set(headers(manager)).expect(200);
      await request(app).get(`/api/statement-archive/archive/${fixture.id}`).set(headers(staff)).expect(404);
    }
    await request(app).get(`/api/statement-archive/archive/${versions[1]}`).set(headers(manager)).expect(200);
    await pool.query("UPDATE business_members SET status='revoked' WHERE business_id=$1 AND member_id=$2", [businessId,manager.id]);
    for (const id of [documents[0].id,documents[1].id,versions[1]]) {
      await request(app).get(`/api/statement-archive/archive/${id}`).set(headers(manager)).expect(404);
      await request(app).get(`/api/statement-archive/archive/${id}/download`).set(headers(manager)).expect(404);
    }
    await pool.query("UPDATE business_members SET status='active' WHERE business_id=$1 AND member_id=$2", [businessId,manager.id]);
  });

  test('nested correction chains keep pagination counts consistent across tied periods and currency filters', async () => {
    const second = await original('business',businessId,owner,storage,'EUR');
    const first = await request(app).get('/api/statement-archive/archive?product=business&per_page=1&page=1').set(headers(owner)).expect(200);
    const next = await request(app).get('/api/statement-archive/archive?product=business&per_page=1&page=2').set(headers(owner)).expect(200);
    expect(first.body).toMatchObject({ total:2, perPage:1, totalPages:2, paginationUnit:'originals' });
    expect(first.body.items).toHaveLength(1); expect(next.body.items).toHaveLength(1);
    expect(new Set([...first.body.items,...next.body.items].map(item => item.id)).size).toBe(2);
    expect([first.body.items[0].id,next.body.items[0].id]).toEqual(expect.arrayContaining([documents[0].id,second.id]));
    const filtered = await request(app).get('/api/statement-archive/archive?product=business&currency=USD&year=2026&month=7').set(headers(owner)).expect(200);
    expect(filtered.body.total).toBe(1); expect(filtered.body.items[0].versionCount).toBe(2);
    expect(filtered.body.items[0].versions.map(version => version.id)).toEqual(versions);
  });

  test('authenticated accessible HTML covers three settlement products and versions in five languages', async () => {
    for (const language of ['en','es','fr','ht','ar']) for (const fixture of documents) {
      const actor = fixture.document.product === 'helper_earnings' ? helper : owner;
      const html = await request(app).get(`/api/statements/documents/${fixture.id}/renditions/${language}/html`).set(headers(actor)).expect(200);
      expect(html.text).toContain(`lang="${language}"`);
      if (language === 'ar') expect(html.text).toContain('dir="rtl"');
      expect(html.text).toContain('<h1');
    }
    await request(app).get(`/api/statements/documents/${versions[1]}/renditions/en/html`).set(headers(owner)).expect(200);
    await request(app).get(`/api/statements/documents/${versions[1]}/renditions/en/html`).set(headers(stranger)).expect(404);
  });

  test('Restaurant Credit retries create one existing support ticket with exact evidence and no financial change', async () => {
    const customer = await user(); const client = await pool.connect(); let posted;
    try { await client.query('BEGIN'); posted = await walletService.applyWalletLedgerEntry(client, { restaurantId,customerId:customer.id,currencyCode:'USD',entryType:'credit',amountCents:1000,
      description:'Synthetic isolated wallet credit',referenceType:'merchant_load',referenceId:crypto.randomUUID(),idempotencyKey:crypto.randomUUID() }); await client.query('COMMIT'); }
    catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    const document = { id:crypto.randomUUID(),version:1,kind:'monthly',product:'restaurant',currencyCode:'USD',period:{from:'2026-09-01',to:'2026-09-30'},generatedAt:'2026-10-01T00:00:00Z',transactions:[{id:String(posted.entry.id),date:'2026-09-15T12:00:00Z',type:'load',creditCents:1000,debitCents:0,balanceAfterCents:1000}], openingBalanceCents:0,closingBalanceCents:1000,totalCreditsCents:1000,totalDebitsCents:0,transactionCount:1 };
    document.contentHash = hashDocument(document);
    await pool.query(`INSERT INTO credit_statement_documents(id,customer_id,product,account_id,currency_code,period_from,period_to,generated_at,document,content_hash)
      VALUES ($1,$2,'restaurant',$3,'USD','2026-09-01','2026-09-30',now(),$4,$5)`, [document.id,customer.id,posted.account.id,JSON.stringify(document),document.contentHash]);
    const route = `/api/statements/${document.id}/entries/${posted.entry.id}`;
    const before = (await pool.query('SELECT balance_cents,ledger_version,last_entry_hash FROM food_customer_wallet_accounts WHERE id=$1',[posted.account.id])).rows[0];
    const first = await request(app).post(`${route}/cases`).set(headers(customer)).send({reason:'unrecognized'}).expect(201);
    const replay = await request(app).post(`${route}/cases`).set(headers(customer)).send({reason:'unrecognized'}).expect(200);
    expect(replay.body.caseId).toBe(first.body.caseId); expect(replay.body.replayed).toBe(true);
    expect(first.body.statement).toMatchObject({documentId:document.id,revision:1,entryId:String(posted.entry.id),accountId:String(posted.account.id),restaurantId:String(restaurantId),contentHash:document.contentHash});
    await request(app).post(`${route}/cases`).set(headers(stranger)).send({reason:'unrecognized'}).expect(404);
    await pool.query("UPDATE support_tickets SET status='in_progress' WHERE id=$1",[first.body.caseId]);
    const cases = await request(app).get(`${route}/cases`).set(headers(customer)).expect(200);
    expect(cases.body.cases).toHaveLength(1); expect(cases.body.cases[0].status).toBe('in_progress');
    await request(app).get(first.body.detailUrl.replace('/support/','/api/support/')).set(headers(customer)).expect(200);
    await request(app).get(first.body.detailUrl.replace('/support/','/api/support/')).set(headers(stranger)).expect(404);
    const after = (await pool.query('SELECT balance_cents,ledger_version,last_entry_hash FROM food_customer_wallet_accounts WHERE id=$1',[posted.account.id])).rows[0];
    expect(after).toEqual(before);
    expect((await pool.query('SELECT count(*)::int AS n FROM support_messages WHERE ticket_id=$1',[first.body.caseId])).rows[0].n).toBe(1);
  });
});
