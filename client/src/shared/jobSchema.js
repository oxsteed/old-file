// Shared job field schema. The server keeps a behaviourally identical CommonJS
// copy in server/validation/jobSchema.js; client/scripts/jobSchema.test.mjs
// proves both copies produce identical results. Error values are stable codes
// that the client localizes under jobEdit.errors.<code>.

export const JOB_SCHEMA_VERSION = 1;
export const MAX_BUDGET_CENTS = 1_000_000_000;
export const SCHEDULE_PAST_TOLERANCE_MS = 5 * 60 * 1000;

export const JOB_FIELD_RULES = Object.freeze({
  title: { type: 'string', required: true, min: 10, max: 255 },
  description: { type: 'string', required: true, min: 50, max: 10000 },
  category_name: { type: 'string', max: 100, nullable: true },
  budget_type: { type: 'enum', options: ['open', 'fixed', 'hourly', 'range'] },
  budget_min_cents: { type: 'cents', nullable: true },
  budget_max_cents: { type: 'cents', nullable: true },
  urgency: { type: 'enum', options: ['asap', 'this_week', 'this_month', 'flexible'] },
  site_access: { type: 'enum', options: ['easy', 'lockbox', 'schedule'] },
  recurrence: { type: 'enum', options: ['none', 'weekly', 'biweekly', 'monthly'] },
  notes: { type: 'string', max: 2000, nullable: true },
  private_notes: { type: 'string', max: 2000, nullable: true },
  location_address: { type: 'string', max: 500, nullable: true },
  location_city: { type: 'string', required: true, min: 1, max: 100 },
  location_state: { type: 'string', max: 100, nullable: true },
  location_zip: { type: 'string', max: 10, nullable: true },
  location_country: { type: 'string', required: true, min: 1, max: 100 },
  location_lat: { type: 'number', min: -90, max: 90, nullable: true },
  location_lng: { type: 'number', min: -180, max: 180, nullable: true },
  scheduled_start_at: { type: 'datetime', nullable: true },
  scheduled_precision: { type: 'enum', options: ['date', 'datetime'], nullable: true },
  requirements: { type: 'array', max: 30 },
  required_skills: { type: 'array', max: 20 },
});

export const EDITABLE_FIELDS = Object.freeze(Object.keys(JOB_FIELD_RULES));

// Changes to these fields alter price, scope, time, or place. When bids exist
// they start a new job revision and every pending bid must be reconfirmed.
export const MATERIAL_FIELDS = Object.freeze([
  'title', 'description', 'category_name', 'budget_type', 'budget_min_cents', 'budget_max_cents',
  'urgency', 'site_access', 'recurrence', 'location_address', 'location_city', 'location_state',
  'location_zip', 'location_country', 'location_lat', 'location_lng', 'scheduled_start_at',
  'scheduled_precision', 'requirements', 'required_skills',
]);

// Money and scope are fixed once a helper is hired; use a change order.
export const LOCKED_AFTER_ACCEPTANCE = Object.freeze([
  'budget_type', 'budget_min_cents', 'budget_max_cents', 'description', 'category_name',
  'requirements', 'required_skills', 'recurrence',
]);

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function dollarsToCents(value) {
  if (blank(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : value; } catch { return value; }
  }
  return value;
}

/**
 * Map request input (canonical names or legacy aliases) to canonical fields.
 * Only keys present in the input appear in the result.
 * mode 'merge' (PATCH): null clears a field. mode 'legacy' (PUT/create):
 * null/empty values are ignored, matching the historical COALESCE behaviour.
 */
export function normalizeJobInput(input, { mode = 'merge', current = null } = {}) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  const unknown = [];
  const legacy = mode === 'legacy';
  const aliases = new Set(['category', 'budget', 'budget_min', 'budget_max', 'scheduled_date', 'scheduled_time', 'priority',
    'expected_version', 'reason', 'currency_code']);

  for (const key of Object.keys(src)) {
    if (!has(JOB_FIELD_RULES, key) && !aliases.has(key)) unknown.push(key);
  }
  for (const key of EDITABLE_FIELDS) {
    if (!has(src, key)) continue;
    let value = src[key];
    if (typeof value === 'string' && JOB_FIELD_RULES[key].type === 'string') value = value.trim();
    if (JOB_FIELD_RULES[key].type === 'array') value = parseJsonArray(value);
    if ((JOB_FIELD_RULES[key].type === 'number' || JOB_FIELD_RULES[key].type === 'cents') && typeof value === 'string' && value.trim() !== '') value = Number(value);
    if (legacy && blank(value)) continue;
    out[key] = blank(value) ? null : value;
  }
  if (!has(out, 'category_name') && has(src, 'category') && !(legacy && blank(src.category))) {
    out.category_name = blank(src.category) ? null : String(src.category).trim();
  }
  const single = has(src, 'budget') ? dollarsToCents(src.budget) : undefined;
  for (const [alias, field] of [['budget_min', 'budget_min_cents'], ['budget_max', 'budget_max_cents']]) {
    if (has(out, field)) continue;
    if (has(src, alias) && !(legacy && blank(src[alias]))) out[field] = dollarsToCents(src[alias]);
    else if (single !== undefined && !(legacy && single === null)) out[field] = single;
  }
  if (!has(out, 'urgency') && has(src, 'priority')) {
    if (src.priority === 'urgent') out.urgency = 'asap';
    else if (src.priority === 'normal' && current?.urgency === 'asap') out.urgency = 'flexible';
  }
  if (!has(out, 'scheduled_start_at') && (has(src, 'scheduled_date') || has(src, 'scheduled_time'))) {
    const date = src.scheduled_date;
    const time = src.scheduled_time;
    if (blank(date) && blank(time)) {
      if (!legacy) { out.scheduled_start_at = null; out.scheduled_precision = null; }
    } else if (!blank(date) && /^\d{4}-\d{2}-\d{2}$/.test(String(date).trim())) {
      const t = !blank(time) && /^\d{2}:\d{2}$/.test(String(time).trim()) ? String(time).trim() : null;
      out.scheduled_start_at = `${String(date).trim()}T${t || '09:00'}:00.000Z`;
      out.scheduled_precision = t ? 'datetime' : 'date';
    } else if (!blank(date)) {
      out.scheduled_start_at = String(date).trim();
      out.scheduled_precision = 'datetime';
    } else {
      out.scheduled_start_at = String(time).trim();
      out.scheduled_precision = 'datetime';
    }
  }
  if (has(out, 'scheduled_start_at') && !has(out, 'scheduled_precision') && out.scheduled_start_at !== null) {
    out.scheduled_precision = 'datetime';
  }
  if (has(out, 'scheduled_start_at') && out.scheduled_start_at === null) out.scheduled_precision = null;
  if (has(out, 'budget_type') && out.budget_type === 'open') {
    out.budget_min_cents = null;
    out.budget_max_cents = null;
  }
  return { patch: out, unknown };
}

