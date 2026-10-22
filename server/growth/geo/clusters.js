"use strict";
const crypto = require("crypto");
const gate = require("../gate");
const { predicate } = require("../access");

// k-suppression (design spec 9.3 / 10.2): find() validates min_n >= 5, the
// product default. HARD_FLOOR is the absolute floor from the spec: a cluster
// whose (remaining) member count is below 3 must never be emitted, even if a
// future caller lowers min_n below the current validation minimum.
const HARD_FLOOR = 3;
// Defensive cap, moved from users to distinct CENTROIDS by the aggregation
// below. The old implementation refused to run above 100,000 profile ROWS
// (users), which does not match the spec: work is proportional to active
// centroids (tens of thousands), not users (millions). After the per-user
// gate loop, counts are aggregated per postal_ref in SQL and only
// (postal_ref, count) pairs flow into the neighbourhood join and the greedy
// selection, so the resource that can actually blow up is the number of
// distinct centroids. 250,000 distinct centroids is far above any real
// postal-centroid count for one country + intent + role slice, while still
// bounding the self-join and the in-memory anchor graph.
const MAX_CENTROIDS = 250000;

// Deterministic cluster identity: a hash of everything that defines the
// cluster. Re-running the same computation (same intent, role, country,
// anchor, radius and the same sorted member postal refs) yields the same
// cluster_key, so persistence upserts onto the same growth_clusters row.
function clusterKey({
  intent_code,
  intent,
  role,
  country,
  anchor_postal_ref,
  anchor_id,
  radius_miles,
  miles,
  postal_refs,
} = {}) {
  const anchor = anchor_postal_ref ?? anchor_id;
  const radius = radius_miles ?? miles;
  const sorted = [...(postal_refs || [])]
    .map(Number)
    .sort((a, b) => a - b);
  const canonical = JSON.stringify([
    intent_code || intent || null,
    role || null,
    country || null,
    anchor == null ? null : Number(anchor),
    radius == null ? null : Number(radius),
    sorted,
  ]);
  return `gc_${crypto.createHash("sha256").update(canonical).digest("hex")}`;
}

// Binary max-heap over { id, count } entries: largest count first, ties by
// lowest anchor id (the greedy tie-break). Entries are validated lazily by
// the caller against the anchors' current counts, so decremented anchors
// simply push a fresh entry and stale entries are skipped when popped.
class AnchorHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  static higher(a, b) {
    return a.count > b.count || (a.count === b.count && a.id < b.id);
  }
  push(entry) {
    const items = this.items;
    items.push(entry);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!AnchorHeap.higher(items[i], items[parent])) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      i = parent;
    }
  }
  pop() {
    const items = this.items;
    if (!items.length) return null;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let best = i;
        if (
          left < items.length &&
          AnchorHeap.higher(items[left], items[best])
        )
          best = left;
        if (
          right < items.length &&
          AnchorHeap.higher(items[right], items[best])
        )
          best = right;
        if (best === i) break;
        [items[i], items[best]] = [items[best], items[i]];
        i = best;
      }
    }
    return top;
  }
}

