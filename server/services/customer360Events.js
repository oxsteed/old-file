"use strict";
/**
 * Customer 360 upgrade 1: unified append-only customer event log.
 *
 * Storage and hashing live in PostgreSQL (migration
 * 20261103120000_customer360_event_log.sql): customer_event_append() takes
 * a per-customer advisory lock, chains SHA-256 hashes and is idempotent on
 * dedupe_key. Source tables write to customer_event_inbox from triggers;
 * drainInbox() moves those rows into the chain. backfillSource() walks each
 * source once by primary key and records the row's current state.
 *
 * Reads are filtered by the viewer's Customer 360 source grants: an event
 * is only returned when the viewer may read the source it came from.
 */
const db = require("../db");
const logger = require("../utils/logger");
const AppError = require("../utils/appError");
const { mapBounded } = require("../utils/boundedBatch");
const { withTransaction } = require("../utils/transaction");

// Which workspace source governs visibility of each event source.
const EVENT_SOURCE_GRANTS = Object.freeze({
  admin_audit: "adminActions",
  login: "sessions",
  payment: "payments",
  support: "tickets",
  food_order: "foodOrders",
  customer360: "tasks",
});
const ACTOR_TYPES = new Set(["admin", "customer", "system", "business"]);
const SAFE_KEY = /^[a-z0-9_.:-]{1,255}$/i;

function assertEvent(e) {
  if (!e || !/^[0-9a-f-]{36}$/i.test(String(e.customerId))) throw new AppError("Invalid event customer", 400, "invalid_event");
  if (!EVENT_SOURCE_GRANTS[e.source]) throw new AppError("Invalid event source", 400, "invalid_event");
  if (!/^[a-z0-9_.]{1,120}$/i.test(String(e.type))) throw new AppError("Invalid event type", 400, "invalid_event");
  if (!ACTOR_TYPES.has(e.actorType)) throw new AppError("Invalid event actor", 400, "invalid_event");
  if (!SAFE_KEY.test(String(e.dedupeKey))) throw new AppError("Invalid event key", 400, "invalid_event");
  if (e.changes != null && (typeof e.changes !== "object" || Array.isArray(e.changes))) throw new AppError("Invalid event changes", 400, "invalid_event");
}

/** Append directly (Customer 360 writers). Pass a transaction client to join it. */
async function append(runner, e) {
  assertEvent(e);
  const { rows: [row] } = await (runner || db).query(
    `SELECT customer_event_append($1::uuid, COALESCE($2::timestamptz, NOW()), $3, $4, $5, $6::uuid, $7, $8, $9::jsonb, $10) AS id`,
    [e.customerId, e.occurredAt || null, e.source, e.type, e.actorType, e.actorId || null,
      e.entityType || null, e.entityId == null ? null : String(e.entityId), JSON.stringify(e.changes || {}), e.dedupeKey],
  );
  return Number(row.id);
}

/**
 * Append one customer's claimed inbox rows in a single statement, inside
 * the caller's transaction. The recursive CTE walks the batch in inbox-id
 * order carrying the chain head: rows already present (dedupe_key) contribute
 * their stored hash, and new rows get the exact hash customer_event_append()
 * would compute (same concat, same UTC microsecond formatting, same jsonb
 * canonical text), so the chain verifies identically. The per-customer
 * advisory lock is the same one the procedure takes, so batch appends for
 * one customer serialise across workers while different customers proceed
 * concurrently. Callers must run this in a transaction: the lock is
 * transaction-scoped.
 */
