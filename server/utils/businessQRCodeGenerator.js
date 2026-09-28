/**
 * Business QR Code Generator Extension
 *
 * Extends the QR code generator to support business profiles.
 * Uses the same infrastructure as helper QR codes.
 */

const {
  generateQRCodeDataURL,
  generateQRCodeBuffer,
  generateQRCodeSVG,
  generateQRCodeSizes,
  validateURL
} = require('./qrCodeGenerator');

const { logger } = require('./logger');

/**
 * Build a business profile URL for QR code
 * @param {string} businessId - Business ID
 * @param {string} businessName - Business name (optional, for readability)
 * @param {string} profileSlug - Vanity profile slug (optional; when set, yields the short /b/:slug URL)
 * @returns {string} - Full URL to business's public profile
 */
exports.buildBusinessProfileURL = (businessId, businessName = null, profileSlug = null) => {
  const baseUrl = process.env.APP_URL || process.env.CLIENT_URL || 'http://localhost:3000';
  if (profileSlug) {
    return `${baseUrl}/b/${profileSlug}`;
  }
  return `${baseUrl}/businesses/public/${businessId}`;
};

/**
 * Generate QR code for a business's profile
 * @param {string} businessId - Business ID
 * @param {string} businessName - Business name (optional)
 * @param {string} format - 'dataurl' | 'buffer' | 'svg' (default: 'dataurl')
 * @param {object} options - Additional QR code options (width, etc.)
 * @returns {Promise} - QR code in requested format
 */
exports.generateBusinessProfileQRCode = async (businessId, businessName = null, format = 'dataurl', options = {}) => {
  const profileUrl = exports.buildBusinessProfileURL(businessId, businessName, options.profileSlug || null);

  try {
    switch (format) {
      case 'buffer':
        return await generateQRCodeBuffer(profileUrl, options);
      case 'svg':
        return await generateQRCodeSVG(profileUrl, options);
      case 'dataurl':
      default:
        return await generateQRCodeDataURL(profileUrl, options);
    }
  } catch (err) {
    logger.error('Error generating business QR code', {
      error: err.message,
      businessId,
      format
    });
    throw err;
  }
};

/**
 * Generate multiple sizes of business QR code
 * @param {string} businessId - Business ID
 * @param {string} businessName - Business name (optional)
 * @returns {Promise<object>} - Object with size keys, QR code data URLs as values
 */
exports.generateBusinessQRCodeSizes = async (businessId, businessName = null, options = {}) => {
  const profileUrl = exports.buildBusinessProfileURL(businessId, businessName, options.profileSlug || null);

  try {
    const sizes = {
      small: 150,
      medium: 300,
      large: 500
    };

    const results = {};

    for (const [sizeKey, width] of Object.entries(sizes)) {
      results[sizeKey] = await generateQRCodeDataURL(profileUrl, { width });
    }

    return results;
  } catch (err) {
    logger.error('Error generating business QR code sizes', {
      error: err.message,
      businessId
    });
    throw err;
  }
};
