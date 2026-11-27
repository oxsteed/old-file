const pool = require('../db');
const logger = require('../utils/logger');
const { sendError, sendValidationError } = require('../utils/apiError');
const { withTransaction } = require('../utils/transaction');
const { processMarketplaceRefund } = require('../services/marketplaceRefundService');
const { sendMoneyMovementGateResult } = require('../utils/dualApprovalHttp');

// ADM-063: allowed marketplace order status transitions. Mirrors the
// database guard in migration 603 (which remains as defense in depth), but
// enforced here so invalid transitions fail with a clean 409 instead of a
// 500 from the trigger — and so unpaid orders can never be shipped.
const ORDER_STATUS_TRANSITIONS = Object.freeze({
  pending: ['paid', 'cancelled'],
  paid: ['processing', 'cancelled', 'refunded'],
  processing: ['processing', 'completed', 'cancelled', 'refunded'],
  completed: ['refunded'],
  cancelled: [],
  refunded: [],
});

function isAllowedOrderTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true;
  const allowed = ORDER_STATUS_TRANSITIONS[fromStatus];
  // Unknown legacy statuses fail open here (migration 603 documents the
  // same policy); known statuses must follow the graph.
  if (!allowed) return true;
  return allowed.includes(toStatus);
}

// Get orders list with filtering, sorting, and pagination
async function getOrders(req, res) {
  try {
    const { status, customerId, sortBy = 'created_at', sortOrder = 'DESC', skip = 0, limit = 20, search } = req.query;
    const parsedLimit = Number.parseInt(String(limit), 10);
    const parsedSkip = Number.parseInt(String(skip), 10);
    const limitN = Number.isSafeInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 20;
    const skipN = Number.isSafeInteger(parsedSkip) && parsedSkip >= 0
      ? Math.min(parsedSkip, 1_000_000)
      : 0;
    const searchTerm = search == null ? '' : String(search).slice(0, 120);

    let query = 'SELECT mo.*, u.email, u.first_name, u.last_name FROM marketplace_orders mo JOIN users u ON mo.customer_id = u.id WHERE 1=1';
    const params = [];
    let paramCount = 1;

    // Filter by status
    if (status && ['pending', 'paid', 'processing', 'completed', 'cancelled', 'refunded'].includes(status)) {
      query += ` AND mo.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    // Filter by customer ID
    if (customerId) {
      query += ` AND mo.customer_id = $${paramCount}`;
      params.push(customerId);
      paramCount++;
    }

    // Search by order ID, email, or customer name
    if (searchTerm) {
      query += ` AND (CAST(mo.id AS TEXT) ILIKE $${paramCount} OR u.email ILIKE $${paramCount} OR u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount})`;
      params.push(`%${searchTerm}%`);
      paramCount++;
    }

    // Validate sort column
    const allowedSort = ['created_at', 'total_cents', 'status', 'customer_id'];
    const sortColumn = allowedSort.includes(sortBy) ? sortBy : 'created_at';
    const direction = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    query += ` ORDER BY mo.${sortColumn} ${direction} LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limitN, skipN);

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM marketplace_orders mo JOIN users u ON mo.customer_id = u.id WHERE 1=1';
    const countParams = [];
    if (status && ['pending', 'paid', 'processing', 'completed', 'cancelled', 'refunded'].includes(status)) {
      countQuery += ` AND mo.status = $${countParams.length + 1}`;
      countParams.push(status);
    }
    if (customerId) {
      countQuery += ` AND mo.customer_id = $${countParams.length + 1}`;
      countParams.push(customerId);
    }
    if (searchTerm) {
      countQuery += ` AND (CAST(mo.id AS TEXT) ILIKE $${countParams.length + 1} OR u.email ILIKE $${countParams.length + 1} OR u.first_name ILIKE $${countParams.length + 1} OR u.last_name ILIKE $${countParams.length + 1})`;
      countParams.push(`%${searchTerm}%`);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      data: result.rows.map(o => ({
        id: o.id,
        customerId: o.customer_id,
        customerEmail: o.email,
        customerName: `${o.first_name} ${o.last_name}`,
        status: o.status,
        totalCents: o.total_cents,
        subtotalCents: o.subtotal_cents,
        taxCents: o.tax_cents,
        shippingCents: o.shipping_cents,
        discountCents: o.discount_cents,
        createdAt: o.created_at,
        shippedAt: o.shipped_at,
        trackingNumber: o.tracking_number,
        refundedAt: o.refunded_at,
        refundReason: o.refund_reason
      })),
      pagination: {
        total,
        skip: skipN,
        limit: limitN,
        hasMore: skipN + limitN < total
      }
    });
  } catch (error) {
    logger.error('Error fetching orders', { error });
    sendError(res, 500, 'Failed to fetch orders');
  }
}

