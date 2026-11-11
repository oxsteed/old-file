'use strict';

const billing = require('../services/careers/billing');

function dbForBoost() {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(sql);
      if (sql.includes('SELECT id, status, location_ids')) {
        return { rows: [{ id: 41, status: 'open', location_ids: [], moderation_status: 'ok' }] };
      }
      if (sql.includes('SELECT * FROM career_boosts')) return { rows: [] };
      if (sql.includes('INSERT INTO career_boosts')) return { rows: [{ id: 77, plan: 'boost_7d', opening_id: 41 }] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

describe('careers billing provider contract', () => {
  test.each([
    [{ sessionId: 'cs_123', checkoutUrl: null }],
    [{ sessionId: null, checkoutUrl: 'https://checkout.stripe.com/cs_123' }],
    [{ sessionId: 'cs_123', checkoutUrl: 'http://checkout.stripe.com/cs_123' }],
  ])('rejects an unusable checkout response before linking the pending record', async (checkout) => {
    const db = dbForBoost();
    await expect(billing.createBoost(db, {
      access: { businessId: 9, isOwner: true },
      actor: { id: 3 },
      body: { opening_id: 41, plan: 'boost_7d' },
      checkoutImpl: async () => checkout,
    })).rejects.toMatchObject({ status: 503, code: 'checkout_unavailable' });
    expect(db.queries).toHaveLength(2);
  });

  test('preserves a valid provider handoff and payment reference', async () => {
    const db = dbForBoost();
    db.query = jest.fn(async (sql) => {
      db.queries.push(sql);
      if (sql.includes('SELECT id, status, location_ids')) {
        return { rows: [{ id: 41, status: 'open', location_ids: [], moderation_status: 'ok' }] };
      }
      if (sql.includes('SELECT * FROM career_boosts')) return { rows: [] };
      if (sql.includes('INSERT INTO career_boosts')) return { rows: [{ id: 77, plan: 'boost_7d', opening_id: 41 }] };
      if (sql.includes('UPDATE career_boosts')) return { rows: [{ id: 77, payment_ref: 'cs_123', plan: 'boost_7d' }] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const result = await billing.createBoost(db, {
      access: { businessId: 9, isOwner: true },
      actor: { id: 3 },
      body: { opening_id: 41, plan: 'boost_7d' },
      checkoutImpl: async () => ({ sessionId: 'cs_123', checkoutUrl: 'https://checkout.stripe.com/cs_123', amountTotal: 700, currency: 'usd' }),
    });
    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/cs_123');
    expect(result.boost.payment_ref).toBe('cs_123');
  });
});

