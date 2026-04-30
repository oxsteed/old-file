/** Map DB category → public URL path segment under /legal */
export const LEGAL_CATEGORY_SLUG = {
  terms_of_service: 'terms',
  privacy_policy: 'privacy',
  helper_agreement: 'helper-agreement',
  seller_agreement: 'seller-agreement',
  payment_terms: 'payment-terms',
  dispute_resolution: 'dispute-resolution',
  data_retention: 'data-retention',
  background_check_policy: 'background-checks',
  fcra_compliance: 'fcra',
  incident_response: 'incident-response',
  accessibility_policy: 'accessibility-policy',
};

export const LEGAL_SLUG_TO_CATEGORY = Object.fromEntries(
  Object.entries(LEGAL_CATEGORY_SLUG).map(([cat, slug]) => [slug, cat])
);

/** Base path for deep links (legacy short URLs for common docs) */
export function legalDocumentBasePath(category) {
  if (category === 'terms_of_service') return '/terms';
  if (category === 'privacy_policy') return '/privacy';
  return `/legal/${LEGAL_CATEGORY_SLUG[category] || category}`;
}
