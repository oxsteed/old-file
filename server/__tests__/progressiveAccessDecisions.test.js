'use strict';

/**
 * Progressive account access — the seven "Decisions already made"
 * (docs/progressive-access/SPEC.md, page 007) as product tests.
 * Later work packages add HTTP/DB evidence for the same decisions in
 * progressiveAccess*.test.js; these pin the contract every layer uses.
 */

const registry = require('../services/access/policyRegistry');
const lifecycle = require('../services/access/lifecycle');
const resolver = require('../services/access/resolver');
const { mapLegacyUser } = require('../services/access/legacyMapping');

const USER = { id: 'u-1', role: 'customer', default_mode: 'customer', is_active: true };
const grant = (capability, extra = {}) => ({ id: `g-${capability}`, capability, subject_type: 'self', subject_id: null, status: 'active', ...extra });

describe('D1 — every new person has customer access; signup choice is intent only', () => {
  test.each(['find_help', 'offer_services', 'run_business', 'run_restaurant', 'helper', 'business_owner', 'admin', 'super_admin', '', null, 42])(
    'intent %p normalizes to a known intent and never to a role', (raw) => {
      const intent = registry.normalizeSignupIntent(raw);
      expect(Object.keys(registry.SIGNUP_INTENTS)).toContain(intent);
    },
  );
  test('a verified account with no grants holds exactly customer access', () => {
    expect(resolver.project({ user: USER, grants: [] }).personal).toEqual(['customer']);
    expect(resolver.evaluate({ user: USER, grants: [] }, 'customer').allowed).toBe(true);
  });
  test('helper intent maps to an application capability, not a grant', () => {
    expect(registry.capabilityForIntent('offer_services')).toBe('helper.offer_services');
    expect(resolver.evaluate({ user: USER, grants: [] }, 'helper.offer_services')).toMatchObject({ allowed: false, reason: 'no_grant' });
  });
  test('forged privileged values collapse to find_help', () => {
    expect(registry.normalizeSignupIntent('admin')).toBe('find_help');
    expect(registry.capabilityForIntent('super_admin')).toBeNull();
  });
});

describe('D2 — Helper / Business Owner open an application reviewed by an authorized OxSteed reviewer', () => {
  test.each(['helper.offer_services', 'business.own'])('%s is platform-reviewed and applicant-requestable', (key) => {
    const cap = registry.getCapability(key);
    expect(cap.reviewerClass).toBe('platform');
    expect(cap.applicantMayRequest).toBe(true);
    expect(cap.form.fields.some((f) => f.required)).toBe(true);
  });
  test('only staff holding the review permission (or super admin) may decide', () => {
    const req = { applicant_id: 'u-1', capability: 'helper.offer_services' };
    expect(resolver.canReview({ id: 'a', role: 'admin', permissions: ['review_access_requests'] }, req).allowed).toBe(true);
    expect(resolver.canReview({ id: 'a', role: 'admin', permissions: [] }, req)).toMatchObject({ allowed: false, reason: 'permission_required' });
    expect(resolver.canReview({ id: 'h', role: 'helper', permissions: ['review_access_requests'] }, req).allowed).toBe(false);
    expect(resolver.canReview({ id: 's', role: 'super_admin' }, req).allowed).toBe(true);
  });
  test('public policy projection hides reviewer-only data', () => {
    const p = registry.publicPolicy('helper.offer_services');
    expect(p).not.toHaveProperty('reviewPermission');
    expect(p).not.toHaveProperty('legacyModes');
    expect(p.policyVersion).toBe('helper-policy-1');
  });
});

