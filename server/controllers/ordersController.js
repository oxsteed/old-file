const pool = require('../db');
const logger = require('../utils/logger');
const { sendError } = require('../utils/apiError');

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

    res.json({
      success: true,
      data: {
        ...order.rows[0],
        items: items.rows,
        transaction: transaction.rows[0] || null
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

async function cancelOrder(req, res) {
  try {
    const { orderId } = req.params;
    const userId = req.user?.id;

    if (!userId) return sendError(res, 401, 'Unauthorized');

    // Check order exists and belongs to user
    const order = await pool.query(
      'SELECT * FROM marketplace_orders WHERE id = $1 AND customer_id = $2',
      [orderId, userId]
    );

    if (!order.rows.length) return sendError(res, 404, 'Order not found');

    if (order.rows[0].status !== 'pending' && order.rows[0].status !== 'paid') {
      return sendError(res, 400, 'Cannot cancel order in ' + order.rows[0].status + ' status');
    }

    // Update order status
    const updatedOrder = await pool.query(
      `UPDATE marketplace_orders
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      ['cancelled', orderId]
    );

    logger.info('Order cancelled', { orderId, userId });

    res.json({
      success: true,
      data: updatedOrder.rows[0]
    });
  } catch (error) {
    logger.error('Error cancelling order', { error });
    sendError(res, 500, 'Failed to cancel order');
  }
}

module.exports = {
  getOrders,
  getOrder,
  getOrderStats,
  cancelOrder
};
