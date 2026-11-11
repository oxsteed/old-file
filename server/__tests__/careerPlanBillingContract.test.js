'use strict';

const plans = require('../services/careers/marketplace/plans');

const ENV = {
  CAREERS_PLANS_ENABLED: process.env.CAREERS_PLANS_ENABLED,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  CAREERS_STRIPE_WEBHOOK_SECRET: process.env.CAREERS_STRIPE_WEBHOOK_SECRET,
  CAREERS_STRIPE_PRICE_PLAN_STARTER: process.env.CAREERS_STRIPE_PRICE_PLAN_STARTER,
};

beforeEach(() => {
  process.env.CAREERS_PLANS_ENABLED = 'true';
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.CAREERS_STRIPE_WEBHOOK_SECRET = 'whsec_test';
  process.env.CAREERS_STRIPE_PRICE_PLAN_STARTER = 'price_starter';
});

afterAll(() => {
  for (const [key, value] of Object.entries(ENV)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
});

test('plan checkout validates the provider URL before inserting checkout_pending', async () => {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('FROM career_employer_subscriptions')) return { rows: [] };
      throw new Error(`unexpected persistence query: ${sql}`);
    },
  };
  const stripe = {
    checkout: { sessions: { create: jest.fn().mockResolvedValue({ id: 'cs_plan_1', url: null }) } },
  };

  await expect(plans.startCheckout(db, {
    access: { businessId: 22, isOwner: true },
    actor: { id: 'owner-22' },
    plan: 'starter',
    stripe,
  })).rejects.toMatchObject({ status: 503, code: 'career_plan_checkout_unavailable' });
  expect(queries).toHaveLength(1);
  expect(queries[0]).toContain('FROM career_employer_subscriptions');
});

test('billing portal validates the provider URL', async () => {
  const db = { query: jest.fn().mockResolvedValue({ rows: [{ stripe_customer_id: 'cus_22' }] }) };
  const stripe = {
    billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: null }) } },
  };

  await expect(plans.portal(db, {
    access: { businessId: 22, isOwner: true },
    stripe,
  })).rejects.toMatchObject({ status: 503, code: 'career_plan_portal_unavailable' });
});

test('hosted URL validator accepts HTTPS only', () => {
  expect(plans.requireHostedUrl({ url: 'https://checkout.stripe.com/cs_1' }, 'x')).toBe('https://checkout.stripe.com/cs_1');
  expect(() => plans.requireHostedUrl({ url: 'http://checkout.stripe.com/cs_1' }, 'x')).toThrow();
});

