// server/jobs/supportTicketSlaJob.js
// Review P1-17-F05: support_tickets had no SLA or stale handling — after the
// creation notifications, an unclaimed ticket sat in 'open' forever with no
// monitor, escalation, or reassignment.
//
// This sweeper runs every 15 minutes and escalates open, unclaimed tickets
// whose SLA deadline (sla_due_at, set at creation from the ticket priority)
// has passed. Escalation bumps the priority one level, stamps escalated_at
// (so each ticket escalates once), and broadcasts to admins; assignment
// itself stays a human decision via the claim endpoint.
//
// SLA windows (also used by migration 828's backfill):
//   urgent 1h, high 4h, normal 24h, low 72h.

const pool = require('../db');
const logger = require('../utils/logger');

const JOB_NAME = 'support-ticket-sla';
const CRON_EXPRESSION = '*/15 * * * *'; // every 15 minutes
const BATCH_SIZE = 200;

const PRIORITY_ORDER = ['low', 'normal', 'high', 'urgent'];

function bumpPriority(priority) {
  const idx = PRIORITY_ORDER.indexOf(priority);
  if (idx === -1 || idx === PRIORITY_ORDER.length - 1) return PRIORITY_ORDER[PRIORITY_ORDER.length - 1];
  return PRIORITY_ORDER[idx + 1];
}

async function sweepSupportTicketSla(db) {
  const escalated = [];
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
          sla_escalated_at: new Date().toISOString(),
          sla_breached_priority: ticket.priority,
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
    }
  }

  // Notify admins once per sweep (socket broadcast; email already went out
  // at creation, so this is the escalation nudge, not a duplicate).
  if (escalated.length > 0) {
    try {
      const socketService = require('../services/socketService');
      socketService.broadcastToAdmins('support:ticket_sla_breach', {
        count: escalated.length,
        tickets: escalated.map((t) => ({
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

  return { escalated: escalated.length };
}

async function runSupportTicketSlaJob(dbClient) {
  const db = dbClient || pool;
  const result = await sweepSupportTicketSla(db);
  if (result.escalated > 0) {
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
