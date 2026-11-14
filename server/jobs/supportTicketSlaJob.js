// server/jobs/supportTicketSlaJob.js
// Review P1-17-F05: support_tickets had no SLA or stale handling — after the
// creation notifications, an unclaimed ticket sat in 'open' forever with no
// monitor, escalation, or reassignment.
//
// This sweeper runs every 15 minutes and escalates open, unclaimed tickets
// whose SLA deadline (sla_due_at, set at creation from the ticket priority)
// has passed. Escalation bumps the priority one level, stamps escalated_at
// (so each ticket escalates once), sends a persistent staff notification
// per breach (item 21), and broadcasts to admins; assignment itself stays
// a human decision via the claim endpoint. A ticket that stays open and
// unclaimed re-escalates on a 4-hour cadence until it is claimed or
// resolved, so the breach never goes silent after the first alert.
//
// SLA windows (also used by migration 828's backfill):
//   urgent 1h, high 4h, normal 24h, low 72h.

const pool = require('../db');
const logger = require('../utils/logger');
const { resolveSupportStaffIds, notifySupportStaff } = require('../services/supportNotificationService');

const JOB_NAME = 'support-ticket-sla';
const CRON_EXPRESSION = '*/15 * * * *'; // every 15 minutes
const BATCH_SIZE = 200;
// Item 21: an unclaimed breached ticket re-escalates (and re-notifies)
// every 4 hours until it is claimed or resolved.
const RE_ESCALATION_INTERVAL_HOURS = 4;

const PRIORITY_ORDER = ['low', 'normal', 'high', 'urgent'];

function bumpPriority(priority) {
  const idx = PRIORITY_ORDER.indexOf(priority);
  if (idx === -1 || idx === PRIORITY_ORDER.length - 1) return PRIORITY_ORDER[PRIORITY_ORDER.length - 1];
  return PRIORITY_ORDER[idx + 1];
}

