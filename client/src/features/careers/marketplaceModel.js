// Pure helpers for the Careers marketplace screens (search filters, slot
// pickers, availability editing, ratings, paging). No React, no network, so
// they run under node --test. Copy lives in i18n under `careers.mk.`.

export const INDUSTRIES = ['food_service', 'hospitality', 'retail', 'healthcare', 'construction', 'skilled_trades', 'transportation',
  'warehouse_logistics', 'cleaning_facilities', 'manufacturing', 'education', 'technology', 'finance',
  'professional_services', 'beauty_wellness', 'security', 'agriculture', 'nonprofit', 'government', 'other'];
export const EXPERIENCE_LEVELS = ['no_experience', 'internship', 'entry', 'mid', 'senior', 'manager', 'executive'];
export const POSTED_WITHIN_DAYS = [1, 3, 7, 14, 30];
export const SEARCH_SORTS = ['newest', 'pay_high', 'pay_low', 'relevance', 'distance', 'oldest'];
export const OPENING_REPORT_REASONS = ['scam', 'asks_for_payment', 'discriminatory', 'misleading_pay', 'fake_employer', 'offensive', 'not_a_job', 'other'];
export const MESSAGE_REPORT_REASONS = ['harassment', 'scam', 'discrimination', 'spam', 'asks_for_payment', 'other'];
export const REVIEW_REPORT_REASONS = ['false_information', 'discriminatory', 'harassment', 'private_information', 'spam', 'conflict_of_interest', 'other'];
export const REVIEW_CATEGORIES = ['work_life', 'pay_benefits', 'security_advancement', 'management', 'culture'];
export const PLANS = ['starter', 'growth', 'pro'];
export const AGENCY_PERMISSIONS = ['post_openings', 'manage_pipeline', 'source_talent'];
export const ALERT_FREQUENCIES = ['instant', 'daily', 'weekly'];
export const ALERT_CHANNELS = ['email', 'in_app', 'push', 'sms'];
export const AVAILABLE_NOW_HOURS = [2, 4, 8, 12, 24];
export const SCREENER_PRESETS = {
  work_authorization: { answer_type: 'yes_no' },
  min_age_18: { answer_type: 'yes_no' },
  drivers_license: { answer_type: 'yes_no' },
  reliable_transport: { answer_type: 'yes_no' },
  commute: { answer_type: 'yes_no' },
  relocate: { answer_type: 'yes_no' },
  shift_availability: { answer_type: 'choice', choices: ['mornings', 'afternoons', 'evenings', 'overnight', 'weekends'] },
  years_experience: { answer_type: 'number' },
  certification: { answer_type: 'yes_no' },
  language: { answer_type: 'yes_no' },
  education: { answer_type: 'choice', choices: ['none', 'high_school', 'vocational', 'associate', 'bachelor', 'master', 'doctorate'] },
  lift_weight: { answer_type: 'yes_no' },
  start_date: { answer_type: 'yes_no' },
};
export const INTERVIEW_TIP_SECTIONS = ['before', 'questions', 'star', 'video', 'phone', 'inPerson', 'after', 'rights'];

const csv = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);

/** Search filters → query params (drops empties, keeps only known values). */
export function searchParamsFrom(f = {}) {
  const out = {};
  for (const k of ['q', 'country', 'workplace', 'department', 'path', 'employer', 'near']) {
    const v = String(f[k] ?? '').trim();
    if (v) out[k] = v;
  }
  if (out.near && f.radius_km) out.radius_km = Number(f.radius_km);
  const industries = csv(f.industry).filter((x) => INDUSTRIES.includes(x));
  if (industries.length) out.industry = industries.join(',');
  const levels = csv(f.experience).filter((x) => EXPERIENCE_LEVELS.includes(x));
  if (levels.length) out.experience = levels.join(',');
  if (POSTED_WITHIN_DAYS.includes(Number(f.posted_within))) out.posted_within = Number(f.posted_within);
  const payMin = Number(f.pay_min);
  if (f.pay_min !== '' && f.pay_min != null && Number.isFinite(payMin) && payMin > 0) {
    out.pay_min = payMin;
    if (f.pay_period) out.pay_period = f.pay_period;
  }
  for (const k of ['same_day', 'urgent', 'sponsorship']) if (f[k] === true || f[k] === 'true') out[k] = 'true';
  if (SEARCH_SORTS.includes(f.sort) && f.sort !== 'newest') out.sort = f.sort;
  if (Number(f.page) > 1) out.page = Number(f.page);
  if ([10, 20, 50].includes(Number(f.page_size)) && Number(f.page_size) !== 20) out.page_size = Number(f.page_size);
  return out;
}

