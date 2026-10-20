"use strict";
// Domain-table demand/supply signals for the nightly rollup (spec 10.1).
//
// The ClickHouse event path in growthNightlyRollups covers job events.
// Everything else OxSteed knows about demand and supply already sits in
// Postgres domain tables, so this collector reads those directly:
//   demand  jobs posted / jobs expired unfilled, Discover searches (with a
//           separate zero-result signal), planned needs, saved searches,
//           booking requests, business appointments, paid food orders (by
//           restaurant cuisine), marketplace orders, Direct quote requests
//   supply  bids (domain table), helpers by skill active in 30 days,
//           active business services, active restaurants by cuisine,
//           Direct crew assigned in 30 days
//
// Location basis: postal centroids only, never raw coordinates. Demand
// uses the record's own postal reference when the domain row carries one
// (job location, restaurant address, search postal_ref, shipping ZIP) and
// otherwise the person's profile postal. Supply is always attributed to
// the provider's postal reference (helper service area, business address,
// restaurant address, crew profile), fixing the old job-bid attribution
// to the job's location.
//
// Every subject still passes the authoritative gate (activity_offers)
// before entering a set, exactly like the event path. Each source is
// isolated: a source whose table shape has drifted records an error in
// the run counts instead of failing the whole night.
const crypto = require("crypto");
const db = require("../../db");
const gate = require("../gate");
const resolveRef = require("../geo/resolve").resolve;
const { withTransaction } = require("../../utils/transaction");

const DAY = "($1::date)";
const IN_DAY = (col) => `${col} >= ${DAY} AND ${col} < ${DAY} + 1`;

function newCollector() {
  return {
    demand: new Map(), // postal|node|signal -> Set(userId)
    supply: new Map(), // postal|node|role -> Set(userId)
    bidCapacity: new Map(), // postal|node|helper -> bid count
    sources: {},
  };
}
const key3 = (a, b, c) => `${a}|${b}|${c}`;
function addTo(map, k, user) {
  if (!map.has(k)) map.set(k, new Set());
  map.get(k).add(user);
}
function addDemand(c, postal, node, signal, user) {
  if (!postal || !node || !user) return;
  addTo(c.demand, key3(postal, node, signal), user);
}
function addSupply(c, postal, node, role, user) {
  if (!postal || !node || !user) return;
  addTo(c.supply, key3(postal, node, role), user);
}

async function loadUsers(conn, ids) {
  const out = new Map();
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 500) {
    const { rows } = await conn.query(
      "SELECT id,country,zip_code,city,state FROM users WHERE id = ANY($1::uuid[])",
      [unique.slice(i, i + 500)],
    );
    for (const r of rows) out.set(r.id, r);
  }
  return out;
}

// Only subjects the gate currently allows may enter a set (consent,
// jurisdiction, eligibility), batched like segments.evaluate does.
async function allowedUsers(conn, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const ok = new Set();
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const contexts = await gate.contexts(chunk, { db: conn });
    for (const id of chunk) {
      const permission = await gate.allow(contexts.get(id), "activity_offers");
      if (permission.allowed) ok.add(id);
    }
  }
  return ok;
}

function makeResolver(conn) {
  const userCache = new Map();
  const refCache = new Map();
  async function users(ids) {
    const missing = ids.filter((id) => id && !userCache.has(id));
    if (missing.length)
      for (const [id, row] of await loadUsers(conn, missing))
        userCache.set(id, row);
    return userCache;
  }
  async function ref({ country, postal_code, city, state }) {
    const cc = /^[A-Z]{2}$/.test(country || "") ? country : null;
    if (!cc) return 0;
    const k = `${cc}|${postal_code || ""}|${city || ""}|${state || ""}`;
    if (!refCache.has(k))
      refCache.set(
        k,
        await resolveRef(conn, { country: cc, postal_code, city, state }),
      );
    return refCache.get(k);
  }
  async function profilePostal(userId) {
    const u = (await users([userId])).get(userId);
    if (!u) return 0;
    return ref({
      country: u.country,
      postal_code: u.zip_code,
      city: u.city,
      state: u.state,
    });
  }
  return { users, ref, profilePostal };
}