// Get single order detail
async function getOrder(req, res) {
  try {
    const { orderId } = req.params;

    if (!orderId || isNaN(orderId)) {
      return sendValidationError(res, { orderId: 'Invalid order ID' });
    }

    const orderResult = await pool.query(
      `SELECT mo.*, u.email, u.first_name, u.last_name, u.phone_number
       FROM marketplace_orders mo
       JOIN users u ON mo.customer_id = u.id
       WHERE mo.id = $1`,
      [orderId]
    );

    if (!orderResult.rows.length) {
      return sendError(res, 404, 'Order not found');
    }

    const order = orderResult.rows[0];

    // Refunded orders stay readable: operators must be able to investigate
    // resolved financial cases. Mutations are disabled client-side for
    // refunded status, so no 409 gate belongs on this read path.

    // Get order items
    const itemsResult = await pool.query(
      `SELECT moi.*, mp.name, mp.image_url
       FROM marketplace_order_items moi
       JOIN marketplace_products mp ON moi.product_id = mp.id
       WHERE moi.order_id = $1`,
      [orderId]
    );

    // Get transaction
    const transactionResult = await pool.query(
      'SELECT * FROM marketplace_transactions WHERE order_id = $1 LIMIT 1',
      [orderId]
    );

    // Get action log
    const logResult = await pool.query(
      'SELECT * FROM order_action_log WHERE order_id = $1 ORDER BY created_at DESC LIMIT 20',
      [orderId]
    );

    res.json({
      success: true,
      data: {
        id: order.id,
        customerId: order.customer_id,
        customer: {
          email: order.email,
          firstName: order.first_name,
          lastName: order.last_name,
          phone: order.phone_number
        },
        status: order.status,
        totals: {
          subtotalCents: order.subtotal_cents,
          taxCents: order.tax_cents,
          shippingCents: order.shipping_cents,
          discountCents: order.discount_cents,
          totalCents: order.total_cents
        },
        // ADM-010: shipping_address is JSONB — node-pg already parses it into
        // an object, so JSON.parse would throw on the string "[object Object]".
        shippingAddress: typeof order.shipping_address === 'string'
          ? JSON.parse(order.shipping_address)
          : (order.shipping_address || {}),
        items: itemsResult.rows.map(i => ({
          id: i.id,
          productId: i.product_id,
          productName: i.name,
          productImage: i.image_url,
          quantity: i.quantity,
          unitPriceCents: i.unit_price_cents,
          totalPriceCents: i.total_price_cents,
          itemStatus: i.status
        })),
        transaction: transactionResult.rows[0] ? {
          id: transactionResult.rows[0].id,
          paymentIntentId: transactionResult.rows[0].payment_intent_id,
          amountCents: transactionResult.rows[0].amount_cents,
          status: transactionResult.rows[0].status,
          completedAt: transactionResult.rows[0].completed_at
        } : null,
        shipping: {
          trackingNumber: order.tracking_number,
          shippedAt: order.shipped_at
        },
        refund: {
          refundedAt: order.refunded_at,
          refundReason: order.refund_reason
        },
        dates: {
          createdAt: order.created_at,
          updatedAt: order.updated_at
        },
        actionLog: logResult.rows.map(log => ({
          id: log.id,
          actionType: log.action_type,
          details: log.action_details,
          createdAt: log.created_at
        }))
      }
    });
  } catch (error) {
    logger.error('Error fetching order detail', { error, orderId: req.params.orderId });
    sendError(res, 500, 'Failed to fetch order details');
  }
}

