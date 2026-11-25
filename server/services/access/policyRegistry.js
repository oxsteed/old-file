'use strict';

/**
 * Progressive account access — capability policy registry.
 *
 * One versioned registry for every capability a person can hold beyond the
 * customer access that every active account has (spec: "Capability policy
 * registry"). An entry declares:
 *   - subjectTypes: which typed subject a request/grant may target
 *   - reviewerClass: who owns the decision
 *       'platform'      OxSteed staff holding the admin permission below
 *       'organization'  the business/location's own authority (team flows)
 *   - reviewPermission: admin grant code required for a platform reviewer
 *   - applicantMayRequest: whether self-service applications are accepted
 *   - legacyModes / legacyRoles: compatibility mapping, read only
 *   - form: the public (applicant-safe) question schema
 *   - activationRequirements: separate, domain-owned readiness steps that an
 *     approval does NOT satisfy (e.g. payouts)
 *
 * Public projection (publicPolicy) omits reviewer-only data. Requests record
 * the policy version under which their answers were submitted; a decision
 * re-validates against the current version.
 *
 * Organization memberships (business owner / manager / representative,
 * restaurant roles) are NOT stored as generic grants: their authority stays
 * in businesses / business_members / restaurant tables and is projected by
 * scopeModel (spec: "Proposed storage model").
 */

const CUSTOMER = 'customer';

const SUBJECT_TYPES = Object.freeze(['self', 'business', 'business_proposal', 'restaurant_location']);

const REQUEST_STATUSES = Object.freeze([
  'draft', 'submitted', 'in_review', 'needs_information', 'approved', 'declined', 'withdrawn',
]);
const OPEN_REQUEST_STATUSES = Object.freeze(['draft', 'submitted', 'in_review', 'needs_information']);
const GRANT_STATUSES = Object.freeze(['active', 'suspended', 'revoked', 'expired']);

/** Safe reason codes a reviewer can show to an applicant (localized client-side). */
const PUBLIC_REASON_CODES = Object.freeze([
  'review_complete',
  'service_area_required',
  'service_categories_required',
  'identity_verification_required',
  'business_details_required',
  'ownership_not_verified',
  'duplicate_request',
  'not_eligible_in_market',
  'policy_not_met',
  'other_contact_support',
]);

const answerField = (name, type, opts = {}) => Object.freeze({ name, type, required: !!opts.required, ...opts });

