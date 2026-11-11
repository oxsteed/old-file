'use strict';

const { mockQuery, resetMocks } = require('./setup');
const pricingEngine = require('../services/pricingEngine');

beforeEach(() => resetMocks());

test('service pricing reads the deployed is_enabled schema and scopes rules to the business', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM business_services\s+WHERE id = \$1 AND business_id = \$2/i.test(sql)) {
      return { rows: [{ base_price_cents: 10000 }] };
    }
    if (/FROM service_price_rules/i.test(sql)) {
      return { rows: [{ id: 'rule-1', rule_type: 'time', priority: 1, is_active: true }] };
    }
    if (/FROM service_price_time_rules/i.test(sql)) {
      return { rows: [{ rule_id: 'rule-1', day_of_week: 2, start_time: '09:00', end_time: '10:00', is_peak: true, price_multiplier: 1.5, fixed_modifier_cents: null }] };
    }
    if (/FROM service_price_demand_rules/i.test(sql) ||
        /FROM service_price_volume_rules/i.test(sql) ||
        /FROM service_price_customer_segment_rules/i.test(sql) ||
        /FROM service_price_seasonal_rules/i.test(sql)) {
      return { rows: [] };
    }
    if (/FROM service_price_constraints/i.test(sql)) return { rows: [] };
    if (/FROM business_appointments/i.test(sql)) return { rows: [{ capacity: 1, booked: 0 }] };
    return { rows: [] };
  });

  const result = await pricingEngine.calculatePrice({
    businessId: 7,
    kind: 'service',
    targetId: 11,
    atTimeIso: '2026-11-10T09:30:00.000Z',
  });

  expect(result.basePriceCents).toBe(10000);
  expect(result.adjustedPriceCents).toBe(15000);
  expect(result.applied[0]).toMatchObject({ ruleId: 'rule-1', ruleType: 'time' });
  const rulesQuery = mockQuery.mock.calls.find(([sql]) => /FROM service_price_rules/i.test(sql));
  expect(rulesQuery[0]).toMatch(/business_id = \$1/);
  expect(rulesQuery[0]).toMatch(/is_enabled = TRUE/);
  expect(rulesQuery[1]).toEqual([7, 11]);
});

test('product pricing reads product rules through applies_to instead of the removed product_id column', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM business_products/i.test(sql)) return { rows: [{ price_cents: 1250 }] };
    if (/FROM product_pricing_rules/i.test(sql)) {
      return {
        rows: [{
          id: 'rule-1',
          rule_type: 'promotion',
          priority: 1,
          conditions_json: { min_quantity: 2 },
          pricing_adjustment: { percent_off: 20 },
          is_active: true,
        }],
      };
    }
    if (/FROM marketplace_products/i.test(sql)) return { rows: [] };
    return { rows: [] };
  });

  const result = await pricingEngine.calculatePrice({
    businessId: 7,
    kind: 'product',
    targetId: '11111111-1111-4111-8111-111111111111',
    quantity: 2,
  });

  expect(result.basePriceCents).toBe(1250);
  expect(result.adjustedPriceCents).toBe(1000);
  const rulesQuery = mockQuery.mock.calls.find(([sql]) => /FROM product_pricing_rules/i.test(sql));
  expect(rulesQuery[0]).toMatch(/applies_to/);
  expect(rulesQuery[0]).not.toMatch(/product_id/);
});

test('product pricing applies category-scoped rules from the shared evaluator', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM business_products/i.test(sql)) return { rows: [{ price_cents: 2000, category: 'garden' }] };
    if (/FROM product_pricing_rules/i.test(sql)) {
      return {
        rows: [{
          id: 'rule-category',
          rule_type: 'seasonal',
          priority: 1,
          conditions_json: {},
          pricing_adjustment: { fixed_modifier_cents: -300 },
          is_active: true,
        }],
      };
    }
    if (/FROM marketplace_products/i.test(sql)) return { rows: [] };
    return { rows: [] };
  });

  const result = await pricingEngine.calculatePrice({
    businessId: 7,
    kind: 'product',
    targetId: '11111111-1111-4111-8111-111111111111',
  });

  expect(result.adjustedPriceCents).toBe(1700);
  expect(result.applied[0]).toMatchObject({ ruleId: 'rule-category', kind: 'modifier', value: -300 });
});