describe('D3 — apply during signup or later; account stays usable during review', () => {
  test('pending applications never remove customer access', () => {
    for (const status of ['draft', 'submitted', 'in_review', 'needs_information', 'declined', 'withdrawn']) {
      expect(lifecycle.isOpen(status) || ['declined', 'withdrawn'].includes(status)).toBe(true);
      expect(resolver.evaluate({ user: USER, grants: [] }, 'customer').allowed).toBe(true);
    }
  });
  test('applicant can save a draft, submit, revise on request, resubmit and withdraw', () => {
    expect(lifecycle.applicantNext('update', 'draft')).toBe('draft');
    expect(lifecycle.applicantNext('submit', 'draft')).toBe('submitted');
    expect(lifecycle.reviewerNext('request_information', 'submitted')).toBe('needs_information');
    expect(lifecycle.applicantNext('resubmit', 'needs_information')).toBe('submitted');
    expect(lifecycle.applicantNext('withdraw', 'in_review')).toBe('withdrawn');
    expect(lifecycle.applicantNext('submit', 'approved')).toBeNull();
    expect(lifecycle.availableApplicantActions('declined')).toEqual(['apply_again']);
  });
  test('submission requires complete answers; drafts may be partial', () => {
    expect(lifecycle.validateAnswers('helper.offer_services', {}, { mode: 'draft' }).ok).toBe(true);
    expect(lifecycle.validateAnswers('helper.offer_services', {}, { mode: 'submit' }).fields).toMatchObject({ serviceCategories: 'required', serviceArea: 'required' });
    expect(lifecycle.validateAnswers('helper.offer_services', {
      serviceCategories: ['plumbing'], serviceArea: { country: 'US', region: 'OH', city: 'Springfield' },
    }).ok).toBe(true);
    expect(lifecycle.validateAnswers('helper.offer_services', { role: 'admin' }, { mode: 'draft' }).fields).toMatchObject({ role: 'unknown_field' });
  });
});

describe('D4 — approved capabilities accumulate; no global role or mode switch', () => {
  test('customer + helper + consultant together', () => {
    const facts = { user: USER, grants: [grant('helper.offer_services'), grant('consultant.accept_paying_clients')] };
    expect(resolver.project(facts).personal).toEqual(['customer', 'consultant.accept_paying_clients', 'helper.offer_services']);
    expect(resolver.evaluate(facts, 'customer').allowed).toBe(true);
    expect(resolver.evaluate(facts, 'helper.offer_services').allowed).toBe(true);
  });
  test('legacy role / default_mode values are ignored by the resolver', () => {
    const asHelperMode = { user: { ...USER, role: 'helper', default_mode: 'helper' }, grants: [] };
    expect(resolver.evaluate(asHelperMode, 'helper.offer_services').allowed).toBe(false);
    const asCustomerMode = { user: { ...USER, role: 'customer', default_mode: 'customer' }, grants: [grant('helper.offer_services')] };
    expect(resolver.evaluate(asCustomerMode, 'helper.offer_services').allowed).toBe(true);
  });
  test('revoked, suspended and expired grants do not authorize', () => {
    expect(resolver.evaluate({ user: USER, grants: [grant('helper.offer_services', { status: 'revoked' })] }, 'helper.offer_services').reason).toBe('grant_revoked');
    expect(resolver.evaluate({ user: USER, grants: [grant('helper.offer_services', { status: 'suspended' })] }, 'helper.offer_services').reason).toBe('grant_suspended');
    expect(resolver.evaluate({ user: USER, grants: [grant('helper.offer_services', { expires_at: '2000-01-01T00:00:00Z' })] }, 'helper.offer_services').allowed).toBe(false);
  });
  test('a suspended account loses everything, including customer', () => {
    const facts = { user: { ...USER, is_suspended: true }, grants: [grant('helper.offer_services')] };
    expect(resolver.evaluate(facts, 'customer').allowed).toBe(false);
    expect(resolver.project(facts).personal).toEqual([]);
  });
});

