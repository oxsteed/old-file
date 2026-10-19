// Deep link from a dashboard KPI into the governed query builder's
// underlying-record evidence. Only link a card whose value is computed by
// the same registry definition, window and currency as the builder metric
// (parity-tested server-side); the builder rechecks the admin's grant and
// shows a localized permission message when it is missing.
export const ANALYTICS_EVIDENCE_PATH = '/admin/analytics/query-builder';

export function analyticsEvidenceHref(metric, period = '30d', filters = null) {
  const query = { metric, period, evidence: true };
  if (filters && Object.keys(filters).length) query.filters = filters;
  return `${ANALYTICS_EVIDENCE_PATH}?q=${encodeURIComponent(JSON.stringify(query))}`;
}