const CAPABILITIES = Object.freeze({
  'helper.offer_services': Object.freeze({
    key: 'helper.offer_services',
    version: 'helper-policy-1',
    intent: 'offer_services',
    subjectTypes: Object.freeze(['self']),
    reviewerClass: 'platform',
    reviewPermission: 'review_access_requests',
    applicantMayRequest: true,
    legacyModes: Object.freeze(['helper']),
    legacyRoles: Object.freeze(['helper']),
    // G-1 (Emile decision, 2026-11-19 — supersedes the delegated restore):
    // OxSteed Credit is the default payout method when Stripe payout setup
    // is absent, and bidding must not be blocked for lack of payout_setup.
    // Offering services is not receiving money: identity + terms activate
    // the capability. The Stripe path still requires payout_setup at money
    // time (Connect charges + payouts, W-9, fresh Didit — see
    // activation.js `payout_setup` evidence, requireTaxIdentity, and the
    // rail engine's Credit default): no Stripe payout moves without it.
    // The setup routes stay carved out via requireHelperSetupCapability so
    // a helper missing identity or terms can still finish activation.
    activationRequirements: Object.freeze(['identity_verified', 'helper_terms']),
    form: Object.freeze({
      fields: Object.freeze([
        answerField('serviceCategories', 'string_list', { required: true, maxItems: 20, maxLength: 80 }),
        answerField('serviceArea', 'service_area', { required: true }),
        answerField('about', 'text', { maxLength: 2000 }),
      ]),
    }),
  }),
  'business.own': Object.freeze({
    key: 'business.own',
    version: 'business-owner-policy-1',
    intent: 'run_business',
    subjectTypes: Object.freeze(['business_proposal', 'business']),
    reviewerClass: 'platform',
    reviewPermission: 'review_access_requests',
    applicantMayRequest: true,
    legacyModes: Object.freeze(['business_owner']),
    legacyRoles: Object.freeze([]),
    // G-1 (Emile decision, 2026-11-19): publishing a business is an
    // offering action, not a money move, so it is not gated on Stripe
    // payout setup. Receiving money still is: creating a scan-to-pay code
    // (routes/qrPayments.js) has its own Connect check, card payments on
    // business invoices assert a Connect destination
    // (businessInvoiceStripeConnectService), and Credit invoice payments
    // settle in OxSteed Credit (businessInvoiceCreditPayService).
    activationRequirements: Object.freeze([]),
    form: Object.freeze({
      fields: Object.freeze([
        answerField('businessName', 'string', { required: true, maxLength: 255 }),
        answerField('businessType', 'enum', { required: true, options: ['llc', 'sole_prop', 'corp', 'partnership', 'other'] }),
        answerField('serviceArea', 'service_area', { required: true }),
        answerField('about', 'text', { maxLength: 2000 }),
      ]),
    }),
  }),
  'restaurant.own': Object.freeze({
    key: 'restaurant.own',
    version: 'restaurant-owner-policy-1',
    intent: 'run_restaurant',
    subjectTypes: Object.freeze(['business_proposal', 'business']),
    reviewerClass: 'platform',
    reviewPermission: 'review_access_requests',
    applicantMayRequest: true,
    legacyModes: Object.freeze(['restaurant_owner']),
    legacyRoles: Object.freeze([]),
    activationRequirements: Object.freeze(['restaurant_activation']),
    form: Object.freeze({
      fields: Object.freeze([
        answerField('restaurantName', 'string', { required: true, maxLength: 255 }),
        answerField('serviceArea', 'service_area', { required: true }),
        answerField('cuisine', 'string', { maxLength: 120 }),
      ]),
    }),
  }),
  'consultant.accept_paying_clients': Object.freeze({
    key: 'consultant.accept_paying_clients',
    version: 'consultant-policy-1',
    intent: 'consult',
    subjectTypes: Object.freeze(['self']),
    reviewerClass: 'platform',
    reviewPermission: 'review_access_requests',
    applicantMayRequest: true,
    legacyModes: Object.freeze(['consultant']),
    legacyRoles: Object.freeze([]),
    // G-1 (Emile decision, 2026-11-19): accepting a paying client is the
    // offering/booking action, analogous to a helper accepting a job, so
    // it is not gated on Stripe payout setup. The payout for the work
    // defaults to OxSteed Credit; any Stripe move at payment time still
    // requires a Connect destination (invoice card payments assert it).
    activationRequirements: Object.freeze([]),
    form: Object.freeze({
      fields: Object.freeze([
        answerField('bio', 'text', { required: true, minLength: 80, maxLength: 2000 }),
        answerField('yearsExperience', 'integer', { required: true, min: 0, max: 60 }),
        answerField('areasOfExpertise', 'string_list', { required: true, maxItems: 20, maxLength: 120 }),
        // Group 10 item 501: consultant-specific application fields, collected
        // at apply time and shown to the reviewer alongside bio/experience.
        // Optional so applications drafted under the earlier form stay
        // submittable; the required core (bio, years, expertise) is unchanged.
        answerField('qualifications', 'text', { maxLength: 2000 }),
        answerField('credentials', 'string_list', { maxItems: 20, maxLength: 120 }),
        answerField('sampleWorkUrl', 'url', { maxLength: 500 }),
      ]),
    }),
  }),
  'tool_owner.list_equipment': Object.freeze({
    key: 'tool_owner.list_equipment',
    version: 'tool-owner-policy-2',
    intent: 'list_equipment',
    subjectTypes: Object.freeze(['self']),
    reviewerClass: 'platform',
    reviewPermission: 'review_access_requests',
    applicantMayRequest: true,
    legacyModes: Object.freeze(['tool_owner']),
    legacyRoles: Object.freeze([]),
    // G-1 (Emile decision, 2026-11-19): listing equipment is an offering
    // action, so it is not gated on Stripe payout setup. Rental payment
    // settlement still goes through the rental payment path, which moves
    // no Stripe money without a payout-ready account.
    activationRequirements: Object.freeze([]),
    // Group 11 item 551: equipment-specific fields. The new fields are
    // required, so applications submitted under tool-owner-policy-1 cannot
    // be approved until the applicant supplies them (the reviewer asks for
    // the missing information; see reviewService policy_changed). Drafts
    // pick the new fields up on their next edit.
    form: Object.freeze({ fields: Object.freeze([
      answerField('serviceArea', 'service_area', { required: true }),
      answerField('equipmentOwned', 'string_list', { required: true, maxItems: 20, maxLength: 120 }),
      answerField('ownershipAttestation', 'enum', { required: true, options: ['owned_outright', 'owned_with_loan', 'borrowed_with_permission'] }),
      answerField('equipmentCondition', 'enum', { required: true, options: ['excellent', 'good', 'fair'] }),
      answerField('pickupLocation', 'service_area', { required: true }),
    ]) }),
  }),
  'logistics.ship': Object.freeze({
    key: 'logistics.ship',
    version: 'logistics-policy-1',
    intent: 'ship_goods',
    subjectTypes: Object.freeze(['self']),
    reviewerClass: 'platform',
    reviewPermission: 'review_access_requests',
    applicantMayRequest: true,
    legacyModes: Object.freeze(['logistics']),
    legacyRoles: Object.freeze([]),
    activationRequirements: Object.freeze([]),
    form: Object.freeze({ fields: Object.freeze([answerField('about', 'text', { maxLength: 2000 })]) }),
  }),
  'investor.reporting': Object.freeze({
    key: 'investor.reporting',
    version: 'investor-policy-2',
    intent: 'request_reporting',
    subjectTypes: Object.freeze(['self']),
    reviewerClass: 'platform',
    reviewPermission: 'review_investor_access',
    // Investor reporting is invite-only. The public access-request flow must
    // never mint this capability; an admin invitation creates an admission
    // record first and review remains the only grant path.
    applicantMayRequest: false,
    legacyModes: Object.freeze([]),
    legacyRoles: Object.freeze([]),
    activationRequirements: Object.freeze([]),
    form: Object.freeze({ fields: Object.freeze([
      answerField('audience', 'string', { required: true, maxLength: 160 }),
      answerField('requestedReports', 'string_list', { required: true, maxItems: 6, maxLength: 80 }),
      answerField('about', 'text', { maxLength: 2000 }),
    ]) }),
  }),
  'investor.participate': Object.freeze({
    key: 'investor.participate',
    version: 'invest-participate-policy-1',
    intent: 'invest_in_entity_opportunities',
    subjectTypes: Object.freeze(['self']),
    reviewerClass: 'platform',
    // OWN reviewer pool: never reuse review_investor_access (reporting).
    reviewPermission: 'review_invest_participation',
    // G-10: participation is per-opportunity through the invest routes only.
    // The generic access-request path must never mint this grant: an empty
    // form sailed through validation, so applicantMayRequest is false and
    // createRequest 403s a generic investor.participate request.
    applicantMayRequest: false,
    // EMPTY legacy mapping: no legacy mode or role grants participation.
    // A legacy `investor` mode or an investor.reporting grant grants nothing
    // here; participation needs its own per-opportunity application, identity
    // and authority verification, eligibility check, and agreement acceptance,
    // rechecked at commit and at closing. ACCESS_INVESTOR_ENFORCEMENT governs
    // investor.reporting only and is never read as a participation gate.
    legacyModes: Object.freeze([]),
    legacyRoles: Object.freeze([]),
    activationRequirements: Object.freeze(['identity_verified', 'authority_verified', 'eligibility_verified', 'agreement_accepted']),
    // Participation applications are per-opportunity through the invest
    // routes (server/routes/invest.js), not through the generic access
    // request form. applicantMayRequest is false (see above), so no generic
    // request can stand in for the per-opportunity checks; the empty form
    // alone never prevented one.
    form: Object.freeze({ fields: Object.freeze([]) }),
  }),
  'franchise.operate': Object.freeze({
    key: 'franchise.operate',
    version: 'franchise-policy-1',
    intent: 'franchise',
    // G-26: one franchisee, two territories. The grant is scoped per
    // territory: subject_type 'franchise_application' with the application
    // id as subject_id, the same shape business subjects already use.
    // Legacy 'self' grants stay valid until sync revokes them when no
    // launched application remains.
    subjectTypes: Object.freeze(['self', 'franchise_application']),
    reviewerClass: 'platform',
    reviewPermission: 'review_franchise_access',
    // Franchise intake keeps its own approved pipeline (routes/franchise.js);
    // the grant is issued only from a current territory assignment.
    applicantMayRequest: false,
    legacyModes: Object.freeze(['franchise_applicant']),
    legacyRoles: Object.freeze([]),
    activationRequirements: Object.freeze(['territory_assignment']),
    form: Object.freeze({ fields: Object.freeze([]) }),
  }),
});

