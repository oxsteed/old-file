#!/usr/bin/env node
"use strict";

// D19 launch dependency. This is intentionally a dry-run report: the current
// schema has no verified date-of-birth field, so it must never infer adulthood
// from account activity or role. A future reviewed provider can use the
// returned subject count to plan an explicit, audited backfill.
const db = require("../server/db");

async function plan(conn = db) {
  const { rows } = await conn.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE adult_confirmed)::int AS confirmed,
            COUNT(*) FILTER (WHERE NOT adult_confirmed)::int AS pending
       FROM growth_subject_eligibility`,
  );
  const age = require("../server/growth/ageVerification").status();
  return {
    mode: "dry_run",
    source_required: "reviewed_age_or_identity_provider",
    // D-ENG-06: which methods are switched on. Backfill with
    // server/scripts/growthAgeBackfill.js once a provider is registered.
    age_verification: age,
    ...rows[0],
  };
}
if (require.main === module)
  plan()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return db.end?.();
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
module.exports = { plan };
