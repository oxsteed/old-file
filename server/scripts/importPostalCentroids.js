#!/usr/bin/env node
"use strict";
const fs = require("fs"),
  readline = require("readline");
const { latLngToCell } = require("h3-js");
const { withTransaction } = require("../utils/transaction");
const ATTRIBUTION = "GeoNames CC BY 4.0";
const CENTROID_INSERT_SQL = `INSERT INTO geo_postal_centroids(country,postal_code,place_name,admin1,admin2,lat,lng,geog,h3_r5,h3_r7,source_version)
    VALUES($1,$2,$3,$4,$5,$6,$7,ST_SetSRID(ST_MakePoint($7,$6),4326)::geography,$8,$9,$10)
    ON CONFLICT(country,postal_code,place_name) DO UPDATE SET admin1=EXCLUDED.admin1,admin2=EXCLUDED.admin2,
    lat=EXCLUDED.lat,lng=EXCLUDED.lng,geog=EXCLUDED.geog,h3_r5=EXCLUDED.h3_r5,h3_r7=EXCLUDED.h3_r7,source_version=EXCLUDED.source_version`;
function assertVersion(version) {
  if (!version || !/^[-a-zA-Z0-9_.]{1,80}$/.test(version))
    throw new Error("source_version_required");
}
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
    // Postal normalization: strip all whitespace + uppercase. PAIRED CODE:
    // normalizePostal() in server/growth/geo/resolve.js implements the exact
    // same rule for lookups. Keep the two in sync.
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
  assertVersion(version);
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
        for (const row of batch) await conn.query(CENTROID_INSERT_SQL, row);
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
  return { imported, rejected, attribution: ATTRIBUTION };
}

// GeoNames cities file (cities500 / cities1000) tab format:
//   0 geonameid, 1 name, 2 asciiname, 3 alternatenames, 4 lat, 5 lng,
//   6 feature class, 7 feature code, 8 country, 9 cc2, 10 admin1 (CODE),
//   11 admin2, 12 admin3, 13 admin4, 14 population, ...
// Only populated places (feature class 'P') with a country and valid
// coordinates become place-centroid fallback rows in geo_postal_centroids:
// postal_code is stored as '' (the column is NOT NULL and the
// UNIQUE(country,postal_code,place_name) key keeps '' place rows distinct
// from real postal rows for the same place name).
// place_name is the GeoNames `name`, falling back to `asciiname`.
// admin1 is stored as the CODE from the file; the matching admin1 NAME lives
// in geo_admin1_names (see importAdmin1File) and the resolver joins the two
// at lookup time.
// POPULATION LIMITATION: column 14 (population) is read for validation only
// and is NOT stored — geo_postal_centroids has no population column, and the
// cities file is not population-ordered, so import order cannot proxy for
// size either. Preference is handled at resolve time (see resolve.js):
// postal rows beat place rows, place rows with an admin1 match beat a lone
// place row, and remaining ties break by lowest id.
function parseCitiesLine(line, version) {
  const c = String(line || "").split("\t"),
    lat = Number(c[4]),
    lng = Number(c[5]);
  if (
    c.length < 15 ||
    c[6] !== "P" ||
    !/^[A-Z]{2}$/.test(c[8] || "") ||
    !(c[1] || c[2]) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    return null;
  return [
    c[8],
    "",
    c[1] || c[2],
    c[10] || "",
    c[11] || "",
    lat,
    lng,
    latLngToCell(lat, lng, 5),
    latLngToCell(lat, lng, 7),
    version,
  ];
}
async function importCitiesFile(file, version, db = require("../db")) {
  assertVersion(version);
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
        for (const row of batch) await conn.query(CENTROID_INSERT_SQL, row);
      },
      "growth_city_centroid_import",
    );
    imported += batch.length;
    batch = [];
  };
  for await (const line of reader) {
    const row = parseCitiesLine(line, version);
    if (!row) {
      rejected++;
      continue;
    }
    batch.push(row);
    if (batch.length === 500) await flush();
  }
  if (batch.length) await flush();
  return { imported, rejected, attribution: ATTRIBUTION };
}

