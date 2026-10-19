'use strict';

/**
 * Shared tenant scope gates (analytics scope report, Area 4).
 *
 * Every route whose path carries a tenant id (:businessId, :restaurantId, ...)
 * must run one of these gates, or carry an explicit scopeExempt(reason)
 * marker. __tests__/routeScopeGuard.test.js enumerates every router and fails
 * when a tenant route has neither, so a new endpoint cannot silently skip
 * scoping. Gates are recognized by the `scopeGate` property set here (and by
 * requireBusinessAccess), not by function name.
 *
 * Gates:
 *   requireBusinessAccess(...)          business hub tenancy (owner or active
 *                                       member, optional min role), see
 *                                       middleware/requireBusinessAccess.js.
 *   requireRestaurantAccess()           restaurant tenancy: the canonical
 *                                       restaurant gate (owner via business or
 *                                       owner_user_id, else an active member of
 *                                       the restaurant's business). Same 404
 *                                       restaurant_not_found as every
 *                                       controller-level copy. Per-domain role
 *                                       policy (manage roles, permissions) stays
 *                                       in the controller.
 *   requireSupportBusinessAccess(level) support desk tenancy. Platform admins
 *                                       pass (existing support policy), then:
 *                                       'administrate' owner/manager/representative,
 *                                       'manage' + support_agent,
 *                                       'conversations' + an active support agent
 *                                       employed for the business (or a platform
 *                                       support agent). Same 403 'Access denied'.
 *   scopeExempt(reason)                 explicit, reviewed exemption (public
 *                                       storefront reads, device credentials,
 *                                       customer self-service keyed by the
 *                                       caller's own id, ...). No-op at runtime.
 *
 * Accessors (fail closed when the matching gate did not run for this request):
 *   scopedBusinessId(req)    canonical string id validated by a business gate
 *   scopedRestaurantId(req)  canonical string id validated by the restaurant gate
 *
 * Request-scoped reuse: the restaurant gate stores the resolved row in an
 * AsyncLocalStorage slot consumed by the FIRST later resolveRestaurantAccess
 * call for the same (user, restaurant) in this request. Controllers keep their
 * local requireRestaurantAccess wrappers (and their role gates) unchanged; the
 * gate replaces their first access query instead of adding one, and any
 * further lookup in the same request still reads fresh from the database.
 */

const { sendError } = require('../utils/apiError');
const { AppError } = require('./errorHandler');
const scopeModel = require('../services/scopeModel');
const supportEmployerService = require('../services/supportEmployerService');

function markGate(fn, kind, detail) {
  Object.defineProperty(fn, 'scopeGate', { value: Object.freeze({ kind, detail: detail || null }), enumerable: false });
  return fn;
}

