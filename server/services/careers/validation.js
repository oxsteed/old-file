'use strict';

// Input validation for careers (fixes C-09, C-15; Q12 pay required).
// Every parser either returns a clean value or records a field error; the
// caller throws one 400 with all field errors at once.

const { AppError } = require('../../middleware/errorHandler');
const countriesUtil = require('../../utils/countries');
const {
  PATH_STAGES,
  EOR_PATH_STAGES,
  EMPLOYER_MODELS,
  WORKPLACE_TYPES,
  DEPARTMENTS,
  TEAM_ROLES,
  COMPENSATION_PERIODS,
  OPENING_WORK_AUTHORIZATION,
  EMPLOYMENT_TYPES,
  LOCALES,
} = require('../careerCatalog');

const MAX_PAY = 100_000_000; // 100M in major units: anything above is a typo.

class FieldErrors {
  constructor() { this.fields = {}; }
  add(field, message) { if (!this.fields[field]) this.fields[field] = message; }
  get any() { return Object.keys(this.fields).length > 0; }
  throwIfAny(message = 'Validation failed') {
    if (this.any) throw new AppError(message, 400, 'validation_failed', this.fields);
  }
}

function text(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\u0000/g, '').trim().slice(0, max);
}

function optionalText(value, max) {
  const t = text(value, max);
  return t || null;
}

function bool(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'on';
}

function isValidTimeZone(tz) {
  if (!tz || typeof tz !== 'string' || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Returns a finite non-negative number, null for blank, or undefined (+error) for garbage.
function money(value, field, errors) {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) { errors.add(field, 'Enter a number'); return undefined; }
  if (n < 0) { errors.add(field, 'Pay cannot be negative'); return undefined; }
  if (n > MAX_PAY) { errors.add(field, 'Pay is too large'); return undefined; }
  return Math.round(n * 100) / 100;
}

function parseDate(value, field, errors, { future = false } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) { errors.add(field, 'Enter a valid date'); return undefined; }
  if (future && d.getTime() < Date.now() - 60_000) { errors.add(field, 'Pick a date in the future'); return undefined; }
  return d.toISOString();
}

function normalizeCountry(code) {
  if (!code) return null;
  return countriesUtil.normalizeCountry(code, null);
}

// ISO 639-1 language codes with an optional level ("es", "es:fluent").
function languageList(value, max = 8) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  const cleaned = list
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item) => /^[a-z]{2,3}(-[a-z]{2})?(:(basic|conversational|fluent|native))?$/.test(item));
  return [...new Set(cleaned)].slice(0, max);
}

function codeList(value, max = 20) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(list.map((c) => String(c || '').trim().toLowerCase())
    .filter((c) => /^[a-z0-9][a-z0-9_.-]{0,63}$/.test(c)))].slice(0, max);
}

function idList(value, field, errors, max = 50) {
  if (value === undefined || value === null || value === '') return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  const ids = [];
  for (const raw of list) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) { errors.add(field, 'Each store id must be a positive integer'); return undefined; }
    ids.push(n);
  }
  return [...new Set(ids)].slice(0, max);
}

// C-09: résumé links must be https (no javascript:, data:, file:).
function safeHttpsUrl(value, field, errors) {
  if (!value) return null;
  try {
    const u = new URL(String(value).trim());
    if (u.protocol !== 'https:') { errors.add(field, 'Use an https:// link'); return undefined; }
    return u.toString().slice(0, 2000);
  } catch {
    errors.add(field, 'Enter a valid link');
    return undefined;
  }
}

// C-09: store a short BCP-47 tag from our supported list, never the raw header.
function normalizeLocale(value) {
  const raw = String(value || '').split(',')[0].trim().toLowerCase();
  const base = raw.split(/[-_;]/)[0];
  return LOCALES.includes(base) ? base : 'en';
}

/**
 * Parse an opening body. With `existing`, missing fields keep their stored
 * value (PATCH semantics) but the merged result is validated as a whole,
 * so a partial update can never leave pay, dates or the EOR rule invalid.
 */
