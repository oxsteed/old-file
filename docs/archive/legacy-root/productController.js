/**
 * Product Management Controller
 * Handles product listing, inventory, variants, and stock management
 *
 * Features:
 * - Full product CRUD with categories and descriptions
 * - Product variants (size, color, material, etc.)
 * - Inventory tracking with SKU management
 * - Stock alerts and low-stock notifications
 * - Product image gallery with S3 integration
 * - Product reviews and ratings
 * - Search and filtering by category, price, tags
 * - Stock history tracking
 *
 * Database:
 * - business_products: Main product table
 * - business_product_variants: Size/color/material variants
 * - business_product_inventory: Stock tracking per variant
 * - business_product_gallery: Product images
 * - business_product_reviews: Customer reviews
 * - business_product_stock_history: Audit trail for inventory changes
 */

const { pool } = require('../db');
const { AppError } = require('../utils/apiError');
const { logger } = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const { uploadFile, deleteFile } = require('../utils/storage');

// ============================================================================
// Product Management
// ============================================================================

/**
 * List products for a business
 * GET /api/businesses/{businessId}/products
 * Query: page, limit, category, search, minPrice, maxPrice, inStock
 */
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
      sortBy = 'created_at', // created_at, price, name, bestselling
    } = req.query;

    const offset = page * limit;
    let query = `
      SELECT
        p.id, p.business_id, p.name, p.description, p.category,
        p.price_cents, p.cost_cents, p.sku,
        p.thumbnail_url, p.is_active, p.created_at,
        COUNT(DISTINCT pi.id) as variant_count,
        COALESCE(SUM(pi.stock_quantity), 0) as total_stock,
        AVG(pr.rating) as avg_rating,
        COUNT(DISTINCT pr.id) as review_count
      FROM business_products p
      LEFT JOIN business_product_variants pi ON p.id = pi.product_id
      LEFT JOIN business_product_reviews pr ON p.id = pr.product_id
      WHERE p.business_id = $1
    `;

    const params = [businessId];
    let paramIndex = 2;

    // Filters
    if (category) {
      query += ` AND p.category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    if (search) {
      query += ` AND (p.name ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (minPrice) {
      query += ` AND p.price_cents >= $${paramIndex}`;
      params.push(Math.round(minPrice * 100));
      paramIndex++;
    }

    if (maxPrice) {
      query += ` AND p.price_cents <= $${paramIndex}`;
      params.push(Math.round(maxPrice * 100));
      paramIndex++;
    }

    if (inStock === 'true') {
      query += ` AND COALESCE(SUM(pi.stock_quantity), 0) > 0`;
    }

    query += ` GROUP BY p.id`;

    // Sorting
    const sortMap = {
      created_at: 'p.created_at DESC',
      price: 'p.price_cents ASC',
      name: 'p.name ASC',
      bestselling: 'review_count DESC',
    };
    query += ` ORDER BY ${sortMap[sortBy] || sortMap.created_at}`;

    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Count total
    const countQuery = `
      SELECT COUNT(*) as total FROM business_products p
      WHERE p.business_id = $1
      ${category ? `AND p.category = $2` : ''}
      ${search ? `AND (p.name ILIKE $${category ? 3 : 2} OR p.description ILIKE $${category ? 3 : 2})` : ''}
      ${minPrice ? `AND p.price_cents >= $${category && search ? 4 : category || search ? 3 : 2}` : ''}
    `;
    const countResult = await pool.query(
      countQuery,
      params.slice(0, params.length - 2)
    );

    res.json({
      success: true,
      data: result.rows.map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        price: p.price_cents / 100,
        thumbnailUrl: p.thumbnail_url,
        variantCount: parseInt(p.variant_count),
        totalStock: parseInt(p.total_stock),
        avgRating: p.avg_rating ? parseFloat(p.avg_rating).toFixed(1) : null,
        reviewCount: parseInt(p.review_count),
        isActive: p.is_active,
        createdAt: p.created_at,
      })),
      total: parseInt(countResult.rows[0].total),
      page,
      limit,
    });
  } catch (error) {
    logger.error('productController.listProducts', { error });
    next(error);
  }
}

/**
 * Get a single product with variants and reviews
 * GET /api/businesses/{businessId}/products/{productId}
 */
