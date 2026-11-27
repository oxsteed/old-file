const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');

/**
 * Create a new shopping cart
 * POST /api/carts
 * Body: { jobId?, name, description? }
 */
const createCart = async (req, res, next) => {
  try {
    const helperId = req.user.id;
    const { jobId, name, description } = req.body;

    const fields = {};
    if (!name || name.trim().length === 0) fields.name = 'Cart name is required';
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
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

    res.status(201).json(cart);
  } catch (err) {
    next(err);
  }
};

/**
 * Get all carts for logged-in helper
 * GET /api/carts?templateOnly=false
 */
const getCarts = async (req, res, next) => {
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

    res.json({
      carts: result.rows,
      count: result.rows.length,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get single cart with items
 * GET /api/carts/:cartId
 */
const getCart = async (req, res, next) => {
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
      throw new AppError('Cart not found or you do not own this cart', 404, 'not_found');
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

    res.json({
      ...cart,
      items: itemsResult.rows,
      itemCount: itemsResult.rows.length,
      calculatedSubtotal: subtotal,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Update cart metadata
 * PUT /api/carts/:cartId
 * Body: { name?, description?, status? }
 */
const updateCart = async (req, res, next) => {
  try {
    const { cartId } = req.params;
    const helperId = req.user.id;
    const { name, description, status } = req.body;

    // Verify ownership
    const checkQuery = `SELECT id FROM shopping_carts WHERE id = $1 AND helper_id = $2`;
    const checkResult = await pool.query(checkQuery, [cartId, helperId]);

    if (checkResult.rows.length === 0) {
      throw new AppError('Cart not found or you do not own this cart', 404, 'not_found');
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
      throw new AppError('No fields to update', 400, 'validation_failed');
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
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * Delete a cart
 * DELETE /api/carts/:cartId
 */
const deleteCart = async (req, res, next) => {
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
      throw new AppError('Cart not found or you do not own this cart', 404, 'not_found');
    }

    logger.info('Shopping cart deleted', { cartId, helperId });
    res.json({ message: 'Cart deleted' });
  } catch (err) {
    next(err);
  }
};

/**
 * Add item to cart
 * POST /api/carts/:cartId/items
 * Body: { productId, quantity, notes? }
 */
const addItem = async (req, res, next) => {
  try {
    const { cartId } = req.params;
    const helperId = req.user.id;
    const { productId, quantity = 1, notes } = req.body;

    const fields = {};
    if (!productId) fields.productId = 'Product ID is required';
    if (quantity <= 0) fields.quantity = 'Quantity must be greater than 0';
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    // Verify cart ownership
    const cartCheck = await pool.query(
      'SELECT id FROM shopping_carts WHERE id = $1 AND helper_id = $2',
      [cartId, helperId]
    );

    if (cartCheck.rows.length === 0) {
      throw new AppError('Cart not found or you do not own this cart', 404, 'not_found');
    }

    // Get product price
    const productCheck = await pool.query(
      'SELECT id, price_cents FROM marketplace_products WHERE id = $1 AND is_active = TRUE AND is_available = TRUE',
      [productId]
    );

    if (productCheck.rows.length === 0) {
      throw new AppError('Product not found or unavailable', 404, 'not_found');
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
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * Update item in cart
 * PUT /api/carts/:cartId/items/:itemId
 * Body: { quantity?, notes? }
 */
const updateItem = async (req, res, next) => {
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
      throw new AppError('Item not found or you do not own this cart', 404, 'not_found');
    }

    const updates = [];
    const params = [itemId, cartId, helperId];
    let paramCount = 4;

    if (quantity !== undefined) {
      if (quantity <= 0) {
        throw new AppError('Quantity must be greater than 0', 400, 'validation_failed', { quantity: 'Quantity must be greater than 0' });
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
      throw new AppError('No fields to update', 400, 'validation_failed');
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
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * Remove item from cart
 * DELETE /api/carts/:cartId/items/:itemId
 */
const removeItem = async (req, res, next) => {
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
      throw new AppError('Item not found or you do not own this cart', 404, 'not_found');
    }

    const query = `
      DELETE FROM shopping_cart_items
      WHERE id = $1 AND cart_id = $2
      RETURNING id
    `;

    await pool.query(query, [itemId, cartId]);

    logger.info('Cart item removed', { cartId, itemId });
    res.json({ message: 'Item removed from cart' });
  } catch (err) {
    next(err);
  }
};

/**
 * Save cart as reusable template
 * POST /api/carts/:cartId/save-as-template
 * Body: { templateName }
 */
const saveAsTemplate = async (req, res, next) => {
  try {
    const { cartId } = req.params;
    const helperId = req.user.id;
    const { templateName } = req.body;

    if (!templateName || templateName.trim().length === 0) {
      throw new AppError('Template name is required', 400, 'validation_failed', { templateName: 'Template name is required' });
    }

    // Verify cart ownership
    const cartCheck = await pool.query(
      'SELECT id FROM shopping_carts WHERE id = $1 AND helper_id = $2',
      [cartId, helperId]
    );

    if (cartCheck.rows.length === 0) {
      throw new AppError('Cart not found or you do not own this cart', 404, 'not_found');
    }

    const query = `
      UPDATE shopping_carts
      SET is_template = TRUE, name = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, name, is_template, created_at
    `;

    const result = await pool.query(query, [cartId, templateName.trim()]);

    logger.info('Cart saved as template', { cartId, templateName });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * Create new cart from template
 * POST /api/carts/from-template/:templateId
 * Body: { name, jobId? }
 */
const createFromTemplate = async (req, res, next) => {
  try {
    const { templateId } = req.params;
    const helperId = req.user.id;
    const { name, jobId } = req.body;

    if (!name || name.trim().length === 0) {
      throw new AppError('Cart name is required', 400, 'validation_failed', { name: 'Cart name is required' });
    }

    // Get template
    const templateQuery = `
      SELECT id FROM shopping_carts
      WHERE id = $1 AND helper_id = $2 AND is_template = TRUE
    `;

    const templateResult = await pool.query(templateQuery, [templateId, helperId]);

    if (templateResult.rows.length === 0) {
      throw new AppError('Template not found or you do not own this template', 404, 'not_found');
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

      res.status(201).json({ id: newCartId, name });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

/**
 * List return requests on orders checked out from the caller's own carts.
 * GET /api/carts/returns?status=&skip=&limit=
 *
 * G1-B6 (D-675): the merchant queue. The scope is the cart helper in
 * SQL (shopping_carts.helper_id = caller), so a helper sees returns on
 * their own carts' orders only and never another merchant's. Orders
 * with no cart have no merchant and never appear here; they are admin
 * only. Read-only: deciding a return is the admin queue's job.
 */
const listCartReturnRequests = async (req, res, next) => {
  try {
    const helperId = req.user.id;
    if (!helperId) {
      throw new AppError('Authentication required', 401, 'no_auth');
    }

    const { status } = req.query;
    const parsedLimit = Number.parseInt(String(req.query.limit ?? 20), 10);
    const parsedSkip = Number.parseInt(String(req.query.skip ?? 0), 10);
    const limitN = Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20;
    const skipN = Number.isSafeInteger(parsedSkip) && parsedSkip >= 0 ? Math.min(parsedSkip, 1_000_000) : 0;
    const statusFilter = ['requested', 'approved', 'declined', 'refunded', 'cancelled'].includes(status)
      ? status
      : null;

    const where = ['sc.helper_id = $1'];
    const params = [helperId];
    if (statusFilter) {
      where.push(`r.status = $${params.length + 1}`);
      params.push(statusFilter);
    }

    const { rows } = await pool.query(
      `SELECT r.*, mo.status AS order_status, mo.total_cents AS order_total_cents,
              mo.cart_id AS cart_id,
              u.email AS customer_email, u.first_name AS customer_first_name,
              u.last_name AS customer_last_name
         FROM order_return_requests r
         JOIN marketplace_orders mo ON mo.id = r.order_id
         JOIN shopping_carts sc ON sc.id = mo.cart_id
         JOIN users u ON u.id = r.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY r.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limitN, skipN]
    );

    const { rows: [countRow] } = await pool.query(
      `SELECT COUNT(*) AS total
         FROM order_return_requests r
         JOIN marketplace_orders mo ON mo.id = r.order_id
         JOIN shopping_carts sc ON sc.id = mo.cart_id
        WHERE ${where.join(' AND ')}`,
      params
    );
    const total = parseInt(countRow.total, 10);

    res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        orderId: r.order_id,
        cartId: r.cart_id,
        customerId: r.user_id,
        customerName: `${r.customer_first_name || ''} ${r.customer_last_name || ''}`.trim(),
        customerEmail: r.customer_email,
        reason: r.reason,
        status: r.status,
        adminNote: r.admin_note,
        decidedBy: r.decided_by,
        decidedAt: r.decided_at,
        orderStatus: r.order_status,
        orderTotalCents: r.order_total_cents,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      pagination: { total, skip: skipN, limit: limitN, hasMore: skipN + limitN < total },
    });
  } catch (err) {
    next(err);
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
  listCartReturnRequests,
};
