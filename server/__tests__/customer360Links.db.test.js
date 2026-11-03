'use strict';

// Customer 360 upgrade 5 on PostgreSQL: keyed signal digests, weighted
// edges, common-value suppression, grant-filtered kinds, and a merge review
// that needs a full checklist and two distinct admins — and merges nothing.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CUSTOMER360_TEST_DATABASE_URL');
if (database) {
  process.env.DATABASE_URL = database;
  process.env.CUSTOMER360_SIGNAL_HMAC_KEY = 'test-signal-key-0123456789abcdef0123456789';
}
const describeDatabase = database ? describe : describe.skip;
const crypto = require('crypto');
const links = require('../services/customer360Links');

jest.setTimeout(120000);

test('edge scores combine distinct kinds and ignore repeats', () => {
  expect(links.score(['card'])).toBe(0.9);
  expect(links.score(['address', 'address'])).toBe(0.3);
  expect(links.score(['device', 'address'])).toBe(0.72);
  expect(links.score(['card', 'bank', 'device', 'address'])).toBe(0.997);
  expect(links.visibleKinds({ financial: false, security: false })).toEqual(['address']);
  expect(links.cardFingerprint({ latest_charge: 'ch_1' })).toBeNull();
  expect(links.cardFingerprint({ latest_charge: { payment_method_details: { card: { fingerprint: 'Abc123XYZ987' } } } })).toBe('Abc123XYZ987');
  expect(links.signalKey({})).toBeNull();
});

