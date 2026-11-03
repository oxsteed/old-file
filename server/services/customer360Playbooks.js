"use strict";
/**
 * Customer 360 upgrade 9: playbooks. Definitions are versioned code. A run
 * executes its `check` and `safe_action` steps automatically, in order;
 * `manual` steps wait for an admin; `money_handoff` steps NEVER execute —
 * they link to the existing approval flow (two distinct admins) and can only
 * be marked handed_off. Safe actions are idempotent and rate-limited:
 * resend email verification, requeue dead-lettered notifications.
 */
const db = require("../db");
const AppError = require("../utils/appError");
const events = require("./customer360Events");

const RESEND_COOLDOWN_MINUTES = 10;

async function countFailed(customerId) {
  const [{ rows: [m] }, { rows: [e] }] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS n FROM message_notification_outbox WHERE recipient_id = $1 AND status = 'failed'`, [customerId]),
    db.query(`SELECT COUNT(*)::int AS n FROM support_email_outbox o JOIN users u ON lower(u.email) = lower(o.recipient)
               WHERE u.id = $1 AND o.status = 'failed'`, [customerId]),
  ]);
  return { messageNotifications: m.n, supportEmails: e.n };
}

const PLAYBOOKS = Object.freeze({
  verification_help: {
    version: 1,
    steps: [
      { key: "check_unverified", kind: "check", async run({ customerId }) {
        const { rows: [u] } = await db.query(`SELECT email IS NOT NULL AS has_email, email_verified IS TRUE AS verified FROM users WHERE id = $1`, [customerId]);
        if (!u?.has_email) return { stop: "no_email", result: { hasEmail: false } };
        if (u.verified) return { stop: "already_verified", result: { verified: true } };
        return { result: { verified: false } };
      } },
      { key: "resend_verification", kind: "safe_action", async run({ customerId }) {
        const { rows: [recent] } = await db.query(
          `SELECT 1 FROM customer_playbook_run_steps s JOIN customer_playbook_runs r ON r.id = s.run_id
            WHERE r.customer_id = $1 AND s.step_key = 'resend_verification' AND s.status = 'done'
              AND s.completed_at > NOW() - ($2::int * interval '1 minute') LIMIT 1`, [customerId, RESEND_COOLDOWN_MINUTES]);
        if (recent) return { status: "skipped", result: { reason: "cooldown", minutes: RESEND_COOLDOWN_MINUTES } };
        const out = await require("../controllers/authController").issueEmailVerificationCode(customerId);
        return out.sent ? { result: { sent: true } } : { status: out.reason === "delivery_failed" ? "failed" : "skipped", result: { reason: out.reason } };
      } },
      { key: "confirm_with_customer", kind: "manual" },
    ],
  },
  notification_retry: {
    version: 1,
    steps: [
      { key: "find_failed", kind: "check", async run({ customerId }) {
        const counts = await countFailed(customerId);
        return counts.messageNotifications + counts.supportEmails ? { result: counts } : { stop: "nothing_failed", result: counts };
      } },
      { key: "retry_message_notifications", kind: "safe_action", grant: "manage_operations", async run({ customerId }) {
        const { rows } = await db.query(`SELECT id::text FROM message_notification_outbox WHERE recipient_id = $1 AND status = 'failed' LIMIT 500`, [customerId]);
        if (!rows.length) return { status: "skipped", result: { reason: "nothing_failed" } };
        const retried = await require("../jobs/messageNotificationOutbox").retryFailedMessageNotifications(rows.map((r) => r.id));
        return { result: { requeued: retried.length } };
      } },
      { key: "retry_support_emails", kind: "safe_action", grant: "manage_operations", async run({ customerId }) {
        // Only failed rows move back; the stored Resend idempotency key stops duplicates.
        const { rows } = await db.query(
          `UPDATE support_email_outbox o SET status = 'pending', attempts = 0, next_attempt_at = NOW(), locked_at = NULL, updated_at = NOW()
             FROM users u WHERE u.id = $1 AND lower(u.email) = lower(o.recipient) AND o.status = 'failed' RETURNING o.id`, [customerId]);
        return rows.length ? { result: { requeued: rows.length } } : { status: "skipped", result: { reason: "nothing_failed" } };
      } },
      { key: "confirm_delivery", kind: "manual" },
    ],
  },
  payment_issue: {
    version: 1,
    steps: [
      { key: "review_payments", kind: "check", async run({ customerId }) {
        const { rows: [p] } = await db.query(
          `SELECT COUNT(*) FILTER (WHERE status = 'failed')::int AS failed, COUNT(*) FILTER (WHERE status = 'refunded')::int AS refunded,
                  COUNT(*)::int AS total
             FROM payments WHERE payer_id = $1 AND created_at > NOW() - interval '30 days'`, [customerId]);
        return { result: p };
      } },
      { key: "contact_customer", kind: "manual", route: "inbox" },
      // Refunds, credits and adjustments stay in the existing approval flows.
      { key: "refund_or_credit", kind: "money_handoff", route: "/admin/payments" },
    ],
  },
});

function definitions() {
  return Object.entries(PLAYBOOKS).map(([key, p]) => ({
    key, version: p.version,
    steps: p.steps.map((s) => ({ key: s.key, kind: s.kind, route: s.route || null, grant: s.grant || null })),
  }));
}

async function runs(customerId, { limit = 10, runId = null } = {}) {
  const { rows } = await db.query(
    `SELECT r.id::text, r.playbook_key, r.playbook_version, r.status, r.started_by, r.created_at, r.closed_at,
            COALESCE(NULLIF(trim(concat_ws(' ', a.first_name, a.last_name)), ''), 'Admin') AS started_by_name,
            COALESCE(json_agg(json_build_object('key', s.step_key, 'kind', s.kind, 'status', s.status, 'result', s.result,
              'note', s.note, 'completedAt', s.completed_at) ORDER BY s.position) FILTER (WHERE s.run_id IS NOT NULL), '[]') AS steps
       FROM customer_playbook_runs r LEFT JOIN customer_playbook_run_steps s ON s.run_id = r.id
       LEFT JOIN users a ON a.id = r.started_by
      WHERE r.customer_id = $1 AND ($3::bigint IS NULL OR r.id = $3) GROUP BY r.id, a.first_name, a.last_name ORDER BY r.created_at DESC, r.id DESC LIMIT $2`,
    [customerId, Math.min(Math.max(1, limit), 50), runId]);
  return rows;
}

async function getRun(customerId, runId) {
  if (!/^\d{1,18}$/.test(String(runId))) throw new AppError("Invalid run id", 400, "invalid_run_id");
  const [run] = await runs(customerId, { limit: 1, runId: String(runId) });
  if (!run) throw new AppError("Playbook run not found", 404, "playbook_run_not_found");
  return run;
}

async function closeIfFinished(runId) {
  await db.query(
    `UPDATE customer_playbook_runs r SET status = 'completed', closed_at = NOW(), updated_at = NOW()
      WHERE r.id = $1 AND r.status = 'open'
        AND NOT EXISTS (SELECT 1 FROM customer_playbook_run_steps s WHERE s.run_id = r.id AND s.status = 'pending')`, [runId]);
}

/**
 * Start a run and execute its automatic steps. `can(definition)` answers grant
 * checks; `audit(action, details)` writes the admin audit row (throwOnError).
 */
async function start({ customerId, key, adminId, clientRequestId, confirm, can, audit }) {
  const pb = PLAYBOOKS[key];
  if (!pb) throw new AppError("Unknown playbook", 404, "playbook_not_found");
  if (confirm !== true) throw new AppError("Running a playbook requires an explicit confirmation", 400, "confirmation_required");
  if (!/^[0-9a-f-]{36}$/i.test(String(clientRequestId || ""))) throw new AppError("clientRequestId must be a UUID", 400, "invalid_client_request_id");
  const client = await db.connect();
  let runId;
  try {
    await client.query("BEGIN");
    const { rows: [prior] } = await client.query(
      `SELECT id::text, customer_id FROM customer_playbook_runs WHERE started_by = $1 AND client_request_id = $2`, [adminId, clientRequestId]);
    if (prior) {
      await client.query("ROLLBACK");
      if (prior.customer_id !== customerId) throw new AppError("Request id reused", 409, "idempotency_conflict");
      return { run: await getRun(customerId, prior.id), replayed: true };
    }
    let row;
    try {
      await client.query("SAVEPOINT open_run");
      ({ rows: [row] } = await client.query(
        `INSERT INTO customer_playbook_runs (customer_id, playbook_key, playbook_version, started_by, client_request_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id::text`, [customerId, key, pb.version, adminId, clientRequestId]));
    } catch (err) {
      if (err.code === "23505") throw new AppError("This playbook is already open for the customer", 409, "playbook_already_open");
      throw err;
    }
    runId = row.id;
    for (const [i, s] of pb.steps.entries()) {
      await client.query(`INSERT INTO customer_playbook_run_steps (run_id, step_key, position, kind) VALUES ($1, $2, $3, $4)`, [runId, s.key, i, s.kind]);
    }
    await audit("customer360_playbook_started", { client, after: { runId, playbook: key, version: pb.version } });
    await events.append(client, {
      customerId, source: "customer360", type: "playbook.started", actorType: "admin", actorId: adminId,
      entityType: "playbook_run", entityId: runId, changes: { playbook: key, version: pb.version }, dedupeKey: `playbook:${runId}:started`,
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Automatic steps run after the run is committed; each result is recorded.
  let stopped = null;
  for (const s of pb.steps) {
    if (s.kind !== "check" && s.kind !== "safe_action") continue;
    let status = "done";
    let result = {};
    if (stopped && s.kind === "safe_action") {
      status = "skipped";
      result = { reason: stopped };
    } else if (s.grant && !(await can({ grant: s.grant }))) {
      status = "skipped";
      result = { reason: "no_access", grant: s.grant };
    } else {
      try {
        const out = (await s.run({ customerId })) || {};
        result = out.result || {};
        if (out.status) status = out.status;
        if (out.stop) stopped = out.stop;
      } catch (err) {
        status = "failed";
        result = { reason: "error", code: err.code || null };
      }
    }
    await db.query(
      `UPDATE customer_playbook_run_steps SET status = $3, result = $4::jsonb, actor_id = $5, completed_at = NOW()
        WHERE run_id = $1 AND step_key = $2 AND status = 'pending'`, [runId, s.key, status, JSON.stringify(result), adminId]);
    if (s.kind === "safe_action" && status !== "skipped") {
      await audit(`customer360_playbook_${s.key}`, { after: { runId, status, result } });
      await events.append(null, {
        customerId, source: "customer360", type: `playbook.${s.key}`, actorType: "admin", actorId: adminId,
        entityType: "playbook_run", entityId: runId, changes: { status }, dedupeKey: `playbook:${runId}:${s.key}`,
      });
    }
  }
  // Stopped early (nothing to do): manual follow-ups in that run are moot.
  if (stopped) {
    await db.query(`UPDATE customer_playbook_run_steps SET status = 'skipped', result = $2::jsonb, completed_at = NOW()
                     WHERE run_id = $1 AND status = 'pending' AND kind = 'manual'`, [runId, JSON.stringify({ reason: stopped })]);
  }
  await closeIfFinished(runId);
  return { run: await getRun(customerId, runId), replayed: false };
}

/** Mark a manual step done, or a money hand-off handed off (never executed). */
async function completeStep({ customerId, runId, stepKey, adminId, note, audit }) {
  const run = await getRun(customerId, runId);
  if (run.status !== "open") throw new AppError("Playbook run is closed", 409, "playbook_run_closed");
  const step = run.steps.find((s) => s.key === stepKey);
  if (!step) throw new AppError("Unknown step", 404, "playbook_step_not_found");
  if (!["manual", "money_handoff"].includes(step.kind)) throw new AppError("Automatic steps cannot be completed by hand", 400, "step_not_manual");
  const text = note == null ? null : String(note).trim().slice(0, 1000) || null;
  if (step.kind === "money_handoff" && !text) throw new AppError("Record where the request was handed off", 400, "handoff_note_required");
  const status = step.kind === "money_handoff" ? "handed_off" : "done";
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      `UPDATE customer_playbook_run_steps SET status = $3, note = $4, actor_id = $5, completed_at = NOW()
        WHERE run_id = $1 AND step_key = $2 AND status = 'pending'`, [runId, stepKey, status, text, adminId]);
    if (!rowCount) throw new AppError("Step already completed", 409, "step_already_completed");
    await audit(`customer360_playbook_step_${status}`, { client, after: { runId, step: stepKey, status } });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await closeIfFinished(runId);
  return getRun(customerId, runId);
}

async function cancel({ customerId, runId, adminId, audit }) {
  await getRun(customerId, runId);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      `UPDATE customer_playbook_runs SET status = 'cancelled', closed_by = $2, closed_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'open'`, [runId, adminId]);
    if (!rowCount) throw new AppError("Playbook run is closed", 409, "playbook_run_closed");
    await client.query(`UPDATE customer_playbook_run_steps SET status = 'skipped', result = '{"reason":"cancelled"}'::jsonb, completed_at = NOW()
                         WHERE run_id = $1 AND status = 'pending'`, [runId]);
    await audit("customer360_playbook_cancelled", { client, after: { runId } });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return getRun(customerId, runId);
}

module.exports = { PLAYBOOKS, definitions, runs, getRun, start, completeStep, cancel, RESEND_COOLDOWN_MINUTES };
