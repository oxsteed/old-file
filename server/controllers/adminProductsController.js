const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const logger = require('../utils/logger');
const { sendError, sendValidationError } = require('../utils/apiError');

const VALID_PRODUCT_CATEGORIES = ['tools', 'supplies', 'equipment', 'materials', 'other'];
const MAX_BULK_PRODUCTS = 100;

/**
 * Shared product validation, mirroring createProduct's rules.
 * partial=true validates only the fields present (for updates).
 */
function validateProductFields(data, { partial = false } = {}) {
  const errors = {};
  const { name, description, category, price_cents, quantity_available, image_url, affiliate_url } = data || {};

  if (!partial || name !== undefined) {
    if (!name || typeof name !== 'string') {
      errors.name = 'Required string';
    } else if (name.trim().length < 3) {
      errors.name = 'Must be at least 3 characters';
    } else if (name.trim().length > 255) {
      errors.name = 'Must be less than 255 characters';
    }
  }

  if (description !== undefined && description !== null && typeof description === 'string') {
    if (description.trim().length > 2000) {
      errors.description = 'Must be less than 2000 characters';
    }
  }

  if (!partial || price_cents !== undefined) {
    if (price_cents === undefined || price_cents === null || typeof price_cents !== 'number') {
      errors.price_cents = 'Required number';
    } else if (!Number.isInteger(price_cents) || price_cents < 0 || price_cents > 999999999) {
      errors.price_cents = 'Must be a non-negative integer between 0 and 999999999';
    }
  }

  if (quantity_available !== undefined && quantity_available !== null &&
      (typeof quantity_available !== 'number' || quantity_available < 0)) {
    errors.quantity_available = 'Must be non-negative number';
  }

  if (category !== undefined && category !== null && typeof category === 'string' && category !== '') {
    if (!VALID_PRODUCT_CATEGORIES.includes(category.toLowerCase())) {
      errors.category = `Must be one of: ${VALID_PRODUCT_CATEGORIES.join(', ')}`;
    }
  }

  for (const [field, url] of [['image_url', image_url], ['affiliate_url', affiliate_url]]) {
    if (url !== undefined && url !== null && url !== '' && typeof url === 'string') {
      try {
        new URL(url);
      } catch {
        errors[field] = 'Invalid URL format';
      }
    }
  }

  return errors;
}

