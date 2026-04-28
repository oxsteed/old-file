const { pool } = require('../db');
const { sendError, sendSuccess } = require('../utils/apiError');
const logger = require('../utils/logger');

/**
 * Create a new shopping cart
 * POST /api/carts
 * Body: { jobId?, name, description? }
 */
const createCart = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { jobId, name, description } = req.body;

    if (!name || name.trim().length === 0) {
      return sendError(res, 400, 'Cart name is required');
    }

    const query = `
      INSERT INTO shopping_carts (helper_id, job_id, name, description, status)
      VALUES ($1, $2, $3, $4, 'draft')
      RETURNING id, helper_id, job_id, name, description, status, created_at, updated_at
    `;

    const result = await pool.query(query, [
      helperId,
      jobId || null,
      name.trim(),
      description?.trim() || null,
    ]);

    const cart = result.rows[0];
    logger.info('Shopping cart created', { cartId: cart.id, helperId, jobId });

    sendSuccess(res, cart, 201);
  } catch (err) {
    logger.error('Error creating shopping cart', err);
    sendError(res, 500, 'Failed to create cart');
  }
};

/**
 * Get all carts for logged-in helper
 * GET /api/carts?templateOnly=false
 */
const getCarts = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { templateOnly = false } = req.query;

    let query = `
      SELECT
        id, helper_id, job_id, name, description, is_template, status,
        subtotal_cents, tax_cents, total_cents, currency,
        (SELECT COUNT(*) FROM shopping_cart_items WHERE cart_id = sc.id) as item_count,
        created_at, updated_at
      FROM shopping_carts sc
      WHERE helper_id = $1
    `;

    const params = [helperId];

    if (templateOnly === 'true' || templateOnly === true) {
      query += ` AND is_template = TRUE`;
    }

    query += ` ORDER BY updated_at DESC`;

    const result = await pool.query(query, params);

    sendSuccess(res, {
      carts: result.rows,
      count: result.rows.length,
    });
  } catch (err) {
    logger.error('Error fetching carts', err);
    sendError(res, 500, 'Failed to fetch carts');
  }
};

/**
 * Get single cart with items
 * GET /api/carts/:cartId
 */
const getCart = async (req, res) => {
  try {
    const { cartId } = req.params;
    const helperId = req.user.id;

    // Verify ownership
    const cartQuery = `
      SELECT id, helper_id, job_id, name, description, is_template, status,
             subtotal_cents, tax_cents, total_cents, currency, created_at, updated_at
      FROM shopping_carts
      WHERE id = $1 AND helper_id = $2
    `;

    const cartResult = await pool.query(cartQuery, [cartId, helperId]);

    if (cartResult.rows.length === 0) {
      return sendError(res, 404, 'Cart not found or you do not own this cart');
    }

    const cart = cartResult.rows[0];

    // Get items
    const itemsQuery = `
      SELECT
        sci.id, sci.product_id, sci.quantity, sci.unit_price_cents, sci.notes, sci.sort_order,
        mp.name as product_name, mp.category, mp.product_image_url, mp.price_cents
      FROM shopping_cart_items sci
      JOIN marketplace_products mp ON sci.product_id = mp.id
      WHERE sci.cart_id = $1
      ORDER BY sci.sort_order ASC, sci.created_at ASC
    `;

    const itemsResult = await pool.query(itemsQuery, [cartId]);

    // Calculate totals from items
    const subtotal = itemsResult.rows.reduce(
      (sum, item) => sum + (item.unit_price_cents || 0) * item.quantity,
      0
    );

    sendSuccess(res, {
      ...cart,
      items: itemsResult.rows,
      itemCount: itemsResult.rows.length,
      calculatedSubtotal: subtotal,
    });
  } catch (err) {
    logger.error('Error fetching cart', err);
    sendError(res, 500, 'Failed to fetch cart');
  }
};

/**
 * Update cart metadata
 * PUT /api/carts/:cartId
 * Body: { name?, description?, status? }
 */
