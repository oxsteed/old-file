'use strict';

// Explicit opt-in to the shared disposable synthetic database; never load .env.
jest.unmock('pg');
const databaseUrl = process.env.STATEMENT_TEST_DATABASE_URL;
const permitted = (() => {
  try { const u = new URL(databaseUrl); return ['postgres:', 'postgresql:'].includes(u.protocol)
    && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && u.pathname === '/credit_statement_test'; }
  catch { return false; }
})();
if (permitted) process.env.DATABASE_URL = databaseUrl;
const dbDescribe = permitted ? describe : describe.skip;
const pool = require('../db');
const statements = require('../services/settlementStatementService');
const history = require('../services/settlementFinancialHistory');
const { documentToCsv } = require('../routes/settlementStatementArchive').testHooks;
const copy = require('../locales/statement-copy.json');
const { normalizeSettlementDocument, renderSettlementStatementPdf } = require('../services/settlementStatementPdf');
const invoicesController = require('../controllers/businessInvoiceController');
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');

test('financial-history DB suite requires explicit synthetic disposable database opt-in', () => {
  expect(permitted).toBe(Boolean(databaseUrl && permitted));
});

dbDescribe('source capture and integrated settlement builders on PostgreSQL (694)', () => {
  let owner; let helper; let business; let invoiceId; let jobId; let today;
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/694_settlement_source_history.sql'), 'utf8');
  const options = product => ({ product, currencyCode: 'USD', businessId: business, helperId: helper, from: today, to: today });
  const getDocument = product => statements.getStatement(product === 'helper_earnings' ? helper : owner, options(product));
  beforeAll(async () => {
    // Assigned new migration only. Parent rehearses the complete catalog on a
    // fresh disposable DB after all agents finalize their migrations.
    await pool.query(migration);
    const tag = crypto.randomBytes(8).toString('hex');
    owner = crypto.randomUUID(); helper = crypto.randomUUID();
    for (const [id, label] of [[owner, 'owner'], [helper, 'helper']]) {
      await pool.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,email_verified,is_active,created_at)
        VALUES($1,$2,'synthetic-fixture','Synthetic',$3,'customer',true,true,'2020-01-01')`, [id, `${label}-${tag}@example.test`, label]);
    }
    const { rows: [b] } = await pool.query(`INSERT INTO businesses(user_id,business_name,currency_code,created_at)
      VALUES($1,$2,'USD','2020-01-01') RETURNING id`, [owner, `Synthetic history ${tag}`]);
    business = b.id;
    const { rows: [clock] } = await pool.query('SELECT (clock_timestamp() AT TIME ZONE \'UTC\')::date::text AS today'); today = clock.today;
    const { rows: [inv] } = await pool.query(`INSERT INTO business_invoices(user_id,business_id,invoice_number,client_name,status,issue_date,total,amount_paid,currency_code)
      VALUES($1,$2,$3,'=1+1','sent',$4,100,0,'USD') RETURNING id`, [owner, business, `INV-${tag}`, today]); invoiceId = inv.id;
    const { rows: [j] } = await pool.query(`INSERT INTO jobs(client_id,assigned_helper_id,title,description,status,payout_status,completed_at,helper_payout_cents,platform_fee_cents,customer_total_cents,currency_code)
      VALUES($1,$2,'Synthetic history job','Synthetic history job','completed','earned',clock_timestamp(),10000,1500,11500,'USD') RETURNING id`, [owner, helper]); jobId = j.id;
  }, 120000);
  afterAll(async () => { await pool.end(); });

  test('migration applies twice without duplicate baselines or financial mutations', async () => {
    const { rows: [before] } = await pool.query('SELECT count(*)::text AS n FROM settlement_source_history');
    await pool.query(migration);
    const { rows: [after] } = await pool.query('SELECT count(*)::text AS n FROM settlement_source_history');
    expect(after.n).toBe(before.n);
    const { rows: [source] } = await pool.query('SELECT total::text, amount_paid::text FROM business_invoices WHERE id=$1', [invoiceId]);
    expect(source).toMatchObject({ total: '100.00', amount_paid: '0.00' });
  });
  test('existing invoice writer captures partial/multiple payments and source correction', async () => {
    const initial = await getDocument('business');
    expect(initial.receivables).toMatchObject({ invoicedCents: 10000, collectedOrAdjustedCents: 0, closingOutstandingCents: 10000 });
    for (const amount of [30, 40, 60, 100]) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await invoicesController.markInvoicePaid({ user: { id: owner }, params: { id: String(business), invoiceId: String(invoiceId) }, body: { amount } }, res);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json.mock.calls[0][0].invoice).toBeDefined();
    }
    const doc = await getDocument('business');
    expect(doc.receivables).toMatchObject({ invoicedCents: 10000, collectedOrAdjustedCents: 10000, closingOutstandingCents: 0 });
    expect(doc.receivables.movements.map(m => m.collectedOrAdjustedCents)).toEqual([0, 3000, 4000, -1000, 4000]);
    expect(documentToCsv(doc, copy.en)).toContain('"\'=1+1"');
    expect(normalizeSettlementDocument(doc).summary.find(s => s.labelKey === 'collectedAdjusted').minor).toBe(10000);
    const pdf = await renderSettlementStatementPdf(doc);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
  test('capture is atomic with source transaction rollback', async () => {
    const client = await pool.connect();
    const { rows: [before] } = await client.query(`SELECT count(*)::text AS n FROM settlement_source_history WHERE source_kind='business_invoice' AND source_id=$1`, [String(invoiceId)]);
    try {
      await client.query('BEGIN');
      await client.query('UPDATE business_invoices SET amount_paid=50,status=\'partial\' WHERE id=$1', [invoiceId]);
      await client.query('ROLLBACK');
      const { rows: [after] } = await client.query(`SELECT count(*)::text AS n FROM settlement_source_history WHERE source_kind='business_invoice' AND source_id=$1`, [String(invoiceId)]);
      expect(after.n).toBe(before.n);
    } finally { client.release(); }
    expect((await getDocument('business')).receivables.closingOutstandingCents).toBe(0);
  });
  test('history cannot be rewritten, truncated or directly fabricated', async () => {
    await expect(pool.query(`UPDATE settlement_source_history SET recorded_at='2026-01-01' WHERE source_kind='business_invoice' AND source_id=$1`, [String(invoiceId)])).rejects.toThrow(/immutable/);
    await expect(pool.query(`DELETE FROM settlement_source_history WHERE source_kind='business_invoice' AND source_id=$1`, [String(invoiceId)])).rejects.toThrow(/immutable/);
    await expect(pool.query('TRUNCATE settlement_source_history')).rejects.toThrow(/immutable/);
    await expect(pool.query(`INSERT INTO settlement_source_history(source_kind,source_id,operation,source)
      VALUES('business_invoice','fake','insert','{}')`)).rejects.toThrow(/authoritative source write/);
  });
  test('helper failure/retry/settlement/reversal retain actual owed amounts without payouts', async () => {
    expect((await getDocument('helper_earnings')).closingPayableCents).toBe(10000);
    await pool.query("UPDATE jobs SET payout_status='failed' WHERE id=$1", [jobId]);
    expect((await getDocument('helper_earnings')).closingPayableCents).toBe(10000);
    await pool.query("UPDATE jobs SET payout_status='pending' WHERE id=$1", [jobId]);
    expect((await getDocument('helper_earnings')).buckets.inTransitCents).toBe(10000);
    await pool.query("UPDATE jobs SET payout_status='paid',paid_at=clock_timestamp() WHERE id=$1", [jobId]);
    expect((await getDocument('helper_earnings')).closingPayableCents).toBe(0);
    await pool.query("UPDATE jobs SET payout_status='reversed' WHERE id=$1", [jobId]);
    const reversed = await getDocument('helper_earnings');
    expect(reversed).toMatchObject({ settledPayoutsCents: 0, statusRemovalsCents: 0, closingPayableCents: 10000 });
    expect(reversed.settled.map(s => s.helperPayoutCents)).toEqual([10000, -10000]);
    expect(reversed.movements.every(m => m.sourceHistoryId && m.recordedAt)).toBe(true);
  });
  test('a dated customer refund with no helper net allocation blocks instead of inventing a reduction', async () => {
    await pool.query(`INSERT INTO payments(job_id,payer_id,payee_id,amount,platform_fee,helper_payout,currency,status,escrow_status,refund_amount,refunded_at)
      VALUES($1,$2,$3,115,15,100,'usd','refunded','refunded',20,clock_timestamp())`, [jobId, owner, helper]);
    await expect(getDocument('helper_earnings')).rejects.toMatchObject({ status: 409, code: 'statement_source_history_unavailable' });
  });
  test('expense first/last/leap-day boundaries and currency evidence round-trip through real SQL', async () => {
    for (const [date, amount] of [['2024-02-01', 100], ['2024-02-29', 1234], ['2024-03-01', 300], ['2026-09-01', 200], ['2026-09-30', 1234], ['2026-10-01', 400]]) {
      await pool.query(`INSERT INTO business_expenses(business_id,category,description,amount_cents,expense_date)
        VALUES($1,'materials','Synthetic boundary',$2,$3)`, [business, amount, date]);
    }
    const leap = await statements.getStatement(owner, { ...options('business'), from: '2024-02-01', to: '2024-02-29' });
    expect(leap.payables.totalExpensesCents).toBe(1334); expect(leap.payables.expenseCount).toBe(2);
    const sep = await statements.getStatement(owner, { ...options('business'), from: '2026-09-01', to: '2026-09-30' });
    expect(sep.payables.totalExpensesCents).toBe(1434); expect(sep.payables.expenseCount).toBe(2);
    const { rows: [expense] } = await pool.query('SELECT id,statement_currency_code,statement_minor_unit_digits FROM business_expenses WHERE business_id=$1 LIMIT 1', [business]);
    expect(expense).toMatchObject({ statement_currency_code: 'USD', statement_minor_unit_digits: 2 });
    await expect(pool.query("UPDATE business_expenses SET statement_currency_code='JPY' WHERE id=$1", [expense.id])).rejects.toThrow(/immutable/);
    await pool.query("UPDATE businesses SET currency_code='EUR' WHERE id=$1", [business]);
    const rebuilt = await statements.getStatement(owner, { ...options('business'), from: '2024-02-01', to: '2024-02-29', rederive: true });
    expect(rebuilt.payables.totalExpensesCents).toBe(1334);
    const stored = await statements.getStatement(owner, { ...options('business'), from: '2024-02-01', to: '2024-02-29' });
    expect(stored.id).toBe(leap.id); expect(stored.contentHash).toBe(leap.contentHash);
    await expect(pool.query("UPDATE settlement_statement_documents SET currency_code='JPY' WHERE id=$1", [leap.id])).rejects.toThrow(/immutable/);
  });
  test('stored source evidence records database clock time and retains exact source IDs', async () => {
    const { rows: [row] } = await pool.query(`SELECT id, recorded_at, source_id, source->>'amount_paid' AS paid
      FROM settlement_source_history WHERE source_kind='business_invoice' AND source_id=$1 ORDER BY id DESC LIMIT 1`, [String(invoiceId)]);
    expect(row.source_id).toBe(String(invoiceId)); expect(row.paid).toBe('100.00');
    expect(new Date(row.recorded_at).toISOString().slice(0, 10)).toBe(today);
    const rows = await history.readSourceHistory(pool, 'business_invoice', business, 'USD');
    expect(rows.some(r => String(r.id) === String(row.id))).toBe(true);
  });
});
