"use strict";

// normalizePostal(value): the single canonical postal normalization for geo
// resolution — strip ALL whitespace and uppercase (e.g. " k1a 0b1 " ->
// "K1A0B1"). PAIRED CODE: server/scripts/importPostalCentroids.js normalizes
// postal codes the exact same way inline at import time (its parse() does
// .replace(/\s+/g, "").toUpperCase()). Keep the two in sync: stored
// postal_code values are always in this normalized form, so lookups must
// normalize identically or exact matches silently miss.
function normalizePostal(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, "")
    .toUpperCase();
}

// Resolve a state input (a code like "FL" or a full name like "Florida") to
// the set of admin1 values it may be stored as. Cities rows store the admin1
// CODE, postal rows may store the code or the name, and callers pass either
// form — so candidates start with the raw input and are widened through the
// geo_admin1_names alias table (code <-> name <-> ascii name) when that table
// exists. The table is expected from migration 937 (clusters slice) or a
// follow-up; it may be absent, and a missing table must never break
// resolution, hence the to_regclass guard plus try/catch (fail soft to just
// the raw input).
async function admin1Candidates(conn, country, stateInput) {
  const candidates = [stateInput];
  const add = (v) => {
    if (
      v &&
      !candidates.some(
        (existing) => String(existing).toLowerCase() === String(v).toLowerCase(),
      )
    )
      candidates.push(String(v));
  };
  try {
    const { rows } = await conn.query("SELECT to_regclass($1) AS reg", [
      "geo_admin1_names",
    ]);
    const reg = rows && rows[0] && (rows[0].reg ?? rows[0].to_regclass);
    if (!reg) return candidates;
    const { rows: aliases } = await conn.query(
      `SELECT admin1_code, name, ascii_name FROM geo_admin1_names
       WHERE country=$1
         AND (lower(name)=lower($2) OR lower(ascii_name)=lower($2) OR upper(admin1_code)=upper($2))
       ORDER BY admin1_code LIMIT 5`,
      [country, stateInput],
    );
    for (const alias of aliases || []) {
      add(alias.admin1_code);
      add(alias.name);
      add(alias.ascii_name);
    }
  } catch {
    // geo_admin1_names missing/unreadable: fall back to the raw input only.
  }
  return candidates;
}

// Fallback order (first hit wins):
//   1. Exact postal row (normalized postal_code match).
//   2. Place-centroid row (postal_code='') whose admin1 matches the given
//      state, where the state may be a code or a full name (resolved through
//      geo_admin1_names when present, and compared against both the stored
//      code and the stored name).
//   3. A single unambiguous place-centroid row for the city (no state given
//      and exactly one candidate). An ambiguous city with no state returns 0
//      rather than guessing (fail closed). When a state IS given, a place row
//      that does not match it is never used.
//   4. Postal-row city+state match (the original path), tried against every
//      admin1 candidate so a full state name still matches rows storing the
//      code, and vice versa.
// Population preference: geo_postal_centroids has no population column, so
// place rows cannot be ranked by population. Postal rows are preferred over
// place rows, place rows with an admin1 match are preferred over a lone
// place row, and any remaining tie is broken deterministically by lowest id.
async function resolve(conn, { country, postal_code, city, state }) {
  if (!/^[A-Z]{2}$/.test(country || "")) return 0;
  const postal = normalizePostal(postal_code);
  if (postal) {
    const {
      rows: [row],
    } = await conn.query(
      "SELECT id FROM geo_postal_centroids WHERE country=$1 AND postal_code=$2 ORDER BY id LIMIT 1",
      [country, postal],
    );
    if (row) return row.id;
  }
  if (city) {
    const cityInput = String(city).slice(0, 120);
    const stateInput = state ? String(state).slice(0, 120) : "";
    const candidates = stateInput
      ? await admin1Candidates(conn, country, stateInput)
      : [];
    const { rows: places } = await conn.query(
      `SELECT id, admin1 FROM geo_postal_centroids
       WHERE country=$1 AND postal_code='' AND lower(place_name)=lower($2)
       ORDER BY id`,
      [country, cityInput],
    );
    if (places && places.length) {
      if (stateInput) {
        const match = places.find(
          (place) =>
            place.admin1 &&
            candidates.some(
              (candidate) =>
                String(place.admin1).toLowerCase() ===
                String(candidate).toLowerCase(),
            ),
        );
        if (match) return match.id;
        // State given but no place row matches it: fall through to the
        // postal-row city+state path instead of guessing a place row.
      } else if (places.length === 1) {
        return places[0].id;
      } else {
        // Ambiguous city, no state to disambiguate: fail closed. The
        // city+state path below cannot run without a state, so this is
        // equivalent to returning 0 here, stated explicitly for clarity.
        return 0;
      }
    }
    if (stateInput) {
      for (const candidate of candidates) {
        const {
          rows: [row],
        } = await conn.query(
          `SELECT id FROM geo_postal_centroids WHERE country=$1 AND lower(place_name)=lower($2)
    AND lower(admin1)=lower($3) ORDER BY id LIMIT 1`,
          [country, cityInput, candidate],
        );
        if (row) return row.id;
      }
    }
  }
  return 0;
}
module.exports = { resolve, normalizePostal };
