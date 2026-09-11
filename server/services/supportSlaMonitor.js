'use strict';

const pool = require('../db');
const WebSocketService = require('./websocketService');
const { sendNotification } = require('./notificationService');
const logger = require('../utils/logger');

const ADVISORY_LOCK_KEY = 379;
const ADVISORY_LOCK_SCOPE = 3;
const BATCH_SIZE = 100;

/**
 * Mark newly overdue support conversations once per interval. The advisory
 * lock keeps multiple app/worker replicas from emitting duplicate alerts.
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
      `WITH candidates AS (
        SELECT
          sc.id,
          (
            COALESCE(sc.sla_first_response_breached, FALSE) = FALSE
            AND sc.sla_first_response_target IS NOT NULL
            AND (
              (sc.first_response_at IS NOT NULL AND sc.first_response_at > sc.sla_first_response_target)
              OR (
                sc.first_response_at IS NULL
                AND sc.status NOT IN ('resolved', 'closed')
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
                AND sc.status NOT IN ('resolved', 'closed')
                AND sc.sla_resolution_target < NOW()
              )
            )
          ) AS resolution_breach
        FROM support_conversations sc
        WHERE sc.status NOT IN ('closed')
          AND (
            (
              COALESCE(sc.sla_first_response_breached, FALSE) = FALSE
              AND sc.sla_first_response_target IS NOT NULL
              AND (
                (sc.first_response_at IS NOT NULL AND sc.first_response_at > sc.sla_first_response_target)
                OR (sc.first_response_at IS NULL AND sc.status NOT IN ('resolved', 'closed') AND sc.sla_first_response_target < NOW())
              )
            )
            OR (
              COALESCE(sc.sla_resolution_breached, FALSE) = FALSE
              AND sc.sla_resolution_target IS NOT NULL
              AND (
                (sc.resolved_at IS NOT NULL AND sc.resolved_at > sc.sla_resolution_target)
                OR (sc.resolved_at IS NULL AND sc.status NOT IN ('resolved', 'closed') AND sc.sla_resolution_target < NOW())
              )
            )
          )
        ORDER BY sc.updated_at ASC
        LIMIT ${BATCH_SIZE}
      ), updated AS (
        UPDATE support_conversations sc
        SET sla_first_response_breached = CASE
              WHEN candidates.first_response_breach THEN TRUE
              ELSE COALESCE(sc.sla_first_response_breached, FALSE)
            END,
            sla_resolution_breached = CASE
              WHEN candidates.resolution_breach THEN TRUE
              ELSE COALESCE(sc.sla_resolution_breached, FALSE)
            END,
            updated_at = NOW()
        FROM candidates
        WHERE sc.id = candidates.id
          AND (candidates.first_response_breach OR candidates.resolution_breach)
        RETURNING sc.id, sc.business_id, sc.agent_id, sc.subject, sc.priority,
                  candidates.first_response_breach, candidates.resolution_breach
      )
      SELECT updated.*, sa.user_id AS agent_user_id
      FROM updated
      LEFT JOIN support_agents sa ON sa.id = updated.agent_id`,
      []
    );

    for (const row of rows) {
      const payload = {
        conversationId: row.id,
        businessId: row.business_id,
        agentId: row.agent_id,
        priority: row.priority,
        firstResponseBreach: Boolean(row.first_response_breach),
        resolutionBreach: Boolean(row.resolution_breach),
      };
      WebSocketService.broadcastToAdmins('support:sla-breached', payload);

      if (row.agent_user_id) {
        await sendNotification({
          userId: row.agent_user_id,
          type: 'support_sla_breach',
          title: 'Support SLA breached',
          body: `${row.first_response_breach ? 'First response' : 'Resolution'} SLA breached for ${row.subject || 'a support conversation'}.`,
          data: { conversationId: row.id, priority: row.priority },
          action_url: '/admin/support/chat',
        });
      }
    }

    return { locked: true, updated: rows.length };
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