test('link graph DB test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('customer360 link graph and merge review', () => {
  let pool;
  const ALL = ['address', 'card', 'bank', 'device'];
  async function createUser(extra = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, signup_device_fingerprint, address_line1, zip_code)
       VALUES ($1, $2, 'synthetic-unusable', 'Lin', 'Kage', $3, $4, $5, $6)`,
      [id, `c360-link-${id}@example.invalid`, extra.role || 'customer', extra.device || null, extra.address || null, extra.zip || null]);
    return id;
  }
  beforeAll(() => { pool = require('../db'); });
  afterAll(async () => { await pool.end?.(); });

  test('signals are digests; edges weight shared kinds; common values are suppressed', async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const a = await createUser({ device: `dev-${tag}`, address: `12  Rue ${tag}`, zip: 'HT6110' });
    const b = await createUser({ device: `dev-${tag}`, address: `12 rue ${tag.toUpperCase()}`, zip: 'ht6110' });
    const c = await createUser({ address: `12 Rue ${tag}`, zip: 'HT6110' });
    await links.recordSignal(null, { userId: a, kind: 'card', value: `fp${tag}card`, source: 'test' });
    await links.recordSignal(null, { userId: c, kind: 'card', value: `fp${tag}card`, source: 'test' });
    // Shared by many customers: an apartment block / kiosk device.
    for (let i = 0; i < links.COMMON_LIMIT + 1; i += 1) {
      const u = await createUser();
      await links.recordSignal(null, { userId: u, kind: 'device', value: `kiosk-${tag}`, source: 'test' });
    }
    await links.recordSignal(null, { userId: a, kind: 'device', value: `kiosk-${tag}`, source: 'test' });
    await pool.query(`DELETE FROM customer_event_ingest_cursors WHERE source = 'signals_users'`);
    for (let i = 0; i < 200; i += 1) { if ((await links.sweep('users', { batch: 5000 })).processed < 5000) break; }

    const { rows } = await pool.query('SELECT kind, value_hash FROM customer_identity_signals WHERE user_id = $1 ORDER BY kind', [a]);
    expect(rows.map((r) => r.kind)).toEqual(['address', 'card', 'device', 'device']);
    expect(JSON.stringify(rows)).not.toMatch(new RegExp(tag, 'i'));

    const g = await links.graph(a, ALL);
    const byId = Object.fromEntries(g.nodes.map((n) => [n.userId, n]));
    expect(byId[b]).toMatchObject({ kinds: ['address', 'device'], score: 0.72 });
    expect(byId[c]).toMatchObject({ kinds: ['address', 'card'], score: 0.93 });
    expect(g.nodes).toHaveLength(2); // the kiosk device links nobody
    expect(g.common).toEqual([expect.objectContaining({ kind: 'device' })]);
    expect(g.edges).toEqual(expect.arrayContaining([expect.objectContaining({ kinds: ['address'], score: 0.3 })]));
    expect(byId[b].emailMasked).toMatch(/^c\*\*\*@example\.invalid$/);

    const limited = await links.graph(a, ['address']);
    expect(limited.nodes.map((n) => n.kinds)).toEqual([['address'], ['address']]);
  });

  test('merge review: checklist, two distinct admins, revisions, nothing merged', async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const a = await createUser({ address: `9 Main ${tag}`, zip: '33101' });
    const b = await createUser({ address: `9 main ${tag}`, zip: '33101' });
    const admin1 = await createUser({ role: 'admin' });
    const admin2 = await createUser({ role: 'super_admin' });
    await pool.query(`DELETE FROM customer_event_ingest_cursors WHERE source = 'signals_users'`);
    for (let i = 0; i < 200; i += 1) { if ((await links.sweep('users', { batch: 5000 })).processed < 5000) break; }
    const req = { headers: {}, ip: '127.0.0.1', get: () => '' };
    const r0 = await links.openReview({ customerId: a, otherId: b, kinds: ALL, adminId: admin1, req });
    const again = await links.openReview({ customerId: b, otherId: a, kinds: ALL, adminId: admin1, req });
    expect(String(again.id)).toBe(String(r0.id));
    await expect(links.decide({ reviewId: r0.id, customerId: a, action: 'duplicate', reason: 'same person', revision: 1, adminId: admin1, req }))
      .rejects.toMatchObject({ code: 'checklist_incomplete' });
    await expect(links.decide({ reviewId: r0.id, customerId: a, action: 'checklist', checklist: { autoMerge: true }, revision: 1, adminId: admin1, req }))
      .rejects.toMatchObject({ code: 'invalid_request' });
    const r1 = await links.decide({ reviewId: r0.id, customerId: a, action: 'checklist', revision: 1, adminId: admin1, req,
      checklist: { identityCompared: true, contactCompared: true, paymentInstrumentsCompared: true, activityReviewed: true } });
    const r2 = await links.decide({ reviewId: r0.id, customerId: a, action: 'duplicate', reason: 'Same ID document', revision: r1.revision, adminId: admin1, req });
    expect(r2.status).toBe('awaiting_second_review');
    await expect(links.decide({ reviewId: r0.id, customerId: a, action: 'confirm', reason: 'self', revision: r2.revision, adminId: admin1, req }))
      .rejects.toMatchObject({ code: 'self_approval_forbidden' });
    await expect(pool.query(`UPDATE customer_link_reviews SET status = 'confirmed_duplicate', decided_by = proposed_by WHERE id = $1`, [r0.id]))
      .rejects.toThrow(/two_admins/);
    const r3 = await links.decide({ reviewId: r0.id, customerId: b, action: 'confirm', reason: 'Verified documents', revision: r2.revision, adminId: admin2, req });
    expect(r3.status).toBe('confirmed_duplicate');
    // Nothing merged: both accounts still exist unchanged.
    const { rows } = await pool.query('SELECT id, deleted_at, is_suspended FROM users WHERE id = ANY($1::uuid[])', [[a, b]]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.deleted_at === null && !r.is_suspended)).toBe(true);
    const { rows: ev } = await pool.query(`SELECT customer_id FROM customer_events WHERE event_type = 'link_review.confirmed_duplicate' AND entity_id = $1`, [String(r0.id)]);
    expect(ev).toHaveLength(2);
    await expect(links.decide({ reviewId: r0.id, customerId: a, action: 'dismiss', reason: 'late', revision: r3.revision, adminId: admin1, req }))
      .rejects.toMatchObject({ code: 'invalid_state' });
    const { rows: audits } = await pool.query(
      `SELECT action FROM admin_audit_log WHERE action LIKE 'customer360_link_review_%' AND (target_id = $1 OR target_id = $2) ORDER BY id`, [a, b]);
    expect(audits.map((x) => x.action)).toEqual(['customer360_link_review_opened', 'customer360_link_review_checklist', 'customer360_link_review_duplicate', 'customer360_link_review_confirm']);
  });
});