async function sweepSupportTicketSla(db) {
  const escalated = [];
  const reescalated = [];

  // Resolve support staff once per sweep, lazily (only when a breach
  // needs notifying). A resolution failure must never block the
  // escalation itself; the breach is warn-logged and the re-escalation
  // cadence below retries the notification. A successful resolution
  // with zero staff is different: there is nobody to notify, so the
  // round completes instead of retrying every sweep.
  let staffResolution;
  async function getStaffIds() {
    if (staffResolution === undefined) {
      try {
        staffResolution = { ids: await resolveSupportStaffIds(db), failed: false };
      } catch (err) {
        logger.warn('Support ticket SLA staff resolution failed', { error: err.message });
        staffResolution = { ids: [], failed: true };
      }
    }
    return staffResolution;
  }

  // Persistent admin notification per breach (item 21), via the shared
  // staff fan-out: one in-app row (visible in the notification center),
  // push, and email per staff member, deduped by a per-round
  // idempotency key. Never throws; a failure is reported, never stamped.
  async function notifyBreach(ticket, roundKey, { reescalation }) {
    const { ids: recipientIds, failed: resolutionFailed } = await getStaffIds();
    if (resolutionFailed) return { notified: 0, failed: 0, skipped: true, resolutionFailed: true };
    if (!recipientIds.length) return { notified: 0, failed: 0, skipped: false };
    try {
      return await notifySupportStaff({
        type: 'support_sla_breach',
        title: 'Support ticket SLA breached',
        body: reescalation
          ? `Ticket #${ticket.ticket_number} is still unclaimed after breaching its SLA.`
          : `Ticket #${ticket.ticket_number} breached its SLA and is unclaimed.`,
        data: {
          supportTicketId: String(ticket.id),
          ticketNumber: ticket.ticket_number,
          escalationRound: roundKey,
          reescalation: Boolean(reescalation),
        },
        action_url: '/admin/support',
        idempotencyKeyPrefix: `support-ticket-sla:${ticket.id}:${roundKey}`,
        recipientIds,
        dbClient: db,
      });
    } catch (err) {
      logger.warn('Support ticket SLA breach notification failed', {
        ticketId: ticket.id,
        error: err.message,
      });
      return { notified: 0, failed: recipientIds.length };
    }
  }

  const { rows } = await db.query(
    `SELECT id, ticket_number, priority, created_at, sla_due_at
       FROM support_tickets
      WHERE status = 'open'
        AND assigned_to IS NULL
        AND escalated_at IS NULL
        AND sla_due_at IS NOT NULL
        AND sla_due_at <= NOW()
      ORDER BY sla_due_at ASC
      LIMIT $1`,
    [BATCH_SIZE]
  );

  for (const ticket of rows) {
    const newPriority = bumpPriority(ticket.priority);
    const escalatedAt = new Date().toISOString();
    const { rowCount } = await db.query(
      `UPDATE support_tickets
          SET escalated_at = NOW(),
              priority = $2,
              metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
              updated_at = NOW()
        WHERE id = $1
          AND status = 'open'
          AND assigned_to IS NULL
          AND escalated_at IS NULL`,
      [
        ticket.id,
        newPriority,
        JSON.stringify({
          sla_escalated_at: escalatedAt,
          sla_breached_priority: ticket.priority,
          sla_escalation_count: 1,
        }),
      ]
    );
    if (rowCount > 0) {
      escalated.push({ ...ticket, new_priority: newPriority });
      logger.warn('Support ticket breached SLA and was escalated', {
        ticketId: ticket.id,
        ticketNumber: ticket.ticket_number,
        oldPriority: ticket.priority,
        newPriority,
      });
      await notifyBreach({ ...ticket, new_priority: newPriority }, escalatedAt, { reescalation: false });
    }
  }

  // Re-escalation cadence (item 21): a ticket that is still open, still
  // unclaimed, and still past due re-notifies every 4 hours. The round
  // key is the last stamped round, so a retry after a failed notify
  // reuses the same idempotency key instead of duplicating the alert.
  const { rows: stale } = await db.query(
    `SELECT id, ticket_number, priority, created_at, sla_due_at, escalated_at, metadata
       FROM support_tickets
      WHERE status = 'open'
        AND assigned_to IS NULL
        AND escalated_at IS NOT NULL
        AND sla_due_at IS NOT NULL
        AND sla_due_at <= NOW()
        AND COALESCE(
          (metadata->>'sla_last_reescalated_at')::timestamptz,
          (metadata->>'sla_escalated_at')::timestamptz,
          escalated_at
        ) <= NOW() - INTERVAL '${RE_ESCALATION_INTERVAL_HOURS} hours'
      ORDER BY sla_due_at ASC
      LIMIT $1`,
    [BATCH_SIZE]
  );

  for (const ticket of stale) {
    const roundKey = ticket.metadata?.sla_last_reescalated_at
      || ticket.metadata?.sla_escalated_at
      || (ticket.escalated_at instanceof Date
        ? ticket.escalated_at.toISOString()
        : String(ticket.escalated_at));
    const result = await notifyBreach(ticket, roundKey, { reescalation: true });
    // Money rule: never mark a round notified on a failed or unknown
    // delivery. The stamp is written only when every recipient was
    // notified (or there was nobody to notify), so a failed round stays
    // eligible for the next sweep.
    if (result.failed === 0 && !result.resolutionFailed) {
      const stampedAt = new Date().toISOString();
      const escalationCount = Number(ticket.metadata?.sla_escalation_count || 1) + 1;
      const { rowCount } = await db.query(
        `UPDATE support_tickets
            SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
                updated_at = NOW()
          WHERE id = $1
            AND status = 'open'
            AND assigned_to IS NULL
            AND escalated_at IS NOT NULL
            AND COALESCE(
              (metadata->>'sla_last_reescalated_at')::timestamptz,
              (metadata->>'sla_escalated_at')::timestamptz,
              escalated_at
            ) <= NOW() - INTERVAL '${RE_ESCALATION_INTERVAL_HOURS} hours'`,
        [
          ticket.id,
          JSON.stringify({
            sla_last_reescalated_at: stampedAt,
            sla_escalation_count: escalationCount,
          }),
        ]
      );
      if (rowCount > 0) {
        reescalated.push({ ...ticket, new_priority: ticket.priority });
        logger.warn('Support ticket SLA re-escalated while unclaimed', {
          ticketId: ticket.id,
          ticketNumber: ticket.ticket_number,
          escalationCount,
        });
      }
    }
  }

  // Notify admins once per sweep (socket broadcast; the persistent
  // per-breach notification above is the durable leg, this is the live
  // nudge for connected admins).
  const breached = [...escalated, ...reescalated];
  if (breached.length > 0) {
    try {
      const socketService = require('../services/socketService');
      socketService.broadcastToAdmins('support:ticket_sla_breach', {
        count: breached.length,
        tickets: breached.map((t) => ({
          ticket_id: t.id,
          ticket_number: t.ticket_number,
          old_priority: t.priority,
          new_priority: t.new_priority,
          sla_due_at: t.sla_due_at,
        })),
      });
    } catch (notifyErr) {
      logger.warn('Support SLA breach broadcast failed', { error: notifyErr.message });
    }
  }

  return { escalated: escalated.length, reescalated: reescalated.length };
}

async function runSupportTicketSlaJob(dbClient) {
  const db = dbClient || pool;
  const result = await sweepSupportTicketSla(db);
  if (result.escalated > 0 || result.reescalated > 0) {
    logger.info('Support ticket SLA sweep completed', { ...result, job: JOB_NAME });
  }
  return result;
}

function startSupportTicketSlaJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runSupportTicketSlaJob();
    } catch (err) {
      logger.error('Support ticket SLA cron error', { error: err.message });
    }
  });
  logger.info('Support ticket SLA job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startSupportTicketSlaJob,
  runSupportTicketSlaJob,
  sweepSupportTicketSla,
  bumpPriority,
  cronExpression: CRON_EXPRESSION,
};
