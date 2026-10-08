'use strict';

/**
 * Return an actionable Media error without exposing provider or database
 * details. Operational client errors keep their status/message/code; unknown
 * failures are intentionally flattened to the route's safe fallback.
 */
function sendMediaError(res, error, fallback, options = {}) {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
    ? error.status : 500;
  const operational = (status >= 400 && status < 500)
    || (status === 503 && Boolean(error?.isOperational));
  const payload = { error: operational && error?.message ? error.message : fallback };
  if (operational && error?.code) payload.code = error.code;
  else if (!operational && options.fallbackCode) payload.code = options.fallbackCode;
  return res.status(status).json(payload);
}

module.exports = { sendMediaError };
