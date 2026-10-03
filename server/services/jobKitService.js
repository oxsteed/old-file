'use strict';

/**
 * jobKitService — template-layer parts-list builder for the helper copilot.
 *
 * A helper picks a curated job kit (e.g. "toilet replacement") and gets a
 * draft shopping cart with real items and real prices, which they review
 * before sharing with the customer. Human supervision is structural: the
 * helper edits the draft first, and the customer approves later.
 *
 * IRON RULE: items and prices ALWAYS come from the live marketplace catalog
 * at build time. Kit definitions reference products by SKU; each SKU resolves
 * to a live product ID and its current database price. A SKU that is missing,
 * inactive, or unavailable is omitted from the draft and reported back in
 * `omitted`. Nothing is ever invented: no phantom products, no guessed
 * prices.
 *
 * Future natural-language layer: resolve the AI's picks to real product IDs
 * and call buildCartFromItems(). The AI must never supply prices; pricing is
 * re-read from the database inside the transaction.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');

/**
 * Resolve one kit's definitions against the live catalog.
 * Returns { resolved, omitted } where resolved entries carry the live
 * product row and omitted entries carry the SKU plus a reason.
 */
async function resolveKitItems(jobType) {
  const { rows } = await pool.query(
    `SELECT d.sku, d.quantity, d.notes, d.sort_order,
            p.id AS product_id, p.name AS product_name, p.price_cents,
            p.currency, p.product_image_url,
            p.is_active, p.is_available
       FROM job_kit_definitions d
       LEFT JOIN marketplace_products p ON p.sku = d.sku
      WHERE d.job_type = $1 AND d.is_active = TRUE
      ORDER BY d.sort_order ASC`,
    [jobType]
  );

  const resolved = [];
  const omitted = [];
  for (const row of rows) {
    if (!row.product_id) {
      omitted.push({ sku: row.sku, reason: 'not_found' });
    } else if (!row.is_active || !row.is_available || row.price_cents == null) {
      omitted.push({ sku: row.sku, reason: 'unavailable', productName: row.product_name });
    } else {
      resolved.push({
        productId: row.product_id,
        name: row.product_name,
        quantity: row.quantity,
        notes: row.notes,
        unitPriceCents: row.price_cents,
        currency: row.currency || 'USD',
        imageUrl: row.product_image_url,
        sortOrder: row.sort_order,
      });
    }
  }
  return { resolved, omitted };
}

/**
 * List curated kits with live resolution stats so the UI can show which
 * kits are buildable right now and their estimated totals.
 */
async function listJobKits() {
  const { rows } = await pool.query(
    `SELECT d.job_type,
            COUNT(*) AS definition_count,
            COUNT(p.id) FILTER (WHERE p.is_active AND p.is_available AND p.price_cents IS NOT NULL) AS available_count,
            COALESCE(SUM(d.quantity * p.price_cents) FILTER (WHERE p.is_active AND p.is_available AND p.price_cents IS NOT NULL), 0) AS estimated_total_cents,
            MIN(COALESCE(p.currency, 'USD')) AS currency
       FROM job_kit_definitions d
       LEFT JOIN marketplace_products p ON p.sku = d.sku
      WHERE d.is_active = TRUE
      GROUP BY d.job_type
      ORDER BY d.job_type ASC`
  );
  return rows.map((row) => ({
    jobType: row.job_type,
    itemCount: Number(row.definition_count),
    availableCount: Number(row.available_count),
    missingCount: Number(row.definition_count) - Number(row.available_count),
    estimatedTotalCents: Number(row.estimated_total_cents),
    currency: row.currency || 'USD',
    buildable: Number(row.available_count) > 0,
  }));
}

/**
 * Primitive cart builder shared by the template layer and the future
 * natural-language matcher. Callers supply product IDs only; unit prices are
 * ALWAYS re-read from marketplace_products inside the transaction. Items
 * whose product cannot be resolved fail closed (422), they are never
 * created with a caller-supplied or guessed price.
 */