function canonicalId(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number.parseInt(s, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Restaurant tenancy gate. Mirrors the controller-level wrappers exactly:
 * missing/invalid id or no standing -> AppError 404 restaurant_not_found via
 * next(err) (the error handler renders it like the controllers' throws).
 */
function requireRestaurantAccess(options = {}) {
  const paramName = options.paramName || 'restaurantId';
  return markGate(async function requireRestaurantAccessGate(req, res, next) {
    if (!req.user || !req.user.id) {
      return sendError(res, 401, 'Authentication required.', 'auth_required');
    }
    const raw = req.params[paramName];
    try {
      // Missing or non-numeric ids are 404 like the wrappers' fast-fail guard
      // (the four wrappers without that guard let the driver 500 instead).
      const id = canonicalId(raw);
      if (id == null) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
      const restaurant = await scopeModel.resolveRestaurantAccess(req.user.id, id);
      req.scope = { ...(req.scope || {}), restaurantId: String(restaurant.id), restaurantParam: paramName };
      req.restaurantRole = restaurant.effective_role;
      return scopeModel.runWithResolvedRestaurant(req.user.id, [raw, id], restaurant, () => next());
    } catch (err) {
      return next(err);
    }
  }, 'restaurant', paramName);
}

const SUPPORT_LEVELS = new Set(['administrate', 'manage', 'conversations']);

function requireSupportBusinessAccess(level, options = {}) {
  if (!SUPPORT_LEVELS.has(level)) throw new Error(`Unknown support access level: ${level}`);
  const paramName = options.paramName || 'businessId';
  // Most support controllers let platform admins through before the
  // membership check; the few that do not pass { platformAdmins: false }.
  const platformAdmins = options.platformAdmins !== false;
  return markGate(async function requireSupportBusinessAccessGate(req, res, next) {
    if (!req.user || !req.user.id) {
      return sendError(res, 401, 'Authentication required.', 'auth_required');
    }
    const businessId = req.params[paramName];
    try {
      let allowed = false;
      let viaPlatformAdmin = false;
      if (businessId && canonicalId(businessId) != null) {
        if (platformAdmins && supportEmployerService.isPlatformAdmin(req.user.role)) { allowed = true; viaPlatformAdmin = true; }
        else if (level === 'administrate') allowed = await supportEmployerService.userCanAdministrateBusiness(businessId, req.user.id);
        else if (level === 'manage') allowed = await supportEmployerService.userCanManageBusiness(businessId, req.user.id);
        else allowed = await supportEmployerService.userCanAccessBusinessConversations(businessId, req.user.id, req.user.role);
      }
      if (!allowed) return sendError(res, 403, 'Access denied');
      req.scope = {
        ...(req.scope || {}),
        businessId: String(canonicalId(businessId)),
        businessParam: paramName,
        supportLevel: level,
        supportViaPlatformAdmin: viaPlatformAdmin,
      };
      return next();
    } catch (err) {
      return next(err);
    }
  }, 'support-business', platformAdmins ? level : `${level} (no platform-admin bypass)`);
}

const SUPPORT_RANK = { conversations: 1, manage: 2, administrate: 3 };

/**
 * True when the support gate already granted at least `level` for this
 * business on this request. Controller helpers call this first so the route
 * gate replaces their membership query instead of repeating it; without the
 * gate they fall through to their own (identical) check.
 */
function supportScopeSatisfies(req, businessId, level) {
  const scope = req && req.scope;
  if (!scope || !scope.supportLevel || canonicalId(businessId) == null) return false;
  if (scope.businessId !== String(canonicalId(businessId))) return false;
  return (SUPPORT_RANK[scope.supportLevel] || 0) >= (SUPPORT_RANK[level] || Infinity);
}

// Same idea for routes gated by requireBusinessAccess: a controller's local
// role check can trust the gate's verified role for the same business.
const BUSINESS_RANK = { owner: 5, manager: 4, representative: 3, support_agent: 2, employee: 1 };
function businessScopeSatisfies(req, businessId, minRole = 'any') {
  if (!req || !req.business || !req.businessRole || canonicalId(businessId) == null) return false;
  if (String(req.business.id) !== String(canonicalId(businessId))) return false;
  if (minRole === 'any') return true;
  return (BUSINESS_RANK[req.businessRole] || 0) >= (BUSINESS_RANK[minRole] || Infinity);
}

// The only accepted exemption reasons. Adding one is a reviewed change to
// this file; scopeExempt() throws at load time for anything else.
const EXEMPT_REASONS = Object.freeze({
  'resource-scoped': 'Authorization is decided from the loaded resource (conversation, agent row, application) and its own business, not the path tenant id; the controller returns 404 when the resource belongs to another tenant.',
  'public-storefront': 'Public read (or anonymous checkout/quote) of a listed business or restaurant; the controller applies the public visibility predicate.',
  'customer-self-service': "Caller acts as a customer of the tenant; every query is keyed by the caller's own user id (wallet, loyalty, favorites, top-ups, reports).",
  'customer-media': 'Restaurant media written by any signed-in customer; the controller checks poster/owner/moderator per media row.',
  'device-credential': 'Managed device routes authenticated by a per-device credential bound to :restaurantId (requireDeviceCredential), not a user session.',
  'applicant-self-service': 'Job applicant acting on their own application; the controller keys rows by the caller id.',
  'public-intake': 'Anonymous or customer request addressed to a business (lead/quote request, intake form, waitlist, appointment, review, maintenance request); the controller only creates rows owned by the requester and applies the public visibility predicate.',
  'signed-callback': 'Third-party redirect (Stripe Connect OAuth) authorized by a signed, expiring state token bound to the business and user, not a session.',
  'agent-self-service': "Support agent acting on their own employment record (clock-in, breaks, own shifts); the controller checks the agent row belongs to the caller or a manager.",
});

function scopeExempt(reason) {
  if (!Object.prototype.hasOwnProperty.call(EXEMPT_REASONS, reason)) {
    throw new Error(`scopeExempt: unknown reason "${reason}" (see EXEMPT_REASONS in middleware/scopeGates.js)`);
  }
  return markGate(function scopeExemptMarker(_req, _res, next) { next(); }, 'exempt', reason);
}

function scopedBusinessId(req) {
  if (req.business && req.business.id != null) return String(req.business.id);
  if (req.scope && req.scope.businessId) return req.scope.businessId;
  throw new AppError('Business scope unavailable', 500, 'scope_gate_missing');
}

function scopedRestaurantId(req) {
  if (req.scope && req.scope.restaurantId) return req.scope.restaurantId;
  throw new AppError('Restaurant scope unavailable', 500, 'scope_gate_missing');
}

module.exports = {
  EXEMPT_REASONS,
  markGate,
  requireRestaurantAccess,
  requireSupportBusinessAccess,
  scopeExempt,
  supportScopeSatisfies,
  businessScopeSatisfies,
  scopedBusinessId,
  scopedRestaurantId,
};