function parseOpening(body = {}, { existing = null, employerType = 'business' } = {}) {
  const errors = new FieldErrors();
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined;
  const pick = (k, fallback) => (has(k) ? body[k] : (existing ? existing[k] : fallback));

  const out = {};
  out.title = text(pick('title', ''), 160);
  if (!out.title) errors.add('title', 'Title is required');

  const department = pick('department', 'other');
  out.department = DEPARTMENTS.includes(department) ? department : (has('department') ? errors.add('department', 'Unsupported department') : 'other');

  let pathStage = has('path_stage') ? body.path_stage : (has('employment_type') ? body.employment_type : (existing ? existing.path_stage || existing.employment_type : 'full_time'));
  if (!PATH_STAGES.includes(pathStage)) { errors.add('path_stage', 'Unsupported type of work'); pathStage = 'full_time'; }
  out.path_stage = pathStage;
  // Keep the legacy column readable: 'shift' maps to the closest old value.
  out.employment_type = EMPLOYMENT_TYPES.includes(pathStage) ? pathStage : 'temporary';

  const workplace = pick('workplace_type', 'onsite');
  if (!WORKPLACE_TYPES.includes(workplace)) errors.add('workplace_type', 'Unsupported workplace type');
  out.workplace_type = WORKPLACE_TYPES.includes(workplace) ? workplace : 'onsite';

  const rawCountry = pick('country_code', null);
  out.country_code = normalizeCountry(rawCountry);
  if (rawCountry && !out.country_code) errors.add('country_code', 'Use a supported ISO country code');
  if (!out.country_code && out.workplace_type !== 'remote') errors.add('country_code', 'Country is required for on-site and hybrid roles');

  out.region = optionalText(pick('region', null), 80);
  out.city = optionalText(pick('city', null), 120);

  const tz = optionalText(pick('timezone', null), 64);
  if (tz && !isValidTimeZone(tz)) errors.add('timezone', 'Use an IANA time zone such as America/New_York');
  out.timezone = tz && isValidTimeZone(tz) ? tz : null;

  const currency = text(pick('currency_code', '') || countriesUtil.getDefaultCurrency?.(out.country_code) || 'USD', 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.add('currency_code', 'Use a 3-letter currency code');
  out.currency_code = /^[A-Z]{3}$/.test(currency) ? currency : 'USD';

  // Q12: pay on every opening, everywhere.
  const min = money(pick('compensation_min', null), 'compensation_min', errors);
  const max = money(pick('compensation_max', null), 'compensation_max', errors);
  if (min === null) errors.add('compensation_min', 'A pay range is required on every opening');
  if (max === null) errors.add('compensation_max', 'A pay range is required on every opening');
  if (typeof min === 'number' && typeof max === 'number' && min > max) errors.add('compensation_max', 'Maximum pay must be at least the minimum');
  out.compensation_min = typeof min === 'number' ? min : null;
  out.compensation_max = typeof max === 'number' ? max : null;
  const period = pick('compensation_period', 'hourly');
  if (!COMPENSATION_PERIODS.includes(period)) errors.add('compensation_period', 'Unsupported pay period');
  out.compensation_period = COMPENSATION_PERIODS.includes(period) ? period : 'hourly';

  const auth = pick('work_authorization', 'local_authorized');
  if (!OPENING_WORK_AUTHORIZATION.includes(auth)) errors.add('work_authorization', 'Choose whether sponsorship is available');
  out.work_authorization = OPENING_WORK_AUTHORIZATION.includes(auth) ? auth : 'local_authorized';
  out.sponsorship_available = has('sponsorship_available') ? bool(body.sponsorship_available) : (existing ? Boolean(existing.sponsorship_available) : out.work_authorization === 'visa_sponsorship');

  const langs = languageList(pick('languages', ['en']));
  out.languages = langs.length ? langs.map((l) => l.split(':')[0]) : ['en'];
  out.required_languages = languageList(pick('required_languages', []));
  out.description = text(pick('description', ''), 20000);
  out.requirements = text(pick('requirements', ''), 10000);
  out.benefits = text(pick('benefits', ''), 5000);
  out.benefits_summary = optionalText(pick('benefits_summary', null) ?? (has('benefits') ? body.benefits : null), 2000);
  out.schedule_summary = optionalText(pick('schedule_summary', null), 1000);
  out.required_credentials = codeList(pick('required_credentials', []));
  out.preferred_credentials = codeList(pick('preferred_credentials', []));
  out.job_role_code = optionalText(pick('job_role_code', null), 40);

  const teamRole = pick('team_role', employerType === 'business' ? 'employee' : null);
  if (teamRole != null && !TEAM_ROLES.includes(teamRole)) errors.add('team_role', 'Unsupported team role');
  out.team_role = TEAM_ROLES.includes(teamRole) ? teamRole : (employerType === 'business' ? 'employee' : null);

  const locationIds = idList(pick('location_ids', []), 'location_ids', errors);
  out.location_ids = Array.isArray(locationIds) ? locationIds : [];

  out.opens_at = parseDate(pick('opens_at', null), 'opens_at', errors) ?? null;
  out.applications_close_at = parseDate(pick('applications_close_at', null) ?? pick('closes_at', null), 'applications_close_at', errors, { future: !existing || has('applications_close_at') || has('closes_at') }) ?? null;
  out.closes_at = out.applications_close_at;
  if (out.opens_at && out.applications_close_at && out.opens_at > out.applications_close_at) {
    errors.add('applications_close_at', 'The close date must be after the open date');
  }

  const minAgeRaw = pick('min_age', 18);
  const minAge = Number(minAgeRaw);
  if (!Number.isInteger(minAge) || minAge < 18 || minAge > 25) errors.add('min_age', 'Minimum age is 18; a higher minimum must be between 19 and 25');
  out.min_age = Number.isInteger(minAge) && minAge >= 18 && minAge <= 25 ? minAge : 18;
  out.min_age_reason = optionalText(pick('min_age_reason', null), 300);
  if (out.min_age > 18 && !out.min_age_reason) errors.add('min_age_reason', 'Say which law requires the higher minimum age');

  out.allow_guest_applications = bool(pick('allow_guest_applications', false));
  out.hide_identity_until_offer = bool(pick('hide_identity_until_offer', false));
  out.ai_ranking_enabled = bool(pick('ai_ranking_enabled', false));
  out.is_internal = bool(pick('is_internal', false));

  const model = pick('employer_model', 'direct');
  if (!EMPLOYER_MODELS.includes(model)) errors.add('employer_model', 'Unsupported employer model');
  out.employer_model = EMPLOYER_MODELS.includes(model) ? model : 'direct';
  if (out.employer_model === 'oxsteed_eor' && (!EOR_PATH_STAGES.includes(out.path_stage) || employerType !== 'business')) {
    errors.add('employer_model', 'OxSteed as employer of record is only for shift, seasonal and temporary openings');
  }

  out.background_check_required = bool(pick('background_check_required', false));
  out.background_check_package = optionalText(pick('background_check_package', null), 80);
  out.background_check_reason = optionalText(pick('background_check_reason', null), 500);
  if (out.background_check_required) {
    if (!out.background_check_package) errors.add('background_check_package', 'Choose a Checkr package');
    if (!out.background_check_reason) errors.add('background_check_reason', 'Say why this role needs a background check');
  }

  const contentLocale = pick('content_locale', 'en');
  out.content_locale = LOCALES.includes(contentLocale) ? contentLocale : 'en';
  const translations = pick('translations', {});
  out.translations = translations && typeof translations === 'object' && !Array.isArray(translations)
    ? Object.fromEntries(Object.entries(translations)
      .filter(([loc, v]) => LOCALES.includes(loc) && v && typeof v === 'object')
      .map(([loc, v]) => [loc, { title: text(v.title, 160), description: text(v.description, 20000) }]))
    : {};

  out.postal_code = optionalText(body.postal_code, 20);
  return { value: out, errors };
}

module.exports = {
  FieldErrors,
  text,
  optionalText,
  bool,
  money,
  parseDate,
  isValidTimeZone,
  normalizeCountry,
  languageList,
  codeList,
  idList,
  safeHttpsUrl,
  normalizeLocale,
  parseOpening,
};
