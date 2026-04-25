// Consulting payment controller - integrates with existing Stripe
const logger = require('../../utils/logger');
const db = require('../../db');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.createPaymentIntent = async (req, res) => {
  const { package_id } = req.body;
  try {
    const pkg = await db.query('SELECT * FROM consulting_packages WHERE id = $1 AND is_active = true', [package_id]);
    if (!pkg.rows.length) return res.status(404).json({ error: 'Package not found' });

    const packageData = pkg.rows[0];

    // Create Stripe payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: packageData.price_cents,
      currency: 'usd',
      description: `OxSteed Consulting - ${packageData.name}`,
      metadata: {
        package_id: packageData.id,
        user_id: req.user.id,
      },
    });

    logger.info('Payment intent created', { package_id, user_id: req.user.id });
    res.json({
      clientSecret: paymentIntent.client_secret,
      amount: packageData.price_cents,
      packageName: packageData.name,
    });
  } catch (err) {
    logger.error('Error creating payment intent', { error: err.message });
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
};

exports.confirmPurchase = async (req, res) => {
  const { payment_intent_id, package_id } = req.body;
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    const pkg = await db.query('SELECT * FROM consulting_packages WHERE id = $1', [package_id]);
    if (!pkg.rows.length) return res.status(404).json({ error: 'Package not found' });

    const packageData = pkg.rows[0];

    // Insert purchase record
    const result = await db.query(
      `INSERT INTO consulting_purchases (user_id, package_id, total_cost_cents, sessions_remaining, payment_intent_id, status)
       VALUES ($1, $2, $3, $4, $5, 'completed')
       RETURNING *`,
      [req.user.id, package_id, packageData.price_cents, packageData.session_count, payment_intent_id]
    );

    logger.info('Purchase confirmed', { user_id: req.user.id, package_id });

    // Generate invoice
    const invoiceNumber = `CONS-${Date.now()}`;
    await db.query(
      `INSERT INTO consulting_invoices (purchase_id, user_id, invoice_number, amount_cents, issued_date, due_date, status)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'sent')`,
      [result.rows[0].id, req.user.id, invoiceNumber, packageData.price_cents]
    );

    res.json({
      purchase: result.rows[0],
      message: 'Purchase completed successfully',
      sessions_remaining: packageData.session_count,
    });
  } catch (err) {
    logger.error('Error confirming purchase', { error: err.message });
    res.status(500).json({ error: 'Failed to confirm purchase' });
  }
};

exports.listUserPurchases = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT cp.*, pkg.name, pkg.tier, pkg.session_count
       FROM consulting_purchases cp
       JOIN consulting_packages pkg ON cp.package_id = pkg.id
       WHERE cp.user_id = $1 AND cp.status = 'completed'
       ORDER BY cp.purchase_date DESC`,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    logger.error('Error fetching user purchases', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch purchases' });
  }
};

exports.getInvoices = async (req, res) => {
  const { status } = req.query;
  try {
    let query = `SELECT * FROM consulting_invoices WHERE user_id = $1`;
    const params = [req.user.id];

    if (status) {
      query += ` AND status = $2`;
      params.push(status);
    }

    query += ` ORDER BY issued_date DESC`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('Error fetching invoices', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
};

exports.handlePaymentWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  try {
    const event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      logger.info('Payment succeeded via webhook', { payment_intent_id: paymentIntent.id });
      // Additional logic if needed
    }

    res.json({ received: true });
  } catch (err) {
    logger.error('Webhook error', { error: err.message });
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
};