// Mark order as shipped
async function markShipped(req, res) {
  try {
    const { orderId } = req.params;
    const { trackingNumber, carrier } = req.body;
    const adminId = req.user?.id;

    if (!orderId || isNaN(orderId)) {
      return sendValidationError(res, { orderId: 'Invalid order ID' });
    }

    const order = await withTransaction(pool, async (client) => {
      const orderResult = await client.query(
        'SELECT * FROM marketplace_orders WHERE id = $1',
        [orderId]
      );

      if (!orderResult.rows.length) {
        throw new Error('Order not found');
      }

      const order = orderResult.rows[0];
      // ADM-063: only paid orders can be shipped (processing is idempotent
      // for tracking updates). Unpaid (pending) orders, completed orders,
      // and terminal cancelled/refunded orders are rejected with 409.
      if (!isAllowedOrderTransition(order.status, 'processing')) {
        const err = new Error(
          `Order cannot be marked shipped from status '${order.status}'. Only paid orders can be shipped.`
        );
        err.status = 409;
        err.code = 'order_invalid_status_transition';
        throw err;
      }

      // Update order with tracking info
      const updateResult = await client.query(
        `UPDATE marketplace_orders
         SET status = 'processing', shipped_at = CURRENT_TIMESTAMP, tracking_number = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [trackingNumber || null, orderId]
      );

      // Log action
      await client.query(
        `INSERT INTO order_action_log (order_id, action_type, action_details, performed_by)
         VALUES ($1, $2, $3, $4)`,
        [orderId, 'shipped', JSON.stringify({ trackingNumber, carrier }), adminId]
      );

      return updateResult.rows[0];
    }, 'mark_order_shipped');

    logger.info('Order marked as shipped', { orderId, trackingNumber });

    res.json({
      success: true,
      data: {
        orderId: order.id,
        status: order.status,
        shippedAt: order.shipped_at,
        trackingNumber: order.tracking_number
      }
    });
  } catch (error) {
    logger.error('Error marking order as shipped', { error, orderId: req.params.orderId });
    // ADM-063: surface invalid transitions as 409, including violations of
    // the migration-603 database guard (ERRCODE 23514) as a second line of
    // defense behind the controller check above.
    if (error.status === 409 || error.code === '23514') {
      return sendError(res, 409, error.message || 'Invalid order status transition', 'order_invalid_status_transition');
    }
    sendError(res, 500, 'Failed to mark order as shipped');
  }
}

// Process refund
async function processRefund(req, res) {
  try {
    const { orderId } = req.params;
    // ADM-009: the client must send an explicit amount in cents, or declare
    // fullRefund: true. A missing/NaN amount is rejected by the service
    // (fail closed) instead of silently becoming a full refund.
    const { reason, refundAmount, fullRefund } = req.body;
    const adminId = req.user?.id;

    if (!orderId || isNaN(orderId)) {
      return sendValidationError(res, { orderId: 'Invalid order ID' });
    }

    if (!reason || String(reason).trim().length === 0) {
      return sendValidationError(res, { reason: 'Refund reason required' });
    }
    const result = await processMarketplaceRefund({
      orderId,
      requestedAmountCents: refundAmount,
      fullRefund: fullRefund === true,
      reason,
      actorUserId: adminId,
      requestId: req.get('Idempotency-Key') || req.body?.idempotencyKey,
      // ADM-016: above-threshold refunds queue for a second admin instead
      // of moving money on this single approval.
      dualApproval: {
        movementType: 'marketplace_refund',
        referenceKey: `order:${orderId}`,
        requestedBy: adminId,
        idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey,
        payload: {
          orderId,
          requestedAmountCents: refundAmount,
          fullRefund: fullRefund === true,
          reason,
          makerAdminId: adminId,
          requestId: req.get('Idempotency-Key') || req.body?.idempotencyKey,
        },
      },
    });
    // ADM-016: queued for dual approval — no money moved yet.
    if (result.dualApproval) {
      logger.info('Marketplace order refund queued for dual approval', {
        orderId,
        approvalId: result.dualApproval.approval.id,
        adminId,
      });
      return sendMoneyMovementGateResult(res, result.dualApproval);
    }
    const status = result.refund.status === 'succeeded' ? (result.order.status || 'refunded') : 'processing';
    logger.info('Marketplace order refund reconciled', {
      orderId,
      refundAmount: result.refund.amount_cents,
      stripeRefundId: result.refund.provider_refund_id,
      refundStatus: result.refund.status,
      replay: !!result.replay,
    });
    return res.status(result.refund.status === 'succeeded' ? 200 : 202).json({
      success: true,
      data: {
        orderId: result.order.id,
        status,
        refundStatus: result.refund.status,
        refundAmount: Number(result.refund.amount_cents),
        cumulativeRefundedAmount: Number(result.transaction.refunded_amount_cents || 0),
        reason: result.refund.reason,
        stripeRefundId: result.refund.provider_refund_id || null,
        idempotent: !!result.replay,
      },
    });
  } catch (error) {
    logger.error('Error processing refund', { error, orderId: req.params.orderId });
    sendError(res, error.status || error.statusCode || 500, error.message || 'Failed to process refund', error.code, error.fields);
  }
}

// Cancel order
async function cancelOrder(req, res) {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;
    const adminId = req.user?.id;

    if (!orderId || isNaN(orderId)) {
      return sendValidationError(res, { orderId: 'Invalid order ID' });
    }

    const order = await withTransaction(pool, async (client) => {
      const orderResult = await client.query(
        'SELECT * FROM marketplace_orders WHERE id = $1',
        [orderId]
      );

      if (!orderResult.rows.length) {
        throw new Error('Order not found');
      }

      const order = orderResult.rows[0];
      if (['cancelled', 'refunded'].includes(order.status)) {
        throw new Error('Order already cancelled or refunded');
      }
      if (['paid', 'processing', 'completed'].includes(order.status)) {
        throw new Error('Paid orders must use the refund action before cancellation');
      }

      // Cancel order
      const updateResult = await client.query(
        `UPDATE marketplace_orders
         SET status = 'cancelled', refund_reason = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [reason || 'Cancelled by admin', orderId]
      );

      // Log action
      await client.query(
        `INSERT INTO order_action_log (order_id, action_type, action_details, performed_by)
         VALUES ($1, $2, $3, $4)`,
        [orderId, 'cancelled', JSON.stringify({ reason }), adminId]
      );

      return updateResult.rows[0];
    }, 'cancel_order');

    logger.info('Order cancelled', { orderId, reason });

    res.json({
      success: true,
      data: {
        orderId: order.id,
        status: order.status,
        reason: order.refund_reason
      }
    });
  } catch (error) {
    logger.error('Error cancelling order', { error, orderId: req.params.orderId });
    sendError(res, 500, 'Failed to cancel order');
  }
}

