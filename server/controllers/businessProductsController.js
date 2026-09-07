/**
 * Business Products Controller
 * Handles product listing, inventory, variants, and stock management per business.
 *
 * Endpoints (all under /api/businesses/:businessId/products):
 *   GET    /                              – list products (public)
 *   GET    /alerts/low-stock             – low-stock alerts (owner)
 *   GET    /:productId                   – get single product (public)
 *   POST   /                             – create product (owner)
 *   PUT    /:productId                   – update product (owner)
 *   DELETE /:productId                   – soft-delete product (owner)
 *   POST   /:productId/variants          – create variant (owner)
 *   PUT    /:productId/variants/:variantId/inventory – update stock (owner)
 */

const pool = require('../db');
const { AppError } = require('../utils/apiError');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');

// ── List products ────────────────────────────────────────────────────────────
async function listProducts(req, res, next) {
  try {
    const { businessId } = req.params;
    const {
      page = 0,
      limit = 20,
      category,
      search,
      minPrice,
      maxPrice,
      inStock,
      sortBy = 'created_at',
    } = req.query;

    const safeLimit  = Math.min(parseInt(limit)  || 20, 100);
    const safeOffset = (parseInt(page) || 0) * safeLimit;

    const params = [businessId];
    let filters = `WHERE p.business_id = $1 AND p.deleted_at IS NULL`;

    if (category) { filters += ` AND p.category = $${params.push(category)}`; }
    if (search)   { filters += ` AND (p.name ILIKE $${params.push(`%${search}%`)} OR p.description ILIKE $${params.length})`; }
    if (minPrice) { filters += ` AND p.price_cents >= $${params.push(Math.round(minPrice * 100))}`; }
    if (maxPrice) { filters += ` AND p.price_cents <= $${params.push(Math.round(maxPrice * 100))}`; }

    const havingClause = inStock === 'true' ? 'HAVING COALESCE(SUM(pv.price_adjustment_cents), 0) >= 0 AND COALESCE(SUM(pi.stock_quantity), 0) > 0' : '';

    const sortMap = {
      created_at:  'p.created_at DESC',
      price:       'p.price_cents ASC',
      name:        'p.name ASC',
      bestselling: 'review_count DESC',
    };
    const orderBy = sortMap[sortBy] || sortMap.created_at;

    const rows = await pool.query(
      `SELECT
         p.id, p.name, p.description, p.category,
         p.price_cents, p.sku, p.thumbnail_url, p.is_active, p.created_at,
         COUNT(DISTINCT pv.id)    AS variant_count,
         COALESCE(SUM(pi.stock_quantity), 0) AS total_stock,
         ROUND(AVG(pr.rating)::NUMERIC, 1)  AS avg_rating,
         COUNT(DISTINCT pr.id)   AS review_count
       FROM business_products p
       LEFT JOIN business_product_variants pv ON p.id = pv.product_id
       LEFT JOIN business_product_inventory pi ON pv.id = pi.variant_id
       LEFT JOIN business_product_reviews pr   ON p.id = pr.product_id AND pr.is_approved = true
       ${filters}
       GROUP BY p.id
       ${havingClause}
       ORDER BY ${orderBy}
       LIMIT $${params.push(safeLimit)} OFFSET $${params.push(safeOffset)}`,
      params
    );

    const countRow = await pool.query(
      `SELECT COUNT(*) AS total FROM business_products p ${filters}`,
      params.slice(0, params.length - 2)
    );

    res.json({
      success: true,
      data: rows.rows.map(p => ({
        id:           p.id,
        name:         p.name,
        category:     p.category,
        price:        p.price_cents / 100,
        sku:          p.sku,
        thumbnailUrl: p.thumbnail_url,
        variantCount: parseInt(p.variant_count),
        totalStock:   parseInt(p.total_stock),
        avgRating:    p.avg_rating ? parseFloat(p.avg_rating) : null,
        reviewCount:  parseInt(p.review_count),
        isActive:     p.is_active,
        createdAt:    p.created_at,
      })),
      total:  parseInt(countRow.rows[0].total),
      page:   parseInt(page),
      limit:  safeLimit,
    });
  } catch (error) {
    logger.error('businessProductsController.listProducts', { error });
    next(error);
  }
}

