const pool = require('../db');
const crypto = require('crypto');
const { sendError, sendSuccess } = require('../utils/apiError');
const logger = require('../utils/logger');

/**
 * Generate a secure share token for a cart
 */
const generateShareToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Share a cart with a unique token
 * POST /api/shared-carts
 * Body: { cartId, customerId?, canModify?, expiresInDays? }
 */
const shareCart = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { cartId, customerId, canModify = true, expiresInDays } = req.body;

    if (!cartId) {
      return sendError(res, 400, 'Cart ID is required');
    }

    // Verify cart ownership
    const cartCheck = await pool.query(
      'SELECT id FROM shopping_carts WHERE id = $1 AND helper_id = $2',
      [cartId, helperId]
    );

    if (cartCheck.rows.length === 0) {
      return sendError(res, 404, 'Cart not found or you do not own this cart');
    }

    const shareToken = generateShareToken();
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const query = `
      INSERT INTO shared_carts (cart_id, share_token, shared_by, customer_id, can_modify, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, share_token, created_at, expires_at, can_modify
    `;

    const result = await pool.query(query, [
      cartId,
      shareToken,
      helperId,
      customerId || null,
      canModify,
      expiresAt,
    ]);

    const shareRecord = result.rows[0];

    logger.info('Cart shared', {
      cartId,
      helperId,
      customerId: customerId || 'public',
      expiresAt: expiresAt?.toISOString(),
    });

    sendSuccess(res, {
      sharedCartId: shareRecord.id,
      shareToken: shareRecord.share_token,
      shareUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/shared-cart/${shareRecord.share_token}`,
      expiresAt: shareRecord.expires_at,
      canModify: shareRecord.can_modify,
    }, 201);
  } catch (err) {
    logger.error('Error sharing cart', err);
    sendError(res, 500, 'Failed to share cart');
  }
};

/**
 * View a shared cart (public endpoint - no auth required)
 * GET /api/shared-carts/:shareToken
 */
const viewSharedCart = async (req, res) => {
  try {
    const { shareToken } = req.params;

    // Check if token is valid and not expired
    const shareQuery = `
      SELECT
        sc.id, sc.cart_id, sc.shared_by, sc.customer_id, sc.can_modify, sc.expires_at,
        sc.view_count, sc.last_viewed_at,
        json_build_object(
          'id', c.id,
          'name', c.name,
          'description', c.description,
          'status', c.status,
          'subtotalCents', c.subtotal_cents,
          'taxCents', c.tax_cents,
          'totalCents', c.total_cents
        ) as cart
      FROM shared_carts sc
      JOIN shopping_carts c ON sc.cart_id = c.id
      WHERE sc.share_token = $1
        AND (sc.expires_at IS NULL OR sc.expires_at > NOW())
    `;

    const shareResult = await pool.query(shareQuery, [shareToken]);

    if (shareResult.rows.length === 0) {
      return sendError(res, 404, 'Shared cart not found or link has expired');
    }

    const sharedCart = shareResult.rows[0];

    // Get cart items
    const itemsQuery = `
      SELECT
        sci.id, sci.product_id, sci.quantity, sci.unit_price_cents, sci.notes,
        mp.name as product_name, mp.category, mp.product_image_url, mp.affiliate_url
      FROM shopping_cart_items sci
      JOIN marketplace_products mp ON sci.product_id = mp.id
      WHERE sci.cart_id = $1
      ORDER BY sci.sort_order ASC
    `;

    const itemsResult = await pool.query(itemsQuery, [sharedCart.cart_id]);

    // Update view count
    await pool.query(
      `UPDATE shared_carts
       SET view_count = view_count + 1, last_viewed_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [sharedCart.id]
    );

    // Log view event
    const userId = req.user?.id || null;
    const userAgent = req.headers['user-agent'] || '';
    const ipHash = crypto
      .createHash('sha256')
      .update(req.ip || req.connection.remoteAddress || '')
      .digest('hex');

    await pool.query(
      `INSERT INTO shared_cart_views (shared_cart_id, viewed_by_id, user_agent, ip_hash, action)
       VALUES ($1, $2, $3, $4, 'view')`,
      [sharedCart.id, userId, userAgent, ipHash]
    );

    logger.info('Shared cart viewed', { shareToken: shareToken.substring(0, 8) + '...' });

    sendSuccess(res, {
      sharedCartId: sharedCart.id,
      cartId: sharedCart.cart_id,
      sharedBy: sharedCart.shared_by,
      customerId: sharedCart.customer_id,
      canModify: sharedCart.can_modify,
      expiresAt: sharedCart.expires_at,
      cart: sharedCart.cart,
      items: itemsResult.rows,
      viewCount: sharedCart.view_count + 1,
    });
  } catch (err) {
    logger.error('Error viewing shared cart', err);
    sendError(res, 500, 'Failed to load shared cart');
  }
};

/**
 * Modify items in a shared cart (if permitted)
 * PUT /api/shared-carts/:shareToken/items/:itemId
 * Body: { quantity?, notes? }
 */
