const pool = require('../db');
const logger = require('../utils/logger');
const { sendError } = require('../utils/apiError');
const { AppError } = require('../middleware/errorHandler');
const { sendNotification } = require('../services/notificationService');
const { hasGlobalGrant } = require('../middleware/adminAuth');
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const { processMarketplaceRefund } = require('../services/marketplaceRefundService');

async function getOrders(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendError(res, 401, 'Unauthorized');

    const { status, skip = 0, limit = 20 } = req.query;
    let query = 'SELECT * FROM marketplace_orders WHERE customer_id = $1';
    const params = [userId];

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, skip);

    const orders = await pool.query(query, params);

    res.json({
      success: true,
      data: orders.rows
    });
  } catch (error) {
    logger.error('Error fetching orders', { error });
    sendError(res, 500, 'Failed to fetch orders');
  }
}

async function getOrder(req, res) {
  try {
    const { orderId } = req.params;
    const userId = req.user?.id;

    if (!userId) return sendError(res, 401, 'Unauthorized');

    // Fetch order
    const order = await pool.query(
      'SELECT * FROM marketplace_orders WHERE id = $1 AND customer_id = $2',
      [orderId, userId]
    );

    if (!order.rows.length) return sendError(res, 404, 'Order not found');

    // Fetch order items with product details
    const items = await pool.query(
      `SELECT oi.*, mp.name, mp.description, mp.image_url
       FROM marketplace_order_items oi
       JOIN marketplace_products mp ON oi.product_id = mp.id
       WHERE oi.order_id = $1`,
      [orderId]
    );

    // Fetch transaction details
    const transaction = await pool.query(
      'SELECT * FROM marketplace_transactions WHERE order_id = $1',
      [orderId]
    );

    // Fetch return requests (Group 1, item 35) so the order page can show
    // the status of any return the customer opened.
    const returns = await pool.query(
      `SELECT * FROM order_return_requests
        WHERE order_id = $1 AND user_id = $2
        ORDER BY created_at DESC`,
      [orderId, userId]
    );

    res.json({
      success: true,
      data: {
        ...order.rows[0],
        items: items.rows,
        transaction: transaction.rows[0] || null,
        return_requests: returns.rows
      }
    });
  } catch (error) {
    logger.error('Error fetching order', { error });
    sendError(res, 500, 'Failed to fetch order');
  }
}

async function getOrderStats(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendError(res, 401, 'Unauthorized');

    const stats = await pool.query(
      `SELECT
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as completed_orders,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_orders,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
        SUM(total_cents) as total_spent_cents,
        AVG(total_cents) as average_order_value_cents
       FROM marketplace_orders
       WHERE customer_id = $1`,
      [userId]
    );

    res.json({
      success: true,
      data: stats.rows[0]
    });
  } catch (error) {
    logger.error('Error fetching order stats', { error });
    sendError(res, 500, 'Failed to fetch order stats');
  }
}

async function cancelOrder(req, res, next) {
  try {
    const { orderId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      throw new AppError('Authentication required', 401, 'no_auth');
    }

    // Check order exists and belongs to user
    const order = await pool.query(
      'SELECT * FROM marketplace_orders WHERE id = $1 AND customer_id = $2',
      [orderId, userId]
    );

    if (!order.rows.length) {
      throw new AppError('Order not found', 404, 'order_not_found');
    }

    if (order.rows[0].status !== 'pending' && order.rows[0].status !== 'paid') {
      throw new AppError(`Cannot cancel order in ${order.rows[0].status} status`, 400, 'invalid_order_state');
    }

    const currentOrder = order.rows[0];
    if (currentOrder.status === 'paid') {
      if (!stripe) {
        throw new AppError('Refunds are temporarily unavailable. Please contact support.', 503, 'refund_unavailable');
      }

      const refundResult = await processMarketplaceRefund({
        orderId,
        requestedAmountCents: Number(currentOrder.total_cents || 0),
        reason: String(req.body?.reason || 'Cancelled by customer').slice(0, 500),
        actorUserId: userId,
        requestId: req.get('Idempotency-Key') || req.body?.idempotencyKey || `customer-cancel-${orderId}`,
      });
      if (refundResult.refund.status !== 'succeeded') {
        throw new AppError('Refund is still processing. Please check the order again shortly.', 202, 'refund_processing');
      }

      logger.info('Paid marketplace order cancelled and refunded', {
        orderId,
        userId,
        refundId: refundResult.refund.provider_refund_id,
      });
      return res.json({ success: true, data: refundResult.order });
    }

    // Pending orders have not been paid and can be cancelled locally.
    const updatedOrder = await pool.query(
      `UPDATE marketplace_orders
       SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND customer_id = $2 AND status = 'pending'
       RETURNING *`,
      [orderId, userId]
    );
    if (!updatedOrder.rows.length) {
      throw new AppError('Order state changed while cancelling.', 409, 'order_state_conflict');
    }

    logger.info('Order cancelled', { orderId, userId });

    res.json({
      success: true,
      data: updatedOrder.rows[0]
    });
  } catch (error) {
    next(error);
  }
}

