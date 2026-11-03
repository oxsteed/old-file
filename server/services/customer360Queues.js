"use strict";
/**
 * Customer 360 upgrade 10: shared team queues with SLA tracking, and saved
 * views of the queue board. Items carry a visibility topic (an anomaly kind,
 * 'link_review' or 'general'); an admin only sees topics their grants allow.
 * Feed queues are filled and closed by the worker from their source tables.
 */
const db = require("../db");
const AppError = require("../utils/appError");
const events = require("./customer360Events");

const PAGE = 50;
const STATUSES = ["open", "claimed"];
const RESOLUTIONS = ["handled", "no_action"];
const ASSIGNEES = ["any", "me", "unassigned"];
const SORTS = ["due", "created"];

function topicsFor({ anomalyKinds = [], links = false }) {
  return [...anomalyKinds, ...(links ? ["link_review"] : []), "general"];
}

/** Validate saved-view / board filters against an allowlist. */
function normalizeFilters(raw = {}) {
  const f = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const list = (v) => (Array.isArray(v) ? v : typeof v === "string" && v ? v.split(",") : []).map(String);
  const queues = [...new Set(list(f.queues))].slice(0, 20);
  if (queues.some((k) => !/^[a-z0-9_]{2,40}$/.test(k))) throw new AppError("Invalid queue filter", 400, "invalid_filters");
  const statuses = [...new Set(list(f.statuses))];
  if (statuses.some((s) => !STATUSES.includes(s))) throw new AppError("Invalid status filter", 400, "invalid_filters");
  const assignee = f.assignee == null || f.assignee === "" ? "any" : String(f.assignee);
  if (!ASSIGNEES.includes(assignee)) throw new AppError("Invalid assignee filter", 400, "invalid_filters");
  const sort = f.sort == null || f.sort === "" ? "due" : String(f.sort);
  if (!SORTS.includes(sort)) throw new AppError("Invalid sort", 400, "invalid_filters");
  const breachedOnly = f.breachedOnly === true || f.breachedOnly === "true";
  return { queues, statuses: statuses.length ? statuses : STATUSES, assignee, breachedOnly, sort };
}

async function queues(topics) {
  const { rows } = await db.query(
    `SELECT q.id::text, q.queue_key, q.name, q.description, q.sla_minutes, q.feed, q.active, q.revision,
            COUNT(i.*) FILTER (WHERE i.status = 'open')::int AS open,
            COUNT(i.*) FILTER (WHERE i.status = 'claimed')::int AS claimed,
            COUNT(i.*) FILTER (WHERE i.status <> 'resolved' AND i.due_at < NOW())::int AS breached,
            COUNT(i.*) FILTER (WHERE i.status = 'resolved' AND i.resolved_at > NOW() - interval '30 days')::int AS resolved_30d,
            COUNT(i.*) FILTER (WHERE i.status = 'resolved' AND i.resolved_at > NOW() - interval '30 days' AND i.resolved_at <= i.due_at)::int AS met_30d,
            round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM i.resolved_at - i.created_at) / 60)
              FILTER (WHERE i.status = 'resolved' AND i.resolved_at > NOW() - interval '30 days'))::numeric, 1)::float AS median_resolve_minutes_30d
       FROM customer360_queues q
       LEFT JOIN customer360_queue_items i ON i.queue_id = q.id AND i.topic = ANY($1::text[])
        AND (i.status <> 'resolved' OR i.resolved_at > NOW() - interval '30 days')
      GROUP BY q.id ORDER BY q.active DESC, q.name`, [topics]);
  return rows.map((q) => ({ ...q, sla_met_pct_30d: q.resolved_30d ? Math.round((q.met_30d / q.resolved_30d) * 1000) / 10 : null }));
}

