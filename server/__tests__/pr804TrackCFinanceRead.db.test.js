'use strict';

// PR #804 Track C — G-8: finance reads/writes are gated on the migration-245
// permission codes, not on the manager role alone.
//
// Reproduces the audit finding on unmodified code: a representative with an
// invoices.view override could not read business finance, and a manager
// could void/delete invoices without holding payouts.manage. After the fix
// the codes are load-bearing: read via any finance read code, write via
// invoices.create, and GET /api/invoices shows business-issued invoices to
// finance readers.
//
// DB-backed; runs against the track-C database only
// (STATEMENT_TEST_DATABASE_URL must point at credit_statement_test_pr804_c).
// Never run against the shared credit_statement_test DB: other tracks run
// concurrently.

const crypto = require('crypto');

const TEST_DB_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';
if (!TEST_DB_URL.includes('/credit_statement_test_pr804_c')) {
  throw new Error('pr804TrackCFinanceRead requires STATEMENT_TEST_DATABASE_URL for credit_statement_test_pr804_c');
}
process.env.DATABASE_URL = TEST_DB_URL;

jest.unmock('pg');
jest.unmock('../db');
const db = require('../db');
const ownership = require('../utils/businessOwnership');
const invoicesSvc = require('../services/userInvoicesService');

const ownerId = '11111111-1111-4111-8111-111111111111';
const managerId = '22222222-2222-4222-8222-222222222222';
const managerDeniedId = '33333333-3333-4333-8333-333333333333';
const repId = '44444444-4444-4444-8444-444444444444';
const repReaderId = '55555555-5555-4555-8555-555555555555';
const outsiderId = '66666666-6666-4666-8666-666666666666';
const bizSuffix = crypto.randomBytes(4).toString('hex');
let bizId;
let ownerInvoiceId;
let managerMembershipId;
let managerDeniedMembershipId;
let repReaderMembershipId;

async function seedUser(id, email) {
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name)
     VALUES ($1, $2, 'x', 'Test', 'User') ON CONFLICT (id) DO NOTHING`,
    [id, email],
  );
}

async function addMember(memberId, role) {
  const { rows } = await db.query(
    `INSERT INTO business_members (business_id, member_id, owner_id, role, invite_email, status)
     VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
    [bizId, memberId, ownerId, role, `${role}-${memberId.slice(0, 8)}-${bizSuffix}@example.test`],
  );
  return rows[0].id;
}

async function addOverride(membershipId, code, effect) {
  await db.query(
    `INSERT INTO membership_permission_overrides (membership_id, permission_id, effect)
     SELECT $1, p.id, $3 FROM team_permissions p WHERE p.code = $2
     ON CONFLICT DO NOTHING`,
    [membershipId, code, effect],
  );
}

