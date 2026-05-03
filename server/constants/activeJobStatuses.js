'use strict';

/**
 * Job rows in these statuses block account deletion (super-admin delete + self-delete).
 * Every value MUST exist on the PostgreSQL `job_status` enum (see 001_initial_schema.sql).
 *
 * Single source of truth: update here, then run `npm run verify:active-job-statuses`
 * against a real DB (or CI with CI_DATABASE_URL).
 */
const ACTIVE_DELETION_GUARD_JOB_STATUSES = Object.freeze([
  'accepted',
  'in_progress',
  'matched',
  'negotiating',
  'published',
]);

/** SQL fragment: `('published', ...)` for use in `status IN ...` */
function activeJobStatusSqlIn() {
  return `(${ACTIVE_DELETION_GUARD_JOB_STATUSES.map((s) => `'${String(s).replace(/'/g, "''")}'`).join(', ')})`;
}

module.exports = {
  ACTIVE_DELETION_GUARD_JOB_STATUSES,
  activeJobStatusSqlIn,
};
