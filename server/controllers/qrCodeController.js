const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const QR_TEMPLATES = {
  profile: {
    name: 'My Profile',
    description: 'Link to your helper profile',
    square_color: '#FF6B35',
    template_type: 'profile',
  },
  service: {
    name: 'Service Card',
    description: 'Link to a specific service',
    square_color: '#FF6B35',
    template_type: 'service',
  },
  job: {
    name: 'Job Post',
    description: 'Link to a job listing',
    square_color: '#FF6B35',
    template_type: 'job',
  },
  contact: {
    name: 'Contact Info',
    description: 'vCard with contact details',
    square_color: '#FF6B35',
    template_type: 'contact',
  },
};

async function generateQRCode(req, res, next) {
  try {
    const {
      url,
      logoUrl,
      overlayText,
      textPosition = 'bottom',
      textColor = '#000000',
      textFontSize = 14,
      squareColor = '#000000',
      backgroundColor = '#ffffff',
      errorCorrectionLevel = 'M',
    } = req.body;

    if (!url || !url.trim()) {
      return res.status(400).json({ error: 'URL is required' });
    }

    if (url.length > 2048) {
      return res.status(400).json({ error: 'URL too long (max 2048 characters)' });
    }

    if (overlayText && overlayText.length > 255) {
      return res.status(400).json({ error: 'Overlay text too long (max 255 characters)' });
    }

    res.json({
      success: true,
      config: {
        url,
        logoUrl,
        overlayText,
        textPosition,
        textColor,
        textFontSize,
        squareColor,
        backgroundColor,
        errorCorrectionLevel,
      },
    });
  } catch (err) {
    logger.error('Failed to generate QR code', { error: err.message });
    next(err);
  }
}

async function saveQRCode(req, res, next) {
  try {
    const userId = req.user?.id;
    const {
      name,
      description,
      url,
      logoUrl,
      overlayText,
      textPosition = 'bottom',
      textColor = '#000000',
      textFontSize = 14,
      squareColor = '#000000',
      backgroundColor = '#ffffff',
      errorCorrectionLevel = 'M',
      templateType = 'custom',
      isTemplate = false,
    } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    if (!url || !url.trim()) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const { rows: [qrCode] } = await db.query(
      `INSERT INTO saved_qr_codes (
        user_id, name, description, url, logo_url, overlay_text, text_position,
        text_color, text_font_size, square_color, background_color, error_correction_level,
        template_type, is_template
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        userId,
        name.trim(),
        description?.trim() || null,
        url.trim(),
        logoUrl || null,
        overlayText?.trim() || null,
        textPosition,
        textColor,
        textFontSize,
        squareColor,
        backgroundColor,
        errorCorrectionLevel,
        templateType,
        isTemplate,
      ]
    );

    logger.info('QR code saved', { qrCodeId: qrCode.id, userId });

    res.status(201).json({
      success: true,
      qrCode,
    });
  } catch (err) {
    logger.error('Failed to save QR code', { error: err.message });
    next(err);
  }
}

async function getMyQRCodes(req, res, next) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { rows: qrCodes } = await db.query(
      `SELECT * FROM saved_qr_codes
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [userId]
    );

    res.json({
      success: true,
      qrCodes,
      total: qrCodes.length,
    });
  } catch (err) {
    logger.error('Failed to fetch QR codes', { error: err.message });
    next(err);
  }
}

async function getQRCode(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { rows: [qrCode] } = await db.query(
      `SELECT * FROM saved_qr_codes WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (!qrCode) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    res.json({
      success: true,
      qrCode,
    });
  } catch (err) {
    logger.error('Failed to fetch QR code', { error: err.message });
    next(err);
  }
}

async function updateQRCode(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const {
      name,
      description,
      url,
      logoUrl,
      overlayText,
      textPosition,
      textColor,
      textFontSize,
      squareColor,
      backgroundColor,
      errorCorrectionLevel,
    } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { rows: [existing] } = await db.query(
      `SELECT * FROM saved_qr_codes WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (!existing) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    const { rows: [updated] } = await db.query(
      `UPDATE saved_qr_codes SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        url = COALESCE($3, url),
        logo_url = COALESCE($4, logo_url),
        overlay_text = COALESCE($5, overlay_text),
        text_position = COALESCE($6, text_position),
        text_color = COALESCE($7, text_color),
        text_font_size = COALESCE($8, text_font_size),
        square_color = COALESCE($9, square_color),
        background_color = COALESCE($10, background_color),
        error_correction_level = COALESCE($11, error_correction_level),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $12 AND user_id = $13
       RETURNING *`,
      [
        name,
        description,
        url,
        logoUrl,
        overlayText,
        textPosition,
        textColor,
        textFontSize,
        squareColor,
        backgroundColor,
        errorCorrectionLevel,
        id,
        userId,
      ]
    );

    logger.info('QR code updated', { qrCodeId: id, userId });

    res.json({
      success: true,
      qrCode: updated,
    });
  } catch (err) {
    logger.error('Failed to update QR code', { error: err.message });
    next(err);
  }
}

async function deleteQRCode(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { rowCount } = await db.query(
      `DELETE FROM saved_qr_codes WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    logger.info('QR code deleted', { qrCodeId: id, userId });

    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to delete QR code', { error: err.message });
    next(err);
  }
}

function getTemplates(req, res) {
  res.json({
    success: true,
    templates: Object.values(QR_TEMPLATES),
  });
}

module.exports = {
  generateQRCode,
  saveQRCode,
  getMyQRCodes,
  getQRCode,
  updateQRCode,
  deleteQRCode,
  getTemplates,
};