const ITEM_SELECT = `SELECT i.id::text, q.queue_key, q.name AS queue_name, i.customer_id, i.topic, i.source, i.source_ref, i.reason, i.status,
       i.assigned_to, COALESCE(NULLIF(trim(concat_ws(' ', a.first_name, a.last_name)), ''), NULL) AS assigned_name,
       COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), 'Customer') AS customer_name,
       i.created_at, i.due_at, i.first_claimed_at, i.sla_breached_at, i.resolved_at, i.resolution, i.resolution_note, i.revision,
       (i.status <> 'resolved' AND i.due_at < NOW()) AS breached,
       round(extract(epoch FROM i.due_at - NOW()) / 60)::int AS minutes_left
  FROM customer360_queue_items i JOIN customer360_queues q ON q.id = i.queue_id
  JOIN users u ON u.id = i.customer_id LEFT JOIN users a ON a.id = i.assigned_to`;

async function items({ filters, topics, adminId, cursor = null }) {
  const f = normalizeFilters(filters);
  let after = null;
  if (cursor) {
    const [ts, id] = String(cursor).split("|");
    if (!ts || !/^\d{1,18}$/.test(id || "") || Number.isNaN(new Date(ts).getTime())) throw new AppError("Invalid cursor", 400, "invalid_cursor");
    after = { ts: new Date(ts).toISOString(), id };
  }
  const col = f.sort === "created" ? "i.created_at" : "i.due_at";
  const { rows } = await db.query(
    `${ITEM_SELECT}
      WHERE i.status = ANY($1::text[]) AND i.topic = ANY($2::text[])
        AND (cardinality($3::text[]) = 0 OR q.queue_key = ANY($3::text[]))
        AND ($4 = 'any' OR ($4 = 'me' AND i.assigned_to = $5::uuid) OR ($4 = 'unassigned' AND i.assigned_to IS NULL))
        AND (NOT $6 OR i.due_at < NOW())
        AND ($7::timestamptz IS NULL OR (${col}, i.id) > ($7::timestamptz, $8::bigint))
      ORDER BY ${col}, i.id LIMIT ${PAGE + 1}`,
    [f.statuses, topics, f.queues, f.assignee, adminId, f.breachedOnly, after?.ts || null, after?.id || null]);
  const page = rows.slice(0, PAGE);
  const last = page[page.length - 1];
  return {
    items: page, filters: f,
    nextCursor: rows.length > PAGE ? `${new Date(f.sort === "created" ? last.created_at : last.due_at).toISOString()}|${last.id}` : null,
  };
}

async function customerItems(customerId, topics) {
  const { rows } = await db.query(`${ITEM_SELECT} WHERE i.customer_id = $1 AND i.topic = ANY($2::text[])
    ORDER BY (i.status = 'resolved'), i.due_at DESC, i.id DESC LIMIT 20`, [customerId, topics]);
  return rows;
}

async function getItem(itemId, topics, runner = db) {
  if (!/^\d{1,18}$/.test(String(itemId))) throw new AppError("Invalid item id", 400, "invalid_item_id");
  const { rows: [row] } = await runner.query(`${ITEM_SELECT} WHERE i.id = $1 AND i.topic = ANY($2::text[])`, [itemId, topics]);
  if (!row) throw new AppError("Queue item not found", 404, "queue_item_not_found");
  return row;
}