const modifySharedCart = async (req, res) => {
  try {
    const { shareToken, itemId } = req.params;
    const { quantity, notes } = req.body;

    // Verify share token and permissions
    const shareQuery = `
      SELECT sc.id, sc.cart_id, sc.can_modify, sc.expires_at
      FROM shared_carts sc
      WHERE sc.share_token = $1
        AND (sc.expires_at IS NULL OR sc.expires_at > NOW())
    `;

    const shareResult = await pool.query(shareQuery, [shareToken]);

    if (shareResult.rows.length === 0) {
      return sendError(res, 404, 'Shared cart not found or link has expired');
    }

    const sharedCart = shareResult.rows[0];

    if (!sharedCart.can_modify) {
      return sendError(res, 403, 'This cart cannot be modified');
    }

    // Update item
    const updates = [];
    const params = [itemId, sharedCart.cart_id];
    let paramCount = 3;

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

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Item not found in cart');
    }

    // Log modification event
    const userId = req.user?.id || null;
    await pool.query(
      `INSERT INTO shared_cart_views (shared_cart_id, viewed_by_id, action)
       VALUES ($1, $2, 'modify')`,
      [sharedCart.id, userId]
    );

    logger.info('Shared cart modified', { shareToken: shareToken.substring(0, 8) + '...' });

    sendSuccess(res, result.rows[0]);
  } catch (err) {
    logger.error('Error modifying shared cart', err);
    sendError(res, 500, 'Failed to modify cart');
  }
};

/**
 * Add item to shared cart (if permitted)
 * POST /api/shared-carts/:shareToken/items
 * Body: { productId, quantity }
 */
const addItemToSharedCart = async (req, res) => {
  try {
    const { shareToken } = req.params;
    const { productId, quantity = 1 } = req.body;

    if (!productId) {
      return sendError(res, 400, 'Product ID is required');
    }

    if (quantity <= 0) {
      return sendError(res, 400, 'Quantity must be greater than 0');
    }

    // Verify share token and permissions
    const shareQuery = `
      SELECT sc.id, sc.cart_id, sc.can_modify, sc.expires_at
      FROM shared_carts sc
      WHERE sc.share_token = $1
        AND (sc.expires_at IS NULL OR sc.expires_at > NOW())
    `;

    const shareResult = await pool.query(shareQuery, [shareToken]);

    if (shareResult.rows.length === 0) {
      return sendError(res, 404, 'Shared cart not found or link has expired');
    }

    const sharedCart = shareResult.rows[0];

    if (!sharedCart.can_modify) {
      return sendError(res, 403, 'This cart cannot be modified');
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

    // Add item
    const query = `
      INSERT INTO shopping_cart_items (cart_id, product_id, quantity, unit_price_cents)
      VALUES ($1, $2, $3, $4)
      RETURNING id, product_id, quantity, unit_price_cents
    `;

    const result = await pool.query(query, [sharedCart.cart_id, productId, quantity, productPrice]);

    // Log event
    const userId = req.user?.id || null;
    await pool.query(
      `INSERT INTO shared_cart_views (shared_cart_id, viewed_by_id, action)
       VALUES ($1, $2, 'add_item')`,
      [sharedCart.id, userId]
    );

    logger.info('Item added to shared cart', { shareToken: shareToken.substring(0, 8) + '...' });

    sendSuccess(res, result.rows[0], 201);
  } catch (err) {
    logger.error('Error adding item to shared cart', err);
    sendError(res, 500, 'Failed to add item');
  }
};

/**
 * Remove item from shared cart (if permitted)
 * DELETE /api/shared-carts/:shareToken/items/:itemId
 */
const removeItemFromSharedCart = async (req, res) => {
  try {
    const { shareToken, itemId } = req.params;

    // Verify share token and permissions
    const shareQuery = `
      SELECT sc.id, sc.cart_id, sc.can_modify, sc.expires_at
      FROM shared_carts sc
      WHERE sc.share_token = $1
        AND (sc.expires_at IS NULL OR sc.expires_at > NOW())
    `;

    const shareResult = await pool.query(shareQuery, [shareToken]);

    if (shareResult.rows.length === 0) {
      return sendError(res, 404, 'Shared cart not found or link has expired');
    }

    const sharedCart = shareResult.rows[0];

    if (!sharedCart.can_modify) {
      return sendError(res, 403, 'This cart cannot be modified');
    }

    // Remove item
    const query = `
      DELETE FROM shopping_cart_items
      WHERE id = $1 AND cart_id = $2
      RETURNING id
    `;

    const result = await pool.query(query, [itemId, sharedCart.cart_id]);

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Item not found in cart');
    }

    // Log event
    const userId = req.user?.id || null;
    await pool.query(
      `INSERT INTO shared_cart_views (shared_cart_id, viewed_by_id, action)
       VALUES ($1, $2, 'remove_item')`,
      [sharedCart.id, userId]
    );

    logger.info('Item removed from shared cart', { shareToken: shareToken.substring(0, 8) + '...' });

    sendSuccess(res, { message: 'Item removed' });
  } catch (err) {
    logger.error('Error removing item from shared cart', err);
    sendError(res, 500, 'Failed to remove item');
  }
};