/** Signup intents a person may express. Each maps to at most one capability. */
const SIGNUP_INTENTS = Object.freeze({
  find_help: null,
  offer_services: 'helper.offer_services',
  run_business: 'business.own',
  run_restaurant: 'restaurant.own',
  // These are descriptive admissions, not grants. Organization, staff,
  // domain-owned, and nonhuman flows are completed by their owning system.
  join_business_team: null,
  join_restaurant_team: null,
  ship_goods: 'logistics.ship',
  consult: 'consultant.accept_paying_clients',
  list_equipment: 'tool_owner.list_equipment',
  franchise: null,
  // Private investor invitations are the only admission mechanism. A public
  // signup intent is intentionally descriptive customer intent, not a request.
  request_reporting: null,
  join_credit: null,
  join_partner: null,
  join_workforce: null,
  request_reviewer: null,
  request_support: null,
  request_operations: null,
  request_device: null,
});

/** Legacy defaultMode / accountType values accepted from old clients → intent. */
const LEGACY_MODE_TO_INTENT = Object.freeze({
  customer: 'find_help',
  restaurant_customer: 'find_help',
  life_only: 'find_help',
  helper: 'offer_services',
  business_owner: 'run_business',
  restaurant_owner: 'run_restaurant',
  consultant: 'consult',
  tool_owner: 'list_equipment',
  equipment_owner: 'list_equipment',
  logistics: 'ship_goods',
  delivery: 'ship_goods',
  driver: 'ship_goods',
  franchise_applicant: 'franchise',
  credit_participant: 'join_credit',
  credit_member: 'join_credit',
  partner: 'join_partner',
  affiliate: 'join_partner',
  workforce: 'join_workforce',
  learner: 'join_workforce',
  instructor: 'join_workforce',
});

