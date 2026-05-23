'use strict';

class AppError extends Error {
  constructor(message, status = 500, code = 'app_error', fields = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.statusCode = status;
    this.code = code;
    this.fields = fields;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      status: this.status,
      timestamp: new Date().toISOString(),
      fields: Object.keys(this.fields || {}).length > 0 ? this.fields : undefined,
    };
  }
}

module.exports = AppError;
