'use strict';

/**
 * jobKitService tests — template-layer parts-list builder.
 *
 * Covers the iron rule: kit SKUs resolve to live catalog products, unit
 * prices always come from the database at build time, and missing or
 * unavailable products are omitted and reported, never invented.
 */

const { mockQuery, resetMocks } = require('./setup');
const {
  listJobKits,
  buildKitFromTemplate,
  buildCartFromItems,
} = require('../services/jobKitService');

beforeEach(() => {
  resetMocks();
});

const PRODUCT_A = {
  id: 'prod-a',
  name: 'Toilet Wax Ring Kit with Bolts',
  price_cents: 749,
  currency: 'USD',
  product_image_url: null,
};
const PRODUCT_B = {
  id: 'prod-b',
  name: 'Braided Stainless Toilet Supply Line, 20 in',
  price_cents: 999,
  currency: 'USD',
  product_image_url: null,
};

function mockResolveKit(defRows) {
  mockQuery.mockResolvedValueOnce({ rows: defRows });
}

describe('listJobKits', () => {
  test('returns kits with live resolution stats', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          job_type: 'toilet-replacement',
          definition_count: '5',
          available_count: '4',
          estimated_total_cents: '20774',
          currency: 'USD',
        },
      ],
    });
    const kits = await listJobKits();
    expect(kits).toEqual([
      {
        jobType: 'toilet-replacement',
        itemCount: 5,
        availableCount: 4,
        missingCount: 1,
        estimatedTotalCents: 20774,
        currency: 'USD',
        buildable: true,
      },
    ]);
  });

  test('marks kits with zero available products as not buildable', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          job_type: 'toilet-replacement',
          definition_count: '5',
          available_count: '0',
          estimated_total_cents: '0',
          currency: 'USD',
        },
      ],
    });
    const kits = await listJobKits();
    expect(kits[0].buildable).toBe(false);
  });
});

describe('buildKitFromTemplate', () => {
  test('builds a draft cart with live DB prices and reports omitted SKUs', async () => {
    mockResolveKit([
      { sku: 'PLB-WAXRING', quantity: 1, notes: 'n1', sort_order: 1, product_id: 'prod-a', product_name: PRODUCT_A.name, price_cents: 749, currency: 'USD', product_image_url: null, is_active: true, is_available: true },
      { sku: 'PLB-SUPPLY-20', quantity: 2, notes: null, sort_order: 2, product_id: 'prod-b', product_name: PRODUCT_B.name, price_cents: 999, currency: 'USD', product_image_url: null, is_active: true, is_available: true },
      { sku: 'PLB-GONE', quantity: 1, notes: null, sort_order: 3, product_id: null, product_name: null, price_cents: null, currency: null, product_image_url: null, is_active: null, is_available: null },
      { sku: 'PLB-OLD', quantity: 1, notes: null, sort_order: 4, product_id: 'prod-c', product_name: 'Old Part', price_cents: 100, currency: 'USD', product_image_url: null, is_active: false, is_available: true },
    ]);

    // Transaction: BEGIN, product price lookup, cart insert, item inserts, totals update, COMMIT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockQuery.mockResolvedValueOnce({ rows: [PRODUCT_A, PRODUCT_B] }); // price lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cart-1', name: 'Toilet job' }] }); // cart insert
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'item-1' }] }); // item 1
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'item-2' }] }); // item 2
    mockQuery.mockResolvedValueOnce({ rows: [] }); // totals update
    mockQuery.mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await buildKitFromTemplate({
      jobType: 'toilet-replacement',
      helperId: 'helper-1',
      name: 'Toilet job',
    });

    expect(result.cartId).toBe('cart-1');
    expect(result.itemCount).toBe(2);
    // Prices come from the database: 1x749 + 2x999
    expect(result.subtotalCents).toBe(749 + 2 * 999);
    expect(result.items[0].unitPriceCents).toBe(749);
    expect(result.items[1].unitPriceCents).toBe(999);
    expect(result.items[1].quantity).toBe(2);
    // Missing and inactive SKUs are omitted and reported, never invented
    expect(result.omitted).toEqual([
      { sku: 'PLB-GONE', reason: 'not_found' },
      { sku: 'PLB-OLD', reason: 'unavailable', productName: 'Old Part' },
    ]);

    // The item INSERTs carried the DB prices, not anything caller-supplied
    const itemInserts = mockQuery.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO shopping_cart_items')
    );
    expect(itemInserts).toHaveLength(2);
    expect(itemInserts[0][1]).toEqual(expect.arrayContaining(['cart-1', 'prod-a', 1, 749]));
    expect(itemInserts[1][1]).toEqual(expect.arrayContaining(['cart-1', 'prod-b', 2, 999]));
  });

  test('returns 404 for an unknown job kit', async () => {
    mockResolveKit([]);
    await expect(
      buildKitFromTemplate({ jobType: 'nope', helperId: 'helper-1' })
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  test('fails closed with 422 when no kit products are available', async () => {
    mockResolveKit([
      { sku: 'PLB-GONE', quantity: 1, notes: null, sort_order: 1, product_id: null, product_name: null, price_cents: null, currency: null, product_image_url: null, is_active: null, is_available: null },
    ]);
    await expect(
      buildKitFromTemplate({ jobType: 'toilet-replacement', helperId: 'helper-1' })
    ).rejects.toMatchObject({ status: 422, code: 'kit_empty' });
    // No cart was created
    const cartInserts = mockQuery.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO shopping_carts')
    );
    expect(cartInserts).toHaveLength(0);
  });
});

describe('buildCartFromItems (future AI-layer primitive)', () => {
  test('fails closed when a product has no database price', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...PRODUCT_A, price_cents: null }],
    }); // price lookup: product exists but unpriced
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(
      buildCartFromItems({
        helperId: 'helper-1',
        name: 'AI draft',
        items: [{ productId: 'prod-a', quantity: 1 }],
      })
    ).rejects.toMatchObject({ status: 422, code: 'kit_products_unpriced' });

    const cartInserts = mockQuery.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO shopping_carts')
    );
    expect(cartInserts).toHaveLength(0);
  });

  test('rejects mixed-currency carts', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockQuery.mockResolvedValueOnce({
      rows: [PRODUCT_A, { ...PRODUCT_B, currency: 'EUR', price_cents: 899 }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(
      buildCartFromItems({
        helperId: 'helper-1',
        name: 'Mixed',
        items: [
          { productId: 'prod-a', quantity: 1 },
          { productId: 'prod-b', quantity: 1 },
        ],
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});
