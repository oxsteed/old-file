"use strict";
/**
 * Customer 360 upgrade 5: weighted duplicate/fraud link graph and guided
 * merge review.
 *
 * Signals are keyed HMAC-SHA256 digests computed in PostgreSQL (pgcrypto),
 * so raw device ids, card/bank fingerprints and addresses never enter the
 * signal table. Edge weight between two customers:
 *   score = 1 - Π(1 - w_kind) over the distinct kinds they share,
 *   w = card 0.9, bank 0.9, device 0.6, address 0.3.
 * A value shared by more than COMMON_LIMIT customers (a kiosk device, an
 * apartment block) is reported as common and contributes nothing.
 *
 * Reviews never merge accounts or balances. "Duplicate" needs two distinct
 * administrators and a complete checklist; the outcome is a recorded
 * finding with manual next steps through existing tools.
 */
const crypto = require("crypto");
const db = require("../db");
const AppError = require("../utils/appError");
const { withTransaction } = require("../utils/transaction");
const { logAdminAction } = require("./auditService");
const events = require("./customer360Events");

const WEIGHTS = Object.freeze({ card: 0.9, bank: 0.9, device: 0.6, address: 0.3 });
const COMMON_LIMIT = 25;
const CHECKLIST = Object.freeze(["identityCompared", "contactCompared", "paymentInstrumentsCompared", "activityReviewed"]);
const OPTIONAL_CHECKLIST = Object.freeze(["customerContacted"]);

/** HMAC key: dedicated secret, else derived from ENCRYPTION_KEY; null disables. */
function signalKey(env = process.env) {
  if (env.CUSTOMER360_SIGNAL_HMAC_KEY && env.CUSTOMER360_SIGNAL_HMAC_KEY.length >= 32) {
    return crypto.createHash("sha256").update(env.CUSTOMER360_SIGNAL_HMAC_KEY).digest();
  }
  if (env.ENCRYPTION_KEY && env.ENCRYPTION_KEY.length >= 32) {
    return Buffer.from(crypto.hkdfSync("sha256", env.ENCRYPTION_KEY, "oxsteed", "customer360-identity-signals-v1", 32));
  }
  return null;
}

function score(kinds) {
  const unique = [...new Set(kinds)].filter((k) => WEIGHTS[k]);
  return Math.round((1 - unique.reduce((p, k) => p * (1 - WEIGHTS[k]), 1)) * 1000) / 1000;
}

/** Record one raw value for a user (hashing happens in SQL). */
async function recordSignal(runner, { userId, kind, value, source }, env = process.env) {
  const key = signalKey(env);
  const raw = String(value || "").trim();
  if (!key || !WEIGHTS[kind] || raw.length < 4 || raw.length > 500) return false;
  await (runner || db).query(
    `INSERT INTO customer_identity_signals (user_id, kind, value_hash, source)
     VALUES ($1, $2::text, encode(hmac(convert_to($2::text || ':' || $3::text, 'UTF8'), decode($4, 'hex'), 'sha256'), 'hex'), $5)
     ON CONFLICT (user_id, kind, value_hash) DO UPDATE SET last_seen_at = NOW()`,
    [userId, kind, raw, key.toString("hex"), String(source).slice(0, 40)],
  );
  return true;
}

/** Card fingerprint from a Stripe payment intent payload, if present. */
function cardFingerprint(intent) {
  const charge = intent && typeof intent.latest_charge === "object" ? intent.latest_charge : intent?.charges?.data?.[0];
  const fp = charge?.payment_method_details?.card?.fingerprint;
  return typeof fp === "string" && /^[A-Za-z0-9]{8,64}$/.test(fp) ? fp : null;
}