// G1-B6 (D-672/D-673): a return request reaches the seller side and
// the admin side. The marketplace records no seller on the order or the
// product (both are platform-sourced), so the "merchant" is the helper
// who built the cart the order was checked out from
// (shopping_carts.helper_id via marketplace_orders.cart_id). An order
// with no cart has no merchant to notify and reaches the admins only.
// Admins follow the dispute_opened pattern: active admins and
// super_admins, gated on the manage_operations grant the admin return
// queue itself requires. Per-recipient failures are swallowed
// (allSettled): the request row is already stored and the caller
// already has their 201.
async function notifyReturnRequested({ returnRequest, order, customerId }) {
  const data = { return_id: returnRequest.id, order_id: order.id };

  let merchantId = null;
  if (order.cart_id) {
    const { rows: cartRows } = await pool.query(
      'SELECT helper_id FROM shopping_carts WHERE id = $1',
      [order.cart_id]
    );
    merchantId = cartRows[0]?.helper_id || null;
  }

  const { rows: adminRows } = await pool.query(
    `SELECT id, role FROM users
       WHERE role IN ('admin', 'super_admin')
         AND is_active = true
         AND deleted_at IS NULL`
  );
  const eligibleAdminRows = (await Promise.all(
    adminRows.map(async (admin) => (
      admin.role === 'super_admin' || await hasGlobalGrant(admin.id, 'manage_operations')
        ? admin
        : null
    ))
  )).filter(Boolean);

  const sends = [];
  // The helper buying from their own cart is the customer already; a
  // notice about their own request would be noise.
  if (merchantId && merchantId !== customerId) {
    sends.push(sendNotification({
      userId: merchantId,
      type: 'marketplace_return_requested',
      data,
      action_url: '/marketplace/returns',
      idempotencyKey: `marketplace-return:${returnRequest.id}:merchant:${merchantId}`,
    }));
  }
  for (const admin of eligibleAdminRows) {
    sends.push(sendNotification({
      userId: admin.id,
      type: 'marketplace_return_requested',
      data,
      action_url: '/admin/orders',
      idempotencyKey: `marketplace-return:${returnRequest.id}:admin:${admin.id}`,
    }));
  }
  await Promise.allSettled(sends);
}

async function createReturnRequest(req, res, next) {
  try {
    const { orderId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      throw new AppError('Authentication required', 401, 'no_auth');
    }

    const reason = String(req.body?.reason || '').trim();
    if (!reason) {
      throw new AppError('A reason for the return is required.', 400, 'validation_failed');
    }
    if (reason.length > 1000) {
      throw new AppError('Reason must be 1000 characters or fewer.', 400, 'validation_failed');
    }

    // The order must belong to the caller; a stranger gets 404, never a
    // hint that the order exists.
    const order = await pool.query(
      'SELECT * FROM marketplace_orders WHERE id = $1 AND customer_id = $2',
      [orderId, userId]
    );
    if (!order.rows.length) {
      throw new AppError('Order not found', 404, 'order_not_found');
    }

    // Only orders the customer actually paid for (or that are being
    // fulfilled) can be returned. Pending orders are cancelled, not
    // returned; cancelled/refunded orders are already closed.
    const status = order.rows[0].status;
    if (!['paid', 'processing', 'completed'].includes(status)) {
      throw new AppError(`Cannot request a return for an order in ${status} status`, 400, 'invalid_order_state');
    }

    // Group 1, item 35: a return request is a record only. It never issues
    // a refund; refunds stay in the existing money-approvals flow.
    try {
      const { rows } = await pool.query(
        `INSERT INTO order_return_requests (order_id, user_id, reason, status)
         VALUES ($1, $2, $3, 'requested')
         RETURNING *`,
        [orderId, userId, reason.slice(0, 1000)]
      );
      const created = rows[0];
      // G1-B6: the request now reaches someone. Notify the helper who
      // sold the order through the cart and the operations admins, after
      // the row is stored. A notification failure never fails the
      // request itself (dispute_opened pattern).
      try {
        await notifyReturnRequested({ returnRequest: created, order: order.rows[0], customerId: userId });
      } catch (notifErr) {
        logger.warn('Marketplace return notification failed', { returnId: created.id, error: notifErr.message });
      }
      logger.info('Marketplace return requested', { orderId, userId, returnId: created.id });
      return res.status(201).json({ success: true, data: created });
    } catch (err) {
      // The partial unique index allows one open request per order.
      if (err.code === '23505') {
        throw new AppError('A return is already open for this order.', 409, 'return_already_open');
      }
      throw err;
    }
  } catch (error) {
    next(error);
  }
}

async function getReturnRequests(req, res, next) {
  try {
    const { orderId } = req.params;
    const userId = req.user?.id;
    if (!userId) return sendError(res, 401, 'Unauthorized');

    const order = await pool.query(
      'SELECT id FROM marketplace_orders WHERE id = $1 AND customer_id = $2',
      [orderId, userId]
    );
    if (!order.rows.length) return sendError(res, 404, 'Order not found');

    const { rows } = await pool.query(
      `SELECT * FROM order_return_requests
        WHERE order_id = $1 AND user_id = $2
        ORDER BY created_at DESC`,
      [orderId, userId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
}

async function cancelReturnRequest(req, res, next) {
  try {
    const { orderId, returnId } = req.params;
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Authentication required', 401, 'no_auth');
    }
    const { rows } = await pool.query(
      `UPDATE order_return_requests
          SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND order_id = $2 AND user_id = $3 AND status = 'requested'
        RETURNING *`,
      [returnId, orderId, userId]
    );
    if (!rows.length) {
      throw new AppError('Return request not found or no longer open', 404, 'return_not_found');
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getOrders,
  getOrder,
  getOrderStats,
  cancelOrder,
  createReturnRequest,
  getReturnRequests,
  cancelReturnRequest
};
