'use strict';

/**
 * Access request lifecycle (spec: "Request lifecycle"). Pure functions; the
 * persistence layer (accessRequestService) applies them inside a locked
 * transaction with an expected-version check.
 */

const { getCapability, OPEN_REQUEST_STATUSES, PUBLIC_REASON_CODES } = require('./policyRegistry');

const APPLICANT_TRANSITIONS = Object.freeze({
  update: Object.freeze({ draft: 'draft', needs_information: 'needs_information' }),
  submit: Object.freeze({ draft: 'submitted' }),
  resubmit: Object.freeze({ needs_information: 'submitted' }),
  withdraw: Object.freeze({ draft: 'withdrawn', submitted: 'withdrawn', in_review: 'withdrawn', needs_information: 'withdrawn' }),
});

const REVIEWER_TRANSITIONS = Object.freeze({
  claim: Object.freeze({ submitted: 'in_review' }),
  request_information: Object.freeze({ submitted: 'needs_information', in_review: 'needs_information' }),
  approve: Object.freeze({ submitted: 'approved', in_review: 'approved' }),
  decline: Object.freeze({ submitted: 'declined', in_review: 'declined', needs_information: 'declined' }),
});

function nextStatus(table, action, status) {
  const row = table[action];
  if (!row) return null;
  return Object.prototype.hasOwnProperty.call(row, status) ? row[status] : null;
}

const applicantNext = (action, status) => nextStatus(APPLICANT_TRANSITIONS, action, status);
const reviewerNext = (action, status) => nextStatus(REVIEWER_TRANSITIONS, action, status);

function availableApplicantActions(status) {
  const out = [];
  if (status === 'draft') out.push('edit', 'submit', 'withdraw');
  else if (status === 'needs_information') out.push('revise', 'resubmit', 'withdraw');
  else if (status === 'submitted' || status === 'in_review') out.push('withdraw');
  else if (status === 'declined' || status === 'withdrawn') out.push('apply_again');
  return out;
}

function availableReviewerActions(status) {
  return Object.keys(REVIEWER_TRANSITIONS).filter((a) => reviewerNext(a, status));
}

const isOpen = (status) => OPEN_REQUEST_STATUSES.includes(status);

// ── answer validation ───────────────────────────────────────────────────────
const MAX_ANSWERS_BYTES = 16 * 1024;

function validString(v, f) {
  if (typeof v !== 'string') return false;
  const t = v.trim();
  if (f.maxLength && t.length > f.maxLength) return false;
  if (f.minLength && t.length < f.minLength) return false;
  return true;
}

function validateField(f, v) {
  switch (f.type) {
    case 'string':
    case 'text':
      return validString(v, f) ? null : 'invalid';
    case 'url': {
      if (!validString(v, f)) return 'invalid';
      try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) ? null : 'invalid'; } catch { return 'invalid'; }
    }
    case 'integer':
      return Number.isInteger(v) && (f.min == null || v >= f.min) && (f.max == null || v <= f.max) ? null : 'invalid';
    case 'enum':
      return (f.options || []).includes(v) ? null : 'invalid';
    case 'string_list':
      if (!Array.isArray(v) || v.length === 0) return 'invalid';
      if (f.maxItems && v.length > f.maxItems) return 'too_many';
      return v.every((s) => validString(s, f) && s.trim().length > 0) ? null : 'invalid';
    case 'service_area': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return 'invalid';
      const keys = Object.keys(v);
      if (keys.some((k) => !['country', 'region', 'city', 'postalCode'].includes(k))) return 'invalid';
      if (!validString(v.country || '', { maxLength: 2, minLength: 2 })) return 'invalid';
      return keys.every((k) => validString(v[k], { maxLength: 120 })) ? null : 'invalid';
    }
    default:
      return 'invalid';
  }
}

function isBlank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
}

/**
 * Validate answers against a capability's form.
 * mode 'draft' checks only shape/size of supplied fields; 'submit' also
 * requires every required field. Unknown keys are rejected (no smuggling).
 */
function validateAnswers(capabilityKey, answers, { mode = 'submit' } = {}) {
  const cap = getCapability(capabilityKey);
  if (!cap) return { ok: false, fields: { capability: 'unknown' } };
  const a = answers == null ? {} : answers;
  if (typeof a !== 'object' || Array.isArray(a)) return { ok: false, fields: { answers: 'invalid' } };
  if (Buffer.byteLength(JSON.stringify(a), 'utf8') > MAX_ANSWERS_BYTES) return { ok: false, fields: { answers: 'too_large' } };
  const fields = {};
  const known = new Map(cap.form.fields.map((f) => [f.name, f]));
  for (const k of Object.keys(a)) if (!known.has(k)) fields[k] = 'unknown_field';
  const normalized = {};
  for (const f of cap.form.fields) {
    const v = a[f.name];
    if (isBlank(v)) {
      if (mode === 'submit' && f.required) fields[f.name] = 'required';
      continue;
    }
    const err = validateField(f, v);
    if (err) fields[f.name] = err;
    else normalized[f.name] = typeof v === 'string' ? v.trim() : v;
  }
  return Object.keys(fields).length ? { ok: false, fields } : { ok: true, answers: normalized };
}

function isPublicReasonCode(code) {
  return PUBLIC_REASON_CODES.includes(code);
}

module.exports = {
  APPLICANT_TRANSITIONS,
  REVIEWER_TRANSITIONS,
  applicantNext,
  reviewerNext,
  availableApplicantActions,
  availableReviewerActions,
  isOpen,
  validateAnswers,
  isPublicReasonCode,
  MAX_ANSWERS_BYTES,
};