function makeClassifier(conn) {
  const cache = new Map();
  async function entityNode(entityType, entityId) {
    const k = `e|${entityType}|${entityId}`;
    if (cache.has(k)) return cache.get(k);
    const {
      rows: [row],
    } = await conn.query(
      `SELECT i.node_id FROM entity_intents i JOIN demand_taxonomy_nodes n ON n.id=i.node_id
       WHERE i.entity_type=$1 AND i.entity_id=$2 AND i.superseded_at IS NULL
       AND n.status='active' AND NOT n.sensitive ORDER BY i.id DESC LIMIT 1`,
      [entityType, String(entityId)],
    );
    cache.set(k, row?.node_id || null);
    return cache.get(k);
  }
  async function classifyNode(entityType, entityId, text, fields = {}) {
    const existing = await entityNode(entityType, entityId);
    if (existing) return existing;
    const k = `c|${entityType}|${entityId}`;
    if (cache.has(k)) return cache.get(k);
    let node = null;
    try {
      const classified = await withTransaction(
        db,
        (c2) =>
          require("../classify").classify(c2, {
            entity_type: entityType,
            entity_id: String(entityId),
            text: String(text || "").slice(0, 2000),
            ...fields,
          }),
        "growth_classify",
      );
      node = classified?.review ? null : classified?.node_id || null;
    } catch {
      node = null; // classifier unavailable: the signal is skipped, never guessed
    }
    cache.set(k, node);
    return node;
  }
  async function ruleNode(kind, pattern) {
    const k = `r|${kind}|${pattern}`;
    if (cache.has(k)) return cache.get(k);
    const {
      rows: [row],
    } = await conn.query(
      `SELECT n.id FROM demand_taxonomy_rules r JOIN demand_taxonomy_nodes n ON n.id=r.node_id
       WHERE r.kind=$1 AND r.pattern=$2 AND n.status='active' AND NOT n.sensitive
       ORDER BY r.weight DESC LIMIT 1`,
      [kind, String(pattern)],
    );
    cache.set(k, row?.id || null);
    return cache.get(k);
  }
  return { entityNode, classifyNode, ruleNode };
}

// Applies the gate to a candidate list, then records the survivors.
async function commitCandidates(conn, c, candidates, kind) {
  if (!candidates.length) return 0;
  const ok = await allowedUsers(
    conn,
    candidates.map((x) => x.user),
  );
  let added = 0;
  for (const x of candidates) {
    if (!ok.has(x.user)) continue;
    if (kind === "demand") addDemand(c, x.postal, x.node, x.signal, x.user);
    else addSupply(c, x.postal, x.node, x.role, x.user);
    added++;
  }
  return added;
}