async function createProduct(req, res) {
  try {
    const {
      name,
      description,
      category,
      price_cents,
      skills = [],
      image_url,
      affiliate_url,
      external_id,
      source = 'manual',
      quantity_available = 999999
    } = req.body;

    // Comprehensive validation (shared with update/bulk paths)
    const errors = validateProductFields(req.body);
    if (Object.keys(errors).length > 0) {
      return sendValidationError(res, errors);
    }

    const product = await withTransaction(async (client) => {
      // Create product
      const result = await client.query(
        `INSERT INTO marketplace_products
         (name, description, category, price_cents, image_url, affiliate_url, external_id, source, quantity_available, rating, review_count, in_carts_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 0, 0)
         RETURNING *`,
        [name, description, category, price_cents, image_url, affiliate_url, external_id, source, quantity_available]
      );

      const productId = result.rows[0].id;

      // Link skills if provided
      if (skills.length > 0) {
        for (const skillId of skills) {
          await client.query(
            `INSERT INTO marketplace_product_skills (product_id, skill_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [productId, skillId]
          );
        }
      }

      return result.rows[0];
    });

    logger.info('Product created', { productId: product.id, name });

    res.json({
      success: true,
      data: product
    });
  } catch (error) {
    logger.error('Error creating product', { error });
    sendError(res, 500, 'Failed to create product');
  }
}

async function updateProduct(req, res) {
  try {
    const { productId } = req.params;
    const {
      name,
      description,
      category,
      price_cents,
      image_url,
      affiliate_url,
      skills = []
    } = req.body;

    // Check product exists
    const existing = await pool.query(
      'SELECT * FROM marketplace_products WHERE id = $1',
      [productId]
    );

    if (!existing.rows.length) return sendError(res, 404, 'Product not found');

    // Mirror createProduct's validation for every field being updated
    const errors = validateProductFields(req.body, { partial: true });
    if (Object.keys(errors).length > 0) {
      return sendValidationError(res, errors);
    }

    const product = await withTransaction(async (client) => {
      // Update product
      const updates = [];
      const values = [productId];
      let paramCount = 2;

      if (name !== undefined) {
        updates.push(`name = $${paramCount}`);
        values.push(name);
        paramCount++;
      }
      if (description !== undefined) {
        updates.push(`description = $${paramCount}`);
        values.push(description);
        paramCount++;
      }
      if (category !== undefined) {
        updates.push(`category = $${paramCount}`);
        values.push(category);
        paramCount++;
      }
      if (price_cents !== undefined) {
        updates.push(`price_cents = $${paramCount}`);
        values.push(price_cents);
        paramCount++;
      }
      if (image_url !== undefined) {
        updates.push(`image_url = $${paramCount}`);
        values.push(image_url);
        paramCount++;
      }
      if (affiliate_url !== undefined) {
        updates.push(`affiliate_url = $${paramCount}`);
        values.push(affiliate_url);
        paramCount++;
      }

      if (updates.length === 0) return existing.rows[0];

      updates.push('updated_at = CURRENT_TIMESTAMP');
      const result = await client.query(
        `UPDATE marketplace_products SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
        values
      );

      // Update skills if provided
      if (skills.length > 0) {
        // Clear existing skills
        await client.query('DELETE FROM marketplace_product_skills WHERE product_id = $1', [productId]);

        // Add new skills
        for (const skillId of skills) {
          await client.query(
            `INSERT INTO marketplace_product_skills (product_id, skill_id) VALUES ($1, $2)`,
            [productId, skillId]
          );
        }
      }

      return result.rows[0];
    });

    logger.info('Product updated', { productId });

    res.json({
      success: true,
      data: product
    });
  } catch (error) {
    logger.error('Error updating product', { error });
    sendError(res, 500, 'Failed to update product');
  }
}

async function deleteProduct(req, res) {
  try {
    const { productId } = req.params;

    // Check product exists
    const product = await pool.query(
      'SELECT * FROM marketplace_products WHERE id = $1',
      [productId]
    );

    if (!product.rows.length) return sendError(res, 404, 'Product not found');

    // Check if product is in any active orders
    const activeOrders = await pool.query(
      `SELECT COUNT(*) as count FROM marketplace_order_items
       WHERE product_id = $1 AND order_id IN (
         SELECT id FROM marketplace_orders WHERE status IN ('pending', 'paid', 'processing')
       )`,
      [productId]
    );

    if (activeOrders.rows[0].count > 0) {
      return sendError(res, 400, 'Cannot delete product with active orders');
    }

    await withTransaction(async (client) => {
      // Delete product skills
      await client.query('DELETE FROM marketplace_product_skills WHERE product_id = $1', [productId]);

      // Delete product
      await client.query('DELETE FROM marketplace_products WHERE id = $1', [productId]);
    });

    logger.info('Product deleted', { productId });

    res.json({
      success: true,
      data: { id: productId }
    });
  } catch (error) {
    logger.error('Error deleting product', { error });
    sendError(res, 500, 'Failed to delete product');
  }
}

async function bulkCreateProducts(req, res) {
  try {
    const { products } = req.body;

    if (!Array.isArray(products) || products.length === 0) {
      return sendValidationError(res, { products: 'Array of products required' });
    }

    if (products.length > MAX_BULK_PRODUCTS) {
      return sendValidationError(res, { products: `Maximum ${MAX_BULK_PRODUCTS} products per bulk request` });
    }

    const created = [];
    const failed = [];

    for (let i = 0; i < products.length; i++) {
      const productData = products[i] || {};
      const itemErrors = validateProductFields(productData);
      if (Object.keys(itemErrors).length > 0) {
        failed.push({ index: i, errors: itemErrors });
        continue;
      }

      try {
        const result = await pool.query(
          `INSERT INTO marketplace_products
           (name, description, category, price_cents, image_url, affiliate_url, external_id, source, rating, review_count, in_carts_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, 0)
           RETURNING *`,
          [
            productData.name,
            productData.description || null,
            productData.category || null,
            productData.price_cents,
            productData.image_url || null,
            productData.affiliate_url || null,
            productData.external_id || null,
            productData.source || 'manual'
          ]
        );
        created.push(result.rows[0]);
      } catch (err) {
        logger.warn('Failed to create product in bulk', { product: productData.name, error: err.message });
      }
    }

    logger.info('Bulk created products', { count: created.length, failed: failed.length });

    res.json({
      success: true,
      data: {
        created: created.length,
        failed: failed.length,
        products: created,
        errors: failed
      }
    });
  } catch (error) {
    logger.error('Error bulk creating products', { error });
    sendError(res, 500, 'Failed to bulk create products');
  }
}

async function getProductStats(req, res) {
  try {
    const stats = await pool.query(
      `SELECT
        COUNT(*) as total_products,
        AVG(price_cents) as avg_price_cents,
        AVG(rating) as avg_rating,
        SUM(in_carts_count) as total_in_carts,
        COUNT(DISTINCT category) as total_categories
       FROM marketplace_products`
    );

    res.json({
      success: true,
      data: stats.rows[0]
    });
  } catch (error) {
    logger.error('Error fetching product stats', { error });
    sendError(res, 500, 'Failed to fetch product stats');
  }
}

module.exports = {
  createProduct,
  updateProduct,
  deleteProduct,
  bulkCreateProducts,
  getProductStats
};
