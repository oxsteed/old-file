const db = require('../db');
const logger = require('../utils/logger');

const getPaymentMethod = async (req, res) => {
  try {
    const ownerId = req.user.id;
    const result = await db.query(
      `SELECT id, payment_type, payment_identifier, is_active
       FROM owner_payment_methods
       WHERE owner_id = $1`,
      [ownerId]
    );

    res.json(result.rows[0] || null);
  } catch (err) {
    logger.error('getPaymentMethod error', { err });
    res.status(500).json({ error: 'Failed to load payment method' });
  }
};

const setPaymentMethod = async (req, res) => {
  try {
    const ownerId = req.user.id;
    const { paymentType, paymentIdentifier } = req.body;

    if (!paymentType || !paymentIdentifier) {
      return res.status(400).json({ error: 'Payment type and identifier required' });
    }

    const validTypes = ['cash_app', 'venmo', 'bank_transfer'];
    if (!validTypes.includes(paymentType)) {
      return res.status(400).json({ error: 'Invalid payment type' });
    }

    // Validate payment identifier format
    if (paymentType === 'cash_app' && !paymentIdentifier.startsWith('$')) {
      return res.status(400).json({ error: 'Cash App identifier must start with $' });
    }
    if (paymentType === 'venmo' && !paymentIdentifier.startsWith('@')) {
      return res.status(400).json({ error: 'Venmo identifier must start with @' });
    }

    // Upsert payment method
    const result = await db.query(
      `INSERT INTO owner_payment_methods (owner_id, payment_type, payment_identifier)
       VALUES ($1, $2, $3)
       ON CONFLICT (owner_id) DO UPDATE
       SET payment_type = $2, payment_identifier = $3, updated_at = NOW()
       RETURNING id, payment_type, payment_identifier, is_active`,
      [ownerId, paymentType, paymentIdentifier]
    );

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('setPaymentMethod error', { err });
    res.status(500).json({ error: 'Failed to save payment method' });
  }
};

const deletePaymentMethod = async (req, res) => {
  try {
    const ownerId = req.user.id;
    await db.query(
      'UPDATE owner_payment_methods SET is_active = FALSE WHERE owner_id = $1',
      [ownerId]
    );
    res.json({ deleted: true });
  } catch (err) {
    logger.error('deletePaymentMethod error', { err });
    res.status(500).json({ error: 'Failed to delete payment method' });
  }
};

module.exports = { getPaymentMethod, setPaymentMethod, deletePaymentMethod };
