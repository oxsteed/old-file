'use strict';

const pool = require('../db');
const WebSocketService = require('./websocketService');
const { sendNotification } = require('./notificationService');
const logger = require('../utils/logger');
const { TERMINAL_CONVERSATION_STATUS_SQL } = require('./supportConversationTerminal');

const ADVISORY_LOCK_KEY = 379;
const ADVISORY_LOCK_SCOPE = 3;
const BATCH_SIZE = 100;

/**
 * Mark newly overdue support conversations once per interval. The advisory
 * lock keeps multiple app/worker replicas from emitting duplicate alerts.
 *
 * Item 48: the breach flags used to be marked in the same CTE that
 * selected the batch, before any notification ran, so a mid-loop throw
 * permanently lost the remaining breaches. The flags are now marked per
 * row only after that row's notify succeeds; a failed row stays eligible
 * for the next interval and never blocks later rows.
 */
async function runSupportSlaMonitor() {
  const client = await pool.connect();
  let locked = false;
  try {
    locked = Boolean((await client.query(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      [ADVISORY_LOCK_KEY, ADVISORY_LOCK_SCOPE]
    )).rows[0]?.locked);
    if (!locked) return { locked: false, updated: 0 };

    const { rows } = await client.query(
      `SELECT
          sc.id,
          sc.business_id,
          sc.agent_id,
          sc.subject,
          sc.priority,
          (
            COALESCE(sc.sla_first_response_breached, FALSE) = FALSE
            AND sc.sla_first_response_target IS NOT NULL
            AND (
              (sc.first_response_at IS NOT NULL AND sc.first_response_at > sc.sla_first_response_target)
              OR (
                sc.first_response_at IS NULL
                AND sc.status NOT IN (${TERMINAL_CONVERSATION_STATUS_SQL})
                AND sc.sla_first_response_target < NOW()
              )
            )
          ) AS first_response_breach,
          (
            COALESCE(sc.sla_resolution_breached, FALSE) = FALSE
            AND sc.sla_resolution_target IS NOT NULL
            AND (
              (sc.resolved_at IS NOT NULL AND sc.resolved_at > sc.sla_resolution_target)
              OR (
                sc.resolved_at IS NULL
                AND sc.status NOT IN (${TERMINAL_CONVERSATION_STATUS_SQL})
                AND sc.sla_resolution_target < NOW()
              )
            )
          ) AS resolution_breach,
          sa.user_id AS agent_user_id
        FROM support_conversations sc
        LEFT JOIN support_agents sa ON sa.id = sc.agent_id
        WHERE sc.status NOT IN (${TERMINAL_CONVERSATION_STATUS_SQL})
          AND (
            (
              COALESCE(sc.sla_first_response_breached, FALSE) = FALSE
              AND sc.sla_first_response_target IS NOT NULL
              AND (
                (sc.first_response_at IS NOT NULL AND sc.first_response_at > sc.sla_first_response_target)
                OR (sc.first_response_at IS NULL AND sc.status NOT IN (${TERMINAL_CONVERSATION_STATUS_SQL}) AND sc.sla_first_response_target < NOW())
              )
            )
            OR (
              COALESCE(sc.sla_resolution_breached, FALSE) = FALSE
              AND sc.sla_resolution_target IS NOT NULL
              AND (
                (sc.resolved_at IS NOT NULL AND sc.resolved_at > sc.sla_resolution_target)
                OR (sc.resolved_at IS NULL AND sc.status NOT IN (${TERMINAL_CONVERSATION_STATUS_SQL}) AND sc.sla_resolution_target < NOW())
              )
            )
          )
        ORDER BY sc.updated_at ASC
        LIMIT ${BATCH_SIZE}`,
      []
    );

    let marked = 0;
    for (const row of rows) {
      try {
        const firstResponseBreach = Boolean(row.first_response_breach);
        const resolutionBreach = Boolean(row.resolution_breach);
        const payload = {
          conversationId: row.id,
          businessId: row.business_id,
          agentId: row.agent_id,
          priority: row.priority,
          firstResponseBreach,
          resolutionBreach,
        };
        WebSocketService.broadcastToAdmins('support:sla-breached', payload);

        if (row.agent_user_id) {
          const result = await sendNotification({
            userId: row.agent_user_id,
            type: 'support_sla_breach',
            title: 'Support SLA breached',
            body: `${firstResponseBreach ? 'First response' : 'Resolution'} SLA breached for ${row.subject || 'a support conversation'}.`,
            data: { conversationId: row.id, priority: row.priority },
            action_url: '/admin/support/chat',
            // The breach kind is in the key: a first-response breach now
            // and a resolution breach later are distinct deliveries.
            idempotencyKey: `support-sla-breach:${row.id}:fr${firstResponseBreach ? 1 : 0}:res${resolutionBreach ? 1 : 0}`,
          });
          // A notification that reports failure is not a delivery; the
          // flags stay unset so the next interval retries this row.
          if (result && result.success === false) {
            throw new Error('Support SLA breach notification was not delivered');
          }
        }

        await client.query(
          `UPDATE support_conversations
              SET sla_first_response_breached = CASE
                    WHEN $2 THEN TRUE
                    ELSE sla_first_response_breached
                  END,
                  sla_resolution_breached = CASE
                    WHEN $3 THEN TRUE
                    ELSE sla_resolution_breached
                  END,
                  updated_at = NOW()
            WHERE id = $1`,
          [row.id, firstResponseBreach, resolutionBreach]
        );
        marked += 1;
      } catch (rowError) {
        logger.warn('Support SLA breach notification failed for a conversation', {
          conversationId: row.id,
          error: rowError.message,
        });
      }
    }

    return { locked: true, updated: marked };
  } catch (error) {
    logger.error('Support SLA monitor failed', { error: error.message });
    throw error;
  } finally {
    try {
      if (locked) await client.query(
        'SELECT pg_advisory_unlock($1, $2)',
        [ADVISORY_LOCK_KEY, ADVISORY_LOCK_SCOPE]
      );
    } finally {
      client.release();
    }
  }
}

module.exports = { runSupportSlaMonitor };
