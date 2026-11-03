"use strict";
/**
 * Customer 360 upgrade 8: unified inbox.
 *
 * Reads support ticket threads, in-app admin conversations and staff email /
 * SMS into one timeline, each part behind its own grant. Sending reuses the
 * existing grant-gated channels only:
 *   - support replies → POST /api/admin/support/tickets/:id/reply (client)
 *   - in-app messages → POST /api/admin/messages/conversations/:userId/send (client)
 *   - email → supportEmailOutbox (Resend, durable retries)
 *   - SMS → smsNotificationService.sendSMSIfOptedIn (customer opt-in, rate
 *     limit, redacted logs), only when CUSTOMER360_INBOX_SMS_ENABLED=true.
 * Every email/SMS is an explicit admin action: confirm=true, idempotency key,
 * message_users permission, audit row in the same transaction.
 */
const crypto = require("crypto");
const db = require("../db");
const AppError = require("../utils/appError");
const templates = require("./customer360InboxTemplates");
const outbox = require("./supportEmailOutbox");
const events = require("./customer360Events");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE = 50;

function maskEmail(e) {
  const [u, d] = String(e || "").split("@");
  return d ? `${u.slice(0, 1)}***@${d}`.slice(0, 80) : "***";
}
function maskPhone(p) {
  const s = String(p || "").replace(/[^0-9+]/g, "");
  return s.length > 4 ? `${"*".repeat(Math.min(s.length - 4, 8))}${s.slice(-4)}` : "****";
}
const smsEnabled = () => String(process.env.CUSTOMER360_INBOX_SMS_ENABLED || "false").toLowerCase() === "true";

/** One page of the merged timeline, newest first. `can` = { support, internal, messages }. */
async function list(customerId, can, { before } = {}) {
  const cursor = before ? new Date(before) : null;
  if (before && Number.isNaN(cursor.getTime())) throw new AppError("Invalid cursor", 400, "invalid_cursor");
  const parts = [];
  if (can.support) {
    parts.push(`SELECT 'support'::text AS channel, m.id::text AS id, m.created_at AS at, m.is_from_admin AS outbound,
        m.is_internal AS internal, m.sender_name AS author, NULL::text AS subject, m.content AS body,
        t.id::text AS thread_id, t.ticket_number::text AS thread_label, t.status::text AS thread_status, NULL::text AS status
      FROM support_messages m JOIN support_tickets t ON t.id = m.ticket_id
     WHERE t.user_id = $1 AND ($3 OR NOT m.is_internal) AND ($2::timestamptz IS NULL OR m.created_at < $2)`);
  }
  if (can.messages) {
    parts.push(`SELECT 'message'::text AS channel, m.id::text AS id, m.created_at AS at, m.sender_id <> $1 AS outbound, false AS internal,
        COALESCE(NULLIF(trim(concat_ws(' ', s.first_name, s.last_name)), ''), 'OxSteed') AS author, NULL::text AS subject, m.content AS body,
        c.id::text AS thread_id, NULL::text AS thread_label, c.status::text AS thread_status, NULL::text AS status
      FROM conversations c JOIN users a ON a.id = c.customer_id AND a.role IN ('admin', 'super_admin')
      JOIN messages m ON m.conversation_id = c.id AND m.deleted_at IS NULL
      LEFT JOIN users s ON s.id = m.sender_id
     WHERE c.helper_id = $1 AND c.job_id IS NULL AND ($2::timestamptz IS NULL OR m.created_at < $2)`);
    parts.push(`SELECT o.channel::text AS channel, o.id::text AS id, o.created_at AS at, true AS outbound, false AS internal,
        COALESCE(NULLIF(trim(concat_ws(' ', s.first_name, s.last_name)), ''), 'OxSteed') AS author, o.subject::text AS subject,
        COALESCE(o.body, o.body_preview) AS body, NULL::text AS thread_id, o.recipient_masked::text AS thread_label, NULL::text AS thread_status, o.status::text AS status
      FROM customer_outbound_messages o LEFT JOIN users s ON s.id = o.admin_id
     WHERE o.customer_id = $1 AND ($2::timestamptz IS NULL OR o.created_at < $2)`);
  }
  if (!parts.length) return { items: [], nextBefore: null };
  const { rows } = await db.query(
    `SELECT * FROM (${parts.join(" UNION ALL ")}) x WHERE $3::boolean IS NOT NULL ORDER BY at DESC, id DESC LIMIT ${PAGE + 1}`,
    [customerId, cursor, !!can.internal]);
  const items = rows.slice(0, PAGE);
  return { items, nextBefore: rows.length > PAGE ? items[items.length - 1].at : null };
}

async function openTickets(customerId) {
  const { rows } = await db.query(
    `SELECT id::text, ticket_number::text, subject, status, assigned_to FROM support_tickets
      WHERE user_id = $1 AND status NOT IN ('resolved', 'closed') ORDER BY created_at DESC LIMIT 20`, [customerId]);
  return rows;
}

async function recipient(customerId) {
  const { rows: [u] } = await db.query(
    `SELECT u.id, u.email, u.email_verified, u.first_name, u.preferred_language, u.role, u.deleted_at,
            u.phone_number, u.phone_e164, u.phone_verified
       FROM users u WHERE u.id = $1`, [customerId]);
  if (!u || u.deleted_at || ["admin", "super_admin"].includes(u.role)) throw new AppError("Customer cannot be messaged", 404, "customer_not_messageable");
  return u;
}

