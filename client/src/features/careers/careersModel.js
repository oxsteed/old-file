// Pure helpers for the Careers UI (no React, no network) so they can be
// unit tested with node --test. Copy comes from i18n keys under `careers.`.

export const STAGES = ['received', 'screening', 'interview', 'assessment', 'offer', 'hired', 'rejected', 'withdrawn', 'offer_declined', 'closed_unfilled'];
export const ACTIVE_STAGES = ['received', 'screening', 'interview', 'assessment', 'offer'];
export const NEUTRAL_MOVES = {
  received: ['screening', 'interview'],
  screening: ['interview', 'assessment'],
  interview: ['assessment'],
  assessment: [],
  offer: [],
};
export const REJECTION_REASONS = ['requirements_not_met', 'schedule_mismatch', 'position_filled', 'location_mismatch', 'withdrew_interest', 'no_response', 'other_business_reason'];
export const PAY_PERIODS = ['hourly', 'daily', 'per_shift', 'monthly', 'yearly'];
export const PATH_STAGES = ['shift', 'part_time', 'full_time', 'seasonal', 'temporary', 'contract', 'intern'];
export const EOR_PATH_STAGES = ['shift', 'seasonal', 'temporary'];
export const WORKPLACE_TYPES = ['onsite', 'hybrid', 'remote'];
export const VISIBILITY_LEVELS = ['private', 'apply_only', 'known_businesses', 'searchable'];
export const FACT_TYPES = ['completed_jobs', 'avg_rating', 'on_time_rate', 'response_rate', 'training_completed', 'certificate', 'badge', 'shifts_worked', 'tenure', 'id_verified'];
export const INVITATION_REASONS = ['worked_with_us', 'great_reviews', 'certified', 'skills_match', 'nearby'];
export const ONBOARDING_STEPS = ['membership', 'location', 'pin', 'training', 'documents', 'age_confirmed', 'eor_enrollment', 'first_shift', 'payroll_handoff', 'notify'];
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Localized money; falls back to "USD 15.00" if Intl rejects the currency. */
export function formatMoney(amount, currency = 'USD', locale = 'en') {
  if (amount === null || amount === undefined || amount === '') return '';
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** "$15–$19" style range (pay is required, so both ends are normally set). */
export function formatPayRange(opening, locale = 'en') {
  if (!opening) return '';
  const cur = opening.currency_code || 'USD';
  const min = formatMoney(opening.compensation_min, cur, locale);
  const max = formatMoney(opening.compensation_max, cur, locale);
  if (min && max && min !== max) return `${min}–${max}`;
  return min || max || '';
}

export function formatOfferPay(offer, locale = 'en') {
  if (!offer) return '';
  const cents = offer.pay_cents != null ? Number(offer.pay_cents) : Math.round(Number(offer.compensation || 0) * 100);
  return formatMoney(cents / 100, offer.currency_code || 'USD', locale);
}

/** Date/time in a stated time zone, with the zone shown so nobody guesses. */
export function formatWhen(value, timeZone, locale = 'en') {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timeZone || undefined, timeZoneName: 'short' }).format(d);
  } catch {
    return d.toISOString();
  }
}

export function formatDate(value, locale = 'en') {
  if (!value) return '';
  const d = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return '';
  try { return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(d); } catch { return value; }
}

const list = (v) => (Array.isArray(v) ? v : String(v || '').split(','))
  .map((s) => String(s).trim()).filter(Boolean);

export const EMPTY_OPENING = Object.freeze({
  title: '', department: 'restaurant', path_stage: 'part_time', employment_type: 'part_time', workplace_type: 'onsite',
  country_code: 'US', region: '', city: '', postal_code: '', timezone: '', currency_code: 'USD',
  compensation_min: '', compensation_max: '', compensation_period: 'hourly', work_authorization: 'local_authorized',
  sponsorship_available: false, description: '', requirements: '', benefits_summary: '', schedule_summary: '',
  team_role: 'employee', job_role_code: '', location_ids: [], employer_model: 'direct', allow_guest_applications: false,
  hide_identity_until_offer: false, ai_ranking_enabled: false, background_check_required: false, background_check_package: '',
  background_check_reason: '', required_credentials: '', preferred_credentials: '', required_languages: '',
  applications_close_at: '', is_internal: false, status: 'draft',
});