async function appendCustomerBatch(client, customerId, rows) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('customer_events:' || $1::text, 0))`, [customerId]);
  const payload = rows.map((r) => ({
    inbox_id: r.id,
    occurred_at: r.occurred_at instanceof Date ? r.occurred_at.toISOString() : r.occurred_at,
    source: r.source, event_type: r.event_type, actor_type: r.actor_type, actor_id: r.actor_id,
    entity_type: r.entity_type, entity_id: r.entity_id, changes: r.changes || {}, dedupe_key: r.dedupe_key,
  }));
  const { rowCount } = await client.query(
    `WITH RECURSIVE batch AS (
       SELECT (x->>'inbox_id')::bigint AS inbox_id,
              (x->>'occurred_at')::timestamptz AS occurred_at,
              x->>'source' AS source, x->>'event_type' AS event_type,
              x->>'actor_type' AS actor_type,
              (x->>'actor_id')::uuid AS actor_id,
              x->>'entity_type' AS entity_type, x->>'entity_id' AS entity_id,
              COALESCE((x->'changes')::jsonb, '{}'::jsonb) AS changes,
              x->>'dedupe_key' AS dedupe_key,
              row_number() OVER (ORDER BY (x->>'inbox_id')::bigint) AS rn
         FROM jsonb_array_elements($2::jsonb) x
     ),
     head AS (SELECT event_hash FROM customer_events WHERE customer_id = $1 ORDER BY id DESC LIMIT 1),
     rec AS (
       SELECT b.*, e.event_hash AS existing_hash,
              (SELECT event_hash FROM head) AS prev_hash,
              CASE WHEN e.id IS NOT NULL THEN e.event_hash
                   ELSE encode(sha256(convert_to(concat_ws('|',
                     COALESCE((SELECT event_hash FROM head), ''), $1::text,
                     to_char(b.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
                     b.source, b.event_type, b.actor_type, COALESCE(b.actor_id::text, ''),
                     COALESCE(b.entity_type, ''), COALESCE(b.entity_id, ''), b.changes::text, b.dedupe_key), 'UTF8')), 'hex')::char(64)
              END AS new_hash
         FROM batch b LEFT JOIN customer_events e ON e.dedupe_key = b.dedupe_key
        WHERE b.rn = 1
       UNION ALL
       SELECT b.*, e.event_hash AS existing_hash,
              r.new_hash AS prev_hash,
              CASE WHEN e.id IS NOT NULL THEN e.event_hash
                   ELSE encode(sha256(convert_to(concat_ws('|',
                     r.new_hash, $1::text,
                     to_char(b.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
                     b.source, b.event_type, b.actor_type, COALESCE(b.actor_id::text, ''),
                     COALESCE(b.entity_type, ''), COALESCE(b.entity_id, ''), b.changes::text, b.dedupe_key), 'UTF8')), 'hex')::char(64)
              END
         FROM rec r JOIN batch b ON b.rn = r.rn + 1
         LEFT JOIN customer_events e ON e.dedupe_key = b.dedupe_key
     )
     INSERT INTO customer_events (customer_id, occurred_at, source, event_type, actor_type, actor_id,
       entity_type, entity_id, changes, dedupe_key, previous_hash, event_hash)
     SELECT $1, occurred_at, source, left(event_type, 120), actor_type, actor_id,
       left(entity_type, 60), left(entity_id, 160), changes, left(dedupe_key, 255), prev_hash, new_hash
       FROM rec WHERE existing_hash IS NULL
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [customerId, JSON.stringify(payload)],
  );
  return rowCount;
}

/** Move up to `limit` outbox rows into the hashed log. Safe to run on many workers. */
async function drainInbox({ limit = 500 } = {}) {
  // Claim only: the SELECT locks the rows for this instant, then releases.
  // Appends run per customer on their own connections (bounded concurrency),
  // and the final DELETE removes only rows whose event is now in the log, so
  // a crashed or failed group is retried by the next tick instead of lost,
  // and a row another worker already appended and deleted is simply a no-op.
  const rows = await withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM customer_event_inbox ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [Math.min(Math.max(1, limit), 2000)],
    );
    return rows;
  }, "customer_event_drain_claim");
  if (!rows.length) return { moved: 0 };
  // Group by customer so each chain lock is taken once per batch, in a
  // stable order (prevents lock-order deadlocks between workers).
  rows.sort((a, b) => (a.customer_id < b.customer_id ? -1 : a.customer_id > b.customer_id ? 1 : Number(a.id) - Number(b.id)));
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.customer_id)) groups.set(r.customer_id, []);
    groups.get(r.customer_id).push(r);
  }
  const appended = [];
  await mapBounded([...groups.entries()], 5, async ([customerId, groupRows]) => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await appendCustomerBatch(client, customerId, groupRows);
      await client.query("COMMIT");
      appended.push(...groupRows.map((r) => r.id));
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      // One customer's failure must not strand the rest of the batch; its
      // rows stay in the inbox and the next tick retries them.
      logger.warn("Customer 360 event drain group failed, will retry", { customerId, rows: groupRows.length, message: err.message });
    } finally {
      client.release();
    }
  });
  if (!appended.length) return { moved: 0 };
  const { rowCount } = await db.query(
    `DELETE FROM customer_event_inbox i WHERE i.id = ANY($1::bigint[])
       AND EXISTS (SELECT 1 FROM customer_events e WHERE e.dedupe_key = i.dedupe_key)`,
    [appended]);
  return { moved: rowCount };
}