const updateCart = async (req, res) => {
  try {
    const { cartId } = req.params;
    const helperId = req.user.id;
    const { name, description, status } = req.body;

    // Verify ownership
    const checkQuery = `SELECT id FROM shopping_carts WHERE id = $1 AND helper_id = $2`;
    const checkResult = await pool.query(checkQuery, [cartId, helperId]);

    if (checkResult.rows.length === 0) {
      return sendError(res, 404, 'Cart not found or you do not own this cart');
    }

    const updates = [];
    const params = [cartId, helperId];
    let paramCount = 3;

    if (name !== undefined && name.trim().length > 0) {
      updates.push(`name = $${paramCount}`);
      params.push(name.trim());
      paramCount++;
    }

    if (description !== undefined) {
      updates.push(`description = $${paramCount}`);
      params.push(description?.trim() || null);
      paramCount++;
    }

    if (status !== undefined && ['draft', 'shared', 'approved', 'purchased'].includes(status)) {
      updates.push(`status = $${paramCount}`);
      params.push(status);
      paramCount++;
    }

    if (updates.length === 0) {
      return sendError(res, 400, 'No fields to update');
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    const query = `
      UPDATE shopping_carts
      SET ${updates.join(', ')}
      WHERE id = $1 AND helper_id = $2
      RETURNING id, name, description, status, updated_at
    `;

    const result = await pool.query(query, params);

    logger.info('Shopping cart updated', { cartId, helperId });
    sendSuccess(res, result.rows[0]);
  } catch (err) {
    logger.error('Error updating cart', err);
    sendError(res, 500, 'Failed to update cart');
  }
};

/**
 * Delete a cart
 * DELETE /api/carts/:cartId
 */
const deleteCart = async (req, res) => {
  try {
    const { cartId } = req.params;
    const helperId = req.user.id;

    const query = `
      DELETE FROM shopping_carts
      WHERE id = $1 AND helper_id = $2
      RETURNING id
    `;

    const result = await pool.query(query, [cartId, helperId]);

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Cart not found or you do not own this cart');
    }

    logger.info('Shopping cart deleted', { cartId, helperId });
    sendSuccess(res, { message: 'Cart deleted' });
  } catch (err) {
    logger.error('Error deleting cart', err);
    sendError(res, 500, 'Failed to delete cart');
  }
};

/**
 * Add item to cart
 * POST /api/carts/:cartId/items
 * Body: { productId, quantity, notes? }
 */
const addItem = async (req, res) => {
  try {
    const { cartId } = req.params;
    const helperId = req.user.id;
    const { productId, quantity = 1, notes } = req.body;

    if (!productId) {
      return sendError(res, 400, 'Product ID is required');
    }

    if (quantity <= 0) {
      return sendError(res, 400, 'Quantity must be greater than 0');
    }

    // Verify cart ownership
    const cartCheck = await pool.query(
      'SELECT id FROM shopping_carts WHERE id = $1 AND helper_id = $2',
      [cartId, helperId]
    );

    if (cartCheck.rows.length === 0) {
      return sendError(res, 404, 'Cart not found or you do not own this cart');
    }

    // Get product price
    const productCheck = await pool.query(
      'SELECT id, price_cents FROM marketplace_products WHERE id = $1 AND is_available = TRUE',
      [productId]
    );

    if (productCheck.rows.length === 0) {
      return sendError(res, 404, 'Product not found or unavailable');
    }

    const productPrice = productCheck.rows[0].price_cents;

    const query = `
      INSERT INTO shopping_cart_items (cart_id, product_id, quantity, unit_price_cents, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, product_id, quantity, unit_price_cents, notes
    `;

    const result = await pool.query(query, [
      cartId,
      productId,
      quantity,
      productPrice,
      notes?.trim() || null,
    ]);

    logger.info('Item added to cart', { cartId, productId, quantity });
    sendSuccess(res, result.rows[0], 201);
  } catch (err) {
    logger.error('Error adding item to cart', err);
    sendError(res, 500, 'Failed to add item');
  }
};

/**
 * Update item in cart
 * PUT /api/carts/:cartId/items/:itemId
 * Body: { quantity?, notes? }
 */
