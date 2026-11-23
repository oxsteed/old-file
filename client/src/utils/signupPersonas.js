import { intentForLegacyMode, joinModeForLegacyMode } from './legacyDeepLinks.js';
import { PERSONA_NAVIGATION_CATALOG } from './personaNavigation.js';

// Signup is an admission-intent chooser, not a role selector. These intents
// cover every family in the navigation catalog so a person can explain their
// future use case without receiving access during account creation.
const PERSONA_SIGNUP_CONFIG = Object.freeze({
  customer: { intent: 'find_help', admission: 'baseline', icon: 'customer', copy: 'customer' },
  'helper': { intent: 'offer_services', admission: 'platform_review', icon: 'helper', copy: 'helper' },
  'business-owner': { intent: 'run_business', admission: 'platform_review', icon: 'business', copy: 'businessOwner' },
  'business-team': { intent: 'join_business_team', admission: 'organization_invitation', icon: 'team', copy: 'businessTeam' },
  'restaurant-owner': { intent: 'run_restaurant', admission: 'platform_review', icon: 'restaurant', copy: 'restaurantOwner' },
  'restaurant-team': { intent: 'join_restaurant_team', admission: 'organization_invitation', icon: 'restaurantTeam', copy: 'restaurantTeam' },
  logistics: { intent: 'ship_goods', admission: 'platform_review', icon: 'logistics', copy: 'logistics' },
  consultant: { intent: 'consult', admission: 'platform_review', icon: 'consultant', copy: 'consultant' },
  'equipment-owner': { intent: 'list_equipment', admission: 'platform_review', icon: 'equipment', copy: 'equipmentOwner' },
  franchise: { intent: 'franchise', admission: 'domain_enrollment', icon: 'franchise', copy: 'franchise' },
  'credit-participant': { intent: 'join_credit', admission: 'domain_enrollment', icon: 'credit', copy: 'creditParticipant' },
  'partner-affiliate': { intent: 'join_partner', admission: 'domain_enrollment', icon: 'partner', copy: 'partnerAffiliate' },
  'workforce-learning': { intent: 'join_workforce', admission: 'domain_enrollment', icon: 'learning', copy: 'workforceLearning' },
  reviewer: { intent: 'request_reviewer', admission: 'staff_provisioning', icon: 'staff', copy: 'reviewer' },
  'support-agent': { intent: 'request_support', admission: 'staff_provisioning', icon: 'staff', copy: 'supportAgent' },
  'operations-staff': { intent: 'request_operations', admission: 'staff_provisioning', icon: 'staff', copy: 'operationsStaff' },
  'device-service-account': { intent: 'request_device', admission: 'nonhuman_provisioning', icon: 'device', copy: 'deviceServiceAccount' },
  // Investor admission is private and invite-only. Keep it in the catalog
  // coverage model for internal/admin flows, but never expose it through the
  // public Join picker or URL intent resolver.
  'investor-reporting': { intent: null, admission: 'admin_invite', icon: 'investor', copy: 'investor', public: false },
});

export const SIGNUP_CATALOG_PERSONAS = Object.freeze(PERSONA_NAVIGATION_CATALOG.map((family) => {
  const config = PERSONA_SIGNUP_CONFIG[family.id];
  if (!config) return null;
  return Object.freeze({ ...family, ...config });
}).filter(Boolean));

// Public signup choices intentionally exclude invite-only admissions. The
// catalog-aware export above lets tests and internal tooling prove that every
// family still has an explicit admission contract without making private
// investor access look publicly selectable.
export const SIGNUP_PERSONAS = Object.freeze(SIGNUP_CATALOG_PERSONAS.filter((persona) => persona.public !== false));

export const SIGNUP_INTENT_VALUES = Object.freeze(SIGNUP_PERSONAS.map(({ intent }) => intent));

export function signupPersonaForIntent(intent) {
  return SIGNUP_PERSONAS.find((persona) => persona.intent === intent) || SIGNUP_PERSONAS[0];
}

// Display grouping only: every catalog path retains the same admission policy.
export const COMMON_SIGNUP_PERSONAS = Object.freeze(SIGNUP_PERSONAS.filter(({ id }) =>
  ['customer', 'helper', 'business-owner'].includes(id)));
export const MORE_SIGNUP_PERSONAS = Object.freeze(SIGNUP_PERSONAS.filter((persona) =>
  !COMMON_SIGNUP_PERSONAS.includes(persona)));

export function signupEntryForParams(params) {
  const rawInvite = params.get('invite');
  const inviteId = rawInvite && /^[A-Za-z0-9-]{1,64}$/.test(rawInvite) ? rawInvite : null;
  const requested = [params.get('goal'), params.get('intent')]
    .map((value) => SIGNUP_PERSONAS.find(({ id, intent }) => value === id || value === intent))
    .find(Boolean);
  const rawMode = params.get('mode')?.trim().toLowerCase();
  const mode = joinModeForLegacyMode(rawMode);
  // Private investor links deliberately land on the customer baseline even
  // though investor is no longer a public Join card. Unknown/provisioned
  // modes still stay unselected rather than inventing an intent.
  const legacyIntent = rawMode === 'investor'
    ? 'find_help'
    : (mode ? intentForLegacyMode(mode) : null);
  const presetIntent = requested?.intent || legacyIntent;
  // An invitation always leads to its server-validated handoff. A URL goal
  // cannot turn it into a professional application or an ownership grant.
  return {
    inviteId,
    intent: inviteId
      ? (presetIntent === 'join_restaurant_team' ? presetIntent : 'join_business_team')
      : presetIntent,
  };
}
