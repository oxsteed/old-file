// Pure helpers for editing a posted job (JobEditPage, job detail, admin tools).
// Validation comes from the shared schema so client and server agree on every
// rule and error code (see src/shared/jobSchema.js).
import {
  JOB_FIELD_RULES, LOCKED_AFTER_ACCEPTANCE, MAX_BUDGET_CENTS, MATERIAL_FIELDS,
  diffJobFields, normalizeJobInput, validateJobFields,
} from '../shared/jobSchema.js';

export const OPEN_JOB_STATUSES = Object.freeze(['published', 'matched', 'negotiating']);
export const OWNER_EDITABLE_STATUSES = Object.freeze(['draft', ...OPEN_JOB_STATUSES]);
export const ACCEPTED_JOB_STATUSES = Object.freeze(['accepted', 'in_progress']);

// Server error codes that map to localized jobEdit.errors.* messages.
export const JOB_EDIT_ERROR_CODES = Object.freeze([
  'required', 'too_short', 'too_long', 'invalid', 'invalid_option', 'budget_negative', 'budget_too_large',
  'out_of_range', 'budget_order', 'coordinates_pair', 'in_past', 'too_many', 'not_editable', 'locked_after_acceptance',
]);

// Request-level failures that map to localized jobEdit.conflict.* / jobEdit.failures.* copy.
export const JOB_EDIT_FAILURES = Object.freeze({
  precondition_failed: 'conflict',
  version_conflict: 'conflict',
  precondition_required: 'conflict',
  job_not_editable: 'notEditable',
  material_edit_limit: 'materialLimit',
  job_not_found: 'notFound',
  impersonation_blocked: 'impersonation',
  rate_limited: 'rateLimited',
});

const text = (v) => (v === null || v === undefined ? '' : String(v));
const pad = (n) => String(n).padStart(2, '0');

function centsOf(job, field) {
  const cents = job?.[`${field}_cents`];
  if (cents !== null && cents !== undefined && cents !== '' && Number.isFinite(Number(cents))) return Number(cents);
  const dollars = job?.[field];
  if (dollars !== null && dollars !== undefined && dollars !== '' && Number.isFinite(Number(dollars))) return Math.round(Number(dollars) * 100);
  return null;
}

export function centsToInput(cents) {
  if (cents === null || cents === undefined) return '';
  const value = Number(cents) / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function inputToCents(value) {
  const raw = text(value).trim().replace(/[,\s]/g, '');
  if (!raw) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(raw)) return Number.NaN;
  return Math.round(Number(raw) * 100);
}

/** Owner's view of the job → editable form state. Uses original (untranslated) text. */
export function formFromJob(job) {
  const j = job || {};
  let scheduledDate = '';
  let scheduledTime = '';
  if (j.scheduled_start_at && Number.isFinite(Date.parse(j.scheduled_start_at))) {
    const when = new Date(j.scheduled_start_at);
    if (j.scheduled_precision === 'date') {
      scheduledDate = when.toISOString().slice(0, 10);
    } else {
      scheduledDate = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
      scheduledTime = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
    }
  } else if (j.scheduled_date) {
    scheduledDate = text(j.scheduled_date).slice(0, 10);
    scheduledTime = j.scheduled_time ? text(j.scheduled_time).slice(0, 5) : '';
  }
  return {
    title: text(j.original_title ?? j.title),
    description: text(j.original_description ?? j.description),
    category_name: text(j.original_category_name ?? j.category_name),
    budget_type: JOB_FIELD_RULES.budget_type.options.includes(j.budget_type) ? j.budget_type : 'open',
    budget_min: centsToInput(centsOf(j, 'budget_min')),
    budget_max: centsToInput(centsOf(j, 'budget_max')),
    urgency: JOB_FIELD_RULES.urgency.options.includes(j.urgency) ? j.urgency : 'flexible',
    site_access: JOB_FIELD_RULES.site_access.options.includes(j.site_access) ? j.site_access : 'easy',
    recurrence: JOB_FIELD_RULES.recurrence.options.includes(j.recurrence) ? j.recurrence : 'none',
    scheduled_date: scheduledDate,
    scheduled_time: scheduledTime,
    location_address: text(j.location_address),
    location_city: text(j.location_city),
    location_state: text(j.location_state),
    location_zip: text(j.location_zip),
    location_country: text(j.location_country),
    notes: text(j.notes),
    private_notes: text(j.private_notes),
  };
}

