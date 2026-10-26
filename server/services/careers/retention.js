'use strict';

// Applicant-record retention (careers spec §12.6, Q15, Q18).
//
// The clock starts at the decision (hired, rejected, withdrawn, declined,
// closed). The rule is the most specific row of career_retention_rules for
// the opening's country/region. US records never keep less than the
// federal one-year floor; anything without a rule keeps 12 months.

const pool = require('../../db');
const logger = require('../../utils/logger');

const DEFAULT_MONTHS = 12;
const US_FLOOR_MONTHS = 12;

async function resolveRetention(db, { country, region, appliesTo = 'application' }) {
  const c = String(country || 'US').toUpperCase().slice(0, 2);
  const r = region ? String(region).toUpperCase().slice(0, 3) : null;
  const { rows } = await db.query(
    `SELECT id, keep_months
       FROM career_retention_rules
      WHERE country = $1 AND applies_to = $3 AND (region IS NULL OR upper(region) = $2)
      ORDER BY (region IS NULL) ASC
      LIMIT 1`,
    [c, r, appliesTo]
  );
  let keepMonths = rows[0] ? Number(rows[0].keep_months) : DEFAULT_MONTHS;
  if (c === 'US') keepMonths = Math.max(keepMonths, US_FLOOR_MONTHS);
  return { ruleId: rows[0] ? Number(rows[0].id) : null, keepMonths };
}

/**
 * Stamp decided_at and retention_until on a final application. Safe to call
 * more than once: the clock is set from the first decision only.
 */
async function stampDecision(db, applicationId, { decidedBy = null } = {}) {
  const { rows } = await db.query(
    `SELECT a.id, a.decided_at, COALESCE(o.country_code, a.country_code) AS country, o.region
       FROM career_applications a
       JOIN career_openings o ON o.id = a.opening_id
      WHERE a.id = $1`,
    [applicationId]
  );
  const app = rows[0];
  if (!app) return null;
  const { ruleId, keepMonths } = await resolveRetention(db, { country: app.country, region: app.region });
  const { rows: updated } = await db.query(
    `UPDATE career_applications
        SET decided_at = COALESCE(decided_at, NOW()),
            decided_by = COALESCE(decided_by, $2),
            retention_rule_id = $3,
            retention_until = (COALESCE(decided_at, NOW()) + make_interval(months => $4::int))::date,
            updated_at = NOW()
      WHERE id = $1
      RETURNING retention_until`,
    [applicationId, decidedBy, ruleId, keepMonths]
  );
  return updated[0]?.retention_until || null;
}

/**
 * Strip personal data from one application, keeping the de-identified
 * facts (stage, reason code, dates, opening) that reporting needs.
 */
async function anonymizeApplication(db, applicationId) {
  await db.query(
    `UPDATE career_applications
        SET applicant_email = 'anonymized-' || id || '@redacted.invalid',
            first_name = '', last_name = '', phone = NULL, city = NULL, timezone = NULL,
            resume_url = NULL, cover_letter = NULL, resume_storage_key = NULL,
            profile_snapshot = NULL, user_id = NULL,
            preferred_location_ids = '{}', languages = '{}',
            anonymized_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND anonymized_at IS NULL`,
    [applicationId]
  );
  await db.query('UPDATE career_application_events SET note = NULL WHERE application_id = $1', [applicationId]);
  await db.query('UPDATE career_interviews SET notes = NULL, location = NULL WHERE application_id = $1', [applicationId]);
  await db.query('DELETE FROM careers_private.career_eeo_responses WHERE application_id = $1', [applicationId]);
  await db.query('DELETE FROM career_guest_apply_requests WHERE application_id = $1', [applicationId]);
}

async function sweepExpired({ db = pool, limit = 500 } = {}) {
  const { rows } = await db.query(
    `SELECT id FROM career_applications
      WHERE retention_until IS NOT NULL
        AND retention_until < CURRENT_DATE
        AND legal_hold = FALSE
        AND anonymized_at IS NULL
      ORDER BY retention_until ASC
      LIMIT $1`,
    [limit]
  );
  let anonymized = 0;
  for (const row of rows) {
    try {
      await anonymizeApplication(db, row.id);
      anonymized += 1;
    } catch (err) {
      logger.error('careers retention: anonymize failed', { applicationId: row.id, error: err.message });
    }
  }
  // Unconfirmed guest requests are never kept past their link expiry + 7 days.
  const { rowCount: guestRows } = await db.query(
    `DELETE FROM career_guest_apply_requests
      WHERE confirmed_at IS NULL AND expires_at < NOW() - INTERVAL '7 days'`
  );
  // AI run audit trail follows the ai_run rule (US 4 years by default).
  const { keepMonths: aiMonths } = await resolveRetention(db, { country: 'US', appliesTo: 'ai_run' });
  const { rowCount: aiRows } = await db.query(
    `DELETE FROM career_ai_runs WHERE created_at < NOW() - make_interval(months => $1::int)`,
    [aiMonths]
  );
  return { anonymized, guestRequestsDeleted: guestRows || 0, aiRunsDeleted: aiRows || 0 };
}

module.exports = {
  DEFAULT_MONTHS,
  US_FLOOR_MONTHS,
  resolveRetention,
  stampDecision,
  anonymizeApplication,
  sweepExpired,
};
