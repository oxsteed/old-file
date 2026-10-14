'use strict';

/**
 * P2-5-F04 residual: the settlement-statement on-demand path
 * (GET /api/settlement-statements/issue -> settlementStatementService.buildStatement)
 * must honor the same 72h issuance grace window the credit path enforces.
 * buildStatement takes the client directly, so these tests use a hand-rolled
 * fake client: no database required.
 */

const statements = require('../services/settlementStatementService');
const { hashDocument } = require('../services/creditStatementService');

const REQUESTER = 'owner-user-1';
const MONTH = { from: '2026-09-01', to: '2026-09-30' }; // monthly (archived)
const GRACE_NOW = '2026-10-02T12:00:00.000Z'; // within 72h of the 2026-09-30 month end
const AFTER_GRACE_NOW = '2026-10-04T00:00:01.000Z';

const RESTAURANT = { id: 7, display_name: 'Bistro', business_id: 3, owner_user_id: 'u1', created_at: '2026-01-01T00:00:00Z' };
const ACCOUNT = { id: 'acc-1', currency_code: 'USD', created_at: '2026-01-01T00:00:00Z' };
const JOURNAL_ROW = {
  id: 'e1', date: '2026-09-12T12:00:00.000Z', type: 'sub_bank_load',
  amount_cents: '500', balance_after_cents: '1500', direction: 'credit',
  description: 'load', reference_type: null, reference_id: null,
};

function fakeClient({ now, saved = null } = {}) {
  const calls = [];
  const query = jest.fn(async (sql, values = []) => {
    calls.push(sql);
    if (sql.includes('transaction_timestamp()')) return { rows: [{ now }] };
    if (sql.includes('FROM settlement_statement_documents')) return { rows: saved ? [saved] : [] };
    if (sql.includes('FROM food_restaurants fr WHERE fr.id')) return { rows: [RESTAURANT] };
    if (sql.includes('restaurant_sub_bank')) return { rows: [ACCOUNT] };
    if (sql.includes('oxsteed_credit_transaction_entries')) {
      if (sql.includes('LIMIT $6')) return { rows: [JOURNAL_ROW] };
      if (values.length === 4) return { rows: [{ balance_after_cents: '1500' }] }; // closing
      return { rows: [{ balance_after_cents: '1000' }] }; // opening
    }
    if (sql.includes('FROM oxsteed_credit_settlements')) return { rows: [] };
    if (sql.includes('FROM restaurant_payouts')) return { rows: [] };
    if (sql.includes('FROM food_orders')) return { rows: [] };
    if (sql.includes('FROM oxsteed_credit_partners')) return { rows: [] };
    if (sql.includes('INSERT INTO settlement_statement_documents')) return { rows: [] };
    throw new Error(`unexpected query in fixture: ${sql.slice(0, 80)}`);
  });
  return { query, calls };
}

const OPTIONS = { product: 'restaurant_settlement', restaurantId: 7, currencyCode: 'USD' };
const inserted = (calls) => calls.some((sql) => sql.includes('INSERT INTO settlement_statement_documents'));

describe('P2-5-F04 issuance grace window on the settlement on-demand path', () => {
  test('monthly build inside the grace window fails closed with 409', async () => {
    const client = fakeClient({ now: GRACE_NOW });
    await expect(statements.buildStatement(client, REQUESTER, { ...OPTIONS, ...MONTH }))
      .rejects.toMatchObject({ code: 'statement_grace_not_elapsed', statusCode: 409 });
    expect(inserted(client.calls)).toBe(false);
  });

  test('monthly build after the grace window succeeds and archives', async () => {
    const client = fakeClient({ now: AFTER_GRACE_NOW });
    const document = await statements.buildStatement(client, REQUESTER, { ...OPTIONS, ...MONTH });
    expect(document.kind).toBe('monthly');
    expect(document.closingBalanceCents).toBe(1500);
    expect(inserted(client.calls)).toBe(true);
  });

  test('interim build inside the grace window is not gated', async () => {
    const client = fakeClient({ now: GRACE_NOW });
    const document = await statements.buildStatement(client, REQUESTER,
      { ...OPTIONS, from: '2026-10-01', to: '2026-10-02' });
    expect(document.kind).toBe('interim');
  });

  test('archived monthly reads bypass the grace gate', async () => {
    const body = { kind: 'monthly', product: 'restaurant_settlement' };
    const saved = { document: { ...body, contentHash: hashDocument(body) } };
    saved.content_hash = saved.document.contentHash;
    const client = fakeClient({ now: GRACE_NOW, saved });
    const document = await statements.buildStatement(client, REQUESTER, { ...OPTIONS, ...MONTH });
    expect(document.kind).toBe('monthly');
    expect(inserted(client.calls)).toBe(false);
  });

  test('rederive monthly rebuild inside the grace window is not gated', async () => {
    const client = fakeClient({ now: GRACE_NOW });
    const document = await statements.buildStatement(client, REQUESTER,
      { ...OPTIONS, ...MONTH, rederive: true });
    expect(document.kind).toBe('monthly');
    // Rederive rebuilds from current records without touching the archive.
    expect(inserted(client.calls)).toBe(false);
  });
});
