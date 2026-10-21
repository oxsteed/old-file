#!/usr/bin/env node
"use strict";

// D16 read-only comparison for the reversible regional geo-source switch.
// It reports aggregate disagreement counts only; no user or postal values are
// printed. Set REGION_GEO_DIFF_LIMIT for a bounded rehearsal sample.
const db = require("../server/db");

function diffQuery(limit = 10000) {
  const n = Math.max(1, Math.min(100000, Number(limit) || 10000));
  return {
    text: `WITH sample AS (
      SELECT u.id,u.country,u.zip_code,d.lat AS direct_lat,d.lng AS direct_lng,
             g.lat AS centroid_lat,g.lng AS centroid_lng
        FROM users u
        LEFT JOIN LATERAL (
          SELECT lat,lng FROM direct_geocode_cache
           WHERE upper(btrim(COALESCE(u.country,'')))='US'
             AND zip_code=substring(btrim(COALESCE(u.zip_code,'')) FROM '^[0-9]{5}')
           ORDER BY updated_at DESC NULLS LAST LIMIT 1
        ) d ON TRUE
        LEFT JOIN LATERAL (
          SELECT z.lat,z.lng FROM geo_postal_centroids z
           WHERE upper(btrim(COALESCE(u.country,'')))=upper(btrim(COALESCE(z.country,'')))
             AND z.postal_code=substring(btrim(COALESCE(u.zip_code,'')) FROM '^[0-9]{3,10}')
           ORDER BY z.id LIMIT 1
        ) g ON TRUE
       WHERE d.lat IS NOT NULL OR g.lat IS NOT NULL
       LIMIT $1
    )
    SELECT COUNT(*)::int AS matched,
           COUNT(*) FILTER (WHERE direct_lat IS NULL OR centroid_lat IS NULL)::int AS one_sided,
           COUNT(*) FILTER (WHERE direct_lat IS NOT NULL AND centroid_lat IS NOT NULL
             AND abs(direct_lat-centroid_lat)>0.01)::int AS latitude_disagreements,
           COUNT(*) FILTER (WHERE direct_lng IS NOT NULL AND centroid_lng IS NOT NULL
             AND abs(direct_lng-centroid_lng)>0.01)::int AS longitude_disagreements
      FROM sample`,
    values: [n],
  };
}

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