// Sweeps compute digests set-wise in SQL. Each wraps around at the end so
// changed devices/addresses are picked up on the next cycle.
const SWEEPS = {
  users: {
    keyType: "uuid",
    sql: `WITH batch AS (
            SELECT id, signup_device_fingerprint, address_line1, zip_code FROM users
             WHERE ($1::uuid IS NULL OR id > $1::uuid) AND deleted_at IS NULL ORDER BY id LIMIT $2),
          vals AS (
            SELECT id AS user_id, 'device' AS kind, btrim(signup_device_fingerprint) AS raw FROM batch
             WHERE length(btrim(COALESCE(signup_device_fingerprint, ''))) BETWEEN 4 AND 500
            UNION ALL
            SELECT id, 'address', lower(regexp_replace(btrim(address_line1), '\\s+', ' ', 'g')) || '|' || lower(btrim(zip_code)) FROM batch
             WHERE length(btrim(COALESCE(address_line1, ''))) >= 4 AND length(btrim(COALESCE(zip_code, ''))) >= 3),
          ins AS (
            INSERT INTO customer_identity_signals (user_id, kind, value_hash, source)
            SELECT user_id, kind, encode(hmac(convert_to(kind || ':' || raw, 'UTF8'), decode($3, 'hex'), 'sha256'), 'hex'), 'users' FROM vals
            ON CONFLICT (user_id, kind, value_hash) DO UPDATE SET last_seen_at = NOW())
          SELECT (SELECT MAX(id::text) FROM batch) AS last_key, (SELECT COUNT(*) FROM batch)::int AS n`,
  },
  bank: {
    keyType: "bigint",
    sql: `WITH batch AS (
            SELECT id, user_id, account_fingerprint FROM credit_payout_destinations
             WHERE id > COALESCE($1::bigint, 0) ORDER BY id LIMIT $2),
          ins AS (
            INSERT INTO customer_identity_signals (user_id, kind, value_hash, source)
            SELECT user_id, 'bank', encode(hmac(convert_to('bank:' || btrim(account_fingerprint), 'UTF8'), decode($3, 'hex'), 'sha256'), 'hex'), 'credit_payout_destinations'
              FROM batch WHERE user_id IS NOT NULL AND length(btrim(COALESCE(account_fingerprint, ''))) >= 4
            ON CONFLICT (user_id, kind, value_hash) DO UPDATE SET last_seen_at = NOW())
          SELECT (SELECT MAX(id)::text FROM batch) AS last_key, (SELECT COUNT(*) FROM batch)::int AS n`,
  },
};

async function sweep(name, { batch = 5000, env = process.env } = {}) {
  const key = signalKey(env);
  if (!key) return { skipped: "no_key" };
  const spec = SWEEPS[name];
  const consumer = `signals_${name}`;
  await db.query(`INSERT INTO customer_event_ingest_cursors (source) VALUES ($1) ON CONFLICT DO NOTHING`, [consumer]);
  const { rows: [cur] } = await db.query(`SELECT last_key FROM customer_event_ingest_cursors WHERE source = $1`, [consumer]);
  const { rows: [r] } = await db.query(spec.sql, [cur.last_key, batch, key.toString("hex")]);
  // Wrap around after the last batch so the next cycle refreshes everyone.
  await db.query(
    `UPDATE customer_event_ingest_cursors SET last_key = $2, updated_at = NOW(), completed_at = CASE WHEN $2::text IS NULL THEN NOW() ELSE completed_at END
      WHERE source = $1`, [consumer, r.n < batch ? null : r.last_key]);
  return { processed: r.n };
}

/** Kinds a viewer may see: address with manage_users; card/bank need financials; device is security (super). */
function visibleKinds({ financial, security }) {
  return ["address", ...(financial ? ["card", "bank"] : []), ...(security ? ["device"] : [])];
}