async function buildCartFromItems({ helperId, name, jobId = null, description = null, items }) {
  if (!helperId) throw new AppError('helperId is required', 400, 'validation_failed');
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('At least one item is required', 400, 'validation_failed');
  }

  const productIds = [...new Set(items.map((i) => i.productId).filter(Boolean))];
  if (productIds.length !== items.length) {
    throw new AppError('Duplicate or missing product IDs', 400, 'validation_failed');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: products } = await client.query(
      `SELECT id, name, price_cents, currency, product_image_url
         FROM marketplace_products
        WHERE id = ANY($1)`,
      [productIds]
    );
    const byId = new Map(products.map((p) => [p.id, p]));

    const missing = items.filter((i) => {
      const p = byId.get(i.productId);
      return !p || p.price_cents == null;
    });
    if (missing.length > 0) {
      // Fail closed: never create cart items with an unknown price.
      throw new AppError(
        'Some products could not be priced from the catalog',
        422,
        'kit_products_unpriced',
        { productIds: missing.map((i) => i.productId) }
      );
    }

    const currencies = new Set(products.map((p) => p.currency || 'USD'));
    if (currencies.size > 1) {
      throw new AppError('All items in a cart must share one currency', 400, 'validation_failed');
    }
    const currency = [...currencies][0] || 'USD';

    const cartName = (name && String(name).trim()) || 'Parts list';
    const { rows: cartRows } = await client.query(
      `INSERT INTO shopping_carts (helper_id, job_id, name, description, status)
       VALUES ($1, $2, $3, $4, 'draft')
       RETURNING id, name`,
      [helperId, jobId, cartName, description]
    );
    const cartId = cartRows[0].id;

    const builtItems = [];
    let sortOrder = 0;
    for (const item of items) {
      const product = byId.get(item.productId);
      const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
      const { rows: itemRows } = await client.query(
        `INSERT INTO shopping_cart_items (cart_id, product_id, quantity, unit_price_cents, notes, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [cartId, item.productId, quantity, product.price_cents, item.notes || null, sortOrder++]
      );
      builtItems.push({
        id: itemRows[0].id,
        productId: item.productId,
        name: product.name,
        quantity,
        unitPriceCents: product.price_cents,
        lineTotalCents: quantity * product.price_cents,
        notes: item.notes || null,
        imageUrl: product.product_image_url,
      });
    }

    const subtotalCents = builtItems.reduce((sum, i) => sum + i.lineTotalCents, 0);
    await client.query(
      `UPDATE shopping_carts
          SET subtotal_cents = $2, tax_cents = 0, total_cents = $2, currency = $3,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [cartId, subtotalCents, currency]
    );

    await client.query('COMMIT');
    logger.info('Draft parts-list cart built', { cartId, helperId, itemCount: builtItems.length });
    return { cartId, name: cartName, currency, itemCount: builtItems.length, subtotalCents, items: builtItems };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Build a draft cart from a curated kit template.
 * Missing/unavailable SKUs are omitted and reported; the draft only ever
 * contains live catalog products at live database prices.
 */
async function buildKitFromTemplate({ jobType, helperId, name = null, jobId = null }) {
  if (!jobType || typeof jobType !== 'string') {
    throw new AppError('jobType is required', 400, 'validation_failed');
  }
  const { resolved, omitted } = await resolveKitItems(jobType.trim());
  if (resolved.length === 0 && omitted.length === 0) {
    throw new AppError('Unknown job kit', 404, 'not_found');
  }
  if (resolved.length === 0) {
    throw new AppError(
      'This kit has no available products right now',
      422,
      'kit_empty',
      { jobType, omitted }
    );
  }
  const cart = await buildCartFromItems({
    helperId,
    name,
    jobId,
    description: `Curated kit: ${jobType.trim()}`,
    items: resolved.map((r) => ({ productId: r.productId, quantity: r.quantity, notes: r.notes })),
  });
  return { ...cart, jobType: jobType.trim(), omitted };
}

module.exports = {
  listJobKits,
  buildKitFromTemplate,
  buildCartFromItems,
};
