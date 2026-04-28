const db = require('../db');
const logger = require('../utils/logger');
const { encrypt, decrypt } = require('../utils/encryption');

const validatePaymentIdentifier = (type, identifier) => {
  if (type === 'cash_app') {
    return /^\$[a-zA-Z0-9\-_]{3,}$/.test(identifier);
  }
  if (type === 'venmo') {
    return /^@[a-zA-Z0-9\-_]{3,}$/.test(identifier);
  }
  if (type === 'bank_transfer') {
    // Bank account validation:
    // - Must be 5-34 characters (international account number lengths)
    // - Must contain at least one digit (to distinguish from just text)
    // - Can contain: alphanumeric, hyphens, spaces, slashes (common separators)
    const trimmed = identifier.trim();
    const isValidLength = trimmed.length >= 5 && trimmed.length <= 34;
    const hasDigit = /[0-9]/.test(trimmed);
    const isValidFormat = /^[a-zA-Z0-9\-\s\/]+$/.test(trimmed);
    return isValidLength && hasDigit && isValidFormat;
  }
  return false;
};

const maskPaymentIdentifier = (type, identifier) => {
  if (!identifier || identifier.length < 4) {
    return '****';
  }
  const lastFour = identifier.slice(-4);
  switch (type) {
    case 'cash_app':
      return '**** ' + lastFour;
    case 'venmo':
      return '**** ' + lastFour;
    case 'bank_transfer':
      // For bank accounts, mask middle portion
      if (identifier.length <= 8) return '****';
      return identifier.slice(0, 2) + '*'.repeat(identifier.length - 6) + identifier.slice(-4);
    default:
      return '****';
  }
};

const getPaymentMethod = async (req, res) => {
  try {
    const ownerId = req.user.id;
    const result = await db.query(
      `SELECT id, payment_type, payment_identifier, payment_identifier_encrypted, is_active
       FROM owner_payment_methods
       WHERE owner_id = $1`,
      [ownerId]
    );

    if (!result.rows[0]) {
      return res.json(null);
    }

    const paymentMethod = result.rows[0];
    let decryptedIdentifier = null;

    try {
      // Try to decrypt from encrypted column first (new approach)
      if (paymentMethod.payment_identifier_encrypted) {
        decryptedIdentifier = decrypt(paymentMethod.payment_identifier_encrypted);
      }
      // Fall back to plaintext for backward compatibility (during migration)
      else if (paymentMethod.payment_identifier) {
        decryptedIdentifier = paymentMethod.payment_identifier;
      }
    } catch (decryptErr) {
      logger.error('Failed to decrypt payment identifier', { ownerId, error: decryptErr.message });
      return res.status(500).json({ error: 'Failed to load payment method (decryption error)' });
    }

    res.json({
      id: paymentMethod.id,
      payment_type: paymentMethod.payment_type,
      payment_identifier: decryptedIdentifier,
      payment_identifier_masked: maskPaymentIdentifier(paymentMethod.payment_type, decryptedIdentifier),
      is_active: paymentMethod.is_active
    });
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
    if (!validatePaymentIdentifier(paymentType, paymentIdentifier)) {
      if (paymentType === 'cash_app') {
        return res.status(400).json({ error: 'Cash App identifier must start with $ followed by username' });
      }
      if (paymentType === 'venmo') {
        return res.status(400).json({ error: 'Venmo identifier must start with @ followed by username' });
      }
      if (paymentType === 'bank_transfer') {
        return res.status(400).json({ error: 'Bank account identifier must be at least 5 characters' });
      }
    }

    // Encrypt the payment identifier
    let encryptedIdentifier;
    try {
      encryptedIdentifier = encrypt(paymentIdentifier);
    } catch (encryptErr) {
      logger.error('Failed to encrypt payment identifier', { ownerId, error: encryptErr.message });
      return res.status(500).json({ error: 'Encryption failed. Payment method not saved.' });
    }

    // Upsert payment method with encrypted identifier
    const result = await db.query(
      `INSERT INTO owner_payment_methods (owner_id, payment_type, payment_identifier_encrypted)
       VALUES ($1, $2, $3)
       ON CONFLICT (owner_id) DO UPDATE
       SET payment_type = $2, payment_identifier_encrypted = $3, updated_at = NOW()
       RETURNING id, payment_type`,
      [ownerId, paymentType, encryptedIdentifier]
    );

    const savedMethod = result.rows[0];

    // Log the payment method change for audit purposes
    logger.info('Payment method updated', {
      userId: ownerId,
      paymentType: paymentType,
      action: 'payment_method_update',
      timestamp: new Date().toISOString(),
      // Note: actual payment identifier is NOT logged for security
      // Only the type is logged so we can audit changes
    });

    res.json({
      id: savedMethod.id,
      payment_type: savedMethod.payment_type,
      payment_identifier_masked: maskPaymentIdentifier(paymentType, paymentIdentifier),
      is_active: true
    });
  } catch (err) {
    logger.error('setPaymentMethod error', { err });
    res.status(500).json({ error: 'Failed to save payment method' });
  }
};

const deletePaymentMethod = async (req, res) => {
  try {
    const ownerId = req.user.id;

    // Get existing method for audit logging
    const existingResult = await db.query(
      'SELECT payment_type FROM owner_payment_methods WHERE owner_id = $1',
      [ownerId]
    );

    await db.query(
      'UPDATE owner_payment_methods SET is_active = FALSE WHERE owner_id = $1',
      [ownerId]
    );

    // Log the deletion
    logger.info('Payment method deleted', {
      userId: ownerId,
      paymentType: existingResult.rows[0]?.payment_type,
      action: 'payment_method_delete',
      timestamp: new Date().toISOString()
    });

    res.json({ deleted: true });
  } catch (err) {
    logger.error('deletePaymentMethod error', { err });
    res.status(500).json({ error: 'Failed to delete payment method' });
  }
};

module.exports = { getPaymentMethod, setPaymentMethod, deletePaymentMethod };