/** One-hop weighted links for a customer, plus links among those neighbours. */
async function graph(customerId, kinds, { limit = 25 } = {}) {
  const { rows } = await db.query(
    `WITH mine AS (
       SELECT kind, value_hash FROM customer_identity_signals WHERE user_id = $1 AND kind = ANY($2::text[])),
     shared AS (
       SELECT m.kind, m.value_hash, COUNT(DISTINCT s.user_id) AS holders
         FROM mine m JOIN customer_identity_signals s ON s.kind = m.kind AND s.value_hash = m.value_hash
        GROUP BY m.kind, m.value_hash),
     links AS (
       SELECT s.user_id, array_agg(DISTINCT s.kind ORDER BY s.kind) AS kinds, MAX(s.last_seen_at) AS last_seen
         FROM shared sh JOIN customer_identity_signals s ON s.kind = sh.kind AND s.value_hash = sh.value_hash
        WHERE s.user_id <> $1 AND sh.holders <= $3
        GROUP BY s.user_id)
     SELECT l.user_id, l.kinds, l.last_seen, u.first_name, left(u.last_name, 1) AS last_initial,
            regexp_replace(u.email, '^(.).*(@.*)$', '\\1***\\2') AS email_masked, u.created_at,
            COALESCE(u.is_suspended, false) AS is_suspended, u.role,
            (SELECT json_agg(json_build_object('kind', kind, 'holders', holders)) FROM shared WHERE holders > $3) AS common
       FROM links l JOIN users u ON u.id = l.user_id
      WHERE u.deleted_at IS NULL AND u.role NOT IN ('admin', 'super_admin')`,
    [customerId, kinds, COMMON_LIMIT],
  );
  const nodes = rows
    .map((r) => ({
      userId: r.user_id,
      name: `${r.first_name || ""} ${r.last_initial || ""}`.trim(),
      emailMasked: r.email_masked,
      createdAt: r.created_at,
      suspended: r.is_suspended,
      role: r.role,
      kinds: r.kinds,
      score: score(r.kinds),
      lastSeen: r.last_seen,
    }))
    .sort((a, b) => b.score - a.score || String(a.userId).localeCompare(String(b.userId)))
    .slice(0, limit);
  const ids = nodes.map((n) => n.userId);
  let between = [];
  if (ids.length > 1) {
    const { rows: e } = await db.query(
      `SELECT LEAST(a.user_id, b.user_id) AS a, GREATEST(a.user_id, b.user_id) AS b, array_agg(DISTINCT a.kind ORDER BY a.kind) AS kinds
         FROM customer_identity_signals a JOIN customer_identity_signals b
           ON a.kind = b.kind AND a.value_hash = b.value_hash AND a.user_id < b.user_id
        WHERE a.user_id = ANY($1::uuid[]) AND b.user_id = ANY($1::uuid[]) AND a.kind = ANY($2::text[])
        GROUP BY 1, 2`, [ids, kinds]);
    between = e.map((x) => ({ a: x.a, b: x.b, kinds: x.kinds, score: score(x.kinds) }));
  }
  const common = rows[0]?.common || (await commonOnly(customerId, kinds));
  return { weights: WEIGHTS, commonLimit: COMMON_LIMIT, nodes, edges: [...nodes.map((n) => ({ a: customerId, b: n.userId, kinds: n.kinds, score: n.score })), ...between], common: common || [] };
}
async function commonOnly(customerId, kinds) {
  const { rows } = await db.query(
    `SELECT m.kind, COUNT(DISTINCT s.user_id)::int AS holders FROM customer_identity_signals m
       JOIN customer_identity_signals s ON s.kind = m.kind AND s.value_hash = m.value_hash
      WHERE m.user_id = $1 AND m.kind = ANY($2::text[]) GROUP BY m.kind, m.value_hash HAVING COUNT(DISTINCT s.user_id) > $3`,
    [customerId, kinds, COMMON_LIMIT]);
  return rows;
}

const pair = (x, y) => (String(x) < String(y) ? [x, y] : [y, x]);

