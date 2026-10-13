'use strict';

// Review P3-7-F07: server-side maintenance gate. The admin-editable
// platform_settings key 'maintenance_mode' previously had no runtime reader,
// so flipping it did nothing. Now, when it is 'true':
//   - health/readiness probes and admin API paths still pass (operators must
//     be able to observe the box and turn the flag back off),
//   - every other request gets 503 { code: 'maintenance_mode' }.
// Fail-open when the setting cannot be read (see platformSettingsCache).

const AppError = require('../utils/appError');
const { isMaintenanceMode, areNewUserRegistrationsEnabled } = require('../services/platformSettingsCache');

const EXEMPT_PATHS = new Set(['/health', '/healthz', '/ready', '/api/ready', '/readyz', '/api/health', '/api/health/deep']);
const ADMIN_API_PREFIX = '/api/admin/';
// The admin SPA itself must stay reachable during maintenance, otherwise no
// operator could load the UI to turn the flag back off (the admin API alone
// would still work via curl/connector, but the UI is the primary path).
const ADMIN_UI_PREFIX = '/admin/';

function isExempt(path) {
  if (EXEMPT_PATHS.has(path)) return true;
  if (typeof path !== 'string') return false;
  return path.startsWith(ADMIN_API_PREFIX) || path.startsWith(ADMIN_UI_PREFIX);
}

function createMaintenanceGate() {
  return async function maintenanceGate(req, res, next) {
    let maintenance = false;
    try {
      maintenance = await isMaintenanceMode();
    } catch (_) {
      return next();
    }
    if (!maintenance) return next();
    if (isExempt(req.path)) return next();
    return res.status(503).json({
      error: 'OxSteed is temporarily down for maintenance. Please try again later.',
      code: 'maintenance_mode',
      retryable: true,
    });
  };
}

// Review P3-7-F07: 'new_user_registrations' now has a real runtime reader.
// Call from registration controllers AFTER input validation (so invalid
// input still fails fast with 400 before any settings lookup). Throws a 503
// AppError when signups are closed. In-flight completions (accept-terms,
// verify-otp) are not gated so users are not stranded mid-flow.
async function assertRegistrationsOpen() {
  const open = await areNewUserRegistrationsEnabled().catch(() => true);
  if (!open) {
    throw new AppError(
      'New user registrations are temporarily disabled. Please try again later.',
      503,
      'registrations_disabled'
    );
  }
}

function requireRegistrationsOpen(req, res, next) {
  assertRegistrationsOpen().then(() => next()).catch(next);
}

module.exports = { createMaintenanceGate, requireRegistrationsOpen, assertRegistrationsOpen, isExempt };
