#!/usr/bin/env node
"use strict";

// D16 read-only comparison for the reversible regional geo-source switch.
// It reports aggregate disagreement counts only; no user or postal values are
// printed. Set REGION_GEO_DIFF_LIMIT for a bounded rehearsal sample.
const db = require("../server/db");

// The query lives with the switch module so the server owns it (D16).
const { diffQuery } = require("../server/analytics/regionGeoSourceSwitch");

async function run(conn = db, limit = process.env.REGION_GEO_DIFF_LIMIT) {
  const result = await conn.query(diffQuery(limit));
  return result.rows[0] || {
    matched: 0,
    one_sided: 0,
    latitude_disagreements: 0,
    longitude_disagreements: 0,
  };
}

if (require.main === module) {
  run()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary)}\n`);
      return db.end?.();
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = { diffQuery, run };