/** Saved-search criteria for a job alert from the current filters. */
export function alertCriteriaFrom(f = {}) {
  const p = searchParamsFrom(f);
  delete p.sort; delete p.page; delete p.page_size; delete p.posted_within;
  if (p.workplace) { p.workplaces = p.workplace; delete p.workplace; }
  if (p.path) { p.types = p.path; delete p.path; }
  return p;
}

/** Page numbers to show around the current page (1 … 4 5 [6] 7 8 … 20). */
export function pageList(page, pages) {
  const cur = Math.max(1, Math.min(Number(page) || 1, Number(pages) || 1));
  const last = Math.max(1, Number(pages) || 1);
  const set = new Set([1, last, cur - 1, cur, cur + 1].filter((n) => n >= 1 && n <= last));
  const sorted = [...set].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((n, i) => { if (i && n - sorted[i - 1] > 1) out.push('…'); out.push(n); });
  return out;
}

export function minutesToTime(m) {
  const n = Math.max(0, Math.min(1440, Number(m) || 0));
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

export function timeToMinutes(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** Validate availability rows before saving (mirrors the server). */
export function availabilityErrors(windows = []) {
  const errors = {};
  windows.forEach((w, i) => {
    if (!(Number.isInteger(w.weekday) && w.weekday >= 0 && w.weekday <= 6)) errors[i] = 'day';
    else if (w.start_minute == null || w.end_minute == null || w.end_minute - w.start_minute < 10) errors[i] = 'range';
  });
  return errors;
}

/** Group ISO slot times by local day in a time zone, for a slot picker. */
export function groupSlotsByDay(slots = [], timeZone = 'UTC', locale = 'en') {
  const day = (d) => {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); } catch { return d.toISOString().slice(0, 10); }
  };
  const label = (d, opts) => {
    try { return new Intl.DateTimeFormat(locale, { timeZone, ...opts }).format(d); } catch { return d.toISOString(); }
  };
  const groups = new Map();
  for (const iso of slots) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    const key = day(d);
    if (!groups.has(key)) groups.set(key, { key, label: label(d, { weekday: 'long', month: 'short', day: 'numeric' }), slots: [] });
    groups.get(key).slots.push({ iso: d.toISOString(), label: label(d, { hour: 'numeric', minute: '2-digit' }) });
  }
  return [...groups.values()];
}

/** 4.25 → "★★★★☆" style text for screen readers we also give a number. */
export function stars(value) {
  const n = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

export function bandKey(band) {
  return ['strong', 'partial', 'limited'].includes(band) ? band : 'unavailable';
}

/** Turn a screener answer map into the request shape (ids as keys). */
export function screenerPayload(questions = [], answers = {}) {
  const out = {};
  for (const q of questions) {
    const v = answers[q.id];
    if (v === undefined || v === '' || v === null || (Array.isArray(v) && !v.length)) continue;
    if (q.answer_type === 'number') out[q.id] = Number(v);
    else out[q.id] = v;
  }
  return out;
}

/** Client-side check that required screener questions were answered. */
export function missingScreenerAnswers(questions = [], answers = {}) {
  const empty = (v) => v === undefined || v === '' || v === null || (Array.isArray(v) && !v.length);
  return questions.filter((q) => q.required && empty(answers[q.id])).map((q) => q.id);
}

export function formatCents(cents, currency = 'usd', locale = 'en') {
  const n = Number(cents || 0) / 100;
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency: String(currency || 'usd').toUpperCase() }).format(n); } catch { return `${n.toFixed(2)} ${currency}`; }
}
