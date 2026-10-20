"use strict";
const gate = require("../gate");
const { predicate } = require("../access");
async function find(
  conn,
  { intent, role, country, miles = 35, min_n = 5 },
  boundary,
) {
  if (
    !/^[a-z][a-z0-9_.]{1,120}$/.test(intent || "") ||
    !["customer", "helper", "business", "restaurant"].includes(role) ||
    !/^[A-Z]{2}$/.test(country || "") ||
    !Number.isFinite(miles) ||
    miles <= 0 ||
    miles > 300 ||
    !Number.isInteger(min_n) ||
    min_n < 5 ||
    min_n > 100000
  )
    throw new Error("invalid_cluster_request");
  if (!gate.rolloutAllows(await gate.runtimePolicy(conn)).allowed) return [];
  const params = [intent, role, country],
    where = predicate(boundary, "g", params);
  const { rows } = await conn.query(
    `SELECT p.user_id,p.postal_ref,p.score FROM user_interest_profiles p JOIN users u ON u.id=p.user_id
    JOIN demand_taxonomy_nodes n ON n.id=p.node_id JOIN geo_postal_centroids g ON g.id=p.postal_ref
    WHERE n.code=$1 AND n.status='active' AND NOT n.sensitive AND ${require("../roles").ROLE_SQL}=$2 AND g.country=$3
    AND p.score>=0.5 AND p.last_seen>NOW()-interval '60 days' AND ${where}
    ORDER BY p.user_id LIMIT 100001`,
    params,
  );
  if (rows.length > 100000) throw new Error("cluster_requires_partitioning");
  const members = new Map();
  const contexts = await gate.contexts(
    rows.map((r) => r.user_id),
    { db: conn },
  );
  for (const row of rows) {
    if (
      (await gate.allow(contexts.get(row.user_id), "activity_offers")).allowed
    ) {
      const list = members.get(row.postal_ref) || [];
      list.push(row.user_id);
      members.set(row.postal_ref, list);
    }
  }
  if (!members.size) return [];
  const { rows: neighbours } = await conn.query(
    `SELECT c.id,c.place_name,n.id AS neighbour FROM geo_postal_centroids c
    JOIN geo_postal_centroids n ON ST_DWithin(c.geog,n.geog,$2)
    WHERE c.id=ANY($1::int[]) AND n.id=ANY($1::int[]) AND c.country=$3 AND n.country=$3`,
    [[...members.keys()], (miles * 1609.344) / 2, country],
  );
  const anchors = new Map();
  for (const row of neighbours) {
    const anchor = anchors.get(row.id) || {
      id: row.id,
      place_name: row.place_name,
      centroids: [],
    };
    anchor.centroids.push(row.neighbour);
    anchors.set(row.id, anchor);
  }
  const result = [],
    used = new Set();
  while (anchors.size) {
    const candidates = [...anchors.values()]
      .map((a) => ({
        ...a,
        count: a.centroids
          .filter((c) => !used.has(c))
          .reduce((n, c) => n + members.get(c).length, 0),
      }))
      .sort((a, b) => b.count - a.count || a.id - b.id);
    const best = candidates[0];
    if (best.count < min_n) break;
    result.push({
      anchor_id: best.id,
      place_name: best.place_name,
      member_count: best.count,
      miles,
      postal_refs: best.centroids.filter((c) => !used.has(c)),
    });
    best.centroids.forEach((c) => used.add(c));
    anchors.delete(best.id);
  }
  return result;
}
module.exports = { find };