/** Canonical values for a form (shape compatible with the shared schema). */
export function canonicalFromForm(form) {
  const f = form || {};
  const blankToNull = (v) => (text(v).trim() === '' ? null : text(v).trim());
  const budgetType = f.budget_type || 'open';
  let scheduledStartAt = null;
  let scheduledPrecision = null;
  if (text(f.scheduled_date).trim()) {
    const date = text(f.scheduled_date).trim();
    const time = text(f.scheduled_time).trim();
    if (time) {
      const local = new Date(`${date}T${time}:00`);
      scheduledStartAt = Number.isFinite(local.getTime()) ? local.toISOString() : `${date}T${time}`;
      scheduledPrecision = 'datetime';
    } else {
      scheduledStartAt = `${date}T09:00:00.000Z`;
      scheduledPrecision = 'date';
    }
  }
  const min = budgetType === 'open' ? null : inputToCents(f.budget_min);
  let max = budgetType === 'open' ? null : inputToCents(f.budget_max);
  // Fixed and hourly budgets are a single amount; keep max in step with min.
  if (budgetType === 'fixed' || budgetType === 'hourly') max = min;
  return {
    title: text(f.title).trim(),
    description: text(f.description).trim(),
    category_name: blankToNull(f.category_name),
    budget_type: budgetType,
    budget_min_cents: min,
    budget_max_cents: max,
    urgency: f.urgency,
    site_access: f.site_access,
    recurrence: f.recurrence,
    scheduled_start_at: scheduledStartAt,
    scheduled_precision: scheduledPrecision,
    location_address: blankToNull(f.location_address),
    location_city: text(f.location_city).trim(),
    location_state: blankToNull(f.location_state),
    location_zip: blankToNull(f.location_zip),
    location_country: text(f.location_country).trim(),
    notes: blankToNull(f.notes),
    private_notes: blankToNull(f.private_notes),
  };
}

/**
 * JSON merge-patch of only what the user changed. Locked fields are left out
 * once a helper is hired. Returns { patch, changedFields, material, errors }.
 */
export function buildJobPatch(job, form, { now = Date.now() } = {}) {
  const before = canonicalFromForm(formFromJob(job));
  const after = canonicalFromForm(form);
  const accepted = ACCEPTED_JOB_STATUSES.includes(job?.status);
  const candidate = {};
  for (const key of Object.keys(after)) {
    if (accepted && LOCKED_AFTER_ACCEPTANCE.includes(key)) continue;
    candidate[key] = after[key];
  }
  const changes = diffJobFields(before, candidate);
  // Precision only matters alongside the timestamp.
  if (changes.scheduled_precision && !changes.scheduled_start_at) delete changes.scheduled_precision;
  if (changes.scheduled_start_at) changes.scheduled_precision = { from: before.scheduled_precision, to: after.scheduled_precision };
  const patch = {};
  for (const key of Object.keys(changes)) patch[key] = candidate[key];
  const { patch: normalized } = normalizeJobInput(patch, { mode: 'merge' });
  const errors = validateJobFields(normalized, { mode: 'edit', current: before, now });
  return {
    patch: normalized,
    changedFields: Object.keys(normalized),
    material: Object.keys(normalized).some((key) => MATERIAL_FIELDS.includes(key)),
    errors,
  };
}

/** Form field that should show a schema error for a canonical field. */
export function formFieldFor(field) {
  if (field === 'budget_min_cents') return 'budget_min';
  if (field === 'budget_max_cents') return 'budget_max';
  if (field === 'scheduled_start_at' || field === 'scheduled_precision') return 'scheduled_date';
  if (field === 'location_lat' || field === 'location_lng') return 'location_address';
  return field;
}

