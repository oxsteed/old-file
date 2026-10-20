"use strict";
async function resolve(conn, { country, postal_code, city, state }) {
  if (!/^[A-Z]{2}$/.test(country || "")) return 0;
  const postal = String(postal_code || "")
    .replace(/\s+/g, "")
    .toUpperCase();
  if (postal) {
    const {
      rows: [row],
    } = await conn.query(
      "SELECT id FROM geo_postal_centroids WHERE country=$1 AND postal_code=$2 ORDER BY id LIMIT 1",
      [country, postal],
    );
    if (row) return row.id;
  }
  if (city && state) {
    const {
      rows: [row],
    } = await conn.query(
      `SELECT id FROM geo_postal_centroids WHERE country=$1 AND lower(place_name)=lower($2)
    AND lower(admin1)=lower($3) ORDER BY id LIMIT 1`,
      [country, String(city).slice(0, 120), String(state).slice(0, 120)],
    );
    if (row) return row.id;
  }
  return 0;
}

// Batched form of resolve(): identical matching semantics (lowest centroid id
// wins, postal match first, then city+state fallback) but at most two queries
// for any number of places. Returns an array parallel to `places` of centroid
// ids, with 0 where resolve() would return 0.
async function resolveBatch(conn, places) {
  const results = new Array(places.length).fill(0);
  const postalKeys = new Map(); // "country\npostal" -> [place indexes]
  places.forEach((place, index) => {
    const { country, postal_code } = place || {};
    if (!/^[A-Z]{2}$/.test(country || "")) return;
    const postal = String(postal_code || "")
      .replace(/\s+/g, "")
      .toUpperCase();
    if (!postal) return;
    const key = `${country}\n${postal}`;
    if (!postalKeys.has(key)) postalKeys.set(key, []);
    postalKeys.get(key).push(index);
  });
  if (postalKeys.size) {
    const keys = [...postalKeys.keys()].map((k) => k.split("\n"));
    const { rows } = await conn.query(
      `WITH keys AS (
         SELECT country, postal_code, ord FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS t(country, postal_code, ord)
       )
       SELECT k.ord, MIN(c.id) AS id
       FROM keys k JOIN geo_postal_centroids c ON c.country = k.country AND c.postal_code = k.postal_code
       GROUP BY k.ord`,
      [keys.map((k) => k[0]), keys.map((k) => k[1])],
    );
    const found = new Map(rows.map((r) => [Number(r.ord), r.id]));
    keys.forEach((_, i) => {
      const id = found.get(i + 1);
      if (id === undefined) return;
      for (const index of postalKeys.get(keys[i].join("\n"))) results[index] = id;
    });
  }
  // City+state pass covers places with no postal code and places whose
  // postal code matched no centroid, exactly like resolve().
  const cityKeys = new Map(); // "country\ncity\nstate" -> [place indexes]
  places.forEach((place, index) => {
    if (results[index] !== 0) return;
    const { country, city, state } = place || {};
    if (!/^[A-Z]{2}$/.test(country || "") || !city || !state) return;
    const key = `${country}\n${String(city).slice(0, 120)}\n${String(state).slice(0, 120)}`;
    if (!cityKeys.has(key)) cityKeys.set(key, []);
    cityKeys.get(key).push(index);
  });
  if (cityKeys.size) {
    const keys = [...cityKeys.keys()].map((k) => k.split("\n"));
    const { rows } = await conn.query(
      `WITH keys AS (
         SELECT country, city, state, ord FROM unnest($1::text[], $2::text[], $3::text[]) WITH ORDINALITY AS t(country, city, state, ord)
       )
       SELECT k.ord, MIN(c.id) AS id
       FROM keys k JOIN geo_postal_centroids c
         ON c.country = k.country AND lower(c.place_name) = lower(k.city) AND lower(c.admin1) = lower(k.state)
       GROUP BY k.ord`,
      [keys.map((k) => k[0]), keys.map((k) => k[1]), keys.map((k) => k[2])],
    );
    const found = new Map(rows.map((r) => [Number(r.ord), r.id]));
    keys.forEach((_, i) => {
      const id = found.get(i + 1);
      if (id === undefined) return;
      for (const index of cityKeys.get(keys[i].join("\n"))) results[index] = id;
    });
  }
  return results;
}
module.exports = { resolve, resolveBatch };