/**
 * Approve a shared cart (customer action)
 * POST /api/shared-carts/:shareToken/approve
 * Body: { notes? }
 */
const approveCart = async (req, res) => {
  try {
    const shareToken = req.params.shareToken;
    const customerId = req.user.id;
    const { notes } = req.body;

    // Get shared cart
    const shareQuery = `
      SELECT sc.id, sc.cart_id, sc.expires_at
      FROM shared_carts sc
      WHERE sc.share_token = $1
        AND (sc.expires_at IS NULL OR sc.expires_at > NOW())
    `;

    const shareResult = await pool.query(shareQuery, [shareToken]);

    if (shareResult.rows.length === 0) {
      return sendError(res, 404, 'Shared cart not found or link has expired');
    }

    const sharedCart = shareResult.rows[0];

    // Create approval record
    const query = `
      INSERT INTO cart_approvals (cart_id, shared_cart_id, customer_id, status, customer_notes, approved_at)
      VALUES ($1, $2, $3, 'approved', $4, CURRENT_TIMESTAMP)
      RETURNING id, status, approved_at
    `;

    const result = await pool.query(query, [
      sharedCart.cart_id,
      sharedCart.id,
      customerId,
      notes?.trim() || null,
    ]);

    // Update shared cart status
    await pool.query(
      `UPDATE shared_carts SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [sharedCart.id]
    );

    // Log approval event
    await pool.query(
      `INSERT INTO shared_cart_views (shared_cart_id, viewed_by_id, action)
       VALUES ($1, $2, 'approve')`,
      [sharedCart.id, customerId]
    );

    logger.info('Cart approved', { shareToken: shareToken.substring(0, 8) + '...' });

    sendSuccess(res, {
      approvalId: result.rows[0].id,
      status: result.rows[0].status,
      approvedAt: result.rows[0].approved_at,
    });
  } catch (err) {
    logger.error('Error approving cart', err);
    sendError(res, 500, 'Failed to approve cart');
  }
};

/**
 * Get share analytics
 * GET /api/shared-carts/:sharedCartId/stats
 */
const getShareAnalytics = async (req, res) => {
  try {
    const { sharedCartId } = req.params;
    const helperId = req.user.id;

    // Verify ownership (shared cart owner must be the helper)
    const ownerCheck = await pool.query(
      `SELECT sc.id FROM shared_carts sc
       JOIN shopping_carts c ON sc.cart_id = c.id
       WHERE sc.id = $1 AND c.helper_id = $2`,
      [sharedCartId, helperId]
    );

    if (ownerCheck.rows.length === 0) {
      return sendError(res, 404, 'Shared cart not found or you do not own it');
    }

    // Get stats
    const query = `
      SELECT
        view_count,
        last_viewed_at,
        (SELECT COUNT(*) FROM shared_cart_views WHERE shared_cart_id = $1 AND action = 'view') as view_events,
        (SELECT COUNT(*) FROM shared_cart_views WHERE shared_cart_id = $1 AND action IN ('add_item', 'remove_item', 'modify')) as edit_events,
        (SELECT COUNT(*) FROM shared_cart_views WHERE shared_cart_id = $1 AND action = 'approve') as approvals,
        (SELECT COUNT(DISTINCT viewed_by_id) FROM shared_cart_views WHERE shared_cart_id = $1) as unique_viewers
      FROM shared_carts
      WHERE id = $1
    `;

    const result = await pool.query(query, [sharedCartId]);

    const stats = result.rows[0] || {
      view_count: 0,
      last_viewed_at: null,
      view_events: 0,
      edit_events: 0,
      approvals: 0,
      unique_viewers: 0,
    };

    sendSuccess(res, stats);
  } catch (err) {
    logger.error('Error getting share analytics', err);
    sendError(res, 500, 'Failed to get analytics');
  }
};

/**
 * Revoke a share link
 * DELETE /api/shared-carts/:sharedCartId
 */
const revokeShare = async (req, res) => {
  try {
    const { sharedCartId } = req.params;
    const helperId = req.user.id;

    // Verify ownership
    const ownerCheck = await pool.query(
      `SELECT sc.id FROM shared_carts sc
       JOIN shopping_carts c ON sc.cart_id = c.id
       WHERE sc.id = $1 AND c.helper_id = $2`,
      [sharedCartId, helperId]
    );

    if (ownerCheck.rows.length === 0) {
      return sendError(res, 404, 'Shared cart not found or you do not own it');
    }

    // Delete shared cart
    await pool.query('DELETE FROM shared_carts WHERE id = $1', [sharedCartId]);

    logger.info('Share link revoked', { sharedCartId });
    sendSuccess(res, { message: 'Share link revoked' });
  } catch (err) {
    logger.error('Error revoking share link', err);
    sendError(res, 500, 'Failed to revoke share link');
  }
};

module.exports = {
  shareCart,
  viewSharedCart,
  modifySharedCart,
  addItemToSharedCart,
  removeItemFromSharedCart,
  approveCart,
  getShareAnalytics,
  revokeShare,
};
