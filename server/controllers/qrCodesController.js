// QR Code Generator Controller
// Handles CRUD for QR code generation, storage, and retrieval

const db = require('../db');
const logger = require('../utils/logger');
const { uuidv4 } = require('../utils/uuid');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

const { QR_UPLOAD_DIR } = require('../utils/qrCodeStorage');

const QR_EXPORT_PRICE_CENTS = 100;
const QR_EXPORT_CURRENCY = 'usd';
const QR_EXPORT_FORMATS = new Set(['png', 'svg', 'promo-png', 'promo-svg']);
const QR_WORKSPACES = new Set(['custom', 'warehouse', 'restaurant']);
const QR_TEMPLATE_KEYS = new Set([
  'custom', 'warehouse-location', 'dock-door', 'inventory-bin', 'pallet-asset',
  'restaurant-table', 'kitchen-station', 'pickup-order', 'menu-promo',
]);
const QR_CODE_TYPES = new Set(['qr', 'code128', 'ean13']);
let stripeClient = null;

function getStripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) {
    const error = new Error('Stripe is not configured on the server');
    error.code = 'stripe_not_configured';
    error.statusCode = 503;
    throw error;
  }
  if (!stripeClient) stripeClient = require('stripe')(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

function getQrExportBaseUrl() {
  return (process.env.APP_URL || process.env.CLIENT_URL || 'https://oxsteed.com').replace(/\/+$/, '');
}

function isValidQrKey(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isValidQrExportFormat(value) {
  return QR_EXPORT_FORMATS.has(value);
}

function sendQrExportError(res, error, fallbackMessage = 'Unable to process QR export payment') {
  const status = error.statusCode || (error.code === 'stripe_not_configured' ? 503 : 500);
  return res.status(status).json({
    error: status >= 500 ? fallbackMessage : error.message,
    code: error.code || 'qr_export_payment_failed',
  });
}

// ────────────────────────────────────────────────────────────────────────────
// CREATE - Generate and save a new QR code
// ────────────────────────────────────────────────────────────────────────────
exports.createQRCode = async (req, res, next) => {
  const client = await db.connect();
  try {
    const {
      title, url, logoUrl, dotColor, backgroundColor, dotStyle, size, imageData, imageFormat,
      workspace = 'custom', templateKey = 'custom', labelData = {}, codeType = 'qr',
    } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!title || !url) {
      return res.status(400).json({ error: 'title and url are required' });
    }

    if (title.length > 255) {
      return res.status(400).json({ error: 'title must be 255 characters or less' });
    }

    if (!['square', 'rounded', 'dots', 'classy', 'classy-rounded'].includes(dotStyle)) {
      return res.status(400).json({ error: 'invalid dot_style' });
    }

    if (size < 100 || size > 1000) {
      return res.status(400).json({ error: 'size must be between 100 and 1000' });
    }

    if (!['png', 'svg'].includes(imageFormat)) {
      return res.status(400).json({ error: 'imageFormat must be png or svg' });
    }

    if (!QR_WORKSPACES.has(workspace) || !QR_TEMPLATE_KEYS.has(templateKey)) {
      return res.status(400).json({ error: 'invalid QR operational template' });
    }

    if (!QR_CODE_TYPES.has(codeType)) {
      return res.status(400).json({ error: 'invalid codeType' });
    }

    if (!labelData || typeof labelData !== 'object' || Array.isArray(labelData)
      || Buffer.byteLength(JSON.stringify(labelData), 'utf8') > 8192) {
      return res.status(400).json({ error: 'labelData must be a small JSON object' });
    }

    // Validate hex colors
    const hexColorRegex = /^#[0-9a-fA-F]{6}$/;
    if (!hexColorRegex.test(dotColor) || !hexColorRegex.test(backgroundColor)) {
      return res.status(400).json({ error: 'invalid color format (must be hex)' });
    }

    // Save QR code image if provided
    let imageUrl = null;
    if (imageData) {
      try {
        // imageData should be base64 or data URL
        let buffer;
        if (imageData.startsWith('data:')) {
          // Remove data URL prefix
          const base64Data = imageData.split(',')[1];
          buffer = Buffer.from(base64Data, 'base64');
        } else {
          buffer = Buffer.from(imageData, 'base64');
        }

        const filename = `${uuidv4()}.${imageFormat}`;
        const filepath = path.join(QR_UPLOAD_DIR, filename);
        await fs.mkdir(QR_UPLOAD_DIR, { recursive: true });
        await fs.writeFile(filepath, buffer);
        imageUrl = `/qr-codes/${filename}`;
      } catch (err) {
        logger.error('qrCodesController.createQRCode: failed to save image', { err: err.message, userId });
        return res.status(500).json({ error: 'Failed to save QR image' });
      }
    }

    // Insert into database
    const query = `
      INSERT INTO qr_codes (user_id, title, url, logo_url, dot_color, background_color, dot_style, size, image_url, image_format, workspace, template_key, label_data, code_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *;
    `;

    const result = await client.query(query, [
      userId,
      title,
      url,
      logoUrl || null,
      dotColor,
      backgroundColor,
      dotStyle,
      size,
      imageUrl,
      imageFormat,
      workspace,
      templateKey,
      labelData,
      codeType,
    ]);

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    logger.error('qrCodesController.createQRCode: error', { err: err.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to create QR code' });
  } finally {
    client.release();
  }
};

// ────────────────────────────────────────────────────────────────────────────
// READ - Get all QR codes for authenticated user
// ────────────────────────────────────────────────────────────────────────────
exports.getQRCodes = async (req, res, next) => {
  const client = await db.connect();
  try {
    const userId = req.user.id;
    const { limit = 20, offset = 0 } = req.query;

    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const offsetNum = Math.max(parseInt(offset) || 0, 0);

    const query = `
      SELECT * FROM qr_codes
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3;
    `;

    const countQuery = `
      SELECT COUNT(*) as total FROM qr_codes WHERE user_id = $1;
    `;

    const [qrCodesResult, countResult] = await Promise.all([
      client.query(query, [userId, limitNum, offsetNum]),
      client.query(countQuery, [userId]),
    ]);

    res.json({
      success: true,
      data: qrCodesResult.rows,
      pagination: {
        limit: limitNum,
        offset: offsetNum,
        total: parseInt(countResult.rows[0].total),
        hasMore: offsetNum + limitNum < parseInt(countResult.rows[0].total),
      },
    });
  } catch (err) {
    logger.error('qrCodesController.getQRCodes: error', { err: err.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to retrieve QR codes' });
  } finally {
    client.release();
  }
};

// ────────────────────────────────────────────────────────────────────────────
// READ - Get single QR code by ID
// ────────────────────────────────────────────────────────────────────────────
exports.getQRCode = async (req, res, next) => {
  const client = await db.connect();
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const query = `
      SELECT * FROM qr_codes
      WHERE id = $1 AND user_id = $2;
    `;

    const result = await client.query(query, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    logger.error('qrCodesController.getQRCode: error', { err: err.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to retrieve QR code' });
  } finally {
    client.release();
  }
};

// ────────────────────────────────────────────────────────────────────────────
// UPDATE - Update QR code metadata
// ────────────────────────────────────────────────────────────────────────────
exports.updateQRCode = async (req, res, next) => {
  const client = await db.connect();
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const {
      title, url, logoUrl, dotColor, backgroundColor, dotStyle, size,
      workspace, templateKey, labelData,
      codeType,
    } = req.body;

    // Build dynamic update query
    const updates = [];
    const values = [id, userId];
    let paramCount = 2;

    if (title !== undefined) {
      paramCount++;
      updates.push(`title = $${paramCount}`);
      values.push(title);
    }

    if (url !== undefined) {
      paramCount++;
      updates.push(`url = $${paramCount}`);
      values.push(url);
    }

    if (logoUrl !== undefined) {
      paramCount++;
      updates.push(`logo_url = $${paramCount}`);
      values.push(logoUrl || null);
    }

    if (dotColor !== undefined) {
      if (!/^#[0-9a-fA-F]{6}$/.test(dotColor)) {
        return res.status(400).json({ error: 'invalid dotColor format' });
      }
      paramCount++;
      updates.push(`dot_color = $${paramCount}`);
      values.push(dotColor);
    }

    if (backgroundColor !== undefined) {
      if (!/^#[0-9a-fA-F]{6}$/.test(backgroundColor)) {
        return res.status(400).json({ error: 'invalid backgroundColor format' });
      }
      paramCount++;
      updates.push(`background_color = $${paramCount}`);
      values.push(backgroundColor);
    }

    if (dotStyle !== undefined) {
      if (!['square', 'rounded', 'dots', 'classy', 'classy-rounded'].includes(dotStyle)) {
        return res.status(400).json({ error: 'invalid dot_style' });
      }
      paramCount++;
      updates.push(`dot_style = $${paramCount}`);
      values.push(dotStyle);
    }

    if (size !== undefined) {
      if (size < 100 || size > 1000) {
        return res.status(400).json({ error: 'size must be between 100 and 1000' });
      }
      paramCount++;
      updates.push(`size = $${paramCount}`);
      values.push(size);
    }

    if (workspace !== undefined) {
      if (!QR_WORKSPACES.has(workspace)) return res.status(400).json({ error: 'invalid workspace' });
      paramCount++;
      updates.push(`workspace = $${paramCount}`);
      values.push(workspace);
    }

    if (templateKey !== undefined) {
      if (!QR_TEMPLATE_KEYS.has(templateKey)) return res.status(400).json({ error: 'invalid templateKey' });
      paramCount++;
      updates.push(`template_key = $${paramCount}`);
      values.push(templateKey);
    }

    if (labelData !== undefined) {
      if (!labelData || typeof labelData !== 'object' || Array.isArray(labelData)
        || Buffer.byteLength(JSON.stringify(labelData), 'utf8') > 8192) {
        return res.status(400).json({ error: 'labelData must be a small JSON object' });
      }
      paramCount++;
      updates.push(`label_data = $${paramCount}`);
      values.push(labelData);
    }

    if (codeType !== undefined) {
      if (!QR_CODE_TYPES.has(codeType)) return res.status(400).json({ error: 'invalid codeType' });
      paramCount++;
      updates.push(`code_type = $${paramCount}`);
      values.push(codeType);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'no fields to update' });
    }

    paramCount++;
    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    const query = `
      UPDATE qr_codes
      SET ${updates.join(', ')}
      WHERE id = $1 AND user_id = $2
      RETURNING *;
    `;

    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    logger.error('qrCodesController.updateQRCode: error', { err: err.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to update QR code' });
  } finally {
    client.release();
  }
};

// ────────────────────────────────────────────────────────────────────────────
// DELETE - Delete QR code
// ────────────────────────────────────────────────────────────────────────────
exports.deleteQRCode = async (req, res, next) => {
  const client = await db.connect();
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const query = `
      DELETE FROM qr_codes
      WHERE id = $1 AND user_id = $2
      RETURNING id, image_url;
    `;

    const result = await client.query(query, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    // Clean up file if it exists
    if (result.rows[0].image_url) {
      try {
        const filename = result.rows[0].image_url.split('/').pop();
        const filepath = path.join(QR_UPLOAD_DIR, filename);
        await fs.unlink(filepath);
      } catch (err) {
        logger.warn('qrCodesController.deleteQRCode: failed to delete file', { err: err.message });
      }
    }

    res.json({
      success: true,
      message: 'QR code deleted',
    });
  } catch (err) {
    logger.error('qrCodesController.deleteQRCode: error', { err: err.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to delete QR code' });
  } finally {
    client.release();
  }
};

// ────────────────────────────────────────────────────────────────────────────
// DOWNLOAD - Track and download QR code
// ────────────────────────────────────────────────────────────────────────────
exports.downloadQRCode = async (req, res, next) => {
  const client = await db.connect();
  try {
    const userId = req.user.id;
    const { id } = req.params;
    // Accept query parameters for the browser client and the legacy body form
    // so the endpoint remains compatible with existing callers.
    const format = req.query.format || req.body?.format || 'png';

    if (!['png', 'svg'].includes(format)) {
      return res.status(400).json({ error: 'format must be png or svg' });
    }

    const query = `
      SELECT * FROM qr_codes
      WHERE id = $1 AND user_id = $2;
    `;

    const result = await client.query(query, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    const qrCode = result.rows[0];

    // Log download
    try {
      const ipHash = crypto.createHash('sha256').update(req.ip || '').digest('hex');
      const userAgentHash = crypto.createHash('sha256').update(req.get('user-agent') || '').digest('hex');

      await client.query(
        `INSERT INTO qr_code_downloads (qr_code_id, user_id, download_format, ip_hash, user_agent_hash)
         VALUES ($1, $2, $3, $4, $5);`,
        [id, userId, format, ipHash, userAgentHash]
      );

      // Update download count
      await client.query(
        `UPDATE qr_codes SET download_count = download_count + 1 WHERE id = $1;`,
        [id]
      );
    } catch (err) {
      logger.warn('qrCodesController.downloadQRCode: failed to log download', { err: err.message });
    }

    // Return the QR code data (frontend will handle the actual download)
    res.json({
      success: true,
      data: {
        id: qrCode.id,
        title: qrCode.title,
        imageUrl: qrCode.image_url,
        imageFormat: qrCode.image_format,
      },
    });
  } catch (err) {
    logger.error('qrCodesController.downloadQRCode: error', { err: err.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to download QR code' });
  } finally {
    client.release();
  }
};

// ────────────────────────────────────────────────────────────────────────────
// EXPORT CHECKOUT - Create a verified one-time watermark-removal purchase
// ────────────────────────────────────────────────────────────────────────────
exports.createQrExportCheckout = async (req, res) => {
  const userId = req.user.id;
  const { qrKey, format } = req.body || {};

  if (!isValidQrKey(qrKey)) {
    return res.status(400).json({ error: 'qrKey must be a SHA-256 hex digest', code: 'invalid_qr_key' });
  }
  if (!isValidQrExportFormat(format)) {
    return res.status(400).json({ error: 'Unsupported QR export format', code: 'invalid_qr_export_format' });
  }

  try {
    const existing = await db.query(
      `SELECT stripe_checkout_session_id, status, stripe_payment_intent_id
         FROM qr_export_purchases
        WHERE user_id = $1 AND qr_key = $2
        LIMIT 1`,
      [userId, qrKey]
    );

    if (existing.rows[0]?.status === 'paid') {
      return res.json({
        success: true,
        data: {
          alreadyPaid: true,
          paid: true,
          amountCents: QR_EXPORT_PRICE_CENTS,
          currency: QR_EXPORT_CURRENCY,
        },
      });
    }

    const stripe = getStripeClient();
    if (existing.rows[0]?.status === 'pending' && existing.rows[0].stripe_checkout_session_id) {
      try {
        const session = await stripe.checkout.sessions.retrieve(existing.rows[0].stripe_checkout_session_id);
        if (session.status === 'open') {
          return res.json({
            success: true,
            data: {
              url: session.url,
              sessionId: session.id,
              amountCents: QR_EXPORT_PRICE_CENTS,
              currency: QR_EXPORT_CURRENCY,
            },
          });
        }
      } catch (err) {
        logger.warn('qrCodesController.createQrExportCheckout: stale checkout session', {
          userId,
          qrKey,
          error: err.message,
        });
      }
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        customer_email: req.user.email || undefined,
        line_items: [{
          price_data: {
            currency: QR_EXPORT_CURRENCY,
            unit_amount: QR_EXPORT_PRICE_CENTS,
            product_data: {
              name: 'OxSteed QR watermark removal',
              description: 'One-time watermark-free export for one QR configuration',
            },
          },
          quantity: 1,
        }],
        metadata: {
          userId: String(userId),
          qrKey,
          format,
          product: 'qr_export_watermark_removal',
        },
        success_url: `${getQrExportBaseUrl()}/qr-generator?qr_payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${getQrExportBaseUrl()}/qr-generator?qr_payment=cancelled`,
      },
      // Reuse the first attempt while it is open, but allow a fresh Stripe
      // session after an expired or cancelled attempt.
      { idempotencyKey: `qr-export:${userId}:${qrKey}:${existing.rows[0]?.stripe_checkout_session_id || 'new'}` }
    );

    await db.query(
      `INSERT INTO qr_export_purchases
        (user_id, qr_key, format, stripe_checkout_session_id, amount_cents, currency, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       ON CONFLICT (user_id, qr_key)
       DO UPDATE SET
         format = EXCLUDED.format,
         stripe_checkout_session_id = EXCLUDED.stripe_checkout_session_id,
         amount_cents = EXCLUDED.amount_cents,
         currency = EXCLUDED.currency,
         status = 'pending',
         updated_at = NOW()`,
      [userId, qrKey, format, session.id, QR_EXPORT_PRICE_CENTS, QR_EXPORT_CURRENCY]
    );

    return res.json({
      success: true,
      data: {
        url: session.url,
        sessionId: session.id,
        amountCents: QR_EXPORT_PRICE_CENTS,
        currency: QR_EXPORT_CURRENCY,
      },
    });
  } catch (err) {
    logger.error('qrCodesController.createQrExportCheckout: error', {
      userId,
      qrKey,
      error: err.message,
    });
    return sendQrExportError(res, err);
  }
};

// ────────────────────────────────────────────────────────────────────────────
// EXPORT CHECKOUT VERIFY - Confirm payment before removing the watermark
// ────────────────────────────────────────────────────────────────────────────
exports.verifyQrExportCheckout = async (req, res) => {
  const userId = req.user.id;
  const { sessionId, qrKey } = req.body || {};

  if (!sessionId || !isValidQrKey(qrKey)) {
    return res.status(400).json({ error: 'sessionId and qrKey are required', code: 'invalid_qr_export_verification' });
  }

  try {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const metadata = session.metadata || {};
    const isExpectedPurchase = metadata.product === 'qr_export_watermark_removal'
      && String(metadata.userId) === String(userId)
      && metadata.qrKey === qrKey;

    if (!isExpectedPurchase) {
      return res.status(403).json({ error: 'This payment does not belong to the requested QR export', code: 'qr_export_payment_mismatch' });
    }

    if (session.payment_status !== 'paid') {
      return res.json({
        success: true,
        data: {
          paid: false,
          status: session.payment_status || session.status || 'pending',
        },
      });
    }

    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || null;

    const updated = await db.query(
      `UPDATE qr_export_purchases
          SET status = 'paid',
              stripe_payment_intent_id = COALESCE($3, stripe_payment_intent_id),
              paid_at = COALESCE(paid_at, NOW()),
              updated_at = NOW()
        WHERE user_id = $1
          AND qr_key = $2
          AND stripe_checkout_session_id = $4
        RETURNING format, amount_cents, currency`,
      [userId, qrKey, paymentIntentId, sessionId]
    );

    if (!updated.rows.length) {
      return res.status(404).json({ error: 'QR export purchase was not found', code: 'qr_export_purchase_not_found' });
    }

    return res.json({
      success: true,
      data: {
        paid: true,
        format: updated.rows[0].format,
        amountCents: Number(updated.rows[0].amount_cents),
        currency: updated.rows[0].currency,
      },
    });
  } catch (err) {
    logger.error('qrCodesController.verifyQrExportCheckout: error', {
      userId,
      sessionId,
      qrKey,
      error: err.message,
    });
    return sendQrExportError(res, err, 'Unable to verify QR export payment');
  }
};
