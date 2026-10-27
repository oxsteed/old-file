'use strict';

// Matching without a black box (careers spec §10).
//
// - requirementChecklist: plain logic comparing what the employer wrote
//   with the candidate's shared facts. The default employer view.
// - jobsForYou: the transparent worker-side formula of §10.3, using only
//   data the worker gave. Weights live here (config) and are documented.
// - rankOrder: the fixed §10.4 formula that turns per-requirement
//   assessments into an order. It never reads ratings, boosts or payments.
// - rankingGate: whether AI ranking may run for an opening right now.

const { jurisdictionOf } = require('./compliance');
const { rankingConfig } = require('./providers/config');

const JOBS_FOR_YOU_WEIGHTS = Object.freeze({
  role_match: 0.35, distance_fit: 0.20, schedule_fit: 0.15, pay_fit: 0.15, credential_fit: 0.10, language_fit: 0.05,
});

function lower(list) {
  return (list || []).map((v) => String(v || '').toLowerCase().split(':')[0]).filter(Boolean);
}

// Credential codes a candidate holds, from shared facts only.
function credentialCodes(facts = []) {
  const codes = new Set();
  for (const f of facts) {
    if (f.fact_type === 'certificate') {
      if (f.category) codes.add(String(f.category).toLowerCase());
      if (f.value?.doc_type) codes.add(String(f.value.doc_type).toLowerCase());
    }
    if (f.fact_type === 'training_completed' && f.category) codes.add(String(f.category).toLowerCase());
    if (f.fact_type === 'badge' && f.value?.code) codes.add(String(f.value.code).toLowerCase());
  }
  return codes;
}

/**
 * Checklist of the opening's stated requirements: met, or not shown.
 * Never "failed": not shown only means the candidate hasn't shared proof.
 */
function requirementChecklist(opening, { facts = [], languages = [], authorizedToWork = null, needsSponsorship = null } = {}) {
  const items = [];
  const held = credentialCodes(facts);
  for (const code of opening.required_credentials || []) {
    items.push({ kind: 'credential', code, required: true, status: held.has(String(code).toLowerCase()) ? 'met' : 'not_shown' });
  }
  for (const code of opening.preferred_credentials || []) {
    items.push({ kind: 'credential', code, required: false, status: held.has(String(code).toLowerCase()) ? 'met' : 'not_shown' });
  }
  const spoken = new Set(lower(languages));
  for (const lang of lower(opening.required_languages)) {
    items.push({ kind: 'language', code: lang, required: true, status: spoken.has(lang) ? 'met' : 'not_shown' });
  }
  if (authorizedToWork !== null) {
    const ok = authorizedToWork === true && (needsSponsorship !== true || Boolean(opening.sponsorship_available));
    items.push({ kind: 'work_authorization', code: opening.country_code || null, required: true, status: ok ? 'met' : 'not_shown' });
  }
  return items;
}

function haversineKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const SCHEDULE_TAGS = Object.freeze(['mornings', 'afternoons', 'evenings', 'overnight', 'weekdays', 'weekends']);

function scheduleTagsOf(opening) {
  const tags = opening?.requirement_tags?.schedule;
  return Array.isArray(tags) ? tags.filter((t) => SCHEDULE_TAGS.includes(t)) : [];
}

// availability: [{ day: 0-6 (0 = Sunday), start: 'HH:MM', end: 'HH:MM' }]
function availabilityTags(availability) {
  const tags = new Set();
  if (!Array.isArray(availability)) return tags;
  for (const w of availability) {
    const day = Number(w?.day);
    const start = Number(String(w?.start || '').split(':')[0]);
    const end = Number(String(w?.end || '').split(':')[0]) || 24;
    if (!Number.isInteger(day) || !Number.isFinite(start)) continue;
    tags.add(day === 0 || day === 6 ? 'weekends' : 'weekdays');
    if (start < 12) tags.add('mornings');
    if (start < 17 && end > 12) tags.add('afternoons');
    if (end > 17 || start >= 17) tags.add('evenings');
    if (end <= start || start >= 22 || start < 5) tags.add('overnight');
  }
  return tags;
}

const HOURS_PER = { hourly: 1, daily: 8, per_shift: 8, monthly: 173, yearly: 2080 };
const PROFILE_PERIOD = { hour: 'hourly', hourly: 'hourly', day: 'daily', daily: 'daily', month: 'monthly', monthly: 'monthly', year: 'yearly', yearly: 'yearly' };