// Pure greedy selection, with the exact semantics of the original rescan
// loop: repeatedly take the anchor with the largest neighbourhood count of
// not-yet-used centroids (ties: lowest anchor id); if that count is below
// the effective minimum, stop; emit the anchor's unused centroids, mark
// them used, remove the anchor, and repeat. Anchors other than the selected
// one stay in play even if their own centroid was used by an earlier
// cluster, exactly as before.
//
// anchorsWithCounts: array (or Map values) of
//   { id | anchor_id, place_name?, centroids | postal_refs: [centroidId] }
//   An optional precomputed `count` is ignored: counts are always derived
//   from membersByCentroid so the two inputs cannot disagree.
// membersByCentroid: Map or plain object of centroidId -> eligible members.
// minN: requested minimum; the effective minimum is max(minN, HARD_FLOOR).
//
// Instead of rescanning every anchor on every round (O(anchors^2)), each
// anchor's count is computed once, a centroid -> anchors index is built
// once, and selecting a cluster decrements only the anchors that contain a
// newly used centroid. Total work is O((anchors + neighbourhood edges)
// log anchors).
function selectClusters(anchorsWithCounts, membersByCentroid, minN) {
  const effectiveMin = Math.max(
    Number.isFinite(minN) ? minN : 0,
    HARD_FLOOR,
  );
  const counts = new Map();
  if (membersByCentroid instanceof Map) {
    for (const [k, v] of membersByCentroid) counts.set(Number(k), Number(v));
  } else if (membersByCentroid && typeof membersByCentroid === "object") {
    for (const [k, v] of Object.entries(membersByCentroid))
      counts.set(Number(k), Number(v));
  }
  const anchorList =
    anchorsWithCounts instanceof Map
      ? [...anchorsWithCounts.values()]
      : [...(anchorsWithCounts || [])];
  // Merge duplicate anchor entries and dedupe each anchor's centroid list,
  // preserving first-seen order (the original built one list per anchor id
  // from the self-join rows in order).
  const states = new Map();
  for (const anchor of anchorList) {
    const id = Number(anchor.id ?? anchor.anchor_id);
    if (!Number.isFinite(id)) continue;
    let state = states.get(id);
    if (!state) {
      state = {
        id,
        place_name: anchor.place_name ?? null,
        centroids: [],
        seen: new Set(),
        count: 0,
      };
      states.set(id, state);
    }
    if (state.place_name == null && anchor.place_name != null)
      state.place_name = anchor.place_name;
    for (const raw of anchor.centroids || anchor.postal_refs || []) {
      const centroid = Number(raw);
      if (!Number.isFinite(centroid) || state.seen.has(centroid)) continue;
      state.seen.add(centroid);
      state.centroids.push(centroid);
    }
  }
  // centroid -> anchors index: the only anchors whose count can change when
  // a centroid is used are the anchors whose neighbourhood contains it.
  const anchorsByCentroid = new Map();
  for (const state of states.values()) {
    state.count = state.centroids.reduce(
      (n, c) => n + (counts.get(c) || 0),
      0,
    );
    for (const centroid of state.centroids) {
      const list = anchorsByCentroid.get(centroid) || [];
      list.push(state.id);
      anchorsByCentroid.set(centroid, list);
    }
  }
  const heap = new AnchorHeap();
  for (const state of states.values())
    heap.push({ id: state.id, count: state.count });
  const used = new Set();
  const removed = new Set();
  const result = [];
  while (heap.size) {
    const top = heap.pop();
    const state = states.get(top.id);
    // Lazy deletion: skip entries for removed anchors and stale entries
    // superseded by a decrement push.
    if (!state || removed.has(top.id) || top.count !== state.count)
      continue;
    if (state.count < effectiveMin) break;
    removed.add(state.id);
    const postal_refs = state.centroids.filter((c) => !used.has(c));
    const member_count = postal_refs.reduce(
      (n, c) => n + (counts.get(c) || 0),
      0,
    );
    // member_count equals state.count by construction; the guard keeps the
    // hard floor absolute even if the inputs disagreed.
    if (member_count >= HARD_FLOOR)
      result.push({
        anchor_id: state.id,
        place_name: state.place_name,
        member_count,
        postal_refs,
      });
    for (const centroid of state.centroids) {
      if (used.has(centroid)) continue;
      used.add(centroid);
      const decrement = counts.get(centroid) || 0;
      if (!decrement) continue;
      for (const anchorId of anchorsByCentroid.get(centroid) || []) {
        if (removed.has(anchorId)) continue;
        const other = states.get(anchorId);
        if (!other) continue;
        other.count -= decrement;
        heap.push({ id: other.id, count: other.count });
      }
    }
  }
  return result;
}

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
  // Step 1 (unchanged eligibility semantics): resolve the candidate
  // user -> postal_ref rows under the territorial predicate, then apply the
  // per-user consent gate (gate.contexts + gate.allow) row by row. The gate
  // is per user, so this loop cannot move into SQL; everything after it
  // works on aggregated centroids only, never on user rows again.
  const { rows } = await conn.query(
    `SELECT p.user_id,p.postal_ref FROM user_interest_profiles p JOIN users u ON u.id=p.user_id
    JOIN demand_taxonomy_nodes n ON n.id=p.node_id JOIN geo_postal_centroids g ON g.id=p.postal_ref
    WHERE n.code=$1 AND n.status='active' AND NOT n.sensitive AND ${require("../roles").ROLE_SQL}=$2 AND g.country=$3
    AND p.score>=0.5 AND p.last_seen>NOW()-interval '60 days' AND ${where}
    ORDER BY p.user_id`,
    params,
  );
  const contexts = await gate.contexts(
    rows.map((r) => r.user_id),
    { db: conn },
  );
  const eligibleUserIds = [];
  for (const row of rows) {
    if (
      (await gate.allow(contexts.get(row.user_id), "activity_offers")).allowed
    )
      eligibleUserIds.push(row.user_id);
  }
  if (!eligibleUserIds.length) return [];
  // Step 2: aggregate the eligible users per postal_ref in SQL. Only
  // (postal_ref, count) pairs leave this query. The DISTINCT unnest keeps a
  // duplicated eligible id from multiplying the join.
  const { rows: aggregated } = await conn.query(
    `WITH eligible(user_id) AS (SELECT DISTINCT unnest($1::uuid[]))
    SELECT p.postal_ref AS postal_ref,COUNT(*)::int AS member_count
    FROM user_interest_profiles p
    JOIN eligible e ON e.user_id=p.user_id
    JOIN demand_taxonomy_nodes n ON n.id=p.node_id
    WHERE n.code=$2 AND n.status='active' AND NOT n.sensitive
    AND p.score>=0.5 AND p.last_seen>NOW()-interval '60 days' AND p.postal_ref IS NOT NULL
    GROUP BY p.postal_ref ORDER BY p.postal_ref`,
    [eligibleUserIds, intent],
  );
  if (!aggregated.length) return [];
  if (aggregated.length > MAX_CENTROIDS)
    throw new Error("cluster_requires_partitioning");
  const memberCounts = new Map(
    aggregated.map((r) => [Number(r.postal_ref), Number(r.member_count)]),
  );
  // Step 3: the neighbourhood computation in ONE SQL statement over the
  // eligible centroids only. Centroid/count pairs are bound as parallel
  // arrays and re-expanded by the eligible CTE, so neighbour member counts
  // travel with the join instead of being re-looked-up per anchor in JS.
  // The half radius is unchanged: ST_DWithin at miles * 1609.344 / 2, so two
  // members of one cluster are at most `miles` apart (diameter guarantee).
  const centroidIds = [...memberCounts.keys()];
  const { rows: neighbours } = await conn.query(
    `WITH eligible(postal_ref,member_count) AS (SELECT unnest($1::int[]),unnest($2::int[]))
    SELECT c.id,c.place_name,n.id AS neighbour,en.member_count AS neighbour_count
    FROM geo_postal_centroids c
    JOIN eligible ea ON ea.postal_ref=c.id
    JOIN geo_postal_centroids n ON ST_DWithin(c.geog,n.geog,$3)
    JOIN eligible en ON en.postal_ref=n.id
    WHERE c.country=$4 AND n.country=$4
    ORDER BY c.id,n.id`,
    [
      centroidIds,
      centroidIds.map((id) => memberCounts.get(id)),
      (miles * 1609.344) / 2,
      country,
    ],
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
  if (!anchors.size) return [];
  // Step 4: incremental greedy selection (see selectClusters). No rescans.
  return selectClusters(anchors, memberCounts, min_n).map((cluster) => ({
    ...cluster,
    miles,
    cluster_key: clusterKey({
      intent,
      role,
      country,
      anchor_postal_ref: cluster.anchor_id,
      miles,
      postal_refs: cluster.postal_refs,
    }),
  }));
}