const SOURCES = [
  [
    "jobs",
    async (conn, day, c, R, X) => {
      const { rows } = await conn.query(
        `SELECT id,client_id AS user_id,title,description,category_id,job_type,
                location_zip,location_country_code,location_city,location_state,
                (expires_at >= ${DAY} AND expires_at < ${DAY} + 1
                 AND accepted_at IS NULL
                 AND status IN ('published','matched','negotiating','closed')) AS expired_unfilled,
                (${IN_DAY("created_at")} AND status<>'draft') AS posted
         FROM jobs WHERE deleted_at IS NULL
           AND ((${IN_DAY("created_at")} AND status<>'draft')
             OR (expires_at >= ${DAY} AND expires_at < ${DAY} + 1 AND accepted_at IS NULL
                 AND status IN ('published','matched','negotiating','closed')))`,
        [day],
      );
      const users = await R.users(rows.map((r) => r.user_id));
      const candidates = [];
      for (const job of rows) {
        const node = await X.classifyNode(
          "job",
          job.id,
          `${job.title} ${job.description || ""}`,
          { category_id: job.category_id, job_type: job.job_type },
        );
        if (!node) continue;
        const u = users.get(job.user_id);
        let postal = await R.ref({
          country: job.location_country_code || u?.country,
          postal_code: job.location_zip,
          city: job.location_city,
          state: job.location_state,
        });
        if (!postal) postal = await R.profilePostal(job.user_id);
        if (!postal) continue;
        if (job.posted)
          candidates.push({ user: job.user_id, postal, node, signal: "job.posted" });
        if (job.expired_unfilled)
          candidates.push({
            user: job.user_id,
            postal,
            node,
            signal: "job.unfilled_expired",
          });
      }
      return commitCandidates(conn, c, candidates, "demand");
    },
  ],
  [
    "searches",
    async (conn, day, c, R, X) => {
      const { rows } = await conn.query(
        `SELECT user_id,query_normalized,result_count,postal_ref FROM discover_search_log
         WHERE ${IN_DAY("created_at")} AND user_id IS NOT NULL`,
        [day],
      );
      const candidates = [];
      for (const row of rows) {
        const digest = crypto
          .createHash("sha256")
          .update(row.query_normalized)
          .digest("hex");
        const node = await X.classifyNode("search", digest, row.query_normalized);
        if (!node) continue;
        const postal =
          row.postal_ref > 0 ? row.postal_ref : await R.profilePostal(row.user_id);
        candidates.push({
          user: row.user_id,
          postal,
          node,
          signal: row.result_count === 0 ? "search.zero_result" : "search",
        });
      }
      return commitCandidates(conn, c, candidates, "demand");
    },
  ],
  [
    "planned_needs",
    async (conn, day, c, R, X) => {
      const { rows } = await conn.query(
        `SELECT id,user_id,title,description,category FROM planned_needs
         WHERE ${IN_DAY("created_at")} AND status<>'cancelled'`,
        [day],
      );
      const candidates = [];
      for (const row of rows) {
        const node = await X.classifyNode(
          "planned_need",
          row.id,
          `${row.title} ${row.description || ""} ${row.category || ""}`,
        );
        if (!node) continue;
        candidates.push({
          user: row.user_id,
          postal: await R.profilePostal(row.user_id),
          node,
          signal: "planned_need",
        });
      }
      return commitCandidates(conn, c, candidates, "demand");
    },
  ],
  [
    "saved_searches",
    async (conn, day, c, R, X) => {
      const { rows } = await conn.query(
        `SELECT id,user_id,name,keyword,query,category,city,state FROM saved_searches
         WHERE ${IN_DAY("created_at")}`,
        [day],
      );
      const users = await R.users(rows.map((r) => r.user_id));
      const candidates = [];
      for (const row of rows) {
        const node = await X.classifyNode(
          "saved_search",
          row.id,
          `${row.keyword || row.query || row.name || ""} ${row.category || ""}`,
        );
        if (!node) continue;
        const u = users.get(row.user_id);
        let postal = await R.ref({
          country: u?.country,
          postal_code: null,
          city: row.city,
          state: row.state,
        });
        if (!postal) postal = await R.profilePostal(row.user_id);
        candidates.push({ user: row.user_id, postal, node, signal: "saved_search" });
      }
      return commitCandidates(conn, c, candidates, "demand");
    },
  ],
  [
    "booking_requests",
    async (conn, day, c, R, X) => {
      const { rows } = await conn.query(
        `SELECT id,customer_id AS user_id,service_name FROM booking_requests
         WHERE ${IN_DAY("created_at")}`,
        [day],
      );
      const candidates = [];
      for (const row of rows) {
        const node = await X.classifyNode("service", row.id, row.service_name || "");
        if (!node) continue;
        candidates.push({
          user: row.user_id,
          postal: await R.profilePostal(row.user_id),
          node,
          signal: "booking.requested",
        });
      }
      return commitCandidates(conn, c, candidates, "demand");
    },
  ],
  [
    "business_appointments",
    async (conn, day, c, R, X) => {
      const { rows } = await conn.query(
        `SELECT a.id,a.customer_id AS user_id,bs.name AS service_name,bs.category,
                b.address_zip,b.address_city,b.address_state,b.address_country
         FROM business_appointments a
         LEFT JOIN business_services bs ON bs.id=a.service_id
         LEFT JOIN businesses b ON b.id=a.business_id
         WHERE ${IN_DAY("a.created_at")} AND a.customer_id IS NOT NULL`,
        [day],
      );
      const candidates = [];
      for (const row of rows) {
        const node = await X.classifyNode(
          "service",
          row.id,
          `${row.service_name || ""} ${row.category || ""}`,
        );
        if (!node) continue;
        let postal = await R.ref({
          country: row.address_country,
          postal_code: row.address_zip,
          city: row.address_city,
          state: row.address_state,
        });
        if (!postal) postal = await R.profilePostal(row.user_id);
        candidates.push({
          user: row.user_id,
          postal,
          node,
          signal: "booking.requested",
        });
      }
      return commitCandidates(conn, c, candidates, "demand");
    },
  ],
  [
    "food_orders",
    async (conn, day, c, R, X) => {
      const { rows } = await conn.query(
        `SELECT o.customer_id AS user_id,r.cuisine_tags,
                r.address_zip,r.address_city,r.address_state,r.address_country
         FROM food_orders o JOIN food_restaurants r ON r.id=o.restaurant_id
         WHERE ${IN_DAY("o.created_at")} AND o.customer_id IS NOT NULL
           AND o.payment_status='paid'`,
        [day],
      );
      const candidates = [];
      for (const row of rows) {
        const postal = await R.ref({
          country: row.address_country,
          postal_code: row.address_zip,
          city: row.address_city,
          state: row.address_state,
        });
        if (!postal) continue;
        for (const tag of row.cuisine_tags || []) {
          const node =
            (await X.ruleNode("cuisine_tag", tag)) ||
            (await X.classifyNode("restaurant", `cuisine:${tag}`, "", {
              cuisine_tag: tag,
            }));
          if (node)
            candidates.push({ user: row.user_id, postal, node, signal: "food.order" });
        }
      }
      return commitCandidates(conn, c, candidates, "demand");
    },
  ],
  [
    "marketplace_orders",
    async (conn, day, c, R, X) => {
      const { rows } = await conn.query(
        `SELECT o.id,o.customer_id AS user_id,o.shipping_address,
                (SELECT p.name FROM marketplace_order_items i
                   JOIN marketplace_products p ON p.id=i.product_id
                  WHERE i.order_id=o.id ORDER BY i.id LIMIT 1) AS product_name,
                (SELECT p.category FROM marketplace_order_items i
                   JOIN marketplace_products p ON p.id=i.product_id
                  WHERE i.order_id=o.id ORDER BY i.id LIMIT 1) AS product_category,
                (SELECT i.product_id FROM marketplace_order_items i
                  WHERE i.order_id=o.id ORDER BY i.id LIMIT 1) AS product_id
         FROM marketplace_orders o
         WHERE ${IN_DAY("o.created_at")} AND o.status IN ('paid','processing','completed')`,
        [day],
      );
      const candidates = [];
      for (const row of rows) {
        if (!row.product_id) continue;
        const node = await X.classifyNode(
          "service",
          row.product_id,
          `${row.product_name || ""} ${row.product_category || ""}`,
        );
        if (!node) continue;
        const ship = row.shipping_address || {};
        let postal = await R.ref({
          country: ship.country,
          postal_code: ship.zip,
          city: ship.city,
          state: ship.state,
        });
        if (!postal) postal = await R.profilePostal(row.user_id);
        candidates.push({
          user: row.user_id,
          postal,
          node,
          signal: "marketplace.order",
        });
      }
      return commitCandidates(conn, c, candidates, "demand");
    },
  ],
  [
    "direct_requests",
    async (conn, day, c, R, X) => {
      const { rows } = await conn.query(
        `SELECT q.id,q.user_id,q.service_category,q.service_zip_code,q.service_city,
                (SELECT string_agg(s.service_name,' ') FROM quote_request_services s
                  WHERE s.quote_request_id=q.id) AS service_names
         FROM quote_requests q
         WHERE ${IN_DAY("q.created_at")} AND q.status<>'cancelled' AND q.user_id IS NOT NULL`,
        [day],
      );
      const users = await R.users(rows.map((r) => r.user_id));
      const candidates = [];
      for (const row of rows) {
        const node = await X.classifyNode(
          "service",
          row.id,
          `${row.service_category || ""} ${row.service_names || ""}`,
        );
        if (!node) continue;
        const u = users.get(row.user_id);
        let postal = await R.ref({
          country: u?.country,
          postal_code: row.service_zip_code,
          city: row.service_city,
          state: null,
        });
        if (!postal) postal = await R.profilePostal(row.user_id);
        candidates.push({
          user: row.user_id,
          postal,
          node,
          signal: "direct.request",
        });
      }
      return commitCandidates(conn, c, candidates, "demand");
    },
  ],
  [
    "bids",
    async (conn, day, c, R, X) => {
      const { rows } = await conn.query(
        `SELECT b.helper_id AS user_id,b.job_id FROM bids b
         WHERE ${IN_DAY("b.created_at")}`,
        [day],
      );
      const candidates = [];
      for (const row of rows) {
        const node = await X.entityNode("job", row.job_id);
        if (!node) continue;
        const postal = await R.profilePostal(row.user_id);
        if (!postal) continue;
        candidates.push({ user: row.user_id, postal, node, role: "helper" });
        const k = key3(postal, node, "helper");
        c.bidCapacity.set(k, (c.bidCapacity.get(k) || 0) + 1);
      }
      return commitCandidates(conn, c, candidates, "supply");
    },
  ],
  [
    "helper_skills",
    async (conn, day, c, R, X) => {
      const { rows } = await conn.query(
        `SELECT hs.user_id,hs.category_id,hs.skill_name,
                hp.service_zip,hp.service_city,hp.service_state
         FROM helper_skills hs
         JOIN users u ON u.id=hs.user_id
         LEFT JOIN helper_profiles hp ON hp.user_id=hs.user_id
         WHERE u.last_login_at >= ${DAY} - 29
            OR EXISTS (SELECT 1 FROM bids b WHERE b.helper_id=hs.user_id
                        AND b.created_at >= ${DAY} - 29)`,
        [day],
      );
      const users = await R.users(rows.map((r) => r.user_id));
      const candidates = [];
      for (const row of rows) {
        const node =
          (row.category_id != null
            ? await X.ruleNode("category_id", row.category_id)
            : null) || (await X.ruleNode("skill_id", row.skill_name));
        if (!node) continue;
        const u = users.get(row.user_id);
        let postal = await R.ref({
          country: u?.country,
          postal_code: row.service_zip,
          city: row.service_city,
          state: row.service_state,
        });
        if (!postal) postal = await R.profilePostal(row.user_id);
        candidates.push({ user: row.user_id, postal, node, role: "helper" });
      }
      return commitCandidates(conn, c, candidates, "supply");
    },
  ],
  [
    "business_services",
    async (conn, day, c, R, X) => {
      const {
        rows: [col],
      } = await conn.query(
        `SELECT EXISTS(SELECT 1 FROM information_schema.columns
          WHERE table_name='business_services' AND column_name='deleted_at') AS has_deleted`,
      );
      const { rows } = await conn.query(
        `SELECT bs.id,bs.name,bs.category,b.user_id,
                b.address_zip,b.address_city,b.address_state,b.address_country
         FROM business_services bs JOIN businesses b ON b.id=bs.business_id
         WHERE bs.is_active=TRUE ${col?.has_deleted ? "AND bs.deleted_at IS NULL" : ""}`,
        [],
      );
      const candidates = [];
      for (const row of rows) {
        const node = await X.classifyNode(
          "service",
          row.id,
          `${row.name || ""} ${row.category || ""}`,
        );
        if (!node) continue;
        let postal = await R.ref({
          country: row.address_country,
          postal_code: row.address_zip,
          city: row.address_city,
          state: row.address_state,
        });
        if (!postal) postal = await R.profilePostal(row.user_id);
        candidates.push({ user: row.user_id, postal, node, role: "business" });
      }
      return commitCandidates(conn, c, candidates, "supply");
    },
  ],
  [
    "restaurants",
    async (conn, day, c, R, X) => {
      const { rows } = await conn.query(
        `SELECT owner_user_id AS user_id,cuisine_tags,
                address_zip,address_city,address_state,address_country
         FROM food_restaurants WHERE status='active' AND owner_user_id IS NOT NULL`,
        [],
      );
      const candidates = [];
      for (const row of rows) {
        const postal = await R.ref({
          country: row.address_country,
          postal_code: row.address_zip,
          city: row.address_city,
          state: row.address_state,
        });
        if (!postal) continue;
        for (const tag of row.cuisine_tags || []) {
          const node =
            (await X.ruleNode("cuisine_tag", tag)) ||
            (await X.classifyNode("restaurant", `cuisine:${tag}`, "", {
              cuisine_tag: tag,
            }));
          if (node)
            candidates.push({ user: row.user_id, postal, node, role: "restaurant" });
        }
      }
      return commitCandidates(conn, c, candidates, "supply");
    },
  ],
  [
    "direct_crew",
    async (conn, day, c, R, X) => {
      const { rows } = await conn.query(
        `SELECT qc.user_id,q.service_category,q.id AS quote_id
         FROM quote_request_crew qc JOIN quote_requests q ON q.id=qc.quote_request_id
         WHERE q.created_at >= ${DAY} - 29 AND q.status<>'cancelled'`,
        [day],
      );
      const candidates = [];
      for (const row of rows) {
        const node = await X.classifyNode(
          "service",
          row.quote_id,
          row.service_category || "",
        );
        if (!node) continue;
        candidates.push({
          user: row.user_id,
          postal: await R.profilePostal(row.user_id),
          node,
          role: "direct_crew",
        });
      }
      return commitCandidates(conn, c, candidates, "supply");
    },
  ],
];

async function collectDomainDay(conn, day, target) {
  const c = target || newCollector();
  if (!c.sources) c.sources = {};
  const R = makeResolver(conn);
  const X = makeClassifier(conn);
  for (const [name, fn] of SOURCES) {
    try {
      c.sources[name] = await fn(conn, day, c, R, X);
    } catch (err) {
      c.sources[name] = `error:${err.code || err.message || "unknown"}`;
    }
  }
  return c;
}

module.exports = { collectDomainDay, newCollector, addDemand, addSupply, key3 };
