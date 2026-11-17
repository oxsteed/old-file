// Product metadata only. Never use this catalog to authorize an action.
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export const PERSONA_CATALOG_VERSION = 1;
export const PERSONA_CLASSIFICATIONS = Object.freeze(['code-backed', 'feature-backed', 'planned', 'needs-verification']);
export const INVESTOR_PRODUCT_INTENT = freeze({ target: 'eligible-entities-on-oxsteed', contributionMethod: 'oxsteed-credit-only', investsInOxsteed: false });
const definitions = [
  ['customer', 'customer', 'code-backed', 'self', 'server/services/access/resolver.js'],
  ['helper', 'helper', 'code-backed', 'self', 'server/services/access/policyRegistry.js'],
  ['business-owner', 'businessOwner', 'code-backed', 'business', 'server/services/access/businessGate.js'],
  ['business-team', 'businessTeam', 'code-backed', 'business', 'server/routes/businessTeam.js'],
  ['restaurant-owner', 'restaurantOwner', 'code-backed', 'business', 'server/services/access/policyRegistry.js'],
  ['restaurant-team', 'restaurantTeam', 'code-backed', 'restaurant', 'server/utils/modeRole.js'],
  ['restaurant-runner', 'restaurantRunner', 'code-backed', 'restaurant-location', 'server/controllers/runnerWorkspaceController.js'],
  ['logistics-operator', 'logisticsOperator', 'code-backed', 'self', 'server/services/access/policyRegistry.js'],
  ['delivery-driver', 'deliveryDriver', 'code-backed', 'delivery-assignment', 'server/routes/localDelivery.js'],
  ['consultant', 'consultant', 'code-backed', 'self', 'server/services/access/consultantGate.js'],
  ['equipment-owner', 'equipmentOwner', 'code-backed', 'self', 'server/services/access/policyRegistry.js'],
  ['franchise-participant', 'franchiseParticipant', 'code-backed', 'territory', 'server/services/access/policyRegistry.js'],
  ['entity-investor', 'entityInvestor', 'needs-verification', 'investment-relationship', 'server/services/invest'],
  ['entity-fundraising-representative', 'entityFundraisingRepresentative', 'needs-verification', 'entity-opportunity', 'server/services/invest'],
  ['partner-affiliate', 'partnerAffiliate', 'feature-backed', 'program', 'server/routes/partners.js'],
  ['workforce-learner', 'workforceLearner', 'feature-backed', 'program', 'server/routes/workforce.js'],
  ['internal-employee', 'internalEmployee', 'code-backed', 'department', 'server/utils/internalWorkspaces.js'],
  ['platform-administrator', 'platformAdministrator', 'code-backed', 'assigned-administration', 'server/services/corporateRolesService.js'],
];
export const PERSONA_FAMILIES = Object.freeze(definitions.map(([id]) => id));
export const PERSONA_CATALOG = freeze(definitions.map(([id, key, classification, scope, evidence]) => ({
  id, family: id, actorKind: 'human', classification, scope,
  labelKey: `personaExplorer.entries.${key}.label`,
  purposeKey: `personaExplorer.entries.${key}.purpose`, evidence: [evidence],
})));
const byId = new Map(PERSONA_CATALOG.map(entry => [entry.id, entry]));
export function getPersona(id) {
  return typeof id === 'string' ? byId.get(id) || null : null;
}
function normalize(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();
}
// Host supplies translated labels. No user profile, storage, API or permission writes.
export function searchPersonas({ query = '', family = null, classification = null, translate = key => key } = {}) {
  const tokens = normalize(query).split(/\s+/u).filter(Boolean);
  return PERSONA_CATALOG.filter(entry => {
    if (family != null && entry.family !== family) return false;
    if (classification != null && entry.classification !== classification) return false;
    const text = normalize([entry.id, entry.family, entry.classification, entry.scope, translate(entry.labelKey), translate(entry.purposeKey)].join(' '));
    return tokens.every(token => text.includes(token));
  });
}