function hourlyEquivalent(amount, period) {
  const per = HOURS_PER[period] || 1;
  return Number(amount) / per;
}

/**
 * Worker-side "Jobs for you" score with reasons (§10.3). Returns
 * { excluded, score, parts, reasons } where reasons are codes the client
 * localizes. Hard requirements the worker can't meet exclude the opening.
 */
function jobsForYou(opening, profile = {}, { distanceKm = null, factsCodes = new Set(), workerAuthorized = null } = {}) {
  if (workerAuthorized === false && !opening.sponsorship_available) return { excluded: true, reason: 'work_authorization' };
  const parts = {};
  const reasons = [];
  const roles = new Set(lower(profile.desired_roles));
  const kinds = new Set(lower(profile.desired_employment));
  parts.role_match = roles.size === 0 ? 0.5
    : (roles.has(String(opening.job_role_code || '').toLowerCase()) || roles.has(String(opening.department || '').toLowerCase()) ? 1 : 0);
  if (kinds.size && kinds.has(String(opening.path_stage || '').toLowerCase())) parts.role_match = Math.min(1, parts.role_match + 0.25);
  if (parts.role_match >= 1) reasons.push('role_match');

  const radius = Number(profile.travel_radius_km) || 25;
  if (opening.workplace_type === 'remote') { parts.distance_fit = 1; reasons.push('remote'); }
  else if (distanceKm == null) parts.distance_fit = 0.5;
  else { parts.distance_fit = distanceKm <= radius ? 1 - (distanceKm / radius) * 0.5 : 0; if (distanceKm <= radius) reasons.push('within_radius'); }

  // Schedule: the opening's confirmed schedule tags vs the worker's weekly
  // windows. Unknown on either side stays neutral (0.5).
  const wanted = scheduleTagsOf(opening);
  const free = availabilityTags(profile.availability);
  if (wanted.length && free.size) {
    const met = wanted.filter((t) => free.has(t)).length;
    parts.schedule_fit = met / wanted.length;
    if (met === wanted.length) reasons.push('schedule_fits');
  } else parts.schedule_fit = 0.5;

  if (profile.min_pay_cents && opening.compensation_max != null) {
    const want = hourlyEquivalent(Number(profile.min_pay_cents) / 100, PROFILE_PERIOD[profile.min_pay_period] || 'hourly');
    const offerMax = hourlyEquivalent(opening.compensation_max, opening.compensation_period);
    parts.pay_fit = offerMax >= want ? 1 : Math.max(0, offerMax / want);
    if (offerMax >= want) reasons.push('pay_above_minimum');
  } else parts.pay_fit = 0.5;

  const required = (opening.required_credentials || []).map((c) => String(c).toLowerCase());
  if (required.length) {
    const met = required.filter((c) => factsCodes.has(c)).length;
    parts.credential_fit = met / required.length;
    if (met === required.length) reasons.push('has_credentials');
  } else parts.credential_fit = 1;

  const needLangs = lower(opening.required_languages);
  const speaks = new Set(lower(profile.languages));
  if (needLangs.length) {
    const met = needLangs.filter((l) => speaks.has(l)).length;
    parts.language_fit = met / needLangs.length;
    if (met === needLangs.length) reasons.push('speaks_languages');
  } else parts.language_fit = 1;

  const score = Object.entries(JOBS_FOR_YOU_WEIGHTS).reduce((sum, [k, w]) => sum + w * (parts[k] ?? 0), 0);
  return { excluded: false, score: Math.round(score * 1000) / 1000, parts, reasons };
}

/**
 * §10.4 order: required items met (desc), then preferred met (desc), then
 * applied earliest. `assessments` maps applicationId → [{required, status}].
 * Inputs are the assessments and application dates only: boosts, ratings
 * and payments cannot change the order (R10).
 */