async function getProduct(req, res, next) {
  try {
    const { businessId, productId } = req.params;

    // Get product details
    const productResult = await pool.query(
      `
      SELECT
        p.*,
        AVG(pr.rating) as avg_rating,
        COUNT(DISTINCT pr.id) as review_count
      FROM business_products p
      LEFT JOIN business_product_reviews pr ON p.id = pr.product_id
      WHERE p.id = $1 AND p.business_id = $2
      GROUP BY p.id
      `,
      [productId, businessId]
    );

    if (!productResult.rows.length) {
      throw new AppError('Product not found', 404, 'not_found');
    }

    const product = productResult.rows[0];

    // Get variants
    const variantsResult = await pool.query(
      `
      SELECT
        v.id, v.sku, v.variant_name, v.price_adjustment_cents,
        COALESCE(inv.stock_quantity, 0) as stock,
        inv.reorder_level, inv.last_restocked
      FROM business_product_variants v
      LEFT JOIN business_product_inventory inv ON v.id = inv.variant_id
      WHERE v.product_id = $1
      ORDER BY v.created_at ASC
      `,
      [productId]
    );

    // Get images
    const imagesResult = await pool.query(
      `SELECT id, image_url, alt_text, sort_order FROM business_product_gallery
       WHERE product_id = $1 ORDER BY sort_order ASC`,
      [productId]
    );

    // Get reviews
    const reviewsResult = await pool.query(
      `
      SELECT
        id, customer_id, customer_name, rating, title, comment, created_at
      FROM business_product_reviews
      WHERE product_id = $1 AND is_approved = true
      ORDER BY created_at DESC
      LIMIT 5
      `,
      [productId]
    );

    res.json({
      success: true,
      data: {
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        price: product.price_cents / 100,
        cost: product.cost_cents / 100,
        sku: product.sku,
        thumbnailUrl: product.thumbnail_url,
        isActive: product.is_active,
        avgRating: product.avg_rating ? parseFloat(product.avg_rating).toFixed(1) : null,
        reviewCount: parseInt(product.review_count),
        createdAt: product.created_at,
        updatedAt: product.updated_at,
        variants: variantsResult.rows.map(v => ({
          id: v.id,
          sku: v.sku,
          name: v.variant_name,
          priceAdjustment: v.price_adjustment_cents / 100,
          stock: parseInt(v.stock),
          reorderLevel: v.reorder_level,
          lastRestocked: v.last_restocked,
        })),
        images: imagesResult.rows,
        reviews: reviewsResult.rows.map(r => ({
          id: r.id,
          customerName: r.customer_name,
          rating: r.rating,
          title: r.title,
          comment: r.comment,
          createdAt: r.created_at,
        })),
      },
    });
  } catch (error) {
    logger.error('productController.getProduct', { error });
    next(error);
  }
}

/**
 * Create a new product
 * POST /api/businesses/{businessId}/products
 * Body: {
 *   name, description, category, price, cost, sku, isActive?
 * }
 */
