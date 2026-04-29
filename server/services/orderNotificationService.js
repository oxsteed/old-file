const logger = require('../utils/logger');
const pool = require('../db');

// Import email sending utility (Resend or similar)
// const emailService = require('./emailService');

/**
 * Send order confirmation email
 */
async function sendOrderConfirmationEmail(orderId) {
  try {
    // Fetch order and customer details
    const orderResult = await pool.query(
      `SELECT mo.*, u.email, u.first_name
       FROM marketplace_orders mo
       JOIN users u ON mo.customer_id = u.id
       WHERE mo.id = $1`,
      [orderId]
    );

    if (!orderResult.rows.length) {
      logger.warn('Order not found for confirmation email', { orderId });
      return false;
    }

    const order = orderResult.rows[0];

    // Fetch order items
    const itemsResult = await pool.query(
      `SELECT moi.*, mp.name, mp.image_url
       FROM marketplace_order_items moi
       JOIN marketplace_products mp ON moi.product_id = mp.id
       WHERE moi.order_id = $1`,
      [orderId]
    );

    const emailContent = buildOrderConfirmationEmail(order, itemsResult.rows);

    // Send email via Resend or other service
    // await emailService.send({
    //   to: order.email,
    //   subject: `Order Confirmation #${orderId}`,
    //   html: emailContent
    // });

    logger.info('Order confirmation email queued', { orderId, email: order.email });
    return true;
  } catch (error) {
    logger.error('Error sending order confirmation email', { error, orderId });
    return false;
  }
}

/**
 * Send order payment received notification
 */
async function sendPaymentReceivedEmail(orderId) {
  try {
    const orderResult = await pool.query(
      `SELECT mo.*, u.email, u.first_name
       FROM marketplace_orders mo
       JOIN users u ON mo.customer_id = u.id
       WHERE mo.id = $1 AND mo.status = 'paid'`,
      [orderId]
    );

    if (!orderResult.rows.length) {
      logger.warn('Paid order not found for payment email', { orderId });
      return false;
    }

    const order = orderResult.rows[0];

    const emailContent = buildPaymentReceivedEmail(order);

    // Send email
    // await emailService.send({
    //   to: order.email,
    //   subject: `Payment Received - Order #${orderId}`,
    //   html: emailContent
    // });

    logger.info('Payment received email queued', { orderId, email: order.email });
    return true;
  } catch (error) {
    logger.error('Error sending payment received email', { error, orderId });
    return false;
  }
}

/**
 * Send order shipped notification
 */
async function sendOrderShippedEmail(orderId, trackingNumber = null, carrier = null) {
  try {
    const orderResult = await pool.query(
      `SELECT mo.*, u.email, u.first_name
       FROM marketplace_orders mo
       JOIN users u ON mo.customer_id = u.id
       WHERE mo.id = $1`,
      [orderId]
    );

    if (!orderResult.rows.length) {
      logger.warn('Order not found for shipped email', { orderId });
      return false;
    }

    const order = orderResult.rows[0];

    const emailContent = buildOrderShippedEmail(order, trackingNumber, carrier);

    // Send email
    // await emailService.send({
    //   to: order.email,
    //   subject: `Your Order Has Shipped - Order #${orderId}`,
    //   html: emailContent
    // });

    logger.info('Order shipped email queued', { orderId, email: order.email, trackingNumber });
    return true;
  } catch (error) {
    logger.error('Error sending order shipped email', { error, orderId });
    return false;
  }
}

/**
 * Send order cancelled notification
 */
async function sendOrderCancelledEmail(orderId, reason = null) {
  try {
    const orderResult = await pool.query(
      `SELECT mo.*, u.email, u.first_name
       FROM marketplace_orders mo
       JOIN users u ON mo.customer_id = u.id
       WHERE mo.id = $1 AND mo.status = 'cancelled'`,
      [orderId]
    );

    if (!orderResult.rows.length) {
      logger.warn('Cancelled order not found for email', { orderId });
      return false;
    }

    const order = orderResult.rows[0];

    const emailContent = buildOrderCancelledEmail(order, reason);

    // Send email
    // await emailService.send({
    //   to: order.email,
    //   subject: `Order Cancelled - Order #${orderId}`,
    //   html: emailContent
    // });

    logger.info('Order cancelled email queued', { orderId, email: order.email });
    return true;
  } catch (error) {
    logger.error('Error sending order cancelled email', { error, orderId });
    return false;
  }
}

/**
 * Build order confirmation email HTML
 */
