// Display helpers for job revision history (owner, bidder, and admin views).
export const REVISION_FIELD_KEYS = Object.freeze({
  title: 'title', description: 'description', category_name: 'category', budget_type: 'budgetType',
  budget_min_cents: 'budgetMin', budget_max_cents: 'budgetMax', job_value_cents: 'jobValue', urgency: 'urgency',
  site_access: 'siteAccess', recurrence: 'recurrence', notes: 'notes', private_notes: 'privateNotes',
  location_address: 'address', location_city: 'city', location_state: 'state', location_zip: 'zip',
  location_country: 'country', location_lat: 'address', location_lng: 'address',
  scheduled_start_at: 'schedule', scheduled_precision: 'schedule', requirements: 'requirements',
  required_skills: 'requiredSkills',
});

export const REVISION_SOURCES = Object.freeze(['owner', 'admin', 'rollback', 'change_order', 'system']);

/** Unique localized-field keys for a revision's changes, in a stable order. */
export function revisionFieldKeys(changes) {
  const seen = new Set();
  for (const key of Object.keys(changes || {})) {
    seen.add(REVISION_FIELD_KEYS[key] || 'other');
  }
  return [...seen];
}

export function revisionSourceKey(source) {
  return REVISION_SOURCES.includes(source) ? source : 'system';
}

/** Short display value; money is in cents. */
export function revisionValue(field, value, { formatMoney, formatDate, currency = 'USD' } = {}) {
  if (value === null || value === undefined || value === '') return '—';
  if (/_cents$/.test(field) && Number.isFinite(Number(value))) {
    return formatMoney ? formatMoney(Number(value) / 100, { currency }) : (Number(value) / 100).toFixed(2);
  }
  if (field === 'scheduled_start_at' && formatDate) return formatDate(value, { month: 'short', hour: 'numeric', minute: '2-digit' });
  if (Array.isArray(value)) return String(value.length);
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}