async function createProduct(req, res, next) {
  try {
    const { businessId } = req.params;
    const { name, description, category, price, cost, sku, isActive = true } = req.body;
    const userId = req.user.id;

    // Validate inputs
    if (!name || name.length === 0 || name.length > 255) {
      throw new AppError('Product name required (1-255 chars)', 400, 'validation_failed');
    }
    if (!category || category.length === 0) {
      throw new AppError('Category required', 400, 'validation_failed');
    }
    if (typeof price !== 'number' || price < 0 || price > 1000000) {
      throw new AppError('Valid price required (0-1000000)', 400, 'validation_failed');
    }
    if (cost !== undefined && (typeof cost !== 'number' || cost < 0)) {
      throw new AppError('Valid cost required', 400, 'validation_failed');
    }
    if (!sku || sku.length === 0 || sku.length > 100) {
      throw new AppError('SKU required (1-100 chars)', 400, 'validation_failed');
    }

    // Verify business ownership
    const bizCheck = await pool.query(
      'SELECT id FROM businesses WHERE id = $1 AND user_id = $2',
      [businessId, userId]
    );
    if (!bizCheck.rows.length) {
      throw new AppError('Unauthorized', 403, 'not_authorized');
    }

    // Check for duplicate SKU
    const skuCheck = await pool.query(
      `SELECT id FROM business_products WHERE business_id = $1 AND sku = $2`,
      [businessId, sku]
    );
    if (skuCheck.rows.length > 0) {
      throw new AppError('SKU already exists', 409, 'duplicate_sku');
    }

    // Create product
    const result = await pool.query(
      `
      INSERT INTO business_products
      (business_id, name, description, category, price_cents, cost_cents, sku, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [
        businessId,
        name.trim(),
        (description || '').trim(),
        category.trim(),
        Math.round(price * 100),
        cost ? Math.round(cost * 100) : 0,
        sku.trim(),
        isActive,
      ]
    );

    logger.info('Product created', { productId: result.rows[0].id, businessId });

    res.status(201).json({
      success: true,
      data: {
        id: result.rows[0].id,
        name: result.rows[0].name,
        category: result.rows[0].category,
        price: result.rows[0].price_cents / 100,
        sku: result.rows[0].sku,
        createdAt: result.rows[0].created_at,
      },
    });
  } catch (error) {
    logger.error('productController.createProduct', { error, body: req.body });
    next(error);
  }
}

/**
 * Update a product
 * PUT /api/businesses/{businessId}/products/{productId}
 */
async function updateProduct(req, res, next) {
  try {
    const { businessId, productId } = req.params;
    const { name, description, category, price, cost, isActive } = req.body;
    const userId = req.user.id;

    // Verify business ownership
    const bizCheck = await pool.query(
      'SELECT id FROM businesses WHERE id = $1 AND user_id = $2',
      [businessId, userId]
    );
    if (!bizCheck.rows.length) {
      throw new AppError('Unauthorized', 403, 'not_authorized');
    }

    const updates = [];
    const params = [productId, businessId];
    let paramIndex = 3;

    if (name !== undefined) {
      if (name.length === 0 || name.length > 255) {
        throw new AppError('Product name required (1-255 chars)', 400, 'validation_failed');
      }
      updates.push(`name = $${paramIndex}`);
      params.push(name.trim());
      paramIndex++;
    }

    if (description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      params.push(description.trim());
      paramIndex++;
    }

    if (category !== undefined) {
      if (category.length === 0) {
        throw new AppError('Category required', 400, 'validation_failed');
      }
      updates.push(`category = $${paramIndex}`);
      params.push(category.trim());
      paramIndex++;
    }

    if (price !== undefined) {
      if (typeof price !== 'number' || price < 0) {
        throw new AppError('Valid price required', 400, 'validation_failed');
      }
      updates.push(`price_cents = $${paramIndex}`);
      params.push(Math.round(price * 100));
      paramIndex++;
    }

    if (cost !== undefined) {
      if (typeof cost !== 'number' || cost < 0) {
        throw new AppError('Valid cost required', 400, 'validation_failed');
      }
      updates.push(`cost_cents = $${paramIndex}`);
      params.push(Math.round(cost * 100));
      paramIndex++;
    }

    if (isActive !== undefined) {
      updates.push(`is_active = $${paramIndex}`);
      params.push(isActive);
      paramIndex++;
    }

    if (updates.length === 0) {
      throw new AppError('No updates provided', 400, 'validation_failed');
    }

    const result = await pool.query(
      `UPDATE business_products SET ${updates.join(', ')}, updated_at = now()
       WHERE id = $1 AND business_id = $2 RETURNING *`,
      params
    );

    if (!result.rows.length) {
      throw new AppError('Product not found', 404, 'not_found');
    }

    logger.info('Product updated', { productId });

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('productController.updateProduct', { error });
    next(error);
  }
}

/**
 * Delete a product
 * DELETE /api/businesses/{businessId}/products/{productId}
 */
async function deleteProduct(req, res, next) {
  try {
    const { businessId, productId } = req.params;
    const userId = req.user.id;

    // Verify business ownership
    const bizCheck = await pool.query(
      'SELECT id FROM businesses WHERE id = $1 AND user_id = $2',
      [businessId, userId]
    );
    if (!bizCheck.rows.length) {
      throw new AppError('Unauthorized', 403, 'not_authorized');
    }

    // Soft delete
    await pool.query(
      `UPDATE business_products SET deleted_at = now() WHERE id = $1 AND business_id = $2`,
      [productId, businessId]
    );

    logger.info('Product deleted', { productId });

    res.json({ success: true, message: 'Product deleted' });
  } catch (error) {
    logger.error('productController.deleteProduct', { error });
    next(error);
  }
}

// ============================================================================
// Variants
// ============================================================================

/**
 * Create a product variant
 * POST /api/businesses/{businessId}/products/{productId}/variants
 * Body: { variantName, sku, priceAdjustment?, stock?, reorderLevel? }
 */
async function createVariant(req, res, next) {
  try {
    const { businessId, productId } = req.params;
    const { variantName, sku, priceAdjustment = 0, stock = 0, reorderLevel = 10 } = req.body;
    const userId = req.user.id;

    // Verify business ownership
    const bizCheck = await pool.query(
      'SELECT id FROM businesses WHERE id = $1 AND user_id = $2',
      [businessId, userId]
    );
    if (!bizCheck.rows.length) {
      throw new AppError('Unauthorized', 403, 'not_authorized');
    }

    // Verify product exists
    const productCheck = await pool.query(
      `SELECT id FROM business_products WHERE id = $1 AND business_id = $2`,
      [productId, businessId]
    );
    if (!productCheck.rows.length) {
      throw new AppError('Product not found', 404, 'not_found');
    }

    // Create variant with inventory
    const variant = await withTransaction(async (client) => {
      const varResult = await client.query(
        `
        INSERT INTO business_product_variants
        (product_id, variant_name, sku, price_adjustment_cents)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        `,
        [productId, variantName.trim(), sku.trim(), Math.round(priceAdjustment * 100)]
      );

      const variantId = varResult.rows[0].id;

      // Create inventory record
      await client.query(
        `
        INSERT INTO business_product_inventory
        (variant_id, stock_quantity, reorder_level)
        VALUES ($1, $2, $3)
        `,
        [variantId, stock, reorderLevel]
      );

      // Log stock history
      await client.query(
        `
        INSERT INTO business_product_stock_history
        (variant_id, change_type, quantity_change, reason)
        VALUES ($1, 'initial', $2, 'Product variant created')
        `,
        [variantId, stock]
      );

      return varResult.rows[0];
    });

    logger.info('Variant created', { variantId: variant.id, productId });

    res.status(201).json({
      success: true,
      data: {
        id: variant.id,
        sku: variant.sku,
        name: variant.variant_name,
        priceAdjustment: variant.price_adjustment_cents / 100,
      },
    });
  } catch (error) {
    logger.error('productController.createVariant', { error });
    next(error);
  }
}

/**
 * Update inventory for a variant
 * PUT /api/businesses/{businessId}/products/{productId}/variants/{variantId}/inventory
 * Body: { quantityChange, reason }
 */
async function updateVariantInventory(req, res, next) {
  try {
    const { businessId, variantId } = req.params;
    const { quantityChange, reason = 'Manual adjustment' } = req.body;
    const userId = req.user.id;

    // Verify business ownership
    const bizCheck = await pool.query(
      'SELECT id FROM businesses WHERE id = $1 AND user_id = $2',
      [businessId, userId]
    );
    if (!bizCheck.rows.length) {
      throw new AppError('Unauthorized', 403, 'not_authorized');
    }

    if (typeof quantityChange !== 'number') {
      throw new AppError('Quantity change required', 400, 'validation_failed');
    }

    // Update inventory in transaction
    const inventory = await withTransaction(async (client) => {
      // Get current stock
      const currentResult = await client.query(
        `SELECT stock_quantity FROM business_product_inventory WHERE variant_id = $1`,
        [variantId]
      );

      if (!currentResult.rows.length) {
        throw new AppError('Variant not found', 404, 'not_found');
      }

      const newStock = currentResult.rows[0].stock_quantity + quantityChange;
      if (newStock < 0) {
        throw new AppError('Insufficient stock', 400, 'insufficient_stock');
      }

      // Update inventory
      const result = await client.query(
        `UPDATE business_product_inventory
         SET stock_quantity = $1, updated_at = now()
         WHERE variant_id = $2 RETURNING *`,
        [newStock, variantId]
      );

      // Log change
      await client.query(
        `
        INSERT INTO business_product_stock_history
        (variant_id, change_type, quantity_change, reason)
        VALUES ($1, $2, $3, $4)
        `,
        [variantId, quantityChange > 0 ? 'restock' : 'sale', quantityChange, reason.trim()]
      );

      return result.rows[0];
    });

    logger.info('Inventory updated', { variantId, quantityChange });

    res.json({
      success: true,
      data: {
        stock: inventory.stock_quantity,
        lastUpdated: inventory.updated_at,
      },
    });
  } catch (error) {
    logger.error('productController.updateVariantInventory', { error });
    next(error);
  }
}

/**
 * Get low stock alerts
 * GET /api/businesses/{businessId}/products/alerts/low-stock
 */
async function getLowStockAlerts(req, res, next) {
  try {
    const { businessId } = req.params;
    const userId = req.user.id;

    // Verify business ownership
    const bizCheck = await pool.query(
      'SELECT id FROM businesses WHERE id = $1 AND user_id = $2',
      [businessId, userId]
    );
    if (!bizCheck.rows.length) {
      throw new AppError('Unauthorized', 403, 'not_authorized');
    }

    const result = await pool.query(
      `
      SELECT
        p.id, p.name, p.category,
        v.id as variant_id, v.sku, v.variant_name,
        pi.stock_quantity, pi.reorder_level
      FROM business_products p
      JOIN business_product_variants v ON p.id = v.product_id
      JOIN business_product_inventory pi ON v.id = pi.variant_id
      WHERE p.business_id = $1
      AND pi.stock_quantity <= pi.reorder_level
      AND p.deleted_at IS NULL
      ORDER BY pi.stock_quantity ASC
      `,
      [businessId]
    );

    res.json({
      success: true,
      data: result.rows.map(r => ({
        productId: r.id,
        productName: r.name,
        category: r.category,
        variantId: r.variant_id,
        sku: r.sku,
        variantName: r.variant_name,
        currentStock: parseInt(r.stock_quantity),
        reorderLevel: parseInt(r.reorder_level),
      })),
      alertCount: result.rows.length,
    });
  } catch (error) {
    logger.error('productController.getLowStockAlerts', { error });
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
