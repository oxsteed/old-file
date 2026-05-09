const pool = require('../db');
const { sendValidationError, sendError } = require('../utils/apiError');
const { logger } = require('../utils/logger');
const { uploadFile, getPublicUrl } = require('../utils/storage');
const { invalidateHelperContext } = require('../services/helperContext');
const {
  generateHelperProfileQRCode,
  buildHelperProfileURL
} = require('../utils/qrCodeGenerator');

/**
 * Get helper profile QR code PNG
 * GET /api/helpers/:id/profile-qr.png
 */
exports.getHelperProfileQRCodePng = async (req, res) => {
  try {
    const helperId = req.params.id;
    const width = Math.min(Math.max(parseInt(req.query.w) || 200, 64), 512); // Clamp between 64-512

    logger.info('Generating profile QR code', { helperId, width });

    const profileUrl = buildHelperProfileURL(helperId);
    const pngBuffer = await generateHelperProfileQRCode(profileUrl, width);

    if (!pngBuffer) {
      return sendError(res, 500, 'Failed to generate QR code');
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    res.send(pngBuffer);

    logger.debug('QR code sent', { helperId, width });
  } catch (err) {
    logger.error('Error generating QR code', { error: err.message, stack: err.stack });
    sendError(res, 500, 'Failed to generate QR code');
  }
};

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

    // Upload to S3 — pass args in the correct order: (buffer, folder, originalName, contentType)
    const key = await uploadFile(file.buffer, 'helper-covers', file.originalname, file.mimetype);

    if (!key) {
      return sendError(res, 500, 'Failed to upload image to storage');
    }

    // Convert the S3 key to a public URL
    const imageUrl = getPublicUrl(key);

    // Delete old cover image if it exists
    const existingResult = await pool.query(
      'SELECT cover_image_url FROM helper_profiles WHERE user_id = $1',
      [helperId]
    );
    if (existingResult.rows.length > 0 && existingResult.rows[0].cover_image_url) {
      // TODO: Delete old image from S3
      logger.info('Old cover image should be deleted', {
        oldUrl: existingResult.rows[0].cover_image_url
      });
    }

    // Update helper profile with new cover image URL (sync legacy column for directory / prerender)
    const result = await pool.query(
      `UPDATE helper_profiles
      SET cover_image_url = $1,
          cover_photo_url = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $2
      RETURNING user_id, cover_image_url`,
      [imageUrl, helperId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Helper profile not found');
    }

    // Keep primary business profile cover in sync (public /business/:id uses businesses first)
    pool.query(
      `UPDATE businesses
       SET cover_photo_url = $1,
           cover_image_url = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2 AND is_primary = TRUE AND is_active = TRUE`,
      [imageUrl, helperId],
    ).catch((e) => logger.warn('Cover sync to primary business failed', { err: e.message, helperId }));

    pool.query(
      `SELECT id FROM businesses WHERE user_id = $1 AND is_primary = TRUE AND is_active = TRUE LIMIT 1`,
      [helperId],
    )
    .then((r) => invalidateHelperContext(helperId, r.rows[0]?.id))
    .catch(() => invalidateHelperContext(helperId));

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