function checkField(key, value, rule) {
  if (value === null) return rule.required ? 'required' : (rule.nullable || rule.type === 'array' ? null : 'required');
  switch (rule.type) {
    case 'string':
      if (typeof value !== 'string') return 'invalid';
      if (rule.min && value.length < rule.min) return 'too_short';
      if (rule.max && value.length > rule.max) return 'too_long';
      return null;
    case 'enum':
      return rule.options.includes(value) ? null : 'invalid_option';
    case 'cents':
      if (typeof value !== 'number' || !Number.isInteger(value)) return 'invalid';
      if (value < 0) return 'budget_negative';
      if (value > MAX_BUDGET_CENTS) return 'budget_too_large';
      return null;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'invalid';
      if (value < rule.min || value > rule.max) return 'out_of_range';
      return null;
    case 'datetime':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? null : 'invalid';
    case 'array':
      if (!Array.isArray(value)) return 'invalid';
      return value.length > rule.max ? 'too_many' : null;
    default:
      return 'invalid';
  }
}

/**
 * Validate canonical fields. In 'create' mode required fields must be present;
 * in 'edit' mode only provided keys are checked, and cross-field rules use the
 * merged result of current + patch. Returns { [field]: code }.
 */
export function validateJobFields(patch, { mode = 'edit', current = {}, now = Date.now() } = {}) {
  const errors = {};
  const cur = current || {};
  for (const [key, rule] of Object.entries(JOB_FIELD_RULES)) {
    if (has(patch, key)) {
      const code = checkField(key, patch[key], rule);
      if (code) errors[key] = code;
    } else if (mode === 'create' && rule.required) {
      errors[key] = 'required';
    }
  }
  const merged = { ...cur, ...patch };
  const budgetType = merged.budget_type || 'open';
  const min = merged.budget_min_cents;
  const max = merged.budget_max_cents;
  const budgetTouched = ['budget_type', 'budget_min_cents', 'budget_max_cents'].some((k) => has(patch, k)) || mode === 'create';
  if (budgetTouched && !errors.budget_min_cents && !errors.budget_max_cents) {
    if ((budgetType === 'fixed' || budgetType === 'hourly' || budgetType === 'range') && (min === null || min === undefined)) {
      errors.budget_min_cents = 'required';
    } else if (budgetType === 'range' && (max === null || max === undefined)) {
      errors.budget_max_cents = 'required';
    } else if (min !== null && min !== undefined && max !== null && max !== undefined && min > max) {
      errors.budget_max_cents = 'budget_order';
    }
  }
  const latTouched = has(patch, 'location_lat') || has(patch, 'location_lng');
  if (latTouched && !errors.location_lat && !errors.location_lng) {
    const lat = merged.location_lat;
    const lng = merged.location_lng;
    // Coordinates move as a pair: a lone lat/lng would silently pair with the
    // stale partner and misplace the job.
    const bothSent = has(patch, 'location_lat') && has(patch, 'location_lng');
    if (!bothSent || (lat === null || lat === undefined) !== (lng === null || lng === undefined)) errors.location_lat = 'coordinates_pair';
  }
  if (has(patch, 'scheduled_start_at') && patch.scheduled_start_at !== null && !errors.scheduled_start_at) {
    const when = Date.parse(patch.scheduled_start_at);
    const precision = merged.scheduled_precision || 'datetime';
    const floor = precision === 'date'
      ? Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()) - 24 * 3600 * 1000
      : now - SCHEDULE_PAST_TOLERANCE_MS;
    if (when < floor) errors.scheduled_start_at = 'in_past';
  }
  return errors;
}

/** Fields whose value differs between current and patch (deep for arrays/objects). */
export function diffJobFields(current, patch) {
  const changes = {};
  for (const key of Object.keys(patch)) {
    const before = current?.[key] === undefined ? null : current[key];
    const after = patch[key] === undefined ? null : patch[key];
    if (!sameValue(key, before, after)) changes[key] = { from: before, to: after };
  }
  return changes;
}

function sameValue(key, a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const rule = JOB_FIELD_RULES[key];
  if (rule?.type === 'datetime') return Date.parse(a) === Date.parse(b);
  if (rule?.type === 'number' || rule?.type === 'cents') return Number(a) === Number(b);
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isMaterialChange(changes) {
  return Object.keys(changes || {}).some((key) => MATERIAL_FIELDS.includes(key));
}
