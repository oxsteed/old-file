const logger = require('../utils/logger');

/**
 * Unified Error Handler
 * Prevents internal server details and stack traces from leaking to the client.
 * L-02: Standardize error responses.
 */
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const isDev = process.env.NODE_ENV === 'development';

  // Log the full error internally
  logger.error('API Error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    userId: req.user ? req.user.id : 'unauthenticated',
    ip_hash: req.ip_hash || null, // from ipHashMiddleware
  });

  // Sensitive errors (like Postgres errors) should never reach the client in detail.
  const publicMessage = (statusCode === 500 && !isDev)
    ? 'An unexpected error occurred. Please try again later.'
    : err.message;

  res.status(statusCode).json({
    error: publicMessage,
    code: err.code || 'INTERNAL_ERROR',
    // Only return stack in development
    stack: isDev ? err.stack : undefined,
    fields: err.fields || undefined, // Support for validation errors
  });
};

/**
 * Custom Error Class
 */
class AppError extends Error {
  constructor(message, statusCode, code = 'APP_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { errorHandler, AppError };
