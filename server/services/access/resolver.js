'use strict';

/**
 * Effective access evaluation (spec: "Effective access evaluation").
 *
 * Pure evaluation over facts loaded by accessService.loadFacts(). Legacy
 * `users.role` / `users.default_mode` are deliberately NOT inputs: a global
 * mode can never add or remove a capability. Organization authority comes
 * from canonical ownership/membership rows (scopeModel semantics).
 */

const { CUSTOMER, getCapability } = require('./policyRegistry');

function accountActive(user, now = Date.now()) {
  if (!user) return false;
  if (user.deleted_at) return false;
  if (user.is_active === false) return false;
  if (user.is_banned === true) return false;
  if (user.is_suspended === true) {
    // Mirrors middleware/auth.js: a suspension with a past end date is over.
    const until = user.suspended_until ? new Date(user.suspended_until).getTime() : null;
    if (until == null || until > now) return false;
  }
  return true;
}

function grantIsEffective(g, now) {
  if (!g || g.status !== 'active') return false;
  if (g.expires_at && new Date(g.expires_at).getTime() <= now) return false;
  return true;
}

function subjectMatches(grant, subject) {
  const type = (subject && subject.type) || 'self';
  if ((grant.subject_type || 'self') !== type) return false;
  if (type === 'self') return true;
  return grant.subject_id != null && subject.id != null && String(grant.subject_id) === String(subject.id);
}

/**
 * @param {object} facts { user, grants[], businesses[{id,name,role}], now? }
 * @param {string} capability
 * @param {object} [subject] { type, id }
 * @returns {{ allowed:boolean, reason:string, source?:object, policyVersion?:string }}
 */
function evaluate(facts, capability, subject = { type: 'self' }) {
  const now = facts.now ? new Date(facts.now).getTime() : Date.now();
  if (!accountActive(facts.user, now)) return { allowed: false, reason: 'account_inactive' };
  if (capability === CUSTOMER) return { allowed: true, reason: 'active_account', source: { type: 'account' } };
  const cap = getCapability(capability);
  if (!cap) return { allowed: false, reason: 'unknown_capability' };

  // Ownership of an existing business is canonical in businesses.user_id.
  if ((capability === 'business.own' || capability === 'restaurant.own') && subject && subject.type === 'business') {
    const b = (facts.businesses || []).find((row) => String(row.id) === String(subject.id) && row.role === 'owner');
    if (b) return { allowed: true, reason: 'canonical_owner', source: { type: 'business_owner', id: String(b.id) }, policyVersion: cap.version };
  }

  const matches = (facts.grants || [])
    .filter((g) => g.capability === capability && subjectMatches(g, subject))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const active = matches.find((g) => grantIsEffective(g, now));
  if (active) {
    return { allowed: true, reason: 'grant', source: { type: 'grant', id: String(active.id), provenance: active.provenance }, policyVersion: cap.version };
  }
  if (matches.some((g) => g.status === 'suspended')) return { allowed: false, reason: 'grant_suspended' };
  if (matches.some((g) => g.status === 'revoked')) return { allowed: false, reason: 'grant_revoked' };
  return { allowed: false, reason: 'no_grant' };
}

/** Browser projection (spec: "Browser access snapshot example"). */
function project(facts, { openRequestCount = 0, version = 0 } = {}) {
  const now = facts.now ? new Date(facts.now).getTime() : Date.now();
  if (!accountActive(facts.user, now)) return { version, personal: [], organizations: [], openRequestCount: 0 };
  const personal = new Set([CUSTOMER]);
  for (const g of facts.grants || []) {
    if ((g.subject_type || 'self') === 'self' && grantIsEffective(g, now) && getCapability(g.capability)) personal.add(g.capability);
  }
  const organizations = (facts.businesses || []).map((b) => ({ type: 'business', id: String(b.id), name: b.name || null, role: b.role }));
  const locations = (facts.restaurantLocations || []).map((location) => ({
    type: 'restaurant_location',
    scopeType: 'restaurant_location',
    id: String(location.id),
    name: location.name || null,
    restaurantId: String(location.restaurant_id),
    businessId: String(location.business_id),
    role: location.role || null,
  }));
  return { version, personal: [...personal].sort((a, b) => (a === CUSTOMER ? -1 : b === CUSTOMER ? 1 : a.localeCompare(b))), organizations, locations, openRequestCount };
}

/**
 * Reviewer authority for one request (spec: "Review authority matrix").
 * reviewer: { id, role, isSuper, permissions:Set|string[] }
 */
function canReview(reviewer, request) {
  if (!reviewer || !request) return { allowed: false, reason: 'unauthenticated' };
  if (String(reviewer.id) === String(request.applicant_id)) return { allowed: false, reason: 'self_review_forbidden' };
  const cap = getCapability(request.capability);
  if (!cap) return { allowed: false, reason: 'unknown_capability' };
  if (cap.reviewerClass !== 'platform') return { allowed: false, reason: 'organization_authority_required' };
  if (reviewer.role !== 'admin' && reviewer.role !== 'super_admin') return { allowed: false, reason: 'not_platform_staff' };
  if (reviewer.isSuper || reviewer.role === 'super_admin') return { allowed: true, reason: 'super_admin' };
  const perms = reviewer.permissions instanceof Set ? reviewer.permissions : new Set(reviewer.permissions || []);
  if (perms.has(cap.reviewPermission)) return { allowed: true, reason: 'permission' };
  return { allowed: false, reason: 'permission_required' };
}

module.exports = { evaluate, project, canReview, accountActive, grantIsEffective };
