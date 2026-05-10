const db = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
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

const getPaymentMethod = async (req, res, next) => {
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
      throw new AppError('Failed to load payment method (decryption error)', 500, 'processing_error');
    }

    res.json({
      id: paymentMethod.id,
      payment_type: paymentMethod.payment_type,
      payment_identifier: decryptedIdentifier,
      payment_identifier_masked: maskPaymentIdentifier(paymentMethod.payment_type, decryptedIdentifier),
      is_active: paymentMethod.is_active
    });
  } catch (err) {
    next(err);
  }
};

const setPaymentMethod = async (req, res, next) => {
  try {
    const ownerId = req.user.id;
    const { paymentType, paymentIdentifier } = req.body;

    const fields = {};
    if (!paymentType) fields.paymentType = 'Payment type is required';
    if (!paymentIdentifier) fields.paymentIdentifier = 'Payment identifier is required';
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    const validTypes = ['cash_app', 'venmo', 'bank_transfer'];
    if (!validTypes.includes(paymentType)) {
      throw new AppError('Invalid payment type', 400, 'validation_failed', { paymentType: 'Must be cash_app, venmo, or bank_transfer' });
    }

    // Validate payment identifier format
    if (!validatePaymentIdentifier(paymentType, paymentIdentifier)) {
      let fieldErr = 'Invalid format';
      if (paymentType === 'cash_app') {
        fieldErr = 'Cash App identifier must start with $ followed by username';
      } else if (paymentType === 'venmo') {
        fieldErr = 'Venmo identifier must start with @ followed by username';
      } else if (paymentType === 'bank_transfer') {
        fieldErr = 'Bank account identifier must be at least 5 characters';
      }
      throw new AppError('Validation failed', 400, 'validation_failed', { paymentIdentifier: fieldErr });
    }

    // Encrypt the payment identifier
    let encryptedIdentifier;
    try {
      encryptedIdentifier = encrypt(paymentIdentifier);
    } catch (encryptErr) {
      throw new AppError('Encryption failed. Payment method not saved', 500, 'processing_error');
    }

    // Upsert payment method with encrypted identifier
    const result = await db.query(
      `INSERT INTO owner_payment_methods (owner_id, payment_type, payment_identifier, payment_identifier_encrypted)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (owner_id) DO UPDATE
       SET payment_type = $2, payment_identifier = $3, payment_identifier_encrypted = $4, is_active = TRUE, updated_at = NOW()
       RETURNING id, payment_type`,
      [ownerId, paymentType, maskPaymentIdentifier(paymentType, paymentIdentifier), encryptedIdentifier]
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
    next(err);
  }
};

const deletePaymentMethod = async (req, res, next) => {
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
    next(err);
  }
};

module.exports = { getPaymentMethod, setPaymentMethod, deletePaymentMethod };