// Upsert computed clusters into growth_clusters (migration 937) by their
// deterministic cluster_key. find() stays read-only; callers that want a
// run persisted call this explicitly. Clusters below the hard floor are
// never persisted, matching the emission guard in selectClusters.
async function persistClusters(conn, clusters, context = {}) {
  const intent_code = context.intent_code || context.intent;
  const role = context.role;
  const country = context.country;
  if (
    !Array.isArray(clusters) ||
    !/^[a-z][a-z0-9_.]{1,120}$/.test(intent_code || "") ||
    !["customer", "helper", "business", "restaurant"].includes(role) ||
    !/^[A-Z]{2}$/.test(country || "")
  )
    throw new Error("invalid_cluster_persist");
  const saved = [];
  for (const cluster of clusters) {
    const member_count = Number(cluster.member_count);
    if (!Number.isInteger(member_count) || member_count < HARD_FLOOR)
      continue;
    const anchor = cluster.anchor_postal_ref ?? cluster.anchor_id;
    const radius = cluster.radius_miles ?? cluster.miles ?? context.radius_miles ?? context.miles;
    if (anchor == null || !Number.isFinite(Number(radius)))
      throw new Error("invalid_cluster_persist");
    const postal_refs = [...(cluster.postal_refs || [])].map(Number);
    const key =
      cluster.cluster_key ||
      clusterKey({
        intent_code,
        role,
        country,
        anchor_postal_ref: anchor,
        radius_miles: radius,
        postal_refs,
      });
    const {
      rows: [row],
    } = await conn.query(
      `INSERT INTO growth_clusters
      (cluster_key,intent_code,role,country,anchor_postal_ref,place_name,member_count,radius_miles,postal_refs,run_date,first_seen_at,last_seen_at,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::date,CURRENT_DATE),NOW(),NOW(),NOW(),NOW())
      ON CONFLICT (cluster_key) DO UPDATE SET
        member_count=EXCLUDED.member_count,
        place_name=EXCLUDED.place_name,
        postal_refs=EXCLUDED.postal_refs,
        run_date=EXCLUDED.run_date,
        last_seen_at=NOW(),
        updated_at=NOW()
      RETURNING *`,
      [
        key,
        intent_code,
        role,
        country,
        Number(anchor),
        cluster.place_name || null,
        member_count,
        Number(radius),
        postal_refs,
        context.run_date || null,
      ],
    );
    saved.push(row);
  }
  return saved;
}