function getCapability(key) {
  return Object.prototype.hasOwnProperty.call(CAPABILITIES, key) ? CAPABILITIES[key] : null;
}

function listCapabilities() {
  return Object.values(CAPABILITIES);
}

function isKnownCapability(key) {
  return key === CUSTOMER || getCapability(key) !== null;
}

/** Applicant-safe projection: never includes reviewer permission or legacy mapping. */
function publicPolicy(key) {
  const cap = getCapability(key);
  if (!cap) return null;
  return {
    capability: cap.key,
    policyVersion: cap.version,
    subjectTypes: [...cap.subjectTypes],
    applicantMayRequest: cap.applicantMayRequest,
    activationRequirements: [...cap.activationRequirements],
    form: { fields: cap.form.fields.map((f) => ({ ...f })) },
    statuses: [...REQUEST_STATUSES],
  };
}

/**
 * Normalize a signup intent from a new or legacy client. Unknown, forged, or
 * privileged values collapse to `find_help`; nothing here grants access.
 */
function normalizeSignupIntent(raw) {
  if (typeof raw !== 'string') return 'find_help';
  const v = raw.trim().toLowerCase();
  if (v === 'request_reporting' || v === 'investor') return 'find_help';
  if (Object.prototype.hasOwnProperty.call(SIGNUP_INTENTS, v)) return v;
  if (Object.prototype.hasOwnProperty.call(LEGACY_MODE_TO_INTENT, v)) return LEGACY_MODE_TO_INTENT[v];
  return 'find_help';
}

function capabilityForIntent(intent) {
  return SIGNUP_INTENTS[normalizeSignupIntent(intent)] || null;
}

module.exports = {
  CUSTOMER,
  SUBJECT_TYPES,
  REQUEST_STATUSES,
  OPEN_REQUEST_STATUSES,
  GRANT_STATUSES,
  PUBLIC_REASON_CODES,
  CAPABILITIES,
  SIGNUP_INTENTS,
  LEGACY_MODE_TO_INTENT,
  getCapability,
  listCapabilities,
  isKnownCapability,
  publicPolicy,
  normalizeSignupIntent,
  capabilityForIntent,
};
