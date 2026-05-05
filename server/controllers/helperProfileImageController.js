const pool = require('../db');
const { AppError, sendValidationError, sendError } = require('../utils/apiError');
const { logger } = require('../utils/logger');
const { uploadFile, getPublicUrl } = require('../utils/storage');
const {
  generateHelperProfileQRCode,
  generateQRCodeSizes,
  buildHelperProfileURL
} = require('../utils/qrCodeGenerator');

/**
 * Upload helper profile cover image
 * PUT /api/helper-profile/cover-image
 */
exports.uploadCoverImage = async (req, res) => {
  try {
    const helperId = req.user.id;
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

    // Recommended dimensions: 1200x400 or similar aspect ratio
    // This is just a guideline; we accept any size and let frontend resize
    logger.info('Uploading cover image', {
      helperId,
      fileName: file.originalname,
      size: file.size,
      mime: file.mimetype
    });

    // Upload to S3
    const key = `helper-covers/${helperId}-${Date.now()}-${file.originalname}`;
    const imageUrl = await uploadFile(key, file.buffer, file.mimetype);

    if (!imageUrl) {
      return sendError(res, 500, 'Failed to upload image to storage');
    }

    // Delete old cover image if it exists
    const existingResult = await pool.query(
      'SELECT cover_image_url FROM helper_profiles WHERE id = $1',
      [helperId]
    );

    if (existingResult.rows.length > 0 && existingResult.rows[0].cover_image_url) {
      // TODO: Delete old image from S3
      logger.info('Old cover image should be deleted', {
        oldUrl: existingResult.rows[0].cover_image_url
      });
    }

    // Update helper profile with new cover image URL
    const result = await pool.query(
      `UPDATE helper_profiles
       SET cover_image_url = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, cover_image_url`,
      [imageUrl, helperId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Helper profile not found');
    }

    logger.info('Cover image uploaded successfully', {
      helperId,
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
    logger.error('Error uploading cover image', { error: err.message, stack: err.stack });
    sendError(res, 500, 'Failed to upload cover image');
  }
};

/**
 * Delete helper profile cover image
 * DELETE /api/helper-profile/cover-image
 */
exports.deleteCoverImage = async (req, res) => {
  try {
    const helperId = req.user.id;

    // Get current cover image URL
    const result = await pool.query(
      'SELECT cover_image_url FROM helper_profiles WHERE id = $1',
      [helperId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Helper profile not found');
    }

    const coverUrl = result.rows[0].cover_image_url;

    // Remove from database
    await pool.query(
      'UPDATE helper_profiles SET cover_image_url = NULL WHERE id = $1',
      [helperId]
    );

    // TODO: Delete from S3
    if (coverUrl) {
      logger.info('Cover image deleted', { helperId, coverUrl });
    }

    res.json({
      success: true,
      message: 'Cover image deleted'
    });
  } catch (err) {
    logger.error('Error deleting cover image', { error: err.message });
    sendError(res, 500, 'Failed to delete cover image');
  }
};

/**
 * Generate QR code for helper's profile
 * GET /api/helper-profile/:helperId/qr-code
 *
 * Query params:
 * - size: 'small' (150px), 'medium' (300px), 'large' (500px), or custom number
 * - format: 'dataurl' (default), 'buffer', or 'svg'
 */
exports.generateQRCode = async (req, res) => {
  try {
    const { helperId } = req.params;
    const { size = 'medium', format = 'dataurl' } = req.query;

    // Validate helper exists
    const helperResult = await pool.query(
      'SELECT id, first_name FROM users WHERE id = $1 AND is_active = true',
      [helperId]
    );

    if (helperResult.rows.length === 0) {
      return sendError(res, 404, 'Helper not found');
    }

    const helper = helperResult.rows[0];

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

    logger.info('Generating QR code', { helperId, size, width, format });

    // Generate QR code
    const qrCode = await generateHelperProfileQRCode(
      helperId,
      helper.first_name,
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
        helperId,
        qrCode,
        format,
        size: width,
        profileUrl: buildHelperProfileURL(helperId),
        message: `QR code generated (${width}px)`
      }
    });
  } catch (err) {
    logger.error('Error generating QR code', { error: err.message, stack: err.stack });
    sendError(res, 500, 'Failed to generate QR code');
  }
};

/**
 * Generate QR codes in multiple sizes
 * GET /api/helper-profile/:helperId/qr-code/multi-size
 *
 * Returns small (150px), medium (300px), and large (500px) versions
 */
exports.generateMultiSizeQRCode = async (req, res) => {
  try {
    const { helperId } = req.params;

    // Validate helper exists
    const helperResult = await pool.query(
      'SELECT id, first_name FROM users WHERE id = $1 AND is_active = true',
      [helperId]
    );

    if (helperResult.rows.length === 0) {
      return sendError(res, 404, 'Helper not found');
    }

    const helper = helperResult.rows[0];

    logger.info('Generating multi-size QR codes', { helperId });

    // Generate all sizes
    const sizes = {
      small: 150,
      medium: 300,
      large: 500
    };

    const qrCodes = {};
    for (const [sizeKey, width] of Object.entries(sizes)) {
      qrCodes[sizeKey] = await generateHelperProfileQRCode(
        helperId,
        helper.first_name,
        'dataurl',
        { width }
      );
    }

    res.json({
      success: true,
      data: {
        helperId,
        qrCodes,
        profileUrl: buildHelperProfileURL(helperId),
        message: 'QR codes generated in multiple sizes'
      }
    });
  } catch (err) {
    logger.error('Error generating multi-size QR codes', { error: err.message });
    sendError(res, 500, 'Failed to generate QR codes');
  }
};

/**
 * Get helper profile with cover image
 * GET /api/helper-profile/:helperId/public
 */
exports.getHelperProfileWithCover = async (req, res) => {
  try {
    const { helperId } = req.params;

    const result = await pool.query(
      `SELECT
        h.id,
        h.cover_image_url,
        h.bio,
        u.first_name,
        u.last_name,
        u.profile_photo_url
      FROM helper_profiles h
      LEFT JOIN users u ON h.id = u.id
      WHERE h.id = $1`,
      [helperId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Helper not found');
    }

    const helper = result.rows[0];

    res.json({
      success: true,
      data: {
        id: helper.id,
        name: `${helper.first_name} ${helper.last_name}`,
        bio: helper.bio,
        profilePhotoUrl: helper.profile_photo_url,
        coverImageUrl: helper.cover_image_url,
        profileUrl: buildHelperProfileURL(helper.id)
      }
    });
  } catch (err) {
    logger.error('Error fetching helper profile with cover', { error: err.message });
    sendError(res, 500, 'Failed to fetch helper profile');
  }
};
