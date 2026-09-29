const QRCode = require('qrcode');
const { logger } = require('./logger');

/**
 * QR Code Generator Utility
 * Generates QR codes dynamically (no storage required)
 */

/**
 * Generate a QR code as a data URL (PNG)
 * @param {string} text - The text/URL to encode
 * @param {object} options - QR code options
 * @returns {Promise<string>} - Base64 data URL
 */
exports.generateQRCodeDataURL = async (text, options = {}) => {
  try {
    const defaultOptions = {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      quality: 0.95,
      margin: 1,
      width: 300, // Default 300px square
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      ...options
    };

    const dataUrl = await QRCode.toDataURL(text, defaultOptions);
    return dataUrl;
  } catch (err) {
    logger.error('Error generating QR code', { error: err.message, text });
    throw err;
  }
};

/**
 * Generate a QR code as a PNG buffer
 * @param {string} text - The text/URL to encode
 * @param {object} options - QR code options
 * @returns {Promise<Buffer>} - PNG buffer
 */
exports.generateQRCodeBuffer = async (text, options = {}) => {
  try {
    const defaultOptions = {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      width: 300,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      ...options
    };

    const buffer = await QRCode.toBuffer(text, defaultOptions);
    return buffer;
  } catch (err) {
    logger.error('Error generating QR code buffer', { error: err.message });
    throw err;
  }
};

/**
 * Generate a QR code as SVG
 * @param {string} text - The text/URL to encode
 * @param {object} options - QR code options
 * @returns {Promise<string>} - SVG string
 */
exports.generateQRCodeSVG = async (text, options = {}) => {
  try {
    const defaultOptions = {
      errorCorrectionLevel: 'H',
      type: 'image/svg+xml',
      width: 300,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      ...options
    };

    const svg = await QRCode.toString(text, defaultOptions);
    return svg;
  } catch (err) {
    logger.error('Error generating QR code SVG', { error: err.message });
    throw err;
  }
};

/**
 * Build a helper profile URL for QR code
 * @param {string} helperId - Helper user ID
 * @param {string} helperName - Helper name (optional, for readability)
 * @param {string} profileSlug - Vanity profile slug (optional; when set, yields the short /h/:slug URL)
 * @returns {string} - Full URL to helper's public profile
 */
exports.buildHelperProfileURL = (helperId, helperName = null, profileSlug = null) => {
  const baseUrl = process.env.APP_URL || process.env.CLIENT_URL || 'http://localhost:3000';

  if (profileSlug) {
    return `${baseUrl}/h/${profileSlug}`;
  }

  return `${baseUrl}/helpers/${helperId}`;
};

/**
 * Generate QR code for a helper's profile
 * @param {string} helperId - Helper user ID
 * @param {string} helperName - Helper name (optional)
 * @param {string} format - 'dataurl' | 'buffer' | 'svg' (default: 'dataurl')
 * @returns {Promise} - QR code in requested format
 */
exports.generateHelperProfileQRCode = async (
  helperId,
  helperName = null,
  format = 'dataurl',
  options = {},
) => {
  const profileUrl = exports.buildHelperProfileURL(helperId, helperName);
  const qrOpts = typeof options === 'object' && options ? options : {};

  switch (format) {
    case 'buffer':
      return await exports.generateQRCodeBuffer(profileUrl, qrOpts);
    case 'svg':
      return await exports.generateQRCodeSVG(profileUrl, qrOpts);
    case 'dataurl':
    default:
      return await exports.generateQRCodeDataURL(profileUrl, qrOpts);
  }
};

/**
 * Generate multiple QR codes with different sizes
 * Useful for different use cases (small display, print, etc.)
 * @param {string} text - The text/URL to encode
 * @param {object} sizes - { small: 150, medium: 300, large: 500 }
 * @returns {Promise<object>} - Object with size keys, QR code data URLs as values
 */
exports.generateQRCodeSizes = async (text, sizes = { small: 150, medium: 300, large: 500 }) => {
  try {
    const results = {};

    for (const [sizeKey, width] of Object.entries(sizes)) {
      results[sizeKey] = await exports.generateQRCodeDataURL(text, { width });
    }

    return results;
  } catch (err) {
    logger.error('Error generating QR code sizes', { error: err.message });
    throw err;
  }
};

/**
 * Validate if a URL is valid for QR encoding
 * @param {string} url - URL to validate
 * @returns {boolean}
 */
exports.validateURL = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};
