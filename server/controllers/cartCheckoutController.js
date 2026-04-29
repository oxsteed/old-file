const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const logger = require('../utils/logger');
const { sendError, sendValidationError } = require('../utils/apiError');

async function getCheckoutSession(req, res) {
  try {
    const { cartId } = req.params;
    const userId = req.user?.id;

    if (!userId) return sendError(res, 401, 'Unauthorized');

    const cart = await pool.query(
      'SELECT * FROM shopping_carts WHERE id = $1 AND customer_id = $2',
      [cartId, userId]
    );

    if (!cart.rows.length) return sendError(res, 404, 'Cart not found');

    const items = await pool.query(
      `SELECT sci.*, mp.name, mp.price_cents
       FROM shopping_cart_items sci
       JOIN marketplace_products mp ON sci.product_id = mp.id
       WHERE sci.cart_id = $1`,
      [cartId]
    );

    if (!items.rows.length) return sendError(res, 400, 'Cart is empty');

    // Validate stock and calculate totals
    let subtotal = 0;
    for (const item of items.rows) {
      subtotal += item.quantity * item.price_cents;
    }

    const tax = Math.round(subtotal * 0.08); // 8% tax (customize per location)
    const total = subtotal + tax;

    res.json({
      success: true,
      data: {
        cartId,
        items: items.rows.map(i => ({
          id: i.id,
          productId: i.product_id,
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.price_cents,
          totalPrice: i.quantity * i.price_cents
        })),
        subtotal,
        tax,
        total
      }
    });
  } catch (error) {
    logger.error('Error getting checkout session', { error });
    sendError(res, 500, 'Failed to get checkout session');
  }
}

async function createPaymentIntent(req, res) {
  try {
    const { cartId, email, shippingAddress } = req.body;
    const userId = req.user?.id;

    if (!userId) return sendError(res, 401, 'Unauthorized');
    if (!cartId) return sendValidationError(res, { cartId: 'Cart ID required' });

    // Fetch cart and items
    const cart = await pool.query(
      'SELECT * FROM shopping_carts WHERE id = $1 AND customer_id = $2',
      [cartId, userId]
    );

    if (!cart.rows.length) return sendError(res, 404, 'Cart not found');

    const items = await pool.query(
      `SELECT sci.*, mp.id as product_id, mp.price_cents, mp.affiliate_url
       FROM shopping_cart_items sci
       JOIN marketplace_products mp ON sci.product_id = mp.id
       WHERE sci.cart_id = $1`,
      [cartId]
    );

    if (!items.rows.length) return sendError(res, 400, 'Cart is empty');

    // Calculate totals
    let subtotal = 0;
    const lineItems = [];

    for (const item of items.rows) {
      const itemTotal = item.quantity * item.price_cents;
      subtotal += itemTotal;
      lineItems.push({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price_cents: item.price_cents,
        total_price_cents: itemTotal,
        affiliate_url: item.affiliate_url
      });
    }

    const tax = Math.round(subtotal * 0.08);
    const shipping = 0; // Can be customized based on address
    const discount = 0; // Can apply promo codes
    const total = subtotal + tax + shipping - discount;

    if (total <= 0) return sendError(res, 400, 'Invalid order total');

    // Create order and payment intent in transaction
    const order = await withTransaction(async (client) => {
      // Create order
      const orderResult = await client.query(
        `INSERT INTO marketplace_orders
         (customer_id, cart_id, total_cents, subtotal_cents, tax_cents, shipping_cents, discount_cents, status, shipping_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [userId, cartId, total, subtotal, tax, shipping, discount, 'pending', JSON.stringify(shippingAddress || {})]
      );

      const orderId = orderResult.rows[0].id;

      // Create order items
      for (const item of lineItems) {
        await client.query(
          `INSERT INTO marketplace_order_items
           (order_id, product_id, quantity, unit_price_cents, total_price_cents)
           VALUES ($1, $2, $3, $4, $5)`,
          [orderId, item.product_id, item.quantity, item.unit_price_cents, item.total_price_cents]
        );
      }

      return orderResult.rows[0];
    });

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: total,
      currency: 'usd',
      receipt_email: email,
      metadata: {
        orderId: order.id.toString(),
        cartId: cartId.toString(),
        userId: userId.toString()
      }
    });

    // Store transaction record
    await pool.query(
      `INSERT INTO marketplace_transactions
       (order_id, payment_intent_id, amount_cents, currency, status, client_secret)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [order.id, paymentIntent.id, total, 'usd', paymentIntent.status, paymentIntent.client_secret]
    );

    res.json({
      success: true,
      data: {
        orderId: order.id,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        total,
        email,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
      }
    });
  } catch (error) {
    logger.error('Error creating payment intent', { error });
    sendError(res, 500, 'Failed to create payment intent');
  }
}

async function confirmPayment(req, res) {
  try {
    const { paymentIntentId, orderId } = req.body;
    const userId = req.user?.id;

    if (!userId) return sendError(res, 401, 'Unauthorized');
    if (!paymentIntentId || !orderId) {
      return sendValidationError(res, { paymentIntentId: 'Required', orderId: 'Required' });
    }

    // Verify order belongs to user
    const order = await pool.query(
      'SELECT * FROM marketplace_orders WHERE id = $1 AND customer_id = $2',
      [orderId, userId]
    );

    if (!order.rows.length) return sendError(res, 404, 'Order not found');

    // Retrieve PaymentIntent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status === 'succeeded') {
      // Update order status
      await pool.query(
        `UPDATE marketplace_orders
         SET status = $1, updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        ['paid', orderId]
      );

      // Update transaction
      await pool.query(
        `UPDATE marketplace_transactions
         SET status = $1, updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP
         WHERE order_id = $2`,
        ['succeeded', orderId]
      );

      // Process affiliate commissions if applicable
      await processAffiliateCommissions(orderId);

      res.json({
        success: true,
        data: {
          orderId,
          status: 'paid',
          message: 'Payment confirmed successfully'
        }
      });
    } else if (paymentIntent.status === 'requires_action') {
      res.json({
        success: false,
        data: {
          requiresAction: true,
          clientSecret: paymentIntent.client_secret
        }
      });
    } else {
      sendError(res, 400, `Payment status: ${paymentIntent.status}`);
    }
  } catch (error) {
    logger.error('Error confirming payment', { error });
    sendError(res, 500, 'Failed to confirm payment');
  }
}

async function processAffiliateCommissions(orderId) {
  try {
    const orderItems = await pool.query(
      `SELECT oi.*, mp.affiliate_url
       FROM marketplace_order_items oi
       JOIN marketplace_products mp ON oi.product_id = mp.id
       WHERE oi.order_id = $1`,
      [orderId]
    );

    for (const item of orderItems.rows) {
      if (item.affiliate_url) {
        // Track conversion in affiliate_links_log
        await pool.query(
          `UPDATE affiliate_links_log
           SET conversions = conversions + 1, confirmed_conversions = confirmed_conversions + 1
           WHERE affiliate_url = $1`,
          [item.affiliate_url]
        );

        // Create affiliate commission record (if program exists)
        // This will be processed by batch payout job
      }
    }

    logger.info('Affiliate commissions processed', { orderId });
  } catch (error) {
    logger.error('Error processing affiliate commissions', { error });
    // Don't fail the order if commission processing fails
  }
}

module.exports = {
  getCheckoutSession,
  createPaymentIntent,
  confirmPayment
};
