const pool = require('../db');
const { AppError, sendValidationError, sendError } = require('../utils/apiError');
const logger = require('../utils/logger');
const { uploadFile } = require('../utils/storage');
const {
  generateBusinessProfileQRCode,
  generateBusinessQRCodeSizes,
  buildBusinessProfileURL
} = require('../utils/businessQRCodeGenerator');

/**
 * Upload business profile cover image
 * PUT /api/business-profile/cover-image
 */
exports.uploadCoverImage = async (req, res) => {
  try {
    const userId = req.user.id;
    const file = req.file;

    if (!file) {
      return sendValidationError(res, { image: 'No image file provided' });
    }

    // Validate file type
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimes.includes(file.mimetype)) {
      return sendValidationError(res, {
        image: 'Only JPEG, PNG, and WebP images are allowed'
      });
    }

    // Validate file size (max 5MB for cover image)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return sendValidationError(res, {
        image: 'Image must be smaller than 5MB'
      });
    }

    // Get user's business ID
    const businessResult = await pool.query(
      'SELECT id FROM businesses WHERE user_id = $1',
      [userId]
    );

    if (businessResult.rows.length === 0) {
      return sendError(res, 404, 'Business not found');
    }

    const businessId = businessResult.rows[0].id;

    logger.info('Uploading business cover image', {
      businessId,
      userId,
      fileName: file.originalname,
      size: file.size,
      mime: file.mimetype
    });

    // Upload to S3
    const key = `business-covers/${businessId}-${Date.now()}-${file.originalname}`;
    const imageUrl = await uploadFile(key, file.buffer, file.mimetype);

    if (!imageUrl) {
      return sendError(res, 500, 'Failed to upload image to storage');
    }

    // Delete old cover image if it exists
    const existingResult = await pool.query(
      'SELECT cover_image_url FROM businesses WHERE id = $1',
      [businessId]
    );

    if (existingResult.rows.length > 0 && existingResult.rows[0].cover_image_url) {
      // TODO: Delete old image from S3
      logger.info('Old business cover image should be deleted', {
        oldUrl: existingResult.rows[0].cover_image_url
      });
    }

    // Update business with new cover image URL
    const result = await pool.query(
      `UPDATE businesses
       SET cover_image_url = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, cover_image_url`,
      [imageUrl, businessId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Business not found');
    }

    logger.info('Business cover image uploaded successfully', {
      businessId,
      imageUrl
    });

    res.json({
      success: true,
      data: {
        coverImageUrl: result.rows[0].cover_image_url,
        message: 'Cover image uploaded successfully'
      }
    });
  } catch (err) {
    logger.error('Error uploading business cover image', { error: err.message, stack: err.stack });
    sendError(res, 500, 'Failed to upload cover image');
  }
};

/**
 * Delete business profile cover image
 * DELETE /api/business-profile/cover-image
 */
exports.deleteCoverImage = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's business
    const businessResult = await pool.query(
      'SELECT id, cover_image_url FROM businesses WHERE user_id = $1',
      [userId]
    );

    if (businessResult.rows.length === 0) {
      return sendError(res, 404, 'Business not found');
    }

    const business = businessResult.rows[0];

    // Remove from database
    await pool.query(
      'UPDATE businesses SET cover_image_url = NULL WHERE id = $1',
      [business.id]
    );

    // TODO: Delete from S3
    if (business.cover_image_url) {
      logger.info('Business cover image deleted', {
        businessId: business.id,
        coverUrl: business.cover_image_url
      });
    }

    res.json({
      success: true,
      message: 'Cover image deleted'
    });
  } catch (err) {
    logger.error('Error deleting business cover image', { error: err.message });
    sendError(res, 500, 'Failed to delete cover image');
  }
};

/**
 * Generate QR code for business's profile
 * GET /api/business-profile/:businessId/qr-code
 *
 * Query params:
 * - size: 'small' (150px), 'medium' (300px), 'large' (500px), or custom number
 * - format: 'dataurl' (default), 'buffer', or 'svg'
 */