// Get order statistics
async function getOrderStats(req, res) {
  try {
    const { startDate, endDate } = req.query;

    let query = `
      SELECT
        COUNT(*) as total_orders,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_orders,
        COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_orders,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders,
        COUNT(CASE WHEN status = 'refunded' THEN 1 END) as refunded_orders,
        SUM(CASE WHEN status = 'completed' THEN total_cents ELSE 0 END) as total_revenue_cents,
        AVG(total_cents) as avg_order_value_cents,
        SUM(discount_cents) as total_discounts_cents,
        SUM(shipping_cents) as total_shipping_cents,
        SUM(tax_cents) as total_tax_cents
      FROM marketplace_orders
      WHERE 1=1
    `;

    const params = [];
    if (startDate) {
      query += ` AND created_at >= $${params.length + 1}`;
      params.push(startDate);
    }
    if (endDate) {
      query += ` AND created_at <= $${params.length + 1}`;
      params.push(endDate);
    }

    const result = await pool.query(query, params);
    const stats = result.rows[0];

    res.json({
      success: true,
      data: {
        totalOrders: parseInt(stats.total_orders),
        completedOrders: parseInt(stats.completed_orders),
        pendingOrders: parseInt(stats.pending_orders),
        processingOrders: parseInt(stats.processing_orders),
        cancelledOrders: parseInt(stats.cancelled_orders),
        refundedOrders: parseInt(stats.refunded_orders),
        totalRevenueCents: stats.total_revenue_cents ? parseInt(stats.total_revenue_cents) : 0,
        averageOrderValueCents: stats.avg_order_value_cents ? Math.round(stats.avg_order_value_cents) : 0,
        totalDiscountsCents: stats.total_discounts_cents ? parseInt(stats.total_discounts_cents) : 0,
        totalShippingCents: stats.total_shipping_cents ? parseInt(stats.total_shipping_cents) : 0,
        totalTaxCents: stats.total_tax_cents ? parseInt(stats.total_tax_cents) : 0
      }
    });
  } catch (error) {
    logger.error('Error fetching order statistics', { error });
    sendError(res, 500, 'Failed to fetch order statistics');
  }
}

