'use strict';

// Per-business careers settings (careers spec §4.4 step 1, §7, §12.4).
// The Checkr access token is write-only and stored encrypted.

const { AppError } = require('../../middleware/errorHandler');
const { EMPLOYER_MODELS } = require('../careerCatalog');
const { FieldErrors, bool, text } = require('./validation');
const { encrypt } = require('../../utils/encryption');
const checkr = require('./providers/checkr');
const eor = require('./providers/eor');
const billing = require('./providers/billing');
const { rankingConfig } = require('./providers/config');

const PUBLIC_FIELDS = [
  'business_id', 'default_employer_model', 'allow_guest_applications_default', 'hide_identity_default',
  'ai_ranking_default', 'background_checks_enabled', 'shift_nudge_threshold', 'clock_in_grace_minutes',
  'employer_digest_opt_out', 'permissible_purpose_certified_at', 'updated_at',
];

async function getSettings(db, businessId) {
  const { rows: [row] } = await db.query('SELECT * FROM career_business_settings WHERE business_id = $1', [businessId]);
  const base = row || {
    business_id: businessId, default_employer_model: 'direct', allow_guest_applications_default: false,
    hide_identity_default: false, ai_ranking_default: false, background_checks_enabled: false,
    shift_nudge_threshold: 6, clock_in_grace_minutes: 7, employer_digest_opt_out: false, permissible_purpose_certified_at: null,
  };
  const out = Object.fromEntries(PUBLIC_FIELDS.map((k) => [k, base[k] ?? null]));
  out.checkr_connected = Boolean(row?.checkr_account_ref);
  out.providers = { checkr: checkr.status(), eor: eor.status(), billing: billing.status(), ai_ranking: { enabled: rankingConfig().enabled } };
  return out;
}

/**
 * Update settings. Only the owner or a brand admin (business-wide scope)
 * may change them, since they set defaults for every store.
 */
async function updateSettings(db, { access, actor, body }) {
  if (!(access.isOwner || access.scope?.mode === 'business' || access.scope?.mode === 'brand')) {
    throw new AppError('Only the owner or a brand admin can change careers settings', 403, 'settings_forbidden');
  }
  const errors = new FieldErrors();
  const current = await getSettings(db, access.businessId);
  const next = { ...current };
  if (body.default_employer_model !== undefined) {
    if (!EMPLOYER_MODELS.includes(body.default_employer_model)) errors.add('default_employer_model', 'Choose direct or employer of record');
    else next.default_employer_model = body.default_employer_model;
  }
  for (const key of ['allow_guest_applications_default', 'hide_identity_default', 'ai_ranking_default', 'employer_digest_opt_out']) {
    if (body[key] !== undefined) next[key] = bool(body[key]);
  }
  for (const [key, lo, hi] of [['shift_nudge_threshold', 1, 100], ['clock_in_grace_minutes', 0, 60]]) {
    if (body[key] !== undefined) {
      const n = Number(body[key]);
      if (!Number.isInteger(n) || n < lo || n > hi) errors.add(key, `Between ${lo} and ${hi}`);
      else next[key] = n;
    }
  }
  let certify = false;
  if (body.certify_permissible_purpose !== undefined && bool(body.certify_permissible_purpose)) certify = true;
  let tokenCipher;
  if (body.checkr_access_token !== undefined) {
    const token = text(body.checkr_access_token, 400);
    tokenCipher = token ? encrypt(token) : null;
  }
  if (body.background_checks_enabled !== undefined) {
    next.background_checks_enabled = bool(body.background_checks_enabled);
    if (next.background_checks_enabled && !certify && !current.permissible_purpose_certified_at) {
      errors.add('certify_permissible_purpose', 'Certify that checks are only for employment decisions');
    }
  }
  errors.throwIfAny();
  await db.query(
    `INSERT INTO career_business_settings (business_id, default_employer_model, allow_guest_applications_default, hide_identity_default,
       ai_ranking_default, background_checks_enabled, shift_nudge_threshold, clock_in_grace_minutes, employer_digest_opt_out,
       permissible_purpose_certified_at, permissible_purpose_certified_by, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $10 THEN NOW() END, CASE WHEN $10 THEN $11::uuid END, $11, NOW())
     ON CONFLICT (business_id) DO UPDATE SET
       default_employer_model = EXCLUDED.default_employer_model,
       allow_guest_applications_default = EXCLUDED.allow_guest_applications_default,
       hide_identity_default = EXCLUDED.hide_identity_default,
       ai_ranking_default = EXCLUDED.ai_ranking_default,
       background_checks_enabled = EXCLUDED.background_checks_enabled,
       shift_nudge_threshold = EXCLUDED.shift_nudge_threshold,
       clock_in_grace_minutes = EXCLUDED.clock_in_grace_minutes,
       employer_digest_opt_out = EXCLUDED.employer_digest_opt_out,
       permissible_purpose_certified_at = CASE WHEN $10 THEN NOW() ELSE career_business_settings.permissible_purpose_certified_at END,
       permissible_purpose_certified_by = CASE WHEN $10 THEN $11::uuid ELSE career_business_settings.permissible_purpose_certified_by END,
       updated_by = $11, updated_at = NOW()`,
    [access.businessId, next.default_employer_model, next.allow_guest_applications_default, next.hide_identity_default,
      next.ai_ranking_default, next.background_checks_enabled, next.shift_nudge_threshold, next.clock_in_grace_minutes,
      next.employer_digest_opt_out, certify, actor.id]
  );
  if (tokenCipher !== undefined) {
    await db.query('UPDATE career_business_settings SET checkr_account_ref = $2 WHERE business_id = $1', [access.businessId, tokenCipher]);
  }
  return { settings: await getSettings(db, access.businessId), changed: Object.keys(body).filter((k) => k !== 'checkr_access_token'), checkrTokenChanged: tokenCipher !== undefined };
}

module.exports = { getSettings, updateSettings, PUBLIC_FIELDS };