const updateItem = async (req, res) => {
  try {
    const { cartId, itemId } = req.params;
    const helperId = req.user.id;
    const { quantity, notes } = req.body;

    // Verify cart ownership
    const cartCheck = await pool.query(
      `SELECT sci.id FROM shopping_cart_items sci
       JOIN shopping_carts sc ON sci.cart_id = sc.id
       WHERE sci.id = $1 AND sci.cart_id = $2 AND sc.helper_id = $3`,
      [itemId, cartId, helperId]
    );

    if (cartCheck.rows.length === 0) {
      return sendError(res, 404, 'Item not found or you do not own this cart');
    }

    const updates = [];
    const params = [itemId, cartId, helperId];
    let paramCount = 4;

    if (quantity !== undefined) {
      if (quantity <= 0) {
        return sendError(res, 400, 'Quantity must be greater than 0');
      }
      updates.push(`quantity = $${paramCount}`);
      params.push(quantity);
      paramCount++;
    }

    if (notes !== undefined) {
      updates.push(`notes = $${paramCount}`);
      params.push(notes?.trim() || null);
      paramCount++;
    }

    if (updates.length === 0) {
      return sendError(res, 400, 'No fields to update');
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    const query = `
      UPDATE shopping_cart_items
      SET ${updates.join(', ')}
      WHERE id = $1 AND cart_id = $2
      RETURNING id, quantity, notes
    `;

    const result = await pool.query(query, params);

    logger.info('Cart item updated', { cartId, itemId });
    sendSuccess(res, result.rows[0]);
  } catch (err) {
    logger.error('Error updating cart item', err);
    sendError(res, 500, 'Failed to update item');
  }
};

/**
 * Remove item from cart
 * DELETE /api/carts/:cartId/items/:itemId
 */
const removeItem = async (req, res) => {
  try {
    const { cartId, itemId } = req.params;
    const helperId = req.user.id;

    // Verify cart ownership and item exists
    const cartCheck = await pool.query(
      `SELECT sci.id FROM shopping_cart_items sci
       JOIN shopping_carts sc ON sci.cart_id = sc.id
       WHERE sci.id = $1 AND sci.cart_id = $2 AND sc.helper_id = $3`,
      [itemId, cartId, helperId]
    );

    if (cartCheck.rows.length === 0) {
      return sendError(res, 404, 'Item not found or you do not own this cart');
    }

    const query = `
      DELETE FROM shopping_cart_items
      WHERE id = $1 AND cart_id = $2
      RETURNING id
    `;

    await pool.query(query, [itemId, cartId]);

    logger.info('Cart item removed', { cartId, itemId });
    sendSuccess(res, { message: 'Item removed from cart' });
  } catch (err) {
    logger.error('Error removing cart item', err);
    sendError(res, 500, 'Failed to remove item');
  }
};

/**
 * Save cart as reusable template
 * POST /api/carts/:cartId/save-as-template
 * Body: { templateName }
 */
const saveAsTemplate = async (req, res) => {
  try {
    const { cartId } = req.params;
    const helperId = req.user.id;
    const { templateName } = req.body;

    if (!templateName || templateName.trim().length === 0) {
      return sendError(res, 400, 'Template name is required');
    }

    // Verify cart ownership
    const cartCheck = await pool.query(
      'SELECT id FROM shopping_carts WHERE id = $1 AND helper_id = $2',
      [cartId, helperId]
    );

    if (cartCheck.rows.length === 0) {
      return sendError(res, 404, 'Cart not found or you do not own this cart');
    }

    const query = `
      UPDATE shopping_carts
      SET is_template = TRUE, name = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, name, is_template, created_at
    `;

    const result = await pool.query(query, [cartId, templateName.trim()]);

    logger.info('Cart saved as template', { cartId, templateName });
    sendSuccess(res, result.rows[0]);
  } catch (err) {
    logger.error('Error saving cart as template', err);
    sendError(res, 500, 'Failed to save template');
  }
};

/**
 * Create new cart from template
 * POST /api/carts/from-template/:templateId
 * Body: { name, jobId? }
 */
const createFromTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;
    const helperId = req.user.id;
    const { name, jobId } = req.body;

    if (!name || name.trim().length === 0) {
      return sendError(res, 400, 'Cart name is required');
    }

    // Get template
    const templateQuery = `
      SELECT id FROM shopping_carts
      WHERE id = $1 AND helper_id = $2 AND is_template = TRUE
    `;

    const templateResult = await pool.query(templateQuery, [templateId, helperId]);

    if (templateResult.rows.length === 0) {
      return sendError(res, 404, 'Template not found or you do not own this template');
    }

    // Start transaction
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Create new cart
      const createCartQuery = `
        INSERT INTO shopping_carts (helper_id, job_id, name, description, status)
        VALUES ($1, $2, $3, $4, 'draft')
        RETURNING id
      `;

      const newCart = await client.query(createCartQuery, [
        helperId,
        jobId || null,
        name.trim(),
        null,
      ]);

      const newCartId = newCart.rows[0].id;

      // Copy items from template
      const copyItemsQuery = `
        INSERT INTO shopping_cart_items (cart_id, product_id, quantity, unit_price_cents, notes, sort_order)
        SELECT $1, product_id, quantity, unit_price_cents, notes, sort_order
        FROM shopping_cart_items
        WHERE cart_id = $2
      `;

      await client.query(copyItemsQuery, [newCartId, templateId]);

      await client.query('COMMIT');

      logger.info('Cart created from template', { newCartId, templateId, helperId });

      sendSuccess(res, { id: newCartId, name }, 201);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error creating cart from template', err);
    sendError(res, 500, 'Failed to create cart from template');
  }
};

module.exports = {
  createCart,
  getCarts,
  getCart,
  updateCart,
  deleteCart,
  addItem,
  updateItem,
  removeItem,
  saveAsTemplate,
  createFromTemplate,
};
