#!/usr/bin/env node
"use strict";
// D-ENG-06: adult-status backfill through the configured age provider.
//
//   node server/scripts/growthAgeBackfill.js            # dry run (default)
//   node server/scripts/growthAgeBackfill.js --apply    # write decisions
//   node server/scripts/growthAgeBackfill.js --limit=1000
//
// With GROWTH_AGE_VERIFICATION_PROVIDER=none (the default) this reports
// "no_age_provider_configured" and changes nothing. It never infers age
// from account age, activity, role or purchases.
const db = require("../db");
const { withTransaction } = require("../utils/transaction");
const { backfill } = require("../growth/ageVerification");

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  const limitArg = argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 500;
  if (!apply) return backfill(db, { apply: false, limit });
  return withTransaction(db, (conn) => backfill(conn, { apply: true, limit }), "growth_age_backfill");
}

if (require.main === module)
  main()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary)}\n`);
      return db.end?.();
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
module.exports = { main };