exports.generateQRCode = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { size = 'medium', format = 'dataurl' } = req.query;

    // Validate business exists
    const businessResult = await pool.query(
      'SELECT id, business_name FROM businesses WHERE id = $1 AND is_active = true',
      [businessId]
    );

    if (businessResult.rows.length === 0) {
      return sendError(res, 404, 'Business not found');
    }

    const business = businessResult.rows[0];

    // Validate size
    let width = 300;
    if (size === 'small') {
      width = 150;
    } else if (size === 'medium') {
      width = 300;
    } else if (size === 'large') {
      width = 500;
    } else if (!isNaN(size) && size > 0 && size <= 1000) {
      width = parseInt(size, 10);
    } else {
      return sendValidationError(res, {
        size: 'Size must be small/medium/large or a number between 1-1000'
      });
    }

    // Validate format
    if (!['dataurl', 'buffer', 'svg'].includes(format)) {
      return sendValidationError(res, {
        format: 'Format must be dataurl, buffer, or svg'
      });
    }

    logger.info('Generating business QR code', { businessId, size, width, format });

    // Generate QR code
    const qrCode = await generateBusinessProfileQRCode(
      businessId,
      business.business_name,
      format,
      { width }
    );

    // For buffer format, send as image
    if (format === 'buffer') {
      res.type('image/png');
      res.send(qrCode);
      return;
    }

    // For dataurl and svg, send as JSON
    res.json({
      success: true,
      data: {
        businessId,
        qrCode,
        format,
        size: width,
        profileUrl: buildBusinessProfileURL(businessId),
        message: `QR code generated (${width}px)`
      }
    });
  } catch (err) {
    logger.error('Error generating business QR code', { error: err.message, stack: err.stack });
    sendError(res, 500, 'Failed to generate QR code');
  }
};

/**
 * Generate QR codes in multiple sizes
 * GET /api/business-profile/:businessId/qr-code/multi-size
 *
 * Returns small (150px), medium (300px), and large (500px) versions
 */
exports.generateMultiSizeQRCode = async (req, res) => {
  try {
    const { businessId } = req.params;

    // Validate business exists
    const businessResult = await pool.query(
      'SELECT id, business_name FROM businesses WHERE id = $1 AND is_active = true',
      [businessId]
    );

    if (businessResult.rows.length === 0) {
      return sendError(res, 404, 'Business not found');
    }

    const business = businessResult.rows[0];

    logger.info('Generating multi-size business QR codes', { businessId });

    // Generate all sizes
    const qrCodes = await generateBusinessQRCodeSizes(businessId, business.business_name);

    res.json({
      success: true,
      data: {
        businessId,
        qrCodes,
        profileUrl: buildBusinessProfileURL(businessId),
        message: 'QR codes generated in multiple sizes'
      }
    });
  } catch (err) {
    logger.error('Error generating multi-size business QR codes', { error: err.message });
    sendError(res, 500, 'Failed to generate QR codes');
  }
};

/**
 * Get business profile with cover image
 * GET /api/business-profile/:businessId/public
 */
exports.getBusinessProfileWithCover = async (req, res) => {
  try {
    const { businessId } = req.params;

    const result = await pool.query(
      `SELECT
        b.id,
        b.cover_image_url,
        b.business_name,
        b.description,
        u.profile_photo_url
      FROM businesses b
      LEFT JOIN users u ON b.user_id = u.id
      WHERE b.id = $1`,
      [businessId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Business not found');
    }

    const business = result.rows[0];

    res.json({
      success: true,
      data: {
        id: business.id,
        name: business.business_name,
        description: business.description,
        profilePhotoUrl: business.profile_photo_url,
        coverImageUrl: business.cover_image_url,
        profileUrl: buildBusinessProfileURL(business.id)
      }
    });
  } catch (err) {
    logger.error('Error fetching business profile with cover', { error: err.message });
    sendError(res, 500, 'Failed to fetch business profile');
  }
};
