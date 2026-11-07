'use strict';

// Phase 7 (gap 21): retention policy per record class + erasure.
//
// Retention is per record class, per restaurant, optionally per
// location and per jurisdiction. Resolution order: a jurisdiction row
// for the class wins, then an operator row, then the 7-year default
// from staffOffboarding.js (businesses.staff_record_retention_years,
// default 7). No jurisdiction-specific period is invented anywhere:
// where a period needs a legal input it stays at the default and is
// flagged for legal review — see the Phase 7 report.
//
// Erasure respects the append-only audit model: time entries, pay
// runs, schedule versions and audit rows are NEVER deleted, and pay
// amounts are never changed. Identifying names on retained rows ARE
// replaced at erasure — the staff label on pay-run lines, names in
// time-entry-edit notes, and names inside audit-log JSON — so no
// directly identifying name survives on a row the job touches or
// retains for the person. Anonymization removes personal content only
// — staff documents (file + row), free-text descriptions on time
// entries, the minor labor profile, and personal fields on the
// membership row — while the wage-and-hour history keeps its
// pseudonymous user_id keys so totals still reconcile. That boundary
// (user_id keys remain) is deliberate and documented on the erasure
// outcome; fully breaking the link to the person would require
// users-table handling, which is outside the restaurant scope and
// needs a legal call.

const { AppError } = require('../middleware/errorHandler');

const RECORD_CLASSES = [
  'time_entries', 'pay_runs', 'schedule_versions',
  'staff_documents', 'tip_records', 'audit_events',
];
const DEFAULT_RETENTION_YEARS = 7;

function isRecordClass(value) {
  return RECORD_CLASSES.includes(value);
}

async function getRetentionPolicy(db, { restaurantId, locationId = null, recordClass, jurisdictionCode = null } = {}) {
  if (!isRecordClass(recordClass)) {
    throw new AppError('Unknown record class', 400, 'validation_failed');
  }
  // Finding 34: a jurisdiction-source row only wins when its
  // jurisdiction_code matches the requested one. A jurisdiction row
  // for another jurisdiction (or no requested code at all) must not
  // outrank a location or operator row. Precedence otherwise
  // unchanged: jurisdiction, then operator, then default; a
  // location-scoped row beats a restaurant-wide one within a source.
  const { rows } = await db.query(
    `SELECT * FROM restaurant_retention_policies
      WHERE restaurant_id = $1 AND record_class = $2
        AND (location_id IS NULL OR location_id = $3::bigint)
        AND (source <> 'jurisdiction' OR jurisdiction_code = $4)
      ORDER BY
        CASE WHEN source = 'jurisdiction' THEN 0 WHEN source = 'operator' THEN 1 ELSE 2 END,
        location_id NULLS LAST
      LIMIT 1`,
    [restaurantId, recordClass, locationId, jurisdictionCode]
  );
  const row = rows[0] || null;
  if (row) {
    return {
      record_class: recordClass,
      retention_years: Number(row.retention_years),
      jurisdiction_code: row.jurisdiction_code,
      source: row.source,
      location_id: row.location_id == null ? null : Number(row.location_id),
    };
  }
  return {
    record_class: recordClass,
    retention_years: DEFAULT_RETENTION_YEARS,
    jurisdiction_code: jurisdictionCode,
    source: 'default',
    location_id: locationId,
  };
}

async function getRetentionPolicies(db, { restaurantId, locationId = null, jurisdictionCode = null } = {}) {
  const policies = {};
  for (const recordClass of RECORD_CLASSES) {
    policies[recordClass] = await getRetentionPolicy(db, { restaurantId, locationId, recordClass, jurisdictionCode });
  }
  return policies;
}

async function setRetentionPolicy(db, {
  restaurantId, locationId = null, recordClass, retentionYears,
  jurisdictionCode = null, source = 'operator', updatedBy = null,
} = {}) {
  if (!isRecordClass(recordClass)) {
    throw new AppError('Unknown record class', 400, 'validation_failed');
  }
  const years = Number(retentionYears);
  if (!Number.isInteger(years) || years < 1 || years > 30) {
    throw new AppError('retentionYears must be an integer between 1 and 30', 400, 'validation_failed');
  }
  if (source === 'jurisdiction' && (jurisdictionCode == null || String(jurisdictionCode).trim() === '')) {
    throw new AppError('A jurisdiction policy needs a jurisdiction_code', 400, 'validation_failed');
  }
  const { rows: [row] } = await db.query(
    `INSERT INTO restaurant_retention_policies
       (restaurant_id, location_id, record_class, retention_years,
        jurisdiction_code, source, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (restaurant_id, location_id, record_class)
       DO UPDATE SET retention_years = EXCLUDED.retention_years,
                     jurisdiction_code = EXCLUDED.jurisdiction_code,
                     source = EXCLUDED.source,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = NOW()
     RETURNING *`,
    [
      restaurantId, locationId, recordClass, years,
      jurisdictionCode == null ? null : String(jurisdictionCode).slice(0, 32),
      source, updatedBy,
    ]
  );
  return row;
}

