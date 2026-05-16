'use strict';

/**
 * server/services/businessProductMarketplaceSync.js
 *
 * Phase 3 plumbing — bridges business-owned products into the existing
 * marketplace pipeline so they can be added to shopping_carts and bought
 * via Stripe checkout without duplicating the cart/order code paths.
 *
 * Strategy: each `business_products` row gets a mirror row in
 * `marketplace_products` with `source = 'business'` and `source_business_id`
 * set. The mirror row is created/updated by `publishBusinessProduct()` and
 * pulled out of the marketplace by `unpublishBusinessProduct()`.
 *
 * Stock is tracked on the source-of-truth (`business_product_inventory`)
 * but mirrored as a `quantity_available` integer on the marketplace row
 * so the existing `cartCheckoutController` validation works unchanged.
 *
 * Reservation flow:
 *   reserveProduct(productId, qty)   - increment reserved_quantity, refuse if oversold
 *   releaseReservation(productId, qty)
 *   commitReservation(productId, qty) - decrement actual stock + reservation
 */

const pool = require('../db');
const logger = require('../utils/logger');

async function _totalStockForProduct(productUuid) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(i.stock_quantity - i.reserved_quantity), 0)::int AS available
       FROM business_product_inventory i
       JOIN business_product_variants v ON v.id = i.variant_id
      WHERE v.product_id = $1`,
    [productUuid]
  );
  return rows[0] ? Number(rows[0].available) : 0;
}

/**
 * Create or update a marketplace_products mirror row for a business_products row.
 * Returns { marketplaceProductId, created }.
 */
async function publishBusinessProduct(businessProductId, options = {}) {
  if (!businessProductId) throw new Error('businessProductId required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: bpRows } = await client.query(
      `SELECT bp.id, bp.business_id, bp.name, bp.description, bp.category,
              bp.sku, bp.price_cents, bp.thumbnail_url, bp.is_active,
              bp.marketplace_product_id, bp.deleted_at,
              b.business_name
         FROM business_products bp
         JOIN businesses b ON b.id = bp.business_id
        WHERE bp.id = $1
        FOR UPDATE`,
      [businessProductId]
    );
    const bp = bpRows[0];
    if (!bp) { await client.query('ROLLBACK'); throw new Error('business_product not found'); }
    if (bp.deleted_at)  { await client.query('ROLLBACK'); throw new Error('business_product is deleted'); }
    if (!bp.is_active)  { await client.query('ROLLBACK'); throw new Error('business_product is inactive'); }

    const stock = await _totalStockForProduct(businessProductId);

    let marketplaceProductId = bp.marketplace_product_id;
    let created = false;

    if (marketplaceProductId) {
      // Update existing mirror
      await client.query(
        `UPDATE marketplace_products
            SET name              = $2,
                description       = $3,
                category          = $4,
                sku               = $5,
                price_cents       = $6,
                product_image_url = $7,
                quantity_available= $8,
                is_active         = TRUE,
                is_available      = ($8 > 0),
                source            = 'business',
                source_business_id= $9,
                business_product_id = $1,
                updated_at        = NOW()
          WHERE id = (
            SELECT marketplace_product_id FROM business_products WHERE id = $1
          )`,
        [
          businessProductId,
          bp.name,
          bp.description,
          bp.category,
          bp.sku,
          bp.price_cents,
          bp.thumbnail_url,
          stock,
          bp.business_id,
        ]
      );
    } else {
      // Insert mirror
      const { rows: mp } = await client.query(
        `INSERT INTO marketplace_products
           (source, source_business_id, business_product_id, name, description,
            category, sku, price_cents, product_image_url,
            quantity_available, reserved_quantity, is_active, is_available)
         VALUES ('business', $1, $2, $3, $4, $5, $6, $7, $8, $9, 0, TRUE, $10)
         RETURNING id`,
        [
          bp.business_id,
          businessProductId,
          bp.name,
          bp.description,
          bp.category,
          bp.sku,
          bp.price_cents,
          bp.thumbnail_url,
          stock,
          stock > 0,
        ]
      );
      marketplaceProductId = mp[0].id;
      created = true;
      await client.query(
        `UPDATE business_products SET marketplace_product_id = $1 WHERE id = $2`,
        [marketplaceProductId, businessProductId]
      );
    }

    await client.query('COMMIT');
    return { marketplaceProductId, created };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Soft-disable the mirror so customers can't add it to new carts. */
async function unpublishBusinessProduct(businessProductId) {
  await pool.query(
    `UPDATE marketplace_products
        SET is_active = FALSE, is_available = FALSE, updated_at = NOW()
      WHERE business_product_id = $1`,
    [businessProductId]
  );
}

/**
 * Refresh quantity_available on the mirror row from current inventory.
 * Call after stock changes (purchase, restock, manual adjustment).
 */
async function syncStock(businessProductId) {
  try {
    const stock = await _totalStockForProduct(businessProductId);
    await pool.query(
      `UPDATE marketplace_products
          SET quantity_available = $1,
              is_available = ($1 > 0),
              updated_at = NOW()
        WHERE business_product_id = $2`,
      [stock, businessProductId]
    );
    return stock;
  } catch (err) {
    logger.warn('syncStock failed', { businessProductId, err: err.message });
    return null;
  }
}

/**
 * Try to reserve `qty` units on a marketplace_product. Returns true if
 * there was enough free stock, false otherwise. Atomic via UPDATE ... WHERE.
 */
async function reserveProduct(marketplaceProductId, qty) {
  if (!qty || qty <= 0) return false;
  const { rowCount } = await pool.query(
    `UPDATE marketplace_products
        SET reserved_quantity = reserved_quantity + $2,
            updated_at = NOW()
      WHERE id = $1
        AND (quantity_available - reserved_quantity) >= $2`,
    [marketplaceProductId, qty]
  );
  return rowCount > 0;
}

async function releaseReservation(marketplaceProductId, qty) {
  if (!qty || qty <= 0) return;
  await pool.query(
    `UPDATE marketplace_products
        SET reserved_quantity = GREATEST(0, reserved_quantity - $2),
            updated_at = NOW()
      WHERE id = $1`,
    [marketplaceProductId, qty]
  );
}

/**
 * After successful payment: decrement actual stock at the source of truth
 * (business_product_inventory) and the mirror row reservation. Called from
 * the order-fulfillment flow.
 */
async function commitReservation(marketplaceProductId, qty) {
  if (!qty || qty <= 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Find the linked business_product
    const { rows } = await client.query(
      `SELECT business_product_id FROM marketplace_products WHERE id = $1`,
      [marketplaceProductId]
    );
    const bpId = rows[0] && rows[0].business_product_id;

    // Decrement reservation on mirror, decrement quantity_available
    await client.query(
      `UPDATE marketplace_products
          SET reserved_quantity  = GREATEST(0, reserved_quantity - $2),
              quantity_available = GREATEST(0, quantity_available - $2),
              updated_at = NOW()
        WHERE id = $1`,
      [marketplaceProductId, qty]
    );

    // Source-of-truth stock decrement (single variant case) — multi-variant
    // splits handled by the caller before getting here.
    if (bpId) {
      await client.query(
        `UPDATE business_product_inventory i
            SET stock_quantity = GREATEST(0, stock_quantity - $2),
                updated_at = NOW()
          WHERE i.variant_id IN (
            SELECT id FROM business_product_variants WHERE product_id = $1
          )`,
        [bpId, qty]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  publishBusinessProduct,
  unpublishBusinessProduct,
  syncStock,
  reserveProduct,
  releaseReservation,
  commitReservation,
};