describe('G-8 finance read scope (PR #804 track C)', () => {
  beforeAll(async () => {
    for (const [id, email] of [
      [ownerId, `pr804c-owner-${bizSuffix}@example.test`],
      [managerId, `pr804c-manager-${bizSuffix}@example.test`],
      [managerDeniedId, `pr804c-mgrdeny-${bizSuffix}@example.test`],
      [repId, `pr804c-rep-${bizSuffix}@example.test`],
      [repReaderId, `pr804c-repreader-${bizSuffix}@example.test`],
      [outsiderId, `pr804c-outsider-${bizSuffix}@example.test`],
    ]) await seedUser(id, email);

    const { rows } = await db.query(
      `INSERT INTO businesses (business_name, user_id, is_active)
       VALUES ($1, $2, TRUE) RETURNING id`,
      [`PR804C Biz ${bizSuffix}`, ownerId],
    );
    bizId = rows[0].id;

    managerMembershipId = await addMember(managerId, 'manager');
    managerDeniedMembershipId = await addMember(managerDeniedId, 'manager');
    await addMember(repId, 'representative');
    repReaderMembershipId = await addMember(repReaderId, 'representative');
    // Accountant: a representative with an explicit invoices.view override.
    await addOverride(repReaderMembershipId, 'invoices.view', 'allow');
    // Manager explicitly denied every finance read code.
    for (const code of ['invoices.view', 'payments.view', 'payouts.view']) {
      await addOverride(managerDeniedMembershipId, code, 'deny');
    }

    const inv = await db.query(
      `INSERT INTO business_invoices
         (user_id, business_id, invoice_number, client_name, client_email, status, total)
       VALUES ($1, $2, $3, 'Acme', 'acme@example.test', 'sent', 100) RETURNING id`,
      [ownerId, bizId, `PR804C-${bizSuffix}`],
    );
    ownerInvoiceId = inv.rows[0].id;
  });

  afterAll(async () => {
    // Defensive cleanup: each step tolerates a partially-seeded run.
    const clean = async (sql, params) => { try { await db.query(sql, params); } catch (_) {} };
    if (ownerInvoiceId) await clean('DELETE FROM business_invoices WHERE id = $1', [ownerInvoiceId]);
    if (bizId) {
      await clean(`DELETE FROM membership_permission_overrides mpo
                    USING business_members bm
                   WHERE mpo.membership_id = bm.id AND bm.business_id = $1`, [bizId]);
      await clean('DELETE FROM business_members WHERE business_id = $1', [bizId]);
      await clean('DELETE FROM businesses WHERE id = $1', [bizId]);
    }
    await clean('DELETE FROM users WHERE id = ANY($1::uuid[])',
      [[ownerId, managerId, managerDeniedId, repId, repReaderId, outsiderId]]);
    await db.end();
  });

  test('owner and manager read finance; plain representative does not', async () => {
    expect(await ownership.canReadBusinessFinance(ownerId, bizId)).not.toBeNull();
    expect(await ownership.canReadBusinessFinance(managerId, bizId)).not.toBeNull();
    expect(await ownership.canReadBusinessFinance(repId, bizId)).toBeNull();
    expect(await ownership.canReadBusinessFinance(outsiderId, bizId)).toBeNull();
  });

  test('representative with an invoices.view override reads finance', async () => {
    expect(await ownership.canReadBusinessFinance(repReaderId, bizId)).not.toBeNull();
  });

  test('manager with deny overrides on every read code loses finance read', async () => {
    expect(await ownership.canReadBusinessFinance(managerDeniedId, bizId)).toBeNull();
  });

  test('finance writes need invoices.create; managers do not hold payouts.manage', async () => {
    expect(await ownership.canWriteBusinessFinance(managerId, bizId)).not.toBeNull();
    expect(await ownership.canWriteBusinessFinance(managerId, bizId, 'payouts.manage')).toBeNull();
    expect(await ownership.canWriteBusinessFinance(repReaderId, bizId)).toBeNull();
    expect(await ownership.canWriteBusinessFinance(repId, bizId)).toBeNull();
    expect(await ownership.canWriteBusinessFinance(ownerId, bizId, 'payouts.manage')).not.toBeNull();
  });

  test('finance-readable business ids include override readers, exclude plain reps', async () => {
    const forReader = await invoicesSvc.listFinanceReadableBusinessIds(repReaderId);
    expect(forReader).toContain(bizId);
    const forRep = await invoicesSvc.listFinanceReadableBusinessIds(repId);
    expect(forRep).not.toContain(bizId);
    const forManager = await invoicesSvc.listFinanceReadableBusinessIds(managerId);
    expect(forManager).toContain(bizId);
  });

  test('GET /api/invoices list shows the owner-issued invoice to a finance reader', async () => {
    const readerBiz = await invoicesSvc.listFinanceReadableBusinessIds(repReaderId);
    const { invoices } = await invoicesSvc.listUserInvoices({
      userId: repReaderId, userEmail: `pr804c-repreader-${bizSuffix}@example.test`,
      view: 'issued', businessIds: readerBiz,
    });
    expect(invoices.map((i) => Number(i.source_id))).toContain(Number(ownerInvoiceId));

    const repBiz = await invoicesSvc.listFinanceReadableBusinessIds(repId);
    const repList = await invoicesSvc.listUserInvoices({
      userId: repId, userEmail: `pr804c-rep-${bizSuffix}@example.test`,
      view: 'issued', businessIds: repBiz,
    });
    expect(repList.invoices.map((i) => Number(i.source_id))).not.toContain(Number(ownerInvoiceId));

    const single = await invoicesSvc.getUserInvoiceById({
      compositeId: String(ownerInvoiceId), userId: repReaderId,
      userEmail: `pr804c-repreader-${bizSuffix}@example.test`, role: 'customer',
      businessIds: readerBiz,
    });
    expect(single).not.toBeNull();
    expect(Number(single.source_id)).toBe(Number(ownerInvoiceId));
    const repSingle = await invoicesSvc.getUserInvoiceById({
      compositeId: String(ownerInvoiceId), userId: repId,
      userEmail: `pr804c-rep-${bizSuffix}@example.test`, role: 'customer',
      businessIds: repBiz,
    });
    expect(repSingle).toBeNull();
  });
});