// ── Get single product with variants & reviews ───────────────────────────────
async function getProduct(req, res, next) {
  try {
    const { businessId, productId } = req.params;

    const productResult = await pool.query(
      `SELECT p.*,
              ROUND(AVG(pr.rating)::NUMERIC, 1) AS avg_rating,
              COUNT(DISTINCT pr.id) AS review_count
       FROM business_products p
       LEFT JOIN business_product_reviews pr ON p.id = pr.product_id AND pr.is_approved = true
       WHERE p.id = $1 AND p.business_id = $2 AND p.deleted_at IS NULL
       GROUP BY p.id`,
      [productId, businessId]
    );
    if (!productResult.rows.length) throw new AppError('Product not found', 404, 'not_found');

    const product = productResult.rows[0];
    const canViewPrivateInventory = ['owner', 'manager'].includes(req.businessRole);

    const [variantsResult, imagesResult, reviewsResult] = await Promise.all([
      pool.query(
        `SELECT v.id, v.sku, v.variant_name, v.price_adjustment_cents,
                COALESCE(i.stock_quantity, 0) AS stock,
                i.reorder_level, i.last_restocked
         FROM business_product_variants v
         LEFT JOIN business_product_inventory i ON v.id = i.variant_id
         WHERE v.product_id = $1 ORDER BY v.created_at ASC`,
        [productId]
      ),
      pool.query(
        `SELECT id, image_url, alt_text, sort_order
         FROM business_product_gallery WHERE product_id = $1 ORDER BY sort_order ASC`,
        [productId]
      ),
      pool.query(
        `SELECT id, customer_id, customer_name, rating, title, comment, created_at
         FROM business_product_reviews
         WHERE product_id = $1 AND is_approved = true
         ORDER BY created_at DESC LIMIT 5`,
        [productId]
      ),
    ]);

    res.json({
      success: true,
      data: {
        id:           product.id,
        name:         product.name,
        description:  product.description,
        category:     product.category,
        price:        product.price_cents / 100,
        ...(canViewPrivateInventory ? { cost: product.cost_cents / 100 } : {}),
        sku:          product.sku,
        thumbnailUrl: product.thumbnail_url,
        isActive:     product.is_active,
        avgRating:    product.avg_rating ? parseFloat(product.avg_rating) : null,
        reviewCount:  parseInt(product.review_count),
        createdAt:    product.created_at,
        updatedAt:    product.updated_at,
        variants: variantsResult.rows.map(v => ({
          id:             v.id,
          sku:            v.sku,
          name:           v.variant_name,
          priceAdjustment: v.price_adjustment_cents / 100,
          stock:          parseInt(v.stock),
          ...(canViewPrivateInventory ? {
            reorderLevel: v.reorder_level,
            lastRestocked: v.last_restocked,
          } : {}),
        })),
        images:  imagesResult.rows,
        reviews: reviewsResult.rows,
      },
    });
  } catch (error) {
    logger.error('businessProductsController.getProduct', { error });
    next(error);
  }
}

