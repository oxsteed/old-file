#!/usr/bin/env node
"use strict";
const fs = require("fs"),
  readline = require("readline");
const { latLngToCell } = require("h3-js");
const { withTransaction } = require("../utils/transaction");
function parse(line, version) {
  const c = line.split("\t"),
    lat = Number(c[9]),
    lng = Number(c[10]);
  if (
    c.length < 11 ||
    !/^[A-Z]{2}$/.test(c[0]) ||
    !c[1] ||
    !c[2] ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    return null;
  return [
    c[0],
    c[1].replace(/\s+/g, "").toUpperCase(),
    c[2],
    c[4] || c[3] || "",
    c[6] || c[5] || "",
    lat,
    lng,
    latLngToCell(lat, lng, 5),
    latLngToCell(lat, lng, 7),
    version,
  ];
}
async function importFile(file, version, db = require("../db")) {
  if (!version || !/^[-a-zA-Z0-9_.]{1,80}$/.test(version))
    throw new Error("source_version_required");
  const reader = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });
  let imported = 0,
    rejected = 0;
  let batch = [];
  const flush = async () => {
    await withTransaction(
      db,
      async (conn) => {
        for (const row of batch)
          await conn.query(
            `INSERT INTO geo_postal_centroids(country,postal_code,place_name,admin1,admin2,lat,lng,geog,h3_r5,h3_r7,source_version)
    VALUES($1,$2,$3,$4,$5,$6,$7,ST_SetSRID(ST_MakePoint($7,$6),4326)::geography,$8,$9,$10)
    ON CONFLICT(country,postal_code,place_name) DO UPDATE SET admin1=EXCLUDED.admin1,admin2=EXCLUDED.admin2,
    lat=EXCLUDED.lat,lng=EXCLUDED.lng,geog=EXCLUDED.geog,h3_r5=EXCLUDED.h3_r5,h3_r7=EXCLUDED.h3_r7,source_version=EXCLUDED.source_version`,
            row,
          );
      },
      "growth_centroid_import",
    );
    imported += batch.length;
    batch = [];
  };
  for await (const line of reader) {
    const row = parse(line, version);
    if (!row) {
      rejected++;
      continue;
    }
    batch.push(row);
    if (batch.length === 500) await flush();
  }
  if (batch.length) await flush();
  return { imported, rejected, attribution: "GeoNames CC BY 4.0" };
}
if (require.main === module)
  importFile(process.argv[2], process.argv[3])
    .then((result) => {
      console.log(JSON.stringify(result));
      return require("../db").end();
    })
    .catch(() => {
      console.error("Postal centroid import failed.");
      process.exitCode = 1;
      require("../db").end();
    });
module.exports = { parse, importFile };
