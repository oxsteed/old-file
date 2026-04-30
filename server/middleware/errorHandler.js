const logger = require('../utils/logger');

const IS_DEV = process.env.NODE_ENV === 'development';

/**
 * Unified Error Handler Middleware
 *
 * Catches all errors and returns consistent error responses with full logging.
 * Prevents internal server details and stack traces from leaking to the client.
 *
 * Error Response Shape:
 *   {
 *     error: string,            // Human-readable message
 *     code: string,             // Machine-readable code
 *     status: number,           // HTTP status (for debugging)
 *     timestamp: string,        // ISO 8601 timestamp
 *     requestId: string,        // For tracing
 *     fields?: object,          // Validation errors (optional)
 *     debug?: object,           // Debug info (dev only)
 *   }
 */
const errorHandler = (err, req, res, next) => {
  const requestId = req.id || 'unknown';
  const userId = req.user?.id;

  // Extract error details
  let status = 500;
  let code = 'internal_error';
  let message = 'Internal server error';
  let fields = {};

  if (err instanceof AppError) {
    // Known application error
    status = err.status || 500;
    code = err.code || 'app_error';
    message = err.message;
    fields = err.fields || {};
  } else if (err.statusCode) {
    // Legacy error format compatibility
    status = err.statusCode;
    code = err.code || 'internal_error';
    message = err.message;
    fields = err.fields || {};
  } else if (err.name === 'ValidationError') {
    // Joi or schema validation errors
    status = 400;
    code = 'validation_failed';
    message = 'Validation failed';
    if (err.details) {
      err.details.forEach((detail) => {
        const path = detail.path.join('.');
        fields[path] = detail.message;
      });
    }
  } else if (err.name === 'UnauthorizedError') {
    status = 401;
    code = 'unauthorized';
    message = err.message || 'Unauthorized';
  } else if (err.name === 'JsonWebTokenError') {
    status = 401;
    code = 'invalid_token';
    message = 'Invalid or expired token';
  } else if (err.name === 'TypeError' && err.message.includes('Cannot read')) {
    // Null reference error
    status = 500;
    code = 'internal_error';
    message = 'Internal server error';
  } else if (err.message) {
    // Other errors
    message = err.message;
  }

  // Sanitize message for production (don't leak database errors, etc.)
  if (status >= 500 && !IS_DEV) {
    message = 'Internal server error';
  }

  // Determine log level
  const logLevel = status >= 500 ? 'error' : 'warn';

  // Log with full context
  logger[logLevel](`HTTP ${status}: ${code}`, {
    requestId,
    userId,
    method: req.method,
    path: req.path,
    query: req.query,
    statusCode: status,
    code,
    message,
    errorName: err.name,
    errorStack: IS_DEV ? err.stack : undefined,
    fields: Object.keys(fields).length > 0 ? fields : undefined,
  });

  // Build response
  const response = {
    error: message,
    code,
    status,
    timestamp: new Date().toISOString(),
    requestId,
  };

  // Include validation field errors if present
  if (Object.keys(fields).length > 0) {
    response.fields = fields;
  }

  // Include debug info in development
  if (IS_DEV && !(err instanceof AppError)) {
    response.debug = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }

  // Send response
  res.status(status).json(response);
};

/**
 * Custom Error Class
 *
 * Represents an application error that should be sent to the client.
 * Use this for all errors that need to be returned in API responses.
 *
 * @example
 *   throw new AppError('User not found', 404, 'user_not_found');
 *   throw new AppError('Validation failed', 400, 'validation_failed', {
 *     email: 'Invalid email format'
 *   });
 */
class AppError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {number} status - HTTP status code (default: 500)
   * @param {string} code - Machine-readable error code (default: 'app_error')
   * @param {Record<string, string>} fields - Per-field validation errors (optional)
   */
  constructor(message, status = 500, code = 'app_error', fields = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert to JSON for API response
   */
  toJSON() {
    return {
      error: this.message,
      code: this.code,
      status: this.status,
      timestamp: new Date().toISOString(),
      fields: Object.keys(this.fields).length > 0 ? this.fields : undefined,
    };
  }
}

module.exports = { errorHandler, AppError };