// ── Create product ───────────────────────────────────────────────────────────
async function createProduct(req, res, next) {
  try {
    const { businessId } = req.params;
    const { name, description, category, price, cost, sku, isActive = true } = req.body;

    if (typeof name !== 'string' || !name.trim() || name.length > 255)
      throw new AppError('Product name required (1-255 chars)', 400, 'validation_failed');
    if (typeof category !== 'string' || !category.trim())
      throw new AppError('Category required', 400, 'validation_failed');
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 1000000)
      throw new AppError('Valid price required (0–1,000,000)', 400, 'validation_failed');
    if (cost !== undefined && (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || cost > 1000000))
      throw new AppError('Cost must be between 0 and 1,000,000', 400, 'validation_failed');
    if (typeof sku !== 'string' || !sku.trim() || sku.length > 100)
      throw new AppError('SKU required (1-100 chars)', 400, 'validation_failed');

    const skuCheck = await pool.query(
      'SELECT id FROM business_products WHERE business_id = $1 AND sku = $2 AND deleted_at IS NULL',
      [businessId, sku]
    );
    if (skuCheck.rows.length) throw new AppError('SKU already exists', 409, 'duplicate_sku');

    const result = await pool.query(
      `INSERT INTO business_products
         (business_id, name, description, category, price_cents, cost_cents, sku, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        businessId, name.trim(), (description || '').trim(), category.trim(),
        Math.round(price * 100),
        cost ? Math.round(cost * 100) : 0,
        sku.trim(), isActive,
      ]
    );

    logger.info('Product created', { productId: result.rows[0].id, businessId });
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('businessProductsController.createProduct', { error });
    next(error);
  }
}

// ── Update product ───────────────────────────────────────────────────────────
async function updateProduct(req, res, next) {
  try {
    const { businessId, productId } = req.params;
    const { name, description, category, price, cost, isActive } = req.body;

    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 255))
      throw new AppError('Product name must be 1-255 characters', 400, 'validation_failed');
    if (description !== undefined && typeof description !== 'string')
      throw new AppError('Description must be text', 400, 'validation_failed');
    if (category !== undefined && (typeof category !== 'string' || !category.trim()))
      throw new AppError('Category must be text', 400, 'validation_failed');
    if (price !== undefined && (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 1000000))
      throw new AppError('Valid price required (0-1,000,000)', 400, 'validation_failed');
    if (cost !== undefined && (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || cost > 1000000))
      throw new AppError('Cost must be between 0 and 1,000,000', 400, 'validation_failed');
    if (isActive !== undefined && typeof isActive !== 'boolean')
      throw new AppError('isActive must be boolean', 400, 'validation_failed');

    const sets = [];
    const params = [productId, businessId];
    const p = () => `$${params.length}`;

    if (name !== undefined)        { params.push(name.trim());               sets.push(`name = ${p()}`); }
    if (description !== undefined) { params.push(description.trim());        sets.push(`description = ${p()}`); }
    if (category !== undefined)    { params.push(category.trim());           sets.push(`category = ${p()}`); }
    if (price !== undefined)       { params.push(Math.round(price * 100));   sets.push(`price_cents = ${p()}`); }
    if (cost !== undefined)        { params.push(Math.round(cost * 100));    sets.push(`cost_cents = ${p()}`); }
    if (isActive !== undefined)    { params.push(isActive);                  sets.push(`is_active = ${p()}`); }

    if (!sets.length) throw new AppError('No updates provided', 400, 'validation_failed');

    const result = await pool.query(
      `UPDATE business_products SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL RETURNING *`,
      params
    );
    if (!result.rows.length) throw new AppError('Product not found', 404, 'not_found');

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('businessProductsController.updateProduct', { error });
    next(error);
  }
}

// ── Delete product (soft) ────────────────────────────────────────────────────
async function deleteProduct(req, res, next) {
  try {
    const { businessId, productId } = req.params;

    await pool.query(
      'UPDATE business_products SET deleted_at = now() WHERE id = $1 AND business_id = $2',
      [productId, businessId]
    );

    res.json({ success: true, message: 'Product deleted' });
  } catch (error) {
    logger.error('businessProductsController.deleteProduct', { error });
    next(error);
  }
}

// ── Create variant ───────────────────────────────────────────────────────────
async function createVariant(req, res, next) {
  try {
    const { businessId, productId } = req.params;
    const { variantName, sku, priceAdjustment = 0, stock = 0, reorderLevel = 10 } = req.body;

    const productCheck = await pool.query(
      'SELECT id FROM business_products WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
      [productId, businessId]
    );
    if (!productCheck.rows.length) throw new AppError('Product not found', 404, 'not_found');

    const variant = await withTransaction(pool, async (client) => {
      const varResult = await client.query(
        `INSERT INTO business_product_variants (product_id, variant_name, sku, price_adjustment_cents)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [productId, variantName.trim(), sku.trim(), Math.round(priceAdjustment * 100)]
      );
      const variantId = varResult.rows[0].id;

      await client.query(
        `INSERT INTO business_product_inventory (variant_id, stock_quantity, reorder_level)
         VALUES ($1,$2,$3)`,
        [variantId, stock, reorderLevel]
      );
      await client.query(
        `INSERT INTO business_product_stock_history (variant_id, change_type, quantity_change, reason)
         VALUES ($1,'initial',$2,'Product variant created')`,
        [variantId, stock]
      );
      return varResult.rows[0];
    });

    res.status(201).json({ success: true, data: variant });
  } catch (error) {
    logger.error('businessProductsController.createVariant', { error });
    next(error);
  }
}