/** Opening row → editable form values. */
export function openingToForm(o) {
  if (!o) return { ...EMPTY_OPENING };
  const out = { ...EMPTY_OPENING };
  for (const k of Object.keys(out)) if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
  for (const k of ['required_credentials', 'preferred_credentials', 'required_languages']) out[k] = (o[k] || []).join(', ');
  out.location_ids = (o.location_ids || []).map(Number);
  out.applications_close_at = o.applications_close_at ? String(o.applications_close_at).slice(0, 10) : '';
  return out;
}

/** Form values → API payload. Keeps blanks as null so the server validates. */
export function formToOpeningPayload(form, { employerType = 'business' } = {}) {
  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const payload = {
    ...form,
    compensation_min: num(form.compensation_min),
    compensation_max: num(form.compensation_max),
    required_credentials: list(form.required_credentials),
    preferred_credentials: list(form.preferred_credentials),
    required_languages: list(form.required_languages),
    location_ids: (form.location_ids || []).map(Number).filter(Number.isInteger),
    applications_close_at: form.applications_close_at || null,
    job_role_code: form.job_role_code || null,
    postal_code: form.postal_code || null,
    region: form.region || null,
  };
  if (!payload.background_check_required) {
    payload.background_check_package = null;
    payload.background_check_reason = null;
  }
  if (!EOR_PATH_STAGES.includes(payload.path_stage)) payload.employer_model = 'direct';
  if (employerType === 'platform') {
    delete payload.team_role;
    delete payload.location_ids;
    delete payload.employer_model;
  }
  return payload;
}

/** Client-side checks that mirror the server's required fields. */
export function validateOpeningForm(form) {
  const errors = {};
  if (!String(form.title || '').trim()) errors.title = 'required';
  if (form.compensation_min === '' || form.compensation_min === null) errors.compensation_min = 'payRequired';
  if (form.compensation_max === '' || form.compensation_max === null) errors.compensation_max = 'payRequired';
  if (!errors.compensation_min && !errors.compensation_max && Number(form.compensation_min) > Number(form.compensation_max)) errors.compensation_max = 'maxBelowMin';
  if (form.workplace_type !== 'remote' && !form.country_code) errors.country_code = 'required';
  if (form.background_check_required && !String(form.background_check_reason || '').trim()) errors.background_check_reason = 'required';
  return errors;
}

/** Server `fields` (field → message) merged with client error codes for display. */
export function fieldErrorsFrom(err) {
  const body = err?.response?.data || {};
  return body.fields && typeof body.fields === 'object' ? body.fields : {};
}

export function errorMessage(err, fallback) {
  return err?.response?.data?.error || fallback;
}

/** Availability rows [{ day, start, end }] ↔ simple per-day form. */
export function availabilityToForm(rows = []) {
  const out = Object.fromEntries(WEEKDAYS.map((d) => [d, { on: false, start: '09:00', end: '17:00' }]));
  for (const r of rows || []) if (out[r.day]) out[r.day] = { on: true, start: r.start || '09:00', end: r.end || '17:00' };
  return out;
}

export function formToAvailability(form) {
  return WEEKDAYS.filter((d) => form[d]?.on).map((d) => ({ day: d, start: form[d].start, end: form[d].end }));
}

/** What the worker must still do before an offer can be accepted. */
export function offerBlockers(offer, { adultConfirmed, identityVerified }) {
  const out = [];
  if (!adultConfirmed) out.push('age');
  if (!identityVerified) out.push('identity');
  if (offer?.expires_at && new Date(offer.expires_at) <= new Date()) out.push('expired');
  return out;
}

/** Group applications for the pipeline columns. */
export function groupByStage(applications = []) {
  const groups = Object.fromEntries(STAGES.map((s) => [s, []]));
  for (const a of applications) (groups[a.stage] || (groups[a.stage] = [])).push(a);
  return groups;
}

/** Applicant label: number until identity shows (hidden until offer, guest). */
export function applicantLabel(app, t) {
  if (app?.name) return app.name;
  if (app?.first_name || app?.last_name) return [app.first_name, app.last_name].filter(Boolean).join(' ');
  return t('careers.employer.applicantNumber', { number: app?.applicant_number ?? app?.id });
}

/** Neutral reason text for the ranking mode badge. */
export function rankingNotice(ranking) {
  if (!ranking || ranking.mode === 'ai') return null;
  return ranking.reason || 'disabled_globally';
}

export function isEorAllowed(pathStage) {
  return EOR_PATH_STAGES.includes(pathStage);
}

/** A stable idempotency key for one checkout attempt. */
export function idempotencyKey(prefix = 'careers') {
  const rand = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${rand}`;
}
