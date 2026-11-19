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
  'investor-reporting': { intent: 'request_reporting', admission: 'platform_review', icon: 'investor', copy: 'investorReporting' },
  'credit-participant': { intent: 'join_credit', admission: 'domain_enrollment', icon: 'credit', copy: 'creditParticipant' },
  'partner-affiliate': { intent: 'join_partner', admission: 'domain_enrollment', icon: 'partner', copy: 'partnerAffiliate' },
  'workforce-learning': { intent: 'join_workforce', admission: 'domain_enrollment', icon: 'learning', copy: 'workforceLearning' },
  reviewer: { intent: 'request_reviewer', admission: 'staff_provisioning', icon: 'staff', copy: 'reviewer' },
  'support-agent': { intent: 'request_support', admission: 'staff_provisioning', icon: 'staff', copy: 'supportAgent' },
  'operations-staff': { intent: 'request_operations', admission: 'staff_provisioning', icon: 'staff', copy: 'operationsStaff' },
  'device-service-account': { intent: 'request_device', admission: 'nonhuman_provisioning', icon: 'device', copy: 'deviceServiceAccount' },
});

export const SIGNUP_PERSONAS = Object.freeze(PERSONA_NAVIGATION_CATALOG.map((family) => {
  const config = PERSONA_SIGNUP_CONFIG[family.id];
  if (!config) return null;
  return Object.freeze({ ...family, ...config });
}).filter(Boolean));

export const SIGNUP_INTENT_VALUES = Object.freeze(SIGNUP_PERSONAS.map(({ intent }) => intent));

export function signupPersonaForIntent(intent) {
  return SIGNUP_PERSONAS.find((persona) => persona.intent === intent) || SIGNUP_PERSONAS[0];
}

