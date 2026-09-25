const pool = require('../db');
const { sendValidationError, sendError } = require('../utils/apiError');
const logger = require('../utils/logger');
const { uploadFile, getPublicUrl } = require('../utils/storage');
const { invalidateHelperContext } = require('../services/helperContext');
const {
  generateQRCodeBuffer,
  generateQRCodeSVG,
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
    const pngBuffer = await generateQRCodeBuffer(profileUrl, { width });

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
 * Generate helper profile QR code in various formats
 * GET /api/helper-profile/:helperId/qr-code?size=small&format=dataurl|png|svg
 */
exports.generateQRCode = async (req, res) => {
  try {
    const { helperId } = req.params;
    const { size = 'medium', format = 'dataurl' } = req.query;

    // Validate size parameter
    const sizeMap = {
      small: 100,
      medium: 200,
      large: 300,
      xlarge: 400,
    };
    const width = sizeMap[size] || 200;

    logger.info('Generating QR code', { helperId, size, width, format });

    const profileUrl = buildHelperProfileURL(helperId);

    if (format === 'png' || format === 'buffer' || format === 'dataurl') {
      const pngBuffer = await generateQRCodeBuffer(profileUrl, { width });
      if (!pngBuffer) {
        return sendError(res, 500, 'Failed to generate QR code');
      }

      if (format === 'dataurl') {
        // Return as base64 data URL for embedding in HTML/JSON
        const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
        return res.json({ success: true, qr_code: dataUrl, size, width, format: 'dataurl' });
      } else {
        // Return as PNG image
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(pngBuffer);
      }
    }

    if (format === 'svg') {
      const svg = await generateQRCodeSVG(profileUrl, { width });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(svg);
    }

    return sendError(res, 400, 'Unsupported QR code format');
  } catch (err) {
    logger.error('Error generating QR code', { error: err.message, stack: err.stack });
    sendError(res, 500, 'Failed to generate QR code');
  }
};

/**
 * Generate helper profile QR code in multiple sizes
 * GET /api/helper-profile/:helperId/qr-code/multi-size
 */
exports.generateMultiSizeQRCode = async (req, res) => {
  try {
    const { helperId } = req.params;

    logger.info('Generating multi-size QR codes', { helperId });

    const profileUrl = buildHelperProfileURL(helperId);

    const sizes = {
      small: 100,
      medium: 200,
      large: 300,
      xlarge: 400,
    };

    const qrCodes = {};
    for (const [label, width] of Object.entries(sizes)) {
      const pngBuffer = await generateQRCodeBuffer(profileUrl, { width });
      if (pngBuffer) {
        qrCodes[label] = `data:image/png;base64,${pngBuffer.toString('base64')}`;
      }
    }

    if (Object.keys(qrCodes).length === 0) {
      return sendError(res, 500, 'Failed to generate QR codes');
    }

    return res.json({
      success: true,
      qr_codes: qrCodes,
      profile_url: profileUrl,
    });
  } catch (err) {
    logger.error('Error generating multi-size QR codes', { error: err.message, stack: err.stack });
    sendError(res, 500, 'Failed to generate QR codes');
  }
};

/**
 * Delete helper profile cover image
 * DELETE /api/helper-profile/cover-image
 */
exports.deleteCoverImage = async (req, res) => {
  try {
    const helperId = req.user.id;

    logger.info('Deleting cover image', { helperId });

    // Update helper profile (clear cover image URL)
    const result = await pool.query(
      `UPDATE helper_profiles
      SET cover_image_url = NULL,
          cover_photo_url = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING user_id`,
      [helperId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Helper profile not found');
    }

    // Keep primary business profile in sync
    pool.query(
      `UPDATE businesses
       SET cover_photo_url = NULL,
           cover_image_url = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND is_primary = TRUE AND is_active = TRUE`,
      [helperId],
    ).catch((e) => logger.warn('Cover delete sync to primary business failed', { err: e.message, helperId }));

    pool.query(
      `SELECT id FROM businesses WHERE user_id = $1 AND is_primary = TRUE AND is_active = TRUE LIMIT 1`,
      [helperId],
    )
    .then((r) => invalidateHelperContext(helperId, r.rows[0]?.id))
    .catch(() => invalidateHelperContext(helperId));

    logger.info('Cover image deleted successfully', { helperId });

    res.json({
      success: true,
      data: { message: 'Cover image deleted successfully' }
    });
  } catch (err) {
    logger.error('Error deleting cover image', { error: err.message, stack: err.stack });
    sendError(res, 500, 'Failed to delete cover image');
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

    // Validate file size
    // - Max 5MB for S3 upload
    // - Max 2MB for base64 fallback (to avoid timeout issues)
    const max5MB = 5 * 1024 * 1024;
    const max2MB = 2 * 1024 * 1024;

    if (file.size > max5MB) {
      return sendValidationError(res, {
        image: 'Image must be smaller than 5MB'
      });
    }

    logger.info('Uploading cover image', {
      helperId,
      fileName: file.originalname,
      size: file.size,
      mime: file.mimetype
    });

    // Upload to S3 — pass args in the correct order: (buffer, folder, originalName, contentType)
    let imageUrl = null;
    const key = await uploadFile(file.buffer, 'helper-covers', file.originalname, file.mimetype);

    if (key) {
      // S3 upload succeeded
      imageUrl = getPublicUrl(key);
      logger.info('Image uploaded to S3', { helperId, key });
    } else if (file.size <= max2MB) {
      // AWS not configured and file is small enough — fallback to base64 data URL
      logger.warn('S3 upload failed, falling back to base64 storage', { helperId, size: file.size });
      const base64 = file.buffer.toString('base64');
      imageUrl = `data:${file.mimetype};base64,${base64}`;
      logger.info('Image stored as base64 data URL', { helperId, size: file.size });
    } else {
      // File too large for base64 and S3 not available
      return sendError(res, 400, 'File is too large. Configure AWS S3 to upload images larger than 2MB.');
    }

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
