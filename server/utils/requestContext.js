'use strict';

// Minimal per-request context (HTTP method) for access checks that run deep
// in services without the request object, e.g. "admins keep read-only access
// to deleted businesses" (decision 5). Mounted first in index.js.
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function requestContextMiddleware(req, _res, next) {
  storage.run({ method: String(req.method || '').toUpperCase() }, next);
}

function runWithRequestContext(ctx, fn) {
  return storage.run({ method: String(ctx?.method || '').toUpperCase() }, fn);
}

/** True only inside an HTTP request whose method is GET/HEAD/OPTIONS. */
function isReadOnlyRequest() {
  const ctx = storage.getStore();
  return Boolean(ctx && SAFE_METHODS.has(ctx.method));
}

module.exports = { requestContextMiddleware, runWithRequestContext, isReadOnlyRequest, SAFE_METHODS };