// One-time backfill walkers: each selects a primary-key batch. Row-per-event
// sources (audit, login) reuse the trigger dedupe keys. Stateful sources
// (payments, tickets, orders) record the current state only for entities
// with no captured history yet, so live transitions are never duplicated.
const BACKFILL = {
  admin_audit: {
    keyType: "bigint",
    sql: `SELECT id::text AS k FROM admin_audit_log WHERE id > COALESCE($1::bigint, 0) ORDER BY id LIMIT $2`,
    insert: `INSERT INTO customer_event_inbox (customer_id, occurred_at, source, event_type, actor_type, actor_id, entity_type, entity_id, changes, dedupe_key)
      SELECT a.target_id::uuid, a.created_at, 'admin_audit', 'admin.' || left(a.action, 110),
        CASE WHEN a.admin_id IS NULL THEN 'system' ELSE 'admin' END, a.admin_id, 'admin_action', a.id::text,
        customer_event_redact_diff(a.before_state, a.after_state), 'admin_audit:' || a.id
      FROM admin_audit_log a WHERE a.id = ANY($1::bigint[]) AND a.target_type = 'user'
        AND a.target_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'`,
  },
  login: {
    keyType: "bigint",
    sql: `SELECT id::text AS k FROM user_login_history WHERE id > COALESCE($1::bigint, 0) ORDER BY id LIMIT $2`,
    insert: `INSERT INTO customer_event_inbox (customer_id, occurred_at, source, event_type, actor_type, actor_id, entity_type, entity_id, changes, dedupe_key)
      SELECT l.user_id, COALESCE(l.login_at, l.created_at, NOW()), 'login', CASE WHEN l.success THEN 'login.succeeded' ELSE 'login.failed' END,
        'customer', l.user_id, 'login', l.id::text, jsonb_strip_nulls(jsonb_build_object('country', l.country_code)), 'login:' || l.id
      FROM user_login_history l WHERE l.id = ANY($1::bigint[]) AND l.user_id IS NOT NULL`,
  },
  payment: {
    keyType: "bigint",
    sql: `SELECT id::text AS k FROM payments WHERE id > COALESCE($1::bigint, 0) ORDER BY id LIMIT $2`,
    insert: `INSERT INTO customer_event_inbox (customer_id, occurred_at, source, event_type, actor_type, actor_id, entity_type, entity_id, changes, dedupe_key)
      SELECT p.uid, COALESCE(x.updated_at, x.created_at, NOW()), 'payment', 'payment.' || COALESCE(x.status, 'unknown'), 'system', NULL,
        'payment', x.id::text, jsonb_build_object('status', jsonb_build_object('to', x.status), 'role', p.role, 'backfilled', true),
        'payment:' || x.id || ':' || COALESCE(x.status, '') || ':' || p.uid
      FROM payments x CROSS JOIN LATERAL (VALUES (x.payer_id, 'payer'), (x.payee_id, 'payee')) AS p(uid, role)
      WHERE x.id = ANY($1::bigint[]) AND p.uid IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM customer_events e WHERE e.customer_id = p.uid AND e.entity_type = 'payment' AND e.entity_id = x.id::text)
        AND NOT EXISTS (SELECT 1 FROM customer_event_inbox i WHERE i.customer_id = p.uid AND i.entity_type = 'payment' AND i.entity_id = x.id::text)`,
  },
  support: {
    keyType: "uuid",
    sql: `SELECT id::text AS k FROM support_tickets WHERE ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT $2`,
    insert: `INSERT INTO customer_event_inbox (customer_id, occurred_at, source, event_type, actor_type, actor_id, entity_type, entity_id, changes, dedupe_key)
      SELECT t.user_id, COALESCE(t.updated_at, t.created_at, NOW()), 'support', 'support_ticket.' || COALESCE(t.status, 'unknown'), 'system', NULL,
        'support_ticket', t.id::text, jsonb_build_object('status', jsonb_build_object('to', t.status), 'backfilled', true),
        'support_ticket:' || t.id || ':' || COALESCE(t.status, '')
      FROM support_tickets t WHERE t.id = ANY($1::uuid[]) AND t.user_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM customer_events e WHERE e.customer_id = t.user_id AND e.entity_type = 'support_ticket' AND e.entity_id = t.id::text)
        AND NOT EXISTS (SELECT 1 FROM customer_event_inbox i WHERE i.customer_id = t.user_id AND i.entity_type = 'support_ticket' AND i.entity_id = t.id::text)`,
  },
  food_order: {
    keyType: "bigint",
    sql: `SELECT id::text AS k FROM food_orders WHERE id > COALESCE($1::bigint, 0) ORDER BY id LIMIT $2`,
    insert: `INSERT INTO customer_event_inbox (customer_id, occurred_at, source, event_type, actor_type, actor_id, entity_type, entity_id, changes, dedupe_key)
      SELECT o.customer_id, COALESCE(o.updated_at, o.created_at, NOW()), 'food_order', 'food_order.' || COALESCE(o.status, 'unknown'), 'system', NULL,
        'food_order', o.id::text, jsonb_build_object('status', jsonb_build_object('to', o.status), 'payment_status', jsonb_build_object('to', o.payment_status), 'backfilled', true),
        'food_order:' || o.id || ':' || COALESCE(o.status, '') || ':' || COALESCE(o.payment_status, '')
      FROM food_orders o WHERE o.id = ANY($1::bigint[]) AND o.customer_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM customer_events e WHERE e.customer_id = o.customer_id AND e.entity_type = 'food_order' AND e.entity_id = o.id::text)
        AND NOT EXISTS (SELECT 1 FROM customer_event_inbox i WHERE i.customer_id = o.customer_id AND i.entity_type = 'food_order' AND i.entity_id = o.id::text)`,
  },
};