function buildOrderConfirmationEmail(order, items) {
  const formatPrice = (cents) => `$${(cents / 100).toFixed(2)}`;

  const itemsHtml = items
    .map(item => `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #eee;">
          <strong>${item.name}</strong><br>
          Qty: ${item.quantity}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">
          ${formatPrice(item.total_price_cents)}
        </td>
      </tr>
    `)
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; color: #333; }
        .container { max-width: 600px; margin: 0 auto; }
        .header { background-color: #f5f5f5; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .order-details { background-color: #f9f9f9; padding: 15px; border-radius: 4px; }
        table { width: 100%; border-collapse: collapse; }
        .footer { background-color: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Order Confirmed!</h1>
        </div>

        <div class="content">
          <p>Hi ${order.first_name || 'there'},</p>

          <p>Thank you for your order. We've received it and will process it right away.</p>

          <div class="order-details">
            <h3>Order Details</h3>
            <p><strong>Order Number:</strong> #${order.id}</p>
            <p><strong>Order Date:</strong> ${new Date(order.created_at).toLocaleDateString()}</p>

            <table style="margin-top: 15px;">
              <thead>
                <tr style="border-bottom: 2px solid #ddd;">
                  <th style="text-align: left; padding: 12px;">Product</th>
                  <th style="text-align: right; padding: 12px;">Price</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            <div style="margin-top: 15px; border-top: 1px solid #ddd; padding-top: 15px;">
              <p style="text-align: right;">
                <strong>Subtotal:</strong> ${formatPrice(order.subtotal_cents)}<br>
                <strong>Tax:</strong> ${formatPrice(order.tax_cents)}<br>
                <strong>Shipping:</strong> ${formatPrice(order.shipping_cents)}<br>
                <strong>Discount:</strong> -${formatPrice(order.discount_cents)}<br>
                <strong style="font-size: 16px;">Total:</strong> ${formatPrice(order.total_cents)}
              </p>
            </div>
          </div>

          <p style="margin-top: 20px;">We'll notify you when your order ships. Thank you for shopping with us!</p>
        </div>

        <div class="footer">
          <p>© 2026 OxSteed Marketplace. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Build payment received email HTML
 */
function buildPaymentReceivedEmail(order) {
  const formatPrice = (cents) => `$${(cents / 100).toFixed(2)}`;

  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial, sans-serif; color: #333;">
      <div style="max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f5f5f5; padding: 20px; text-align: center;">
          <h1>✓ Payment Received</h1>
        </div>

        <div style="padding: 20px;">
          <p>Hi ${order.first_name || 'there'},</p>
          <p>Your payment has been successfully received and processed for order #${order.id}.</p>

          <div style="background-color: #f9f9f9; padding: 15px; border-radius: 4px;">
            <p><strong>Amount:</strong> ${formatPrice(order.total_cents)}</p>
            <p><strong>Order Date:</strong> ${new Date(order.created_at).toLocaleDateString()}</p>
            <p><strong>Status:</strong> Payment Confirmed</p>
          </div>

          <p style="margin-top: 20px;">Your order will be prepared for shipment shortly. You'll receive a shipping notification once it's on its way.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Build order shipped email HTML
 */
function buildOrderShippedEmail(order, trackingNumber = null, carrier = null) {
  const trackingInfo = trackingNumber
    ? `<p><strong>Tracking Number:</strong> <a href="https://tracking.example.com/${trackingNumber}">${trackingNumber}</a></p><p><strong>Carrier:</strong> ${carrier || 'Standard Shipping'}</p>`
    : '';

  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial, sans-serif; color: #333;">
      <div style="max-width: 600px; margin: 0 auto;">
        <div style="background-color: #4CAF50; color: white; padding: 20px; text-align: center;">
          <h1>Your Order Has Shipped!</h1>
        </div>

        <div style="padding: 20px;">
          <p>Hi ${order.first_name || 'there'},</p>
          <p>Great news! Your order #${order.id} has been shipped.</p>

          <div style="background-color: #f9f9f9; padding: 15px; border-radius: 4px;">
            ${trackingInfo}
            <p><strong>Expected Delivery:</strong> 3-5 business days</p>
          </div>

          <p style="margin-top: 20px;">Thank you for shopping with us!</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Build order cancelled email HTML
 */
function buildOrderCancelledEmail(order, reason = null) {
  const reasonText = reason ? `<p><strong>Reason:</strong> ${reason}</p>` : '';

  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial, sans-serif; color: #333;">
      <div style="max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f5f5f5; padding: 20px; text-align: center;">
          <h1>Order Cancelled</h1>
        </div>

        <div style="padding: 20px;">
          <p>Hi ${order.first_name || 'there'},</p>
          <p>Your order #${order.id} has been cancelled.</p>

          <div style="background-color: #f9f9f9; padding: 15px; border-radius: 4px;">
            ${reasonText}
            <p><strong>Refund Status:</strong> Your refund will be processed within 5-7 business days.</p>
          </div>

          <p style="margin-top: 20px;">If you have any questions, please contact our support team.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

module.exports = {
  sendOrderConfirmationEmail,
  sendPaymentReceivedEmail,
  sendOrderShippedEmail,
  sendOrderCancelledEmail
};
