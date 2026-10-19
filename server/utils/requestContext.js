'use strict';

// Minimal per-request context for access checks that run deep in services
// without the request object, e.g. "admins keep read-only access to deleted
// businesses" (decision 5). Mounted first in index.js; the scope gates also
// enter it, so routers mounted on their own (tests, sub-apps) get it too.
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function newContext(method) {
  return { method: String(method || '').toUpperCase(), adminSupportOk: new Set() };
}

function requestContextMiddleware(req, _res, next) {
  storage.run(newContext(req.method), next);
}

/** Run fn inside this request's context, creating one if none is active. */
function ensureRequestContext(req, fn) {
  const current = storage.getStore();
  if (current) return fn();
  return storage.run(newContext(req && req.method), fn);
}

function runWithRequestContext(ctx, fn) {
  return storage.run(newContext(ctx && ctx.method), fn);
}

/** True only inside an HTTP request whose method is GET/HEAD/OPTIONS. */
function isReadOnlyRequest() {
  const ctx = storage.getStore();
  return Boolean(ctx && SAFE_METHODS.has(ctx.method));
}

// A platform admin's write access to a business was verified (not deleted)
// earlier in this request, so later checks for it need no second lookup.
function markAdminSupportOk(businessId) {
  const ctx = storage.getStore();
  if (ctx) ctx.adminSupportOk.add(String(businessId));
}

function adminSupportOk(businessId) {
  const ctx = storage.getStore();
  return Boolean(ctx && ctx.adminSupportOk.has(String(businessId)));
}

module.exports = {
  requestContextMiddleware, ensureRequestContext, runWithRequestContext, isReadOnlyRequest,
  markAdminSupportOk, adminSupportOk, SAFE_METHODS,
};
