/**
 * server/utils/appError.js
 *
 * Custom error class for consistent error handling across the application.
 * All errors should be instances of AppError for proper classification and response.
 *
 * Usage:
 *   throw new AppError('User not found', 404, 'user_not_found');
 *   throw new AppError('Validation failed', 400, 'validation_failed', {
 *     email: 'Invalid email format',
 *     password: 'Must be at least 8 characters'
 *   });
 */

'use strict';

class AppError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {number} status - HTTP status code (default: 500)
   * @param {string} code - Machine-readable error code (default: 'internal_error')
   * @param {Record<string, string>} fields - Per-field validation errors (optional)
   */
  constructor(message, status = 500, code = 'internal_error', fields = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = fields;

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert to JSON for API response
   */
  toJSON() {
    const obj = {
      error: this.message,
      code: this.code,
      status: this.status,
      timestamp: new Date().toISOString(),
    };

    if (Object.keys(this.fields).length > 0) {
      obj.fields = this.fields;
    }

    return obj;
  }
}

module.exports = AppError;