// Link a persisted cluster to a growth segment (migration 926
// growth_segments). The segment must exist; clusters carry the reference
// (growth_clusters.segment_id, migration 937) because segment definitions
// are versioned JSON with no cluster table of their own, so there is no
// reverse column to keep in sync. Accepts a numeric cluster id or a
// cluster_key string.
async function linkClusterToSegment(conn, clusterKeyOrId, segmentId) {
  const segment_id = Number(segmentId);
  if (!Number.isInteger(segment_id) || segment_id <= 0)
    throw new Error("invalid_segment_link");
  const {
    rows: [segment],
  } = await conn.query("SELECT id FROM growth_segments WHERE id=$1", [
    segment_id,
  ]);
  if (!segment) throw new Error("segment_not_found");
  const byId =
    typeof clusterKeyOrId === "number" ||
    (typeof clusterKeyOrId === "string" && /^[1-9]\d*$/.test(clusterKeyOrId));
  const {
    rows: [row],
  } = await conn.query(
    byId
      ? `UPDATE growth_clusters SET segment_id=$2,updated_at=NOW() WHERE id=$1 RETURNING *`
      : `UPDATE growth_clusters SET segment_id=$2,updated_at=NOW() WHERE cluster_key=$1 RETURNING *`,
    [byId ? Number(clusterKeyOrId) : String(clusterKeyOrId), segment_id],
  );
  if (!row) throw new Error("cluster_not_found");
  return row;
}

module.exports = {
  find,
  selectClusters,
  clusterKey,
  computeClusterKey: clusterKey,
  persistClusters,
  linkClusterToSegment,
  HARD_FLOOR,
  MAX_CENTROIDS,
};
