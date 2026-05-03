#!/usr/bin/env node
/**
 * Verifies ACTIVE_DELETION_GUARD_JOB_STATUSES ⊆ pg_enum for job_status.
 * Usage: DATABASE_URL=... node server/scripts/verify-active-job-statuses.js
 * Exit 0 if OK, 1 if mismatch or connection failure.
 */
'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const { ACTIVE_DELETION_GUARD_JOB_STATUSES } = require('../constants/activeJobStatuses');

async function main() {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.error('verify-active-job-statuses: DATABASE_URL is not set.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: conn,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    const { rows } = await pool.query(
      `SELECT e.enumlabel AS label
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE t.typname = 'job_status' AND n.nspname = 'public'
       ORDER BY e.enumsortorder`
    );

    if (!rows.length) {
      console.error(
        'verify-active-job-statuses: no pg_enum rows for public.job_status. '
        + 'Check search_path / schema (this script expects typname job_status in public).'
      );
      process.exit(1);
    }

    const dbLabels = new Set(rows.map((r) => r.label));
    const missing = ACTIVE_DELETION_GUARD_JOB_STATUSES.filter((s) => !dbLabels.has(s));

    if (missing.length) {
      console.error(
        'verify-active-job-statuses: constants/activeJobStatuses.js lists values not present '
        + `on enum job_status: ${missing.join(', ')}`
      );
      console.error(`Database has: ${[...dbLabels].join(', ')}`);
      process.exit(1);
    }

    console.log(
      `verify-active-job-statuses: OK (${ACTIVE_DELETION_GUARD_JOB_STATUSES.length} labels are on public.job_status).`
    );
    process.exit(0);
  } catch (err) {
    console.error('verify-active-job-statuses:', err.message);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
