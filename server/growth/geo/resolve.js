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
module.exports = { resolve };