/** Walk one batch of a source. Returns { done, queued }. */
async function backfillSource(source, { batch = 500 } = {}) {
  const spec = BACKFILL[source];
  if (!spec) throw new AppError("Unknown backfill source", 400, "invalid_source");
  return withTransaction(db, async (client) => {
    await client.query(`INSERT INTO customer_event_ingest_cursors (source) VALUES ($1) ON CONFLICT DO NOTHING`, [source]);
    const { rows: [cursor] } = await client.query(
      `SELECT last_key, completed_at FROM customer_event_ingest_cursors WHERE source = $1 FOR UPDATE SKIP LOCKED`, [source]);
    if (!cursor) return { done: false, queued: 0, busy: true };
    if (cursor.completed_at) return { done: true, queued: 0 };
    const { rows } = await client.query(spec.sql, [cursor.last_key, Math.min(Math.max(1, batch), 5000)]);
    if (!rows.length) {
      await client.query(`UPDATE customer_event_ingest_cursors SET completed_at = NOW(), updated_at = NOW() WHERE source = $1`, [source]);
      return { done: true, queued: 0 };
    }
    const keys = rows.map((r) => r.k);
    // Duplicates of trigger-captured rows collapse on dedupe_key at append time.
    const result = await client.query(spec.insert, [keys]);
    await client.query(`UPDATE customer_event_ingest_cursors SET last_key = $2, updated_at = NOW() WHERE source = $1`, [source, keys[keys.length - 1]]);
    return { done: false, queued: result.rowCount };
  }, "customer_event_backfill");
}

async function backfillStatus() {
  const { rows } = await db.query(`SELECT source, last_key, completed_at, updated_at FROM customer_event_ingest_cursors ORDER BY source`);
  const bySource = Object.fromEntries(rows.map((r) => [r.source, r]));
  return Object.keys(BACKFILL).map((source) => ({
    source,
    completed: Boolean(bySource[source]?.completed_at),
    completedAt: bySource[source]?.completed_at || null,
    updatedAt: bySource[source]?.updated_at || null,
  }));
}

function eventFilters(query = {}) {
  const date = (v) => {
    if (!v) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || !Number.isFinite(Date.parse(v))) throw new AppError("Invalid date", 400, "invalid_date");
    return String(v);
  };
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new AppError("Invalid limit", 400, "invalid_pagination");
  const before = query.before === undefined || query.before === "" ? null : String(query.before);
  if (before !== null && !/^\d{1,19}$/.test(before)) throw new AppError("Invalid cursor", 400, "invalid_pagination");
  const sources = query.sources ? String(query.sources).split(",").filter(Boolean) : [];
  if (sources.some((s) => !EVENT_SOURCE_GRANTS[s])) throw new AppError("Unknown event source", 400, "invalid_source");
  const actorType = query.actorType ? String(query.actorType) : "";
  if (actorType && !ACTOR_TYPES.has(actorType)) throw new AppError("Invalid actor", 400, "invalid_request");
  return {
    from: date(query.from), to: date(query.to), limit, before, sources, actorType,
    type: String(query.type || "").slice(0, 120),
  };
}

