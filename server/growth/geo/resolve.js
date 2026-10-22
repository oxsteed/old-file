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

// Batched form of resolve(): identical matching semantics (lowest centroid
// id wins; postal match first, then place-centroid fallback, then
// city+state) with a bounded number of queries for any number of places:
// one per pass plus one alias lookup per distinct (country, state) pair.
// Keys are kept as objects, never round-tripped through string splitting,
// so a place name containing a separator character cannot corrupt the
// mapping. In the city+state pass each place is tried against its admin1
// candidates in resolve()'s order and the first candidate with a row
// wins, exactly like resolve() step 4. Returns an array parallel to
// `places` of centroid ids, with 0 where resolve() would return 0.
async function resolveBatch(conn, places) {
  const results = new Array(places.length).fill(0);
  const groupEntries = () => {
    const byKey = new Map();
    const entries = [];
    return {
      entries,
      add(parts, index) {
        const mapKey = JSON.stringify(parts);
        if (!byKey.has(mapKey)) {
          const entry = { parts, indexes: [] };
          byKey.set(mapKey, entry);
          entries.push(entry);
        }
        byKey.get(mapKey).indexes.push(index);
      },
    };
  };
  const candidateCache = new Map();
  const candidatesFor = async (country, stateInput) => {
    const cacheKey = `${country}\n${stateInput}`;
    if (!candidateCache.has(cacheKey))
      candidateCache.set(
        cacheKey,
        await admin1Candidates(conn, country, stateInput),
      );
    return candidateCache.get(cacheKey);
  };

  // Pass 1: exact postal rows.
  const postal = groupEntries();
  places.forEach((place, index) => {
    const { country, postal_code } = place || {};
    if (!/^[A-Z]{2}$/.test(country || "")) return;
    const code = normalizePostal(postal_code);
    if (!code) return;
    postal.add([country, code], index);
  });
  if (postal.entries.length) {
    const { rows } = await conn.query(
      `WITH keys AS (
         SELECT country, postal_code, ord FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS t(country, postal_code, ord)
       )
       SELECT k.ord, MIN(c.id) AS id
       FROM keys k JOIN geo_postal_centroids c ON c.country = k.country AND c.postal_code = k.postal_code
       GROUP BY k.ord`,
      [
        postal.entries.map((e) => e.parts[0]),
        postal.entries.map((e) => e.parts[1]),
      ],
    );
    const found = new Map(rows.map((r) => [Number(r.ord), r.id]));
    postal.entries.forEach((entry, i) => {
      const id = found.get(i + 1);
      if (id === undefined) return;
      for (const index of entry.indexes) results[index] = id;
    });
  }

  // Pass 2: place centroids (postal_code=''), mirroring resolve() steps
  // 2-3 for places the postal pass left unresolved.
  const placePass = groupEntries();
  places.forEach((place, index) => {
    if (results[index] !== 0) return;
    const { country, city } = place || {};
    if (!/^[A-Z]{2}$/.test(country || "") || !city) return;
    placePass.add([country, String(city).slice(0, 120)], index);
  });
  if (placePass.entries.length) {
    const { rows } = await conn.query(
      `WITH keys AS (
         SELECT country, city, ord FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS t(country, city, ord)
       )
       SELECT k.ord, c.id, c.admin1
       FROM keys k JOIN geo_postal_centroids c
         ON c.country = k.country AND c.postal_code = '' AND lower(c.place_name) = lower(k.city)
       ORDER BY k.ord, c.id`,
      [
        placePass.entries.map((e) => e.parts[0]),
        placePass.entries.map((e) => e.parts[1]),
      ],
    );
    const byOrd = new Map();
    for (const row of rows) {
      if (!byOrd.has(Number(row.ord))) byOrd.set(Number(row.ord), []);
      byOrd.get(Number(row.ord)).push(row);
    }
    for (let i = 0; i < placePass.entries.length; i++) {
      const candidates = byOrd.get(i + 1) || [];
      if (!candidates.length) continue;
      const [country] = placePass.entries[i].parts;
      for (const index of placePass.entries[i].indexes) {
        const stateInput = places[index].state
          ? String(places[index].state).slice(0, 120)
          : "";
        if (stateInput) {
          const widened = await candidatesFor(country, stateInput);
          const match = candidates.find(
            (place) =>
              place.admin1 &&
              widened.some(
                (candidate) =>
                  String(place.admin1).toLowerCase() ===
                  String(candidate).toLowerCase(),
              ),
          );
          if (match) results[index] = match.id;
          // No match: leave for the city+state pass, like resolve().
        } else if (candidates.length === 1) {
          results[index] = candidates[0].id;
        }
        // Ambiguous city with no state: stays 0 (fail closed), like resolve().
      }
    }
  }

  // Pass 3: postal-row city+state, tried against every admin1 candidate
  // in order; the first candidate with a row wins (resolve() step 4).
  const cityPass = groupEntries();
  for (let index = 0; index < places.length; index++) {
    if (results[index] !== 0) continue;
    const place = places[index] || {};
    const { country, city, state } = place;
    if (!/^[A-Z]{2}$/.test(country || "") || !city || !state) continue;
    const widened = await candidatesFor(country, String(state).slice(0, 120));
    for (const candidate of widened)
      cityPass.add([country, String(city).slice(0, 120), candidate], index);
  }
  if (cityPass.entries.length) {
    const { rows } = await conn.query(
      `WITH keys AS (
         SELECT country, city, state, ord FROM unnest($1::text[], $2::text[], $3::text[]) WITH ORDINALITY AS t(country, city, state, ord)
       )
       SELECT k.ord, MIN(c.id) AS id
       FROM keys k JOIN geo_postal_centroids c
         ON c.country = k.country AND lower(c.place_name) = lower(k.city) AND lower(c.admin1) = lower(k.state)
       GROUP BY k.ord`,
      [
        cityPass.entries.map((e) => e.parts[0]),
        cityPass.entries.map((e) => e.parts[1]),
        cityPass.entries.map((e) => e.parts[2]),
      ],
    );
    const found = new Map(rows.map((r) => [Number(r.ord), r.id]));
    cityPass.entries.forEach((entry, i) => {
      const id = found.get(i + 1);
      if (id === undefined) return;
      for (const index of entry.indexes)
        if (results[index] === 0) results[index] = id;
    });
  }
  return results;
}
module.exports = { resolve, resolveBatch, normalizePostal };