describe('D5 — work continues in the existing task context with scoped authority', () => {
  test('a grant scoped to one subject never authorizes another', () => {
    const facts = { user: USER, grants: [grant('business.own', { subject_type: 'business', subject_id: '10' })] };
    expect(resolver.evaluate(facts, 'business.own', { type: 'business', id: '10' }).allowed).toBe(true);
    expect(resolver.evaluate(facts, 'business.own', { type: 'business', id: '11' }).allowed).toBe(false);
    expect(resolver.evaluate(facts, 'business.own', { type: 'self' }).allowed).toBe(false);
  });
  test('canonical ownership authorizes its own business only', () => {
    const facts = { user: USER, grants: [], businesses: [{ id: 10, role: 'owner' }, { id: 12, role: 'manager' }] };
    expect(resolver.evaluate(facts, 'business.own', { type: 'business', id: '10' })).toMatchObject({ allowed: true, reason: 'canonical_owner' });
    expect(resolver.evaluate(facts, 'business.own', { type: 'business', id: '12' }).allowed).toBe(false);
  });
});

describe('D6 — the approver is the authority for the requested access', () => {
  test('nobody approves their own elevation', () => {
    expect(resolver.canReview({ id: 'u-1', role: 'super_admin' }, { applicant_id: 'u-1', capability: 'helper.offer_services' }))
      .toMatchObject({ allowed: false, reason: 'self_review_forbidden' });
  });
  test('specialist domains need their own review permission', () => {
    const req = { applicant_id: 'u-1', capability: 'investor.reporting' };
    expect(resolver.canReview({ id: 'a', role: 'admin', permissions: ['review_access_requests'] }, req).allowed).toBe(false);
    expect(resolver.canReview({ id: 'a', role: 'admin', permissions: ['review_investor_access'] }, req).allowed).toBe(true);
  });
  test('franchise operation is issued from its own pipeline, not self-service', () => {
    expect(registry.getCapability('franchise.operate').applicantMayRequest).toBe(false);
  });
});

describe('D7 — existing valid access, records and ownership survive', () => {
  test('existing helpers keep helper access', () => {
    expect(mapLegacyUser({ user: { role: 'helper', default_mode: 'helper' } }).grants.map((g) => g.capability)).toEqual(['helper.offer_services']);
    expect(mapLegacyUser({ user: { role: 'customer', default_mode: 'customer' }, helperProfile: true }).grants[0].reason).toBe('legacy_helper_profile');
  });
  test('approved consultants keep consulting; unapproved keep a draft application', () => {
    expect(mapLegacyUser({ user: { role: 'helper', default_mode: 'consultant' }, modeApprovals: [{ mode: 'consultant', status: 'approved' }] }).grants.map((g) => g.capability))
      .toEqual(['helper.offer_services', 'consultant.accept_paying_clients']);
    expect(mapLegacyUser({ user: { role: 'helper', default_mode: 'consultant' } }).drafts).toEqual([{ capability: 'consultant.accept_paying_clients', reason: 'legacy_mode_unapproved' }]);
  });
  test('a historic owner mode is never proof of ownership', () => {
    const r = mapLegacyUser({ user: { role: 'helper', default_mode: 'restaurant_owner' }, ownedBusinessCount: 0 });
    expect(r.grants.map((g) => g.capability)).not.toContain('restaurant.own');
    expect(r.drafts).toEqual([{ capability: 'restaurant.own', reason: 'legacy_owner_mode_without_business' }]);
  });
  test('staff modes without membership and investor modes without audience become exceptions', () => {
    expect(mapLegacyUser({ user: { role: 'helper', default_mode: 'restaurant_staff' } }).exceptions).toEqual([{ reason: 'staff_mode_without_membership' }]);
    expect(mapLegacyUser({ user: { role: 'customer', default_mode: 'investor' } }).exceptions).toEqual([{ reason: 'investor_mode_without_audience' }]);
  });
  test('helper_pro keeps helper access; broker goes to review', () => {
    expect(mapLegacyUser({ user: { role: 'helper_pro', default_mode: 'helper' } }).grants.map((g) => g.capability)).toEqual(['helper.offer_services']);
    expect(mapLegacyUser({ user: { role: 'broker', default_mode: 'customer' } }).exceptions).toEqual([{ reason: 'unmapped_legacy_role' }]);
  });
  test('admins are untouched', () => {
    expect(mapLegacyUser({ user: { role: 'super_admin', default_mode: 'helper' }, helperProfile: true })).toEqual({ grants: [], exceptions: [], drafts: [] });
  });
});