export function errorKey(code) {
  return JOB_EDIT_ERROR_CODES.includes(code) ? `jobEdit.errors.${code}` : 'jobEdit.errors.invalid';
}

/** Map server/client field errors to { formField: i18nKey }. */
export function fieldErrorKeys(fields) {
  const out = {};
  for (const [field, code] of Object.entries(fields || {})) {
    const target = formFieldFor(field);
    if (!out[target]) out[target] = errorKey(String(code));
  }
  return out;
}

/** Classify a failed PATCH so the page can render the right recovery. */
export function classifyEditError(error) {
  const status = error?.response?.status;
  const body = error?.response?.data || {};
  const code = body.code || (status === 412 ? 'precondition_failed' : status === 429 ? 'rate_limited' : null);
  if (status === 422 && body.fields) return { kind: 'fields', fields: fieldErrorKeys(body.fields) };
  if (code && JOB_EDIT_FAILURES[code]) return { kind: JOB_EDIT_FAILURES[code], code };
  if (status === 403) return { kind: 'impersonation', code: 'forbidden' };
  if (status === 404) return { kind: 'notFound', code: 'job_not_found' };
  return { kind: 'unknown', code: code || 'unknown' };
}

export function canEditJob(job, user) {
  if (!job || !user) return false;
  if (job.can_edit === true) return true;
  if (job.can_edit === false) return false;
  return String(job.client_id ?? '') !== '' && String(job.client_id) === String(user.id) && OWNER_EDITABLE_STATUSES.includes(job.status);
}

/** Helper's own pending bid that must be reconfirmed after a material edit. */
export function bidNeedingReconfirm(bids, user, job) {
  if (!user || !Array.isArray(bids)) return null;
  return bids.find((bid) => bid && String(bid.helper_id) === String(user.id) && bid.status === 'pending'
    && (bid.needs_reconfirm === true || (job?.revision != null && bid.job_revision != null && Number(bid.job_revision) < Number(job.revision)))) || null;
}

export const SCHEMA_LIMITS = Object.freeze({
  titleMin: JOB_FIELD_RULES.title.min,
  titleMax: JOB_FIELD_RULES.title.max,
  descriptionMin: JOB_FIELD_RULES.description.min,
  descriptionMax: JOB_FIELD_RULES.description.max,
  notesMax: JOB_FIELD_RULES.notes.max,
  maxBudget: MAX_BUDGET_CENTS / 100,
});

// PostJobPage keeps camelCase form keys; server field codes land on them.
const POST_JOB_FIELD_MAP = Object.freeze({
  title: 'title', description: 'description', category_name: 'categoryId',
  location_city: 'locationCity', location: 'locationCity', location_country: 'locationCountry',
});

/** Server 422 `fields` ({ field: code }) → PostJobPage errors ({ formKey: message }). */
export function postJobFieldErrors(fields, t) {
  const out = {};
  const other = [];
  for (const [field, code] of Object.entries(fields || {})) {
    const message = t(errorKey(String(code)), { field: t(`jobEdit.fields.${fieldLabelKey(field)}`) });
    const key = POST_JOB_FIELD_MAP[field];
    if (key) { if (!out[key]) out[key] = message; } else other.push(`${t(`jobEdit.fields.${fieldLabelKey(field)}`)}: ${message}`);
  }
  if (other.length) out.submit = other.join(' ');
  return out;
}

export function fieldLabelKey(field) {
  const map = {
    title: 'title', description: 'description', category_name: 'category', budget_type: 'budgetType',
    budget_min_cents: 'budgetMin', budget_max_cents: 'budgetMax', urgency: 'urgency', site_access: 'siteAccess',
    recurrence: 'recurrence', notes: 'notes', private_notes: 'privateNotes', location_address: 'address',
    location_city: 'city', location: 'city', location_state: 'state', location_zip: 'zip', location_country: 'country',
    location_lat: 'address', location_lng: 'address', scheduled_start_at: 'schedule', scheduled_precision: 'schedule',
    requirements: 'requirements', required_skills: 'requiredSkills',
  };
  return map[field] || 'other';
}