/** Event sources the viewer may read, using the workspace source grants. */
async function allowedEventSources(can, workspaceSources) {
  const allowed = [];
  for (const [source, sourceKey] of Object.entries(EVENT_SOURCE_GRANTS)) {
    const def = workspaceSources[sourceKey];
    if (def && (await can(def))) allowed.push(source);
  }
  return allowed;
}

async function listEvents(customerId, filter, allowedSources) {
  const sources = filter.sources.length ? filter.sources.filter((s) => allowedSources.includes(s)) : allowedSources;
  if (!sources.length) return { events: [], nextBefore: null, sources };
  const { rows } = await db.query(
    `SELECT id::text, occurred_at, recorded_at, source, event_type, actor_type, actor_id, entity_type, entity_id, changes, event_hash
       FROM customer_events
      WHERE customer_id = $1 AND source = ANY($2::text[])
        AND ($3::date IS NULL OR occurred_at >= $3::date)
        AND ($4::date IS NULL OR occurred_at < $4::date + INTERVAL '1 day')
        AND ($5::bigint IS NULL OR id < $5::bigint)
        AND ($6::text = '' OR actor_type = $6)
        AND ($7::text = '' OR event_type LIKE $7 || '%')
      ORDER BY id DESC LIMIT $8`,
    [customerId, sources, filter.from, filter.to, filter.before, filter.actorType, filter.type, filter.limit + 1],
  );
  const more = rows.length > filter.limit;
  const events = rows.slice(0, filter.limit);
  return { events, nextBefore: more ? events[events.length - 1].id : null, sources };
}

/**
 * Replay one entity's recorded changes up to `at`: start from an empty
 * state and apply every `to` value in chain order. Fields the log only
 * knows changed (redacted or non-scalar) are reported, not guessed.
 */
async function replay(customerId, { entityType, entityId, at }, allowedSources) {
  if (!/^[a-z_]{1,60}$/.test(String(entityType || "")) || !entityId || String(entityId).length > 160) {
    throw new AppError("Entity required", 400, "invalid_request");
  }
  const until = at ? new Date(at) : new Date();
  if (!Number.isFinite(until.getTime())) throw new AppError("Invalid time", 400, "invalid_date");
  const { rows } = await db.query(
    `SELECT id::text, occurred_at, source, event_type, actor_type, actor_id, changes
       FROM customer_events
      WHERE customer_id = $1 AND entity_type = $2 AND entity_id = $3 AND occurred_at <= $4 AND source = ANY($5::text[])
      ORDER BY occurred_at, id LIMIT 1000`,
    [customerId, entityType, String(entityId), until.toISOString(), allowedSources],
  );
  const state = {};
  const redacted = new Set();
  const steps = rows.map((row) => {
    for (const [field, change] of Object.entries(row.changes || {})) {
      if (change && typeof change === "object" && "to" in change) { state[field] = change.to; redacted.delete(field); }
      else if (change && change.changed) { redacted.add(field); delete state[field]; }
    }
    return { id: row.id, occurredAt: row.occurred_at, eventType: row.event_type, actorType: row.actor_type, actorId: row.actor_id, changes: row.changes };
  });
  return { entityType, entityId: String(entityId), at: until.toISOString(), state, unknownFields: [...redacted].sort(), steps, truncated: rows.length === 1000 };
}

/** Recompute the customer's chain; returns the first broken id or null. */
async function verifyChain(customerId) {
  const { rows } = await db.query(
    `WITH ordered AS (
       SELECT id, event_hash, previous_hash,
              LAG(event_hash) OVER (ORDER BY id) AS expected_previous,
              encode(sha256(convert_to(concat_ws('|', COALESCE(previous_hash, ''), customer_id::text,
                to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), source, event_type, actor_type,
                COALESCE(actor_id::text, ''), COALESCE(entity_type, ''), COALESCE(entity_id, ''), changes::text, dedupe_key), 'UTF8')), 'hex') AS recomputed
         FROM customer_events WHERE customer_id = $1)
     SELECT COUNT(*)::int AS total,
            MIN(id) FILTER (WHERE event_hash <> recomputed OR previous_hash IS DISTINCT FROM expected_previous)::text AS first_broken
       FROM ordered`,
    [customerId],
  );
  return { total: rows[0].total, intact: rows[0].first_broken === null, firstBrokenId: rows[0].first_broken };
}

module.exports = {
  EVENT_SOURCE_GRANTS, BACKFILL, append, drainInbox, backfillSource, backfillStatus,
  eventFilters, allowedEventSources, listEvents, replay, verifyChain,
};