const RETURN_STATUSES = ['requested', 'approved', 'declined', 'refunded', 'cancelled'];

function parseReturnListPaging(req) {
  const parsedLimit = Number.parseInt(String(req.query.limit ?? 20), 10);
  const parsedSkip = Number.parseInt(String(req.query.skip ?? 0), 10);
  return {
    limitN: Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20,
    skipN: Number.isSafeInteger(parsedSkip) && parsedSkip >= 0 ? Math.min(parsedSkip, 1_000_000) : 0,
  };
}

// G1-B6 (D-674): the admin return queue. Every return request in the
// system, newest first, with an optional ?status= filter (one of the
// five statuses on order_return_requests; anything else is ignored and
// lists all). Visibility only plus the decide endpoint below; deciding
// a return never refunds — refunds stay in the money-approvals flow.
async function listReturnRequests(req, res) {
  try {
    const { status } = req.query;
    const { limitN, skipN } = parseReturnListPaging(req);
    const statusFilter = RETURN_STATUSES.includes(status) ? status : null;

    const where = statusFilter ? 'WHERE r.status = $1' : '';
    const params = statusFilter ? [statusFilter] : [];
    const limitParam = params.length + 1;
    const skipParam = params.length + 2;

    const { rows } = await pool.query(
      `SELECT r.*, mo.status AS order_status, mo.total_cents AS order_total_cents,
              u.email AS customer_email, u.first_name AS customer_first_name,
              u.last_name AS customer_last_name
         FROM order_return_requests r
         JOIN marketplace_orders mo ON mo.id = r.order_id
         JOIN users u ON u.id = r.user_id
        ${where}
        ORDER BY r.created_at DESC
        LIMIT $${limitParam} OFFSET $${skipParam}`,
      [...params, limitN, skipN]
    );

    const countParams = statusFilter ? [statusFilter] : [];
    const { rows: [countRow] } = await pool.query(
      `SELECT COUNT(*) AS total FROM order_return_requests r ${where}`,
      countParams
    );
    const total = parseInt(countRow.total, 10);

    res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        orderId: r.order_id,
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
  } catch (error) {
    logger.error('Error fetching return requests', { error });
    sendError(res, 500, 'Failed to fetch return requests');
  }
}

// G1-B6 (D-676): decide a return request. Status-only handling: an
// admin records approved or declined with an optional note, using the
// admin_note / decided_by / decided_at columns the return table already
// carries. Only a request still in 'requested' can be decided (409
// otherwise), and deciding never moves money: an approved return is
// not a refund, and the customer sees the decision on their order page.
async function decideReturnRequest(req, res) {
  try {
    const { returnId } = req.params;
    const adminId = req.user?.id;
    if (!adminId) return sendError(res, 401, 'Unauthorized');

    const decision = String(req.body?.decision || '').trim();
    if (!['approved', 'declined'].includes(decision)) {
      return sendValidationError(res, { decision: 'Decision must be approved or declined' });
    }
    const note = req.body?.note == null ? null : String(req.body.note).slice(0, 1000);

    const { rows } = await pool.query(
      `UPDATE order_return_requests
          SET status = $1, admin_note = $2, decided_by = $3,
              decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $4 AND status = 'requested'
        RETURNING *`,
      [decision, note, adminId, returnId]
    );
    if (!rows.length) {
      const { rows: existing } = await pool.query(
        'SELECT status FROM order_return_requests WHERE id = $1',
        [returnId]
      );
      if (!existing.length) return sendError(res, 404, 'Return request not found');
      return sendError(res, 409, `Return request is already ${existing[0].status}`);
    }

    logger.info('Marketplace return request decided', { returnId, adminId, decision });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    logger.error('Error deciding return request', { error });
    sendError(res, 500, 'Failed to decide return request');
  }
}

module.exports = {
  getOrders,
  getOrder,
  markShipped,
  processRefund,
  cancelOrder,
  getOrderStats,
  listReturnRequests,
  decideReturnRequest
};
