// QR Code Generator Controller
// Handles CRUD for QR code generation, storage, and retrieval

const db = require('../db');
const logger = require('../utils/logger');
const { uuidv4 } = require('../utils/uuid');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

// Ensure upload directory exists
const QR_UPLOAD_DIR = path.join(__dirname, '../../public/qr-codes');

async function ensureUploadDir() {
  try {
    await fs.mkdir(QR_UPLOAD_DIR, { recursive: true });
  } catch (err) {
    logger.warn('qrCodesController: failed to create upload dir', { err: err.message });
  }
}

ensureUploadDir();

// ────────────────────────────────────────────────────────────────────────────
// CREATE - Generate and save a new QR code
// ────────────────────────────────────────────────────────────────────────────
exports.createQRCode = async (req, res, next) => {
  const client = await db.connect();
  try {
    const { title, url, logoUrl, dotColor, backgroundColor, dotStyle, size, imageData, imageFormat } = req.body;
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
        await fs.writeFile(filepath, buffer);
        imageUrl = `/qr-codes/${filename}`;
      } catch (err) {
        logger.error('qrCodesController.createQRCode: failed to save image', { err: err.message, userId });
        // Don't fail the entire request, just don't attach the image
      }
    }

    // Insert into database
    const query = `
      INSERT INTO qr_codes (user_id, title, url, logo_url, dot_color, background_color, dot_style, size, image_url, image_format)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
    const { title, url, logoUrl, dotColor, backgroundColor, dotStyle, size } = req.body;

    // Build dynamic update query
    const updates = [];
    const values = [userId, id];
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