// ── Update variant inventory ─────────────────────────────────────────────────
async function updateVariantInventory(req, res, next) {
  try {
    const { businessId, productId, variantId } = req.params;
    const { quantityChange, reason = 'Manual adjustment' } = req.body;

    if (typeof quantityChange !== 'number')
      throw new AppError('Quantity change required', 400, 'validation_failed');

    const inventory = await withTransaction(pool, async (client) => {
      const cur = await client.query(
        `SELECT pi.stock_quantity
           FROM business_product_inventory pi
           JOIN business_product_variants v ON v.id = pi.variant_id
           JOIN business_products p ON p.id = v.product_id
          WHERE pi.variant_id = $1
            AND v.product_id = $2
            AND p.business_id = $3
            AND p.deleted_at IS NULL
          FOR UPDATE OF pi`,
        [variantId, productId, businessId]
      );
      if (!cur.rows.length) throw new AppError('Variant not found', 404, 'not_found');

      const newStock = cur.rows[0].stock_quantity + quantityChange;
      if (newStock < 0) throw new AppError('Insufficient stock', 400, 'insufficient_stock');

      const result = await client.query(
        `UPDATE business_product_inventory
         SET stock_quantity = $1, updated_at = now()
         WHERE variant_id = $2 RETURNING *`,
        [newStock, variantId]
      );
      await client.query(
        `INSERT INTO business_product_stock_history (variant_id, change_type, quantity_change, reason)
         VALUES ($1,$2,$3,$4)`,
        [variantId, quantityChange > 0 ? 'restock' : 'sale', quantityChange, reason.trim()]
      );
      return result.rows[0];
    });

    res.json({ success: true, data: { stock: inventory.stock_quantity, lastUpdated: inventory.updated_at } });
  } catch (error) {
    logger.error('businessProductsController.updateVariantInventory', { error });
    next(error);
  }
}

// ── Low-stock alerts ─────────────────────────────────────────────────────────
async function getLowStockAlerts(req, res, next) {
  try {
    const { businessId } = req.params;

    const result = await pool.query(
      `SELECT p.id, p.name, p.category,
              v.id AS variant_id, v.sku, v.variant_name,
              pi.stock_quantity, pi.reorder_level
       FROM business_products p
       JOIN business_product_variants v  ON p.id = v.product_id
       JOIN business_product_inventory pi ON v.id = pi.variant_id
       WHERE p.business_id = $1
         AND pi.stock_quantity <= pi.reorder_level
         AND p.deleted_at IS NULL
       ORDER BY pi.stock_quantity ASC`,
      [businessId]
    );

    res.json({
      success: true,
      data: result.rows.map(r => ({
        productId:    r.id,
        productName:  r.name,
        category:     r.category,
        variantId:    r.variant_id,
        sku:          r.sku,
        variantName:  r.variant_name,
        currentStock: parseInt(r.stock_quantity),
        reorderLevel: parseInt(r.reorder_level),
      })),
      alertCount: result.rows.length,
    });
  } catch (error) {
    logger.error('businessProductsController.getLowStockAlerts', { error });
    next(error);
  }
}

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  createVariant,
  updateVariantInventory,
  getLowStockAlerts,
};