// GeoNames admin1CodesASCII format (tab separated):
//   0 concatenated code ("US.FL"), 1 name, 2 asciiname, 3 geonameid
// Rows go to geo_admin1_names(country, admin1_code, name, ascii_name,
// source_version) with UNIQUE(country, admin1_code).
// OPEN DEPENDENCY: no migration in this slice creates geo_admin1_names —
// migration 937 is reserved for the clusters slice, and the table is
// expected from that migration or a follow-up. Until it lands,
// importAdmin1File skips cleanly (see below) and the resolver treats the
// table as optional.
function parseAdmin1Line(line, version) {
  const c = String(line || "").split("\t");
  const match = /^([A-Z]{2})\.([A-Za-z0-9_-]+)$/.exec(c[0] || "");
  if (c.length < 3 || !match || !c[1]) return null;
  return [match[1], match[2], c[1], c[2] || c[1], version];
}
async function geoAdmin1TableExists(db) {
  const sql = "SELECT to_regclass($1) AS reg";
  try {
    if (db && typeof db.query === "function") {
      const { rows } = await db.query(sql, ["geo_admin1_names"]);
      return Boolean(rows && rows[0] && rows[0].reg);
    }
    if (db && typeof db.connect === "function") {
      const client = await db.connect();
      try {
        const { rows } = await client.query(sql, ["geo_admin1_names"]);
        return Boolean(rows && rows[0] && rows[0].reg);
      } finally {
        if (client.release) client.release();
      }
    }
  } catch {
    return false;
  }
  return false;
}
async function importAdmin1File(file, version, db = require("../db")) {
  assertVersion(version);
  if (!(await geoAdmin1TableExists(db)))
    return {
      imported: 0,
      rejected: 0,
      skipped: "geo_admin1_names_missing",
      attribution: ATTRIBUTION,
    };
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
            `INSERT INTO geo_admin1_names(country,admin1_code,name,ascii_name,source_version)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(country,admin1_code) DO UPDATE SET name=EXCLUDED.name,ascii_name=EXCLUDED.ascii_name,source_version=EXCLUDED.source_version`,
            row,
          );
      },
      "growth_admin1_import",
    );
    imported += batch.length;
    batch = [];
  };
  for await (const line of reader) {
    const row = parseAdmin1Line(line, version);
    if (!row) {
      rejected++;
      continue;
    }
    batch.push(row);
    if (batch.length === 500) await flush();
  }
  if (batch.length) await flush();
  return { imported, rejected, attribution: ATTRIBUTION };
}
if (require.main === module) {
  // Usage:
  //   node importPostalCentroids.js postal <file> <version>
  //   node importPostalCentroids.js cities <file> <version>
  //   node importPostalCentroids.js admin1 <file> <version>
  //   node importPostalCentroids.js <file> <version>   (legacy: postal mode)
  const modes = {
    postal: importFile,
    cities: importCitiesFile,
    admin1: importAdmin1File,
  };
  const args = process.argv.slice(2);
  let mode = "postal",
    file = args[0],
    version = args[1];
  if (Object.prototype.hasOwnProperty.call(modes, args[0])) {
    mode = args[0];
    file = args[1];
    version = args[2];
  }
  modes[mode](file, version)
    .then((result) => {
      console.log(JSON.stringify(result));
      return require("../db").end();
    })
    .catch(() => {
      console.error(
        mode === "postal"
          ? "Postal centroid import failed."
          : `${mode} import failed.`,
      );
      process.exitCode = 1;
      require("../db").end();
    });
}
module.exports = {
  parse,
  importFile,
  parseCitiesLine,
  importCitiesFile,
  parseAdmin1Line,
  importAdmin1File,
  geoAdmin1TableExists,
};