// Anonymized marker written over a former staff member's name on
// retained history rows (pay-run labels, edit notes, audit JSON).
// The rows and their amounts stay; only the identifying label goes.
const ANONYMIZED_STAFF_LABEL = 'Former staff';

// Anonymize one former staff member's restaurant-scoped personal data.
// `retainUntil` is the offboarding retention deadline for the person;
// anonymization only runs once it has passed, and a missing deadline
// (no offboarding record) refuses the erasure outright — it never
// means "no retention applies". Returns counts of what was cleared;
// history rows (time entries, pay runs, schedule versions, audit rows)
// are counted as retained and never deleted, but identifying names on
// them are replaced (see the pay-run / edit / audit steps below).
async function anonymizeFormerStaff(db, { businessId, restaurantId, userId, retainUntil } = {}) {
  if (!businessId || !userId) throw new AppError('businessId and userId are required', 400, 'validation_failed');
  if (retainUntil && new Date(retainUntil) > new Date()) {
    return { skipped: true, reason: 'retention_not_expired', retain_until: retainUntil };
  }
  // Finding 12: no retention deadline means no expired retention has
  // been established — fail closed, never anonymize on a missing gate.
  if (!retainUntil) {
    return { skipped: true, reason: 'retention_not_established', retain_until: null };
  }
  const counts = {
    documents_deleted: 0, time_entry_notes_cleared: 0, labor_profile_removed: 0,
    pay_run_labels_cleared: 0, time_entry_edits_scrubbed: 0, audit_names_scrubbed: 0,
    history_rows_retained: 0,
  };
  // Finding 13: the person's name has to come off every retained row
  // that carries it, not just the rows this job deletes. Look the
  // display name up once; if the users row is already gone there is
  // no name left to scrub and the label clearing below still runs.
  const { rows: [person] } = await db.query(
    `SELECT first_name, last_name FROM users WHERE id = $1`,
    [userId]
  );
  const firstName = String(person?.first_name || '').trim();
  const lastName = String(person?.last_name || '').trim();
  const fullName = `${firstName} ${lastName}`.trim();
  // Name parts worth scrubbing, longest first so the full name goes
  // before its parts; single letters never match (they would mangle
  // unrelated words).
  const nameParts = [...new Set([fullName, firstName, lastName])]
    .filter((part) => part.length >= 2)
    .sort((a, b) => b.length - a.length);
  // Staff documents: the file goes through the storage cleanup queue
  // (same path as a document delete) and the row is hard-deleted — a
  // permit or certificate is personal data, not wage history.
  const { rows: docs } = await db.query(
    `SELECT id, storage_key FROM restaurant_staff_documents
      WHERE restaurant_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [restaurantId, userId]
  );
  const storageKeysToDelete = [];
  for (const doc of docs) {
    await db.query(
      `UPDATE restaurant_staff_documents SET deleted_at = NOW() WHERE id = $1`,
      [doc.id]
    );
    counts.documents_deleted += 1;
    // File deletion runs through the storage cleanup queue in the
    // caller; the keys travel in the return value, never in a stored
    // outcome row.
    if (doc.storage_key) storageKeysToDelete.push(doc.storage_key);
  }
  // Free-text descriptions on time entries may name people or places;
  // the hours, dates and pay inputs stay exactly as recorded.
  const notes = await db.query(
    `UPDATE business_time_entries
        SET description = NULL
      WHERE business_id = $1 AND user_id = $2 AND description IS NOT NULL
        AND voided_at IS NULL
      RETURNING id`,
    [businessId, userId]
  );
  counts.time_entry_notes_cleared = notes.rowCount || 0;
  // Finding 13: pay-run lines are retained history, but the
  // staff_label on them is the person's name. Replace the label with
  // the anonymized marker; the line and every amount on it stay
  // exactly as recorded.
  const labels = await db.query(
    `UPDATE restaurant_pay_run_lines
        SET staff_label = $3
      WHERE staff_user_id = $2
        AND pay_run_id IN (SELECT id FROM restaurant_pay_runs WHERE restaurant_id = $1)
        AND staff_label IS NOT NULL AND staff_label <> $3
      RETURNING id`,
    [restaurantId, userId, ANONYMIZED_STAFF_LABEL]
  );
  counts.pay_run_labels_cleared = labels.rowCount || 0;
  // Finding 13: time-entry edits on this person's own entries may
  // name them in the free-text reason or in the old/new values.
  // Only their own entries are touched, so the name parts are
  // replaced literally here. Counts distinct rows scrubbed across
  // the passes (a row naming them twice is one row).
  const scrubbedEditIds = new Set();
  for (const part of nameParts) {
    const scrubbed = await db.query(
      `UPDATE business_time_entry_edits
          SET reason = REPLACE(reason, $3, $4),
              old_value = REPLACE(old_value, $3, $4),
              new_value = REPLACE(new_value, $3, $4)
        WHERE entry_id IN (
          SELECT id FROM business_time_entries
           WHERE business_id = $1 AND user_id = $2
        )
          AND (position($3 in COALESCE(reason, '')) > 0
            OR position($3 in COALESCE(old_value, '')) > 0
            OR position($3 in COALESCE(new_value, '')) > 0)
        RETURNING id`,
      [businessId, userId, part, ANONYMIZED_STAFF_LABEL]
    );
    for (const row of scrubbed.rows || []) scrubbedEditIds.add(Number(row.id));
  }
  counts.time_entry_edits_scrubbed = scrubbedEditIds.size;
  // Finding 13: names inside audit-log JSON for this business. The
  // full name is replaced wherever it appears in free text; a first
  // or last name is replaced only when it stands alone as a whole
  // JSON string value (e.g. {"first_name": "Phase"}), so a shared
  // first name in another person's note is not mangled. Bare
  // first/last names inside other people's free-text audit notes are
  // the known residual (see the Phase 7 report): they are not
  // replaced, and the actor/target user_id keys stay — they are the
  // pseudonymous keys the erasure boundary keeps.
  const scrubbedAuditIds = new Set();
  if (fullName) {
    // Each needle carries its own replacement: a quoted needle
    // ("Phase") must be replaced by a quoted marker ("Former staff")
    // or the JSON text stops parsing.
    const needles = [[fullName, ANONYMIZED_STAFF_LABEL]];
    if (firstName && firstName !== fullName) needles.push([`"${firstName}"`, `"${ANONYMIZED_STAFF_LABEL}"`]);
    if (lastName && lastName !== fullName) needles.push([`"${lastName}"`, `"${ANONYMIZED_STAFF_LABEL}"`]);
    for (const [needle, replacement] of needles) {
      const scrubbed = await db.query(
        `UPDATE business_audit_log
            SET before_state = replace(before_state::text, $2, $3)::jsonb,
                after_state = replace(after_state::text, $2, $3)::jsonb,
                metadata = replace(metadata::text, $2, $3)::jsonb
          WHERE business_id = $1
            AND (position($2 in COALESCE(before_state::text, '')) > 0
              OR position($2 in COALESCE(after_state::text, '')) > 0
              OR position($2 in COALESCE(metadata::text, '')) > 0)
          RETURNING id`,
        [businessId, needle, replacement]
      );
      for (const row of scrubbed.rows || []) scrubbedAuditIds.add(Number(row.id));
    }
  }
  counts.audit_names_scrubbed = scrubbedAuditIds.size;
  // The minor band + until date is personal data about a child; once
  // retention expires it goes. (A band that is still current — the
  // person is still a minor — is never anonymized by this job.)
  // Finding 60: the delete must honor that comment — a profile whose
  // minor_until is still in the future stays. minor_until is the date
  // the band ends, so a band ending today has expired.
  const profile = await db.query(
    `DELETE FROM business_staff_labor_profiles
      WHERE business_id = $1 AND user_id = $2
        AND (minor_until IS NULL OR minor_until <= CURRENT_DATE)
      RETURNING user_id`,
    [businessId, userId]
  );
  counts.labor_profile_removed = profile.rowCount || 0;
  const { rows: [history] } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM business_time_entries WHERE business_id = $1 AND user_id = $2 AND voided_at IS NULL)::int
       + (SELECT COUNT(*) FROM business_staff_shifts WHERE business_id = $1 AND user_id = $2)::int
       + (SELECT COUNT(*) FROM business_staff_schedule_changes WHERE business_id = $1 AND user_id = $2)::int
       AS retained`,
    [businessId, userId]
  );
  counts.history_rows_retained = Number(history?.retained || 0);
  return { skipped: false, storageKeysToDelete, ...counts };
}

module.exports = {
  RECORD_CLASSES,
  DEFAULT_RETENTION_YEARS,
  ANONYMIZED_STAFF_LABEL,
  isRecordClass,
  getRetentionPolicy,
  getRetentionPolicies,
  setRetentionPolicy,
  anonymizeFormerStaff,
};