function rankOrder(applications, assessments) {
  const scored = applications.map((a) => {
    const items = assessments.get(Number(a.id)) || [];
    const reqMet = items.filter((i) => i.required && i.status === 'met').length;
    const reqPartly = items.filter((i) => i.required && i.status === 'partly_met').length;
    const prefMet = items.filter((i) => !i.required && i.status === 'met').length;
    return { id: Number(a.id), created_at: new Date(a.created_at).getTime(), key: [reqMet, reqPartly, prefMet], items };
  });
  scored.sort((x, y) => (y.key[0] - x.key[0]) || (y.key[1] - x.key[1]) || (y.key[2] - x.key[2]) || (x.created_at - y.created_at) || (x.id - y.id));
  return scored.map((s, i) => ({ application_id: s.id, position: i + 1, reasons: s.items.map((it) => ({ code: it.code, kind: it.kind, required: it.required, status: it.status, reason: it.reason || null })) }));
}

function isNycOpening(opening) {
  const city = String(opening.city || '').toLowerCase().replace(/[^a-z]/g, '');
  return String(opening.country_code || '').toUpperCase() === 'US'
    && ['newyork', 'newyorkcity', 'nyc', 'manhattan', 'brooklyn', 'queens', 'bronx', 'statenisland'].includes(city);
}

function marketCodes(opening) {
  const j = jurisdictionOf(opening);
  if (!j) return [];
  const codes = [j];
  if (j.includes('-')) codes.push(j.split('-')[0]);
  if (isNycOpening(opening)) codes.unshift('US-NY-NYC');
  return codes;
}

/**
 * Can AI ranking run for this opening now? Returns { allowed, reason }.
 * Every gate must pass; the first failing gate is the reason.
 */
async function rankingGate(db, opening) {
  if (!rankingConfig().enabled) return { allowed: false, reason: 'disabled_globally' };
  if (!opening.ai_ranking_enabled) return { allowed: false, reason: 'disabled_for_opening' };
  if (opening.workplace_type === 'remote' && !opening.country_code) return { allowed: false, reason: 'no_market' };
  const codes = marketCodes(opening);
  if (!codes.length) return { allowed: false, reason: 'no_market' };
  const { rows: markets } = await db.query(
    `SELECT * FROM career_ai_ranking_markets WHERE market = ANY($1::text[])`,
    [codes]
  );
  // The most specific market row decides; EU countries need their own row.
  const market = codes.map((c) => markets.find((m) => m.market === c)).find(Boolean);
  if (!market || !market.enabled) return { allowed: false, reason: 'market_not_enabled' };
  if (!market.bias_audit_passed_at) return { allowed: false, reason: 'bias_audit_missing' };
  if (market.bias_audit_expires_at && new Date(market.bias_audit_expires_at) <= new Date()) return { allowed: false, reason: 'bias_audit_expired' };
  if (market.is_eu && !market.ai_act_signed_off_at) return { allowed: false, reason: 'eu_ai_act_not_signed_off' };
  if (String(market.market).startsWith('GB') && !market.dpia_covers_ranking_at) return { allowed: false, reason: 'uk_dpia_missing' };
  const { rows: blocks } = await db.query(
    `SELECT scope_type, scope_ref FROM career_ai_ranking_blocks
      WHERE reviewed_at IS NULL AND (
        (scope_type = 'platform') OR (scope_type = 'market' AND scope_ref = ANY($1::text[]))
        OR (scope_type = 'business' AND scope_ref = $2) OR (scope_type = 'opening' AND scope_ref = $3))
      LIMIT 1`,
    [codes, String(opening.business_id || 'platform'), String(opening.id)]
  );
  if (blocks.length) return { allowed: false, reason: 'impact_ratio_block', block: blocks[0] };
  if (isNycOpening(opening)) {
    const { rows: [notice] } = await db.query('SELECT rank_allowed_from FROM career_ai_ranking_notices WHERE opening_id = $1', [opening.id]);
    if (!notice || new Date(notice.rank_allowed_from) > new Date()) return { allowed: false, reason: 'nyc_notice_period' };
  }
  return { allowed: true, reason: null, market: market.market };
}

// NYC LL144 notice window: 10 business days.
function addBusinessDays(date, days) {
  const d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) added += 1;
  }
  return d;
}

module.exports = {
  JOBS_FOR_YOU_WEIGHTS,
  SCHEDULE_TAGS,
  scheduleTagsOf,
  availabilityTags,
  credentialCodes,
  requirementChecklist,
  haversineKm,
  hourlyEquivalent,
  jobsForYou,
  rankOrder,
  isNycOpening,
  marketCodes,
  rankingGate,
  addBusinessDays,
};