/** Open (or return the active) review for a customer pair with a live link. */
async function openReview({ customerId, otherId, kinds, adminId, req }) {
  if (customerId === otherId) throw new AppError("Choose a different account", 400, "invalid_request");
  const g = await graph(customerId, kinds, { limit: 200 });
  const node = g.nodes.find((n) => n.userId === otherId);
  if (!node) throw new AppError("No visible link between these accounts", 404, "not_found");
  const [a, b] = pair(customerId, otherId);
  return withTransaction(db, async (client) => {
    const { rows: [existing] } = await client.query(
      `SELECT * FROM customer_link_reviews WHERE user_a = $1 AND user_b = $2 AND status IN ('in_review', 'awaiting_second_review') FOR UPDATE`, [a, b]);
    if (existing) return existing;
    const { rows: [row] } = await client.query(
      `INSERT INTO customer_link_reviews (user_a, user_b, score, signal_kinds, opened_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [a, b, node.score, node.kinds, adminId]);
    await logAdminAction({ adminId, action: "customer360_link_review_opened", targetType: "user", targetId: customerId,
      after: { reviewId: String(row.id), otherUserId: otherId, score: node.score, kinds: node.kinds }, req, client });
    return row;
  }, "customer360_link_review_open");
}

async function reviewsFor(customerId) {
  const { rows } = await db.query(
    `SELECT r.*, r.id::text AS id FROM customer_link_reviews r WHERE r.user_a = $1 OR r.user_b = $1 ORDER BY r.updated_at DESC LIMIT 50`, [customerId]);
  return rows;
}

function checklistValid(list) {
  if (!list || typeof list !== "object" || Array.isArray(list)) return false;
  return Object.entries(list).every(([k, v]) => [...CHECKLIST, ...OPTIONAL_CHECKLIST].includes(k) && typeof v === "boolean");
}

/**
 * Review steps. "duplicate" by the first admin proposes; a second, distinct
 * admin confirms ("confirm") or returns it ("reject"). "distinct" and
 * "dismiss" close the review. Nothing is merged in any outcome.
 */
async function decide({ reviewId, customerId, action, checklist, reason, revision, adminId, req }) {
  if (!/^\d{1,19}$/.test(String(reviewId))) throw new AppError("Invalid review", 400, "invalid_request");
  if (!["checklist", "duplicate", "confirm", "reject", "distinct", "dismiss"].includes(action)) throw new AppError("Invalid action", 400, "invalid_request");
  if (action !== "checklist" && (typeof reason !== "string" || reason.trim().length < 3 || reason.length > 500)) throw new AppError("Reason required", 400, "reason_required");
  if (checklist !== undefined && !checklistValid(checklist)) throw new AppError("Invalid checklist", 400, "invalid_request");
  return withTransaction(db, async (client) => {
    const { rows: [r] } = await client.query(`SELECT * FROM customer_link_reviews WHERE id = $1 FOR UPDATE`, [reviewId]);
    if (!r || (r.user_a !== customerId && r.user_b !== customerId)) throw new AppError("Review not found", 404, "not_found");
    if (Number(revision) !== r.revision) throw new AppError("Review changed", 409, "revision_conflict");
    const list = { ...r.checklist, ...(checklist || {}) };
    let next = { status: r.status, proposed_by: r.proposed_by, proposed_at: r.proposed_at, decided_by: r.decided_by, decided_at: r.decided_at, decision_reason: r.decision_reason };
    const open = ["in_review", "awaiting_second_review"].includes(r.status);
    if (!open) throw new AppError("Review is closed", 409, "invalid_state");
    if (action === "checklist") {
      if (r.status !== "in_review") throw new AppError("Checklist is locked while awaiting a second review", 409, "invalid_state");
    } else if (action === "duplicate") {
      if (r.status !== "in_review") throw new AppError("Already proposed", 409, "invalid_state");
      if (!CHECKLIST.every((k) => list[k] === true)) throw new AppError("Complete the checklist first", 409, "checklist_incomplete");
      next = { ...next, status: "awaiting_second_review", proposed_by: adminId, proposed_at: new Date(), decision_reason: reason.trim() };
    } else if (action === "confirm" || action === "reject") {
      if (r.status !== "awaiting_second_review") throw new AppError("Nothing to confirm", 409, "invalid_state");
      if (r.proposed_by === adminId) throw new AppError("A second, different administrator must decide", 403, "self_approval_forbidden");
      next = action === "confirm"
        ? { ...next, status: "confirmed_duplicate", decided_by: adminId, decided_at: new Date(), decision_reason: reason.trim() }
        : { ...next, status: "in_review", proposed_by: null, proposed_at: null, decision_reason: reason.trim() };
    } else {
      next = { ...next, status: action === "distinct" ? "confirmed_distinct" : "dismissed", decided_by: adminId, decided_at: new Date(), decision_reason: reason.trim() };
    }
    const { rows: [after] } = await client.query(
      `UPDATE customer_link_reviews SET status = $2, checklist = $3::jsonb, proposed_by = $4, proposed_at = $5, decided_by = $6, decided_at = $7,
         decision_reason = $8, revision = revision + 1, updated_at = NOW() WHERE id = $1 RETURNING *, id::text AS id`,
      [reviewId, next.status, JSON.stringify(list), next.proposed_by, next.proposed_at, next.decided_by, next.decided_at, next.decision_reason]);
    await logAdminAction({
      adminId, action: `customer360_link_review_${action}`, targetType: "user", targetId: customerId,
      before: { status: r.status, revision: r.revision, checklist: r.checklist },
      after: { status: after.status, revision: after.revision, checklist: after.checklist, reviewId: String(reviewId) },
      description: reason ? JSON.stringify({ reason: reason.trim() }) : null, req, client,
    });
    if (after.status === "confirmed_duplicate") {
      for (const user of [after.user_a, after.user_b]) {
        await events.append(client, {
          customerId: user, source: "customer360", type: "link_review.confirmed_duplicate", actorType: "admin", actorId: adminId,
          entityType: "link_review", entityId: String(after.id), changes: { status: { to: "confirmed_duplicate" } },
          dedupeKey: `link_review:${after.id}:confirmed:${user}`,
        });
      }
    }
    return after;
  }, "customer360_link_review_decide");
}

module.exports = { WEIGHTS, COMMON_LIMIT, CHECKLIST, OPTIONAL_CHECKLIST, signalKey, score, recordSignal, cardFingerprint, sweep, visibleKinds, graph, openReview, reviewsFor, decide };