async function enqueue({ queueKey, customerId, reason, adminId, audit }) {
  const text = String(reason || "").trim().slice(0, 300);
  if (!text) throw new AppError("A reason is required", 400, "reason_required");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows: [q] } = await client.query(`SELECT * FROM customer360_queues WHERE queue_key = $1 AND active`, [String(queueKey || "")]);
    if (!q) throw new AppError("Queue not found", 404, "queue_not_found");
    if (q.feed) throw new AppError("Items in this queue are added automatically", 400, "feed_queue");
    const { rows: [row] } = await client.query(
      `INSERT INTO customer360_queue_items (queue_id, customer_id, topic, source, reason, created_by, due_at)
       VALUES ($1, $2, 'general', 'manual', $3, $4, NOW() + ($5::int * interval '1 minute'))
       ON CONFLICT (queue_id, customer_id) WHERE status <> 'resolved' AND source = 'manual' DO NOTHING RETURNING id::text`,
      [q.id, customerId, text, adminId, q.sla_minutes]);
    if (!row) throw new AppError("The customer is already in this queue", 409, "already_queued");
    await audit("customer360_queue_item_added", { client, after: { itemId: row.id, queue: q.queue_key } });
    await events.append(client, {
      customerId, source: "customer360", type: "queue.item_added", actorType: "admin", actorId: adminId,
      entityType: "queue_item", entityId: row.id, changes: { queue: q.queue_key }, dedupeKey: `queue:${row.id}:added`,
    });
    await client.query("COMMIT");
    return getItem(row.id, ["general"]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function act({ itemId, action, revision, resolution, note, adminId, topics, audit }) {
  if (!["claim", "release", "resolve"].includes(action)) throw new AppError("Unknown action", 400, "invalid_action");
  if (!Number.isInteger(revision)) throw new AppError("revision is required", 400, "revision_required");
  const current = await getItem(itemId, topics);
  if (current.status === "resolved") throw new AppError("Item already resolved", 409, "item_resolved");
  if (current.revision !== revision) throw new AppError("The item changed; reload", 409, "revision_conflict");
  if (action === "release" && current.assigned_to !== adminId) throw new AppError("Only the assignee can release", 403, "not_assignee");
  if (action === "claim" && current.status === "claimed" && current.assigned_to !== adminId) throw new AppError("Already claimed", 409, "already_claimed");
  const text = note == null ? null : String(note).trim().slice(0, 1000) || null;
  if (action === "resolve" && !RESOLUTIONS.includes(resolution)) throw new AppError("Choose a resolution", 400, "resolution_required");
  const sql = {
    claim: `status = 'claimed', assigned_to = $3, first_claimed_at = COALESCE(first_claimed_at, NOW())`,
    release: `status = 'open', assigned_to = NULL`,
    resolve: `status = 'resolved', resolved_at = NOW(), resolved_by = $3, resolution = $4, resolution_note = $5`,
  }[action];
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      `UPDATE customer360_queue_items SET ${sql}, revision = revision + 1, updated_at = NOW()
        WHERE id = $1 AND revision = $2 AND status <> 'resolved'`,
      { claim: [itemId, revision, adminId], release: [itemId, revision], resolve: [itemId, revision, adminId, resolution, text] }[action]);
    if (!rowCount) throw new AppError("The item changed; reload", 409, "revision_conflict");
    await audit(`customer360_queue_item_${action}`, { client, targetId: current.customer_id,
      before: { status: current.status, assignedTo: current.assigned_to }, after: { itemId, queue: current.queue_key, resolution: resolution || null } });
    if (action === "resolve") {
      await events.append(client, {
        customerId: current.customer_id, source: "customer360", type: "queue.item_resolved", actorType: "admin", actorId: adminId,
        entityType: "queue_item", entityId: itemId, changes: { queue: current.queue_key, resolution, withinSla: new Date(current.due_at) >= new Date() },
        dedupeKey: `queue:${itemId}:resolved`,
      });
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return getItem(itemId, topics);
}

/** Worker: fill feed queues from their sources and close items whose source closed. */
async function syncFeeds() {
  const added = await db.query(
    `INSERT INTO customer360_queue_items (queue_id, customer_id, topic, source, source_ref, reason, due_at, created_at)
     SELECT q.id, a.customer_id, a.kind, 'anomaly', a.id::text, a.kind, a.first_detected_at + (q.sla_minutes * interval '1 minute'), a.first_detected_at
       FROM customer360_queues q JOIN customer_anomalies a ON a.status IN ('open', 'acknowledged')
      WHERE q.feed = 'anomalies' AND q.active
     ON CONFLICT (queue_id, source, source_ref) WHERE status <> 'resolved' AND source_ref IS NOT NULL DO NOTHING`);
  const addedLinks = await db.query(
    `INSERT INTO customer360_queue_items (queue_id, customer_id, topic, source, source_ref, reason, due_at, created_at)
     SELECT q.id, r.user_a, 'link_review', 'link_review', r.id::text, 'awaiting_second_review',
            COALESCE(r.proposed_at, r.updated_at) + (q.sla_minutes * interval '1 minute'), COALESCE(r.proposed_at, r.updated_at)
       FROM customer360_queues q JOIN customer_link_reviews r ON r.status = 'awaiting_second_review'
      WHERE q.feed = 'link_reviews' AND q.active
     ON CONFLICT (queue_id, source, source_ref) WHERE status <> 'resolved' AND source_ref IS NOT NULL DO NOTHING`);
  const closed = await db.query(
    `UPDATE customer360_queue_items i SET status = 'resolved', resolved_at = NOW(), resolution = 'source_closed',
            revision = revision + 1, updated_at = NOW()
      WHERE i.status <> 'resolved' AND (
        (i.source = 'anomaly' AND NOT EXISTS (SELECT 1 FROM customer_anomalies a WHERE a.id::text = i.source_ref AND a.status IN ('open', 'acknowledged')))
        OR (i.source = 'link_review' AND NOT EXISTS (SELECT 1 FROM customer_link_reviews r WHERE r.id::text = i.source_ref AND r.status = 'awaiting_second_review')))`);
  return { added: added.rowCount + addedLinks.rowCount, closed: closed.rowCount };
}

/** Worker: stamp SLA breaches once, for reporting. */
async function markBreaches({ limit = 1000 } = {}) {
  const { rows } = await db.query(
    `UPDATE customer360_queue_items SET sla_breached_at = due_at
      WHERE id IN (SELECT id FROM customer360_queue_items WHERE status <> 'resolved' AND sla_breached_at IS NULL AND due_at < NOW()
                   ORDER BY due_at LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING id::text, customer_id, queue_id`, [limit]);
  for (const r of rows) {
    await events.append(null, {
      customerId: r.customer_id, source: "customer360", type: "queue.sla_breached", actorType: "system",
      entityType: "queue_item", entityId: r.id, changes: { queueId: r.queue_id }, dedupeKey: `queue:${r.id}:breached`,
    });
  }
  return rows.length;
}

function validQueueInput(b, partial = false) {
  const out = {};
  if (!partial || b.name !== undefined) {
    out.name = String(b.name || "").trim();
    if (!out.name || out.name.length > 80) throw new AppError("Name must be 1-80 characters", 400, "invalid_name");
  }
  if (b.description !== undefined) out.description = b.description == null ? null : String(b.description).trim().slice(0, 300) || null;
  if (!partial || b.slaMinutes !== undefined) {
    if (!Number.isInteger(b.slaMinutes) || b.slaMinutes < 5 || b.slaMinutes > 43200) throw new AppError("SLA must be 5-43200 minutes", 400, "invalid_sla");
    out.sla_minutes = b.slaMinutes;
  }
  if (b.active !== undefined) {
    if (typeof b.active !== "boolean") throw new AppError("active must be boolean", 400, "invalid_request");
    out.active = b.active;
  }
  return out;
}

async function createQueue({ body, adminId, audit }) {
  const key = String(body.queueKey || "");
  if (!/^[a-z0-9_]{2,40}$/.test(key)) throw new AppError("Key must be 2-40 lowercase letters, digits or _", 400, "invalid_queue_key");
  const v = validQueueInput(body);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows: [q] } = await client.query(
      `INSERT INTO customer360_queues (queue_key, name, description, sla_minutes, created_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (queue_key) DO NOTHING RETURNING *`, [key, v.name, v.description ?? null, v.sla_minutes, adminId]);
    if (!q) throw new AppError("Queue key already exists", 409, "queue_exists");
    await audit("customer360_queue_created", { client, after: { queue: key, slaMinutes: q.sla_minutes } });
    await client.query("COMMIT");
    return q;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function updateQueue({ queueId, body, audit }) {
  if (!/^\d{1,18}$/.test(String(queueId))) throw new AppError("Invalid queue id", 400, "invalid_queue_id");
  if (!Number.isInteger(body.revision)) throw new AppError("revision is required", 400, "revision_required");
  const v = validQueueInput(body, true);
  const cols = Object.keys(v);
  if (!cols.length) throw new AppError("Nothing to change", 400, "invalid_request");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows: [before] } = await client.query(`SELECT * FROM customer360_queues WHERE id = $1 FOR UPDATE`, [queueId]);
    if (!before) throw new AppError("Queue not found", 404, "queue_not_found");
    if (before.revision !== body.revision) throw new AppError("The queue changed; reload", 409, "revision_conflict");
    const { rows: [q] } = await client.query(
      `UPDATE customer360_queues SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, revision = revision + 1, updated_at = NOW()
        WHERE id = $1 RETURNING *`, [queueId, ...cols.map((c) => v[c])]);
    await audit("customer360_queue_updated", { client, before: { name: before.name, slaMinutes: before.sla_minutes, active: before.active },
      after: { name: q.name, slaMinutes: q.sla_minutes, active: q.active } });
    await client.query("COMMIT");
    return q;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Saved views ──────────────────────────────────────────────────────────
async function views(adminId) {
  const { rows } = await db.query(
    `SELECT v.id::text, v.name, v.scope, v.filters, v.revision, v.owner_id, v.owner_id = $1 AS mine, v.updated_at,
            COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), 'Admin') AS owner_name
       FROM customer360_saved_views v JOIN users u ON u.id = v.owner_id
      WHERE v.owner_id = $1 OR v.scope = 'team' ORDER BY (v.owner_id = $1) DESC, lower(v.name) LIMIT 200`, [adminId]);
  return rows;
}
function viewInput(b) {
  const name = String(b.name || "").trim();
  if (!name || name.length > 80) throw new AppError("Name must be 1-80 characters", 400, "invalid_name");
  const scope = b.scope == null ? "private" : String(b.scope);
  if (!["private", "team"].includes(scope)) throw new AppError("Invalid scope", 400, "invalid_scope");
  return { name, scope, filters: normalizeFilters(b.filters) };
}
async function saveView({ adminId, viewId = null, body, audit }) {
  const v = viewInput(body || {});
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    let row;
    if (viewId == null) {
      ({ rows: [row] } = await client.query(
        `INSERT INTO customer360_saved_views (owner_id, name, scope, filters) VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (owner_id, lower(name)) DO NOTHING RETURNING id::text, name, scope, filters, revision`,
        [adminId, v.name, v.scope, JSON.stringify(v.filters)]));
      if (!row) throw new AppError("You already have a view with this name", 409, "view_name_taken");
    } else {
      if (!/^\d{1,18}$/.test(String(viewId))) throw new AppError("Invalid view id", 400, "invalid_view_id");
      if (!Number.isInteger(body.revision)) throw new AppError("revision is required", 400, "revision_required");
      try {
        ({ rows: [row] } = await client.query(
          `UPDATE customer360_saved_views SET name = $3, scope = $4, filters = $5::jsonb, revision = revision + 1, updated_at = NOW()
            WHERE id = $1 AND owner_id = $2 AND revision = $6 RETURNING id::text, name, scope, filters, revision`,
          [viewId, adminId, v.name, v.scope, JSON.stringify(v.filters), body.revision]));
      } catch (err) {
        if (err.code === "23505") throw new AppError("You already have a view with this name", 409, "view_name_taken");
        throw err;
      }
      if (!row) throw new AppError("View not found or changed", 409, "revision_conflict");
    }
    await audit(viewId == null ? "customer360_view_created" : "customer360_view_updated", { client, after: { viewId: row.id, scope: row.scope } });
    await client.query("COMMIT");
    return row;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
async function deleteView({ adminId, viewId, audit }) {
  if (!/^\d{1,18}$/.test(String(viewId))) throw new AppError("Invalid view id", 400, "invalid_view_id");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rowCount } = await client.query(`DELETE FROM customer360_saved_views WHERE id = $1 AND owner_id = $2`, [viewId, adminId]);
    if (!rowCount) throw new AppError("View not found", 404, "view_not_found");
    await audit("customer360_view_deleted", { client, after: { viewId: String(viewId) } });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  PAGE, topicsFor, normalizeFilters, queues, items, customerItems, getItem, enqueue, act, syncFeeds, markBreaches,
  createQueue, updateQueue, views, saveView, deleteView,
};
