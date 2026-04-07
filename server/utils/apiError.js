/**
 * server/utils/apiError.js
 *
 * Shared helpers for consistent API error and success shapes.
 *
 * Error shape:
 *   { error: string, code?: string, fields?: Record<string, string> }
 *
 * Success shape:
 *   { data: T } | { message: string } | { data: T, meta: M }
 *
 * Usage:
 *   const { sendError, sendValidationError, sendSuccess } = require('../utils/apiError');
 *
 *   sendError(res, 404, 'Job not found', 'not_found');
 *   sendValidationError(res, { email: 'Invalid email address' });
 *   sendSuccess(res, { job }, 201);
 */

'use strict';

/**
 * Send a structured error response.
 * @param {import('express').Response} res
 * @param {number} status  - HTTP status code
 * @param {string} message - Human-readable error message
 * @param {string} [code]  - Machine-readable error code (snake_case)
 * @param {object} [extra] - Any additional fields to merge in
 */
function sendError(res, status, message, code, extra = {}) {
  const body = { error: message };
  if (code)  body.code  = code;
  if (extra && typeof extra === 'object') Object.assign(body, extra);
  return res.status(status).json(body);
}

/**
 * Send a 400 validation error with per-field messages.
 * @param {import('express').Response} res
 * @param {Record<string, string>} fields - Map of field → error message
 */
function sendValidationError(res, fields) {
  return res.status(400).json({
    error:  'Validation failed',
    code:   'validation_failed',
    fields,
  });
}

/**
 * Send a successful response.
 * @param {import('express').Response} res
 * @param {object|string} data  - Response payload (object) or message string
 * @param {number}        [status=200]
 * @param {object}        [meta]  - Optional pagination/meta envelope
 */
function sendSuccess(res, data, status = 200, meta) {
  const body = typeof data === 'string' ? { message: data } : data;
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

module.exports = { sendError, sendValidationError, sendSuccess };
