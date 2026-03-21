const pool = require('../db');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PLATFORM_FEE_PERCENT = 15;

// Create Connect account for helper (onboarding)
exports.createConnectAccount = async (req, res) => {
  try {
    const existing = await pool.query('SELECT * FROM connect_accounts WHERE user_id = $1', [req.user.id]);
    if (existing.rows[0]) {
      // Return onboarding link if not complete
      if (!existing.rows[0].onboarding_complete) {
        const link = await stripe.accountLinks.create({
          account: existing.rows[0].stripe_account_id,
          refresh_url: `${process.env.CLIENT_URL}/helper-dashboard?refresh=true`,
          return_url: `${process.env.CLIENT_URL}/helper-dashboard?onboarding=complete`,
          type: 'account_onboarding',
        });
        return res.json({ url: link.url, account_id: existing.rows[0].stripe_account_id });
      }
      return res.json({ message: 'Account already set up', account: existing.rows[0] });
    }
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      email: req.user.email,
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    });
    await pool.query(
      'INSERT INTO connect_accounts (user_id, stripe_account_id) VALUES ($1, $2)',
      [req.user.id, account.id]
    );
    const link = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${process.env.CLIENT_URL}/helper-dashboard?refresh=true`,
      return_url: `${process.env.CLIENT_URL}/helper-dashboard?onboarding=complete`,
      type: 'account_onboarding',
    });
    res.json({ url: link.url, account_id: account.id });
  } catch (err) {
    console.error('Create connect account error:', err);
    res.status(500).json({ error: 'Failed to create payment account' });
  }
};

// Get Connect account status
exports.getConnectStatus = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM connect_accounts WHERE user_id = $1', [req.user.id]);
    if (!result.rows[0]) return res.json({ connected: false });
    res.json({ connected: true, ...result.rows[0] });
  } catch (err) {
    console.error('Get connect status error:', err);
    res.status(500).json({ error: 'Failed to get account status' });
  }
};

// Create payment intent for a job (poster pays)
exports.createPaymentIntent = async (req, res) => {
  try {
    const { job_id } = req.body;
    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [job_id]);
    if (!job.rows[0]) return res.status(404).json({ error: 'Job not found' });
    if (job.rows[0].poster_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    if (!job.rows[0].final_price) return res.status(400).json({ error: 'No final price set' });
    // Get helper connect account
    const connect = await pool.query('SELECT * FROM connect_accounts WHERE user_id = $1', [job.rows[0].helper_id]);
    if (!connect.rows[0] || !connect.rows[0].charges_enabled) {
      return res.status(400).json({ error: 'Helper payment account not ready' });
    }
    const amount = Math.round(job.rows[0].final_price * 100);
    const platformFee = Math.round(amount * PLATFORM_FEE_PERCENT / 100);
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      payment_method_types: ['card'],
      capture_method: 'manual',
      transfer_data: { destination: connect.rows[0].stripe_account_id },
      application_fee_amount: platformFee,
      metadata: { job_id: job_id.toString(), poster_id: req.user.id.toString(), helper_id: job.rows[0].helper_id.toString() },
    });
    await pool.query(
      `INSERT INTO payments (job_id, payer_id, payee_id, stripe_payment_intent_id, amount, platform_fee, platform_fee_percent, helper_payout, status, escrow_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'authorized', 'held')`,
      [job_id, req.user.id, job.rows[0].helper_id, paymentIntent.id, job.rows[0].final_price, platformFee / 100, PLATFORM_FEE_PERCENT, (amount - platformFee) / 100]
    );
    res.json({ client_secret: paymentIntent.client_secret, payment_intent_id: paymentIntent.id });
  } catch (err) {
    console.error('Create payment intent error:', err);
    res.status(500).json({ error: 'Failed to create payment' });
  }
};

// Capture payment (release from escrow after job completion)
exports.capturePayment = async (req, res) => {
  try {
    const { job_id } = req.body;
    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [job_id]);
    if (!job.rows[0] || job.rows[0].status !== 'completed') {
      return res.status(400).json({ error: 'Job must be completed first' });
    }
    const payment = await pool.query('SELECT * FROM payments WHERE job_id = $1 AND status = $2', [job_id, 'authorized']);
    if (!payment.rows[0]) return res.status(404).json({ error: 'No authorized payment found' });
    await stripe.paymentIntents.capture(payment.rows[0].stripe_payment_intent_id);
    await pool.query(
      `UPDATE payments SET status = 'captured', escrow_status = 'released', captured_at = NOW(), released_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [payment.rows[0].id]
    );
    res.json({ message: 'Payment captured and released to helper' });
  } catch (err) {
    console.error('Capture payment error:', err);
    res.status(500).json({ error: 'Failed to capture payment' });
  }
};

// Refund payment
exports.refundPayment = async (req, res) => {
  try {
    const { payment_id, reason, amount } = req.body;
    const payment = await pool.query('SELECT * FROM payments WHERE id = $1', [payment_id]);
    if (!payment.rows[0]) return res.status(404).json({ error: 'Payment not found' });
    const refundParams = { payment_intent: payment.rows[0].stripe_payment_intent_id };
    if (amount) refundParams.amount = Math.round(amount * 100);
    const refund = await stripe.refunds.create(refundParams);
    await pool.query(
      `UPDATE payments SET status = 'refunded', escrow_status = 'refunded', refunded_at = NOW(), refund_amount = $1, refund_reason = $2, updated_at = NOW() WHERE id = $3`,
      [amount || payment.rows[0].amount, reason, payment_id]
    );
    res.json({ message: 'Refund processed', refund_id: refund.id });
  } catch (err) {
    console.error('Refund payment error:', err);
    res.status(500).json({ error: 'Failed to process refund' });
  }
};

// Get payment for a job
exports.getJobPayment = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM payments WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1', [req.params.job_id]);
    if (!result.rows[0]) return res.json(null);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get job payment error:', err);
    res.status(500).json({ error: 'Failed to fetch payment' });
  }
};

// Get my payments
exports.getMyPayments = async (req, res) => {
  try {
    const { role = 'payer' } = req.query;
    const field = role === 'payee' ? 'payee_id' : 'payer_id';
    const result = await pool.query(
      `SELECT p.*, j.title as job_title FROM payments p JOIN jobs j ON p.job_id = j.id WHERE p.${field} = $1 ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get my payments error:', err);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
};