function channels(u) {
  return {
    support: true, message: true,
    email: { available: !!u.email, verified: !!u.email_verified, to: u.email ? maskEmail(u.email) : null },
    sms: { available: smsEnabled() && !!(u.phone_e164 || u.phone_number) && !!u.phone_verified, enabled: smsEnabled(),
      to: u.phone_e164 || u.phone_number ? maskPhone(u.phone_e164 || u.phone_number) : null },
  };
}

function preferredLanguage(u) {
  const l = String(u.preferred_language || "en").slice(0, 2).toLowerCase();
  return templates.LANGUAGES.includes(l) ? l : "en";
}

/**
 * Explicit admin send of an email or SMS. `audit(client, row)` must write the
 * admin audit row (throwOnError) inside the same transaction.
 */
async function send({ customerId, adminId, channel, templateKey, language, subject, body, clientMessageId, confirm, audit }) {
  if (confirm !== true) throw new AppError("Sending requires an explicit confirmation", 400, "confirmation_required");
  if (!["email", "sms"].includes(channel)) throw new AppError("Unsupported channel", 400, "invalid_channel");
  if (!UUID.test(String(clientMessageId || ""))) throw new AppError("clientMessageId must be a UUID", 400, "invalid_client_message_id");
  if (!templates.LANGUAGES.includes(language)) throw new AppError("Unsupported language", 400, "invalid_language");
  if (templateKey != null && !templates.KEYS.includes(templateKey)) throw new AppError("Unknown template", 400, "invalid_template");
  const text = String(body || "").trim();
  const max = channel === "sms" ? 480 : 8000;
  if (!text || text.length > max) throw new AppError(`Message must be 1-${max} characters`, 400, "invalid_body");
  const subj = String(subject || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  if (channel === "email" && !subj) throw new AppError("Subject is required", 400, "invalid_subject");

  const { rows: [existing] } = await db.query(
    `SELECT * FROM customer_outbound_messages WHERE admin_id = $1 AND client_message_id = $2`, [adminId, clientMessageId]);
  if (existing) {
    if (existing.customer_id !== customerId || existing.channel !== channel) throw new AppError("Idempotency key reused", 409, "idempotency_conflict");
    return { message: existing, replayed: true };
  }
  const u = await recipient(customerId);
  const hash = crypto.createHash("sha256").update(text).digest("hex");
  const preview = text.length > 20 ? `${text.slice(0, 20)}…` : text;
  let status = "queued", reason = null, outboxId = null, to = null;
  if (channel === "email") {
    if (!u.email) throw new AppError("Customer has no email address", 409, "no_email");
    to = maskEmail(u.email);
  } else {
    if (!smsEnabled()) throw new AppError("SMS from Customer 360 is disabled", 409, "sms_disabled");
    if (!(u.phone_e164 || u.phone_number) || !u.phone_verified) throw new AppError("Customer has no verified phone", 409, "no_verified_phone");
    to = maskPhone(u.phone_e164 || u.phone_number);
  }

  const client = await db.connect();
  let row;
  try {
    await client.query("BEGIN");
    ({ rows: [row] } = await client.query(
      `INSERT INTO customer_outbound_messages (customer_id, admin_id, channel, template_key, language, subject, body, body_hash,
         body_preview, recipient_masked, status, client_message_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'queued', $11)
       ON CONFLICT (admin_id, client_message_id) DO NOTHING RETURNING *`,
      [customerId, adminId, channel, templateKey || null, language, channel === "email" ? subj : null,
        channel === "email" ? text : null, hash, preview, to, clientMessageId]));
    if (!row) {
      await client.query("ROLLBACK");
      const { rows: [again] } = await db.query(`SELECT * FROM customer_outbound_messages WHERE admin_id = $1 AND client_message_id = $2`, [adminId, clientMessageId]);
      return { message: again, replayed: true };
    }
    await audit(client, row);
    await events.append(client, {
      customerId, source: "customer360", type: `inbox.${channel}_sent`, actorType: "admin", actorId: adminId,
      entityType: "outbound_message", entityId: row.id, changes: { channel, template: templateKey || null, language },
      dedupeKey: `outbound:${row.id}`,
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Delivery happens after the record and audit are committed.
  try {
    if (channel === "email") {
      const escaped = text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
      const queued = await outbox.enqueueSupportEmail({
        kind: "customer360", to: u.email, subject: subj, text,
        html: `<div dir="${language === "ar" ? "rtl" : "ltr"}" lang="${language}" style="white-space:pre-wrap">${escaped}</div>`,
        idempotencyKey: `customer360:${row.id}`,
      });
      outboxId = queued.id || null;
      status = "queued";
    } else {
      const sms = require("./smsNotificationService");
      const ok = await sms.sendSMSIfOptedIn(customerId, text, "support_replies");
      status = ok ? "sent" : "not_sent";
      reason = ok ? null : "opted_out_or_rate_limited";
    }
  } catch (err) {
    status = "not_sent";
    reason = "delivery_error";
  }
  ({ rows: [row] } = await db.query(
    `UPDATE customer_outbound_messages SET status = $2, status_reason = $3, outbox_id = $4 WHERE id = $1 RETURNING *`,
    [row.id, status, reason, outboxId]));
  return { message: row, replayed: false };
}

module.exports = { list, openTickets, recipient, channels, preferredLanguage, send, maskEmail, maskPhone, smsEnabled, PAGE };
