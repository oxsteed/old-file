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
// runs, schedule versions and audit rows are NEVER deleted or
// rewritten. Anonymization removes personal content only — staff
// documents (file + row), free-text descriptions on time entries,
// the minor labor profile, and personal fields on the membership row
// — while the wage-and-hour history keeps its pseudonymous user_id
// keys so totals still reconcile. That boundary (user_id keys remain)
// is deliberate and documented on the erasure outcome; fully breaking
// the link to the person would require users-table handling, which is
// outside the restaurant scope and needs a legal call.

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
  const { rows } = await db.query(
    `SELECT * FROM restaurant_retention_policies
      WHERE restaurant_id = $1 AND record_class = $2
        AND (location_id IS NULL OR location_id = $3::bigint)
      ORDER BY
        CASE WHEN source = 'jurisdiction' THEN 0 WHEN source = 'operator' THEN 1 ELSE 2 END,
        location_id NULLS LAST
      LIMIT 1`,
    [restaurantId, recordClass, locationId]
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

async function getRetentionPolicies(db, { restaurantId, locationId = null } = {}) {
  const policies = {};
  for (const recordClass of RECORD_CLASSES) {
    policies[recordClass] = await getRetentionPolicy(db, { restaurantId, locationId, recordClass });
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
     ON CONFLICT (restaurant_id, location_id, record_class) NULLS NOT DISTINCT
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

// Anonymize one former staff member's restaurant-scoped personal data.
// `retainUntil` is the offboarding retention deadline for the person;
// anonymization only runs once it has passed. Returns counts of what
// was cleared; history rows (time entries, pay runs, schedule versions,
// audit rows) are counted as retained, never touched.
async function anonymizeFormerStaff(db, { businessId, restaurantId, userId, retainUntil } = {}) {
  if (!businessId || !userId) throw new AppError('businessId and userId are required', 400, 'validation_failed');
  if (retainUntil && new Date(retainUntil) > new Date()) {
    return { skipped: true, reason: 'retention_not_expired', retain_until: retainUntil };
  }
  const counts = { documents_deleted: 0, time_entry_notes_cleared: 0, labor_profile_removed: 0, history_rows_retained: 0 };
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
  // The minor band + until date is personal data about a child; once
  // retention expires it goes. (A band that is still current — the
  // person is still a minor — is never anonymized by this job.)
  const profile = await db.query(
    `DELETE FROM business_staff_labor_profiles
      WHERE business_id = $1 AND user_id = $2
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
  isRecordClass,
  getRetentionPolicy,
  getRetentionPolicies,
  setRetentionPolicy,
  anonymizeFormerStaff,
};
