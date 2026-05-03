'use strict';

const {
  ACTIVE_DELETION_GUARD_JOB_STATUSES,
  activeJobStatusSqlIn,
} = require('../constants/activeJobStatuses');

/** Full set from server/migrations/001_initial_schema.sql CREATE TYPE job_status */
const JOB_STATUS_ENUM_ALL = Object.freeze([
  'draft',
  'published',
  'matched',
  'negotiating',
  'accepted',
  'in_progress',
  'completed',
  'cancelled',
  'closed',
]);

describe('activeJobStatuses', () => {
  it('every guard status exists on canonical job_status enum', () => {
    ACTIVE_DELETION_GUARD_JOB_STATUSES.forEach((s) => {
      expect(JOB_STATUS_ENUM_ALL).toContain(s);
    });
  });

  it('has no duplicates and is sorted for stable diffs', () => {
    const sorted = [...ACTIVE_DELETION_GUARD_JOB_STATUSES].sort();
    expect(ACTIVE_DELETION_GUARD_JOB_STATUSES).toEqual(sorted);
    expect(new Set(ACTIVE_DELETION_GUARD_JOB_STATUSES).size).toBe(
      ACTIVE_DELETION_GUARD_JOB_STATUSES.length
    );
  });

  it('activeJobStatusSqlIn matches IN list', () => {
    const sql = activeJobStatusSqlIn();
    expect(sql).toMatch(/^\(/);
    expect(sql).toMatch(/\)$/);
    ACTIVE_DELETION_GUARD_JOB_STATUSES.forEach((s) => {
      expect(sql).toContain(`'${s}'`);
    });
  });
});
