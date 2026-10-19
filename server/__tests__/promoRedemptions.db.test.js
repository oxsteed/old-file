'use strict';

// Decision 2: platform promo redemptions against the real schema (LIKE
// public.* INCLUDING ALL in a disposable schema): row-locked limits under
// concurrency, per-user limits, idempotent reservation, reversal releasing
// usage, funding source per surface, and the governed promo metric.
const crypto = require('crypto');
const schema = `promo_redeem_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Disposable database required');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

const db = require('../db');
const promo = require('../services/promoRedemptionService');
const { financialMetricSql } = require('../analytics/financialMetrics');

const TABLES = ['users', 'discount_codes', 'promo_redemptions'];

(url ? describe : describe.skip)('platform promo redemptions', () => {
  const alice = crypto.randomUUID();
  const bob = crypto.randomUUID();
  const carol = crypto.randomUUID();
  const user = (id) => db.query(`INSERT INTO users(id, email, password_hash, first_name, last_name, role)
    VALUES($1, $2, 'x', 'T', 'U', 'customer')`, [id, `${id}@example.test`]);
  const code = (c, over = {}) => db.query(`INSERT INTO discount_codes(code, discount_type, discount_amount, usage_limit,
      per_user_limit, min_order_cents, currency_code, applicable_surfaces, end_date, status, created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10) RETURNING id`, [c, over.type || 'percentage', over.amount ?? 10,
    over.usageLimit ?? null, over.perUser ?? null, over.minOrder ?? 0, over.currency ?? null, over.surfaces ?? null,
    over.endDate ?? null, alice]);
  const tx = async (fn) => {
    const client = await db.connect();
    try { await client.query('BEGIN'); const r = await fn(client); await client.query('COMMIT'); return r; }
    catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  };
  const reserve = (args) => tx((c) => promo.reservePromo(c, { surface: 'job', currency: 'USD', grossCents: 10000,
    fundableCents: 2000, ...args }));

  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    for (const t of TABLES) await db.query(`CREATE TABLE ${schema}.${t} (LIKE public.${t} INCLUDING ALL)`);
    await user(alice); await user(bob); await user(carol);
  });
  afterAll(async () => { await db.query(`DROP SCHEMA ${schema} CASCADE`); await db.end(); });

  test('global usage limit holds under concurrent checkouts (row lock)', async () => {
    await code('ONEONLY', { usageLimit: 1 });
    const results = await Promise.allSettled([alice, bob, carol].map((u, i) => reserve({
      code: 'oneonly', userId: u, referenceId: `job-${i}`, idempotencyKey: `k-oneonly-${i}` })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected').map(r => r.reason.code))
      .toEqual(['promo_usage_limit_reached', 'promo_usage_limit_reached']);
    const { rows: [c] } = await db.query(`SELECT usage_count FROM discount_codes WHERE code='ONEONLY'`);
    expect(c.usage_count).toBe(1);
  });

  test('per-user limit, idempotent replay, and integer cents with the funding cap', async () => {
    await code('PERUSER', { perUser: 1, amount: 33 });
    const first = await reserve({ code: 'PERUSER', userId: alice, referenceId: 'job-a', idempotencyKey: 'k-pu-1',
      grossCents: 999, fundableCents: 5000 });
    expect(first.discountCents).toBe(329); // floor(999 * 33 / 100)
    const replay = await reserve({ code: 'PERUSER', userId: alice, referenceId: 'job-a', idempotencyKey: 'k-pu-1',
      grossCents: 999, fundableCents: 5000 });
    expect(replay.replayed).toBe(true);
    expect(replay.redemption.id).toBe(first.redemption.id);
    await expect(reserve({ code: 'PERUSER', userId: alice, referenceId: 'job-b', idempotencyKey: 'k-pu-2' }))
      .rejects.toMatchObject({ code: 'promo_user_limit_reached' });
    const capped = await reserve({ code: 'PERUSER', userId: bob, referenceId: 'job-c', idempotencyKey: 'k-pu-3',
      grossCents: 10000, fundableCents: 120 });
    expect(capped).toMatchObject({ discountCents: 120, limited: true });
    const { rows: [c] } = await db.query(`SELECT usage_count FROM discount_codes WHERE code='PERUSER'`);
    expect(c.usage_count).toBe(2);
  });

  test('reversal releases the limit; a reversed key cannot be replayed', async () => {
    await code('REUSE', { usageLimit: 1 });
    await reserve({ code: 'REUSE', userId: alice, referenceId: 'job-r1', idempotencyKey: 'k-r1' });
    expect(await promo.reversePromo(db, { surface: 'job', referenceId: 'job-r1', reason: 'refunded' })).toBe(1);
    expect(await promo.reversePromo(db, { surface: 'job', referenceId: 'job-r1', reason: 'refunded' })).toBe(0);
    await expect(reserve({ code: 'REUSE', userId: alice, referenceId: 'job-r1', idempotencyKey: 'k-r1' }))
      .rejects.toMatchObject({ code: 'promo_reservation_reversed' });
    const again = await reserve({ code: 'REUSE', userId: bob, referenceId: 'job-r2', idempotencyKey: 'k-r2' });
    expect(again.replayed).toBe(false);
    const { rows: [c] } = await db.query(`SELECT usage_count FROM discount_codes WHERE code='REUSE'`);
    expect(c.usage_count).toBe(1);
  });

  test('one live redemption per checkout reference', async () => {
    await code('TWICE');
    await code('TWICE2');
    await reserve({ code: 'TWICE', userId: alice, referenceId: 'job-t', idempotencyKey: 'k-t1' });
    await expect(reserve({ code: 'TWICE2', userId: alice, referenceId: 'job-t', idempotencyKey: 'k-t2' }))
      .rejects.toMatchObject({ code: '23505' });
  });

  test('validation: expiry, surface, currency, minimum order, sign-in, unfundable', async () => {
    await code('OLD', { endDate: '2020-01-01T00:00:00Z' });
    await code('JOBSONLY', { surfaces: ['job'] });
    await code('HTGFIX', { type: 'fixed_cents', amount: 500, currency: 'HTG' });
    await code('BIGMIN', { minOrder: 50000 });
    const ev = (c, over = {}) => promo.evaluatePromo(db, { code: c, userId: alice, surface: 'job', currency: 'USD',
      grossCents: 10000, fundableCents: 1000, ...over });
    await expect(ev('OLD')).rejects.toMatchObject({ code: 'promo_expired' });
    await expect(ev('JOBSONLY', { surface: 'food' })).rejects.toMatchObject({ code: 'promo_surface_not_supported' });
    await expect(ev('HTGFIX')).rejects.toMatchObject({ code: 'promo_currency_mismatch' });
    await expect(ev('HTGFIX', { currency: 'HTG' })).resolves.toMatchObject({ discountCents: 500 });
    await expect(ev('BIGMIN')).rejects.toMatchObject({ code: 'promo_min_order_not_met' });
    await expect(ev('JOBSONLY', { userId: null })).rejects.toMatchObject({ code: 'promo_sign_in_required' });
    await expect(ev('JOBSONLY', { fundableCents: 0 })).rejects.toMatchObject({ code: 'promo_not_fundable' });
    await expect(ev('NOPE')).rejects.toMatchObject({ code: 'promo_invalid', status: 404 });
  });

  test('funding follows the surface and the governed metric counts redeemed only', async () => {
    await code('METRIC', { type: 'fixed_cents', amount: 300 });
    await tx((c) => promo.reservePromo(c, { code: 'METRIC', userId: alice, surface: 'food', referenceId: '9001',
      currency: 'USD', grossCents: 2000, fundableCents: 2000, idempotencyKey: 'food-order:9001:promo' }));
    await tx((c) => promo.reservePromo(c, { code: 'METRIC', userId: bob, surface: 'booking', referenceId: 'b-1',
      currency: 'USD', grossCents: 2000, fundableCents: 1950, idempotencyKey: 'booking:b-1:promo', providerReference: 'pi_1' }));
    const { rows } = await db.query(`SELECT surface, funded_by FROM promo_redemptions WHERE code='METRIC' ORDER BY surface`);
    expect(rows).toEqual([{ surface: 'booking', funded_by: 'platform' }, { surface: 'food', funded_by: 'restaurant' }]);
    await expect(db.query(`UPDATE promo_redemptions SET funded_by='platform' WHERE surface='food'`))
      .rejects.toMatchObject({ code: '23514' });

    await db.query(`DELETE FROM promo_redemptions WHERE code <> 'METRIC'`);
    expect(await promo.markRedeemed(db, { surface: 'booking', providerReference: 'pi_1' })).toBe(1);
    expect(await promo.markRedeemed(db, { surface: 'food', referenceId: '9001' })).toBe(1);
    expect(await promo.markRedeemed(db, { surface: 'food', referenceId: '9001' })).toBe(0);
    const built = financialMetricSql('promo_discount_cents', { interval: '30 days' });
    let { rows: metric } = await db.query(built.text, built.params);
    expect(metric).toEqual([{ currency_code: 'USD', promo_discount_cents: '600', redemptions: 2,
      platform_funded_cents: '300', gross_cents: '4000' }]);
    await promo.reversePromo(db, { surface: 'food', referenceId: '9001', reason: 'order_cancelled' });
    ({ rows: metric } = await db.query(built.text, built.params));
    expect(metric[0]).toMatchObject({ promo_discount_cents: '300', redemptions: 1 });
  });
});
