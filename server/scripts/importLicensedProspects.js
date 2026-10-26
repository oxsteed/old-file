#!/usr/bin/env node
"use strict";
// D23: load a licensed business-listing file from the command line.
//
//   node server/scripts/importLicensedProspects.js --file=batch.json [--full-snapshot]
//
// batch.json = { "license": { source, license_ref, license_version,
//   permitted_uses: [...], acquired_at, license_expires_at }, "rows": [...] }
// Needs GROWTH_PROSPECTS_ENABLED=true. Outreach stays off unless
// GROWTH_PROSPECT_OUTREACH_ENABLED=true AND the country's B2B rules are
// legally reviewed AND the licence permits marketing_outreach.
const fs = require("fs");
const db = require("../db");
const { withTransaction } = require("../utils/transaction");
const { importLicensedBatch } = require("../growth/prospects/import");

async function main(argv = process.argv.slice(2)) {
  const file = argv.find((a) => a.startsWith("--file="))?.slice(7);
  if (!file) throw new Error("usage: --file=batch.json [--full-snapshot]");
  const batch = JSON.parse(fs.readFileSync(file, "utf8"));
  return withTransaction(
    db,
    (conn) => importLicensedBatch(conn, { license: batch.license, rows: batch.rows, fullSnapshot: argv.includes("--full-snapshot") }),
    "growth_prospect_import_cli",
  );
}
if (require.main === module)
  main()
    .then((out) => {
      process.stdout.write(`${JSON.stringify(out)}\n`);
      return db.end?.();
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
module.exports = { main };
