'use strict';

const pool = require('../db');
const email = require('../utils/email');
const sockets = require('./websocketService');
const logger = require('../utils/logger');

const WAIT_SECONDS = 300;
const ALERT_SECONDS = 120;

function waitingState(conversation, now = Date.now()) {
  const expires = new Date(conversation.live_wait_expires_at).getTime();
  const remaining = conversation.live_wait_expires_at ? Math.max(0, Math.ceil((expires - now) / 1000)) : 0;
  return {
    state: ['resolved', 'closed'].includes(conversation.status) ? 'closed'
      : conversation.agent_id ? 'connected'
        : remaining > 0 && !conversation.live_wait_ended_at ? 'waiting' : 'message',
    remainingSeconds: remaining,
    expiresAt: conversation.live_wait_expires_at,
    serverTime: new Date(now).toISOString(),
  };
}

async function processWaiting() {
  const client = await pool.connect();
  let locked = false;
  try {
    // A database lock coordinates API and worker replicas without process-local timers.
    locked = (await client.query('SELECT pg_try_advisory_lock(379, 1) AS locked')).rows[0].locked;
    if (!locked) return;
    const { rows } = await client.query(`SELECT id FROM support_conversations
      WHERE live_wait_started_at IS NOT NULL AND agent_id IS NULL
        AND status = 'waiting_for_agent'
        AND (live_wait_ended_at IS NULL OR founder_alert_sent_at IS NULL)
      ORDER BY live_wait_started_at LIMIT 25`);
    for (const { id } of rows) {
      await client.query('BEGIN');
      try {
        const { rows: conversations } = await client.query(
          `SELECT *, NOW() AS server_now FROM support_conversations WHERE id = $1 FOR UPDATE`, [id]);
        const c = conversations[0];
        if (!c || c.agent_id || c.status !== 'waiting_for_agent') {
          await client.query('COMMIT');
          continue;
        }
        const now = new Date(c.server_now).getTime();
        if (!c.live_wait_ended_at && now < new Date(c.live_wait_expires_at).getTime()) {
          const { rows: agents } = await client.query(`SELECT a.id, a.max_concurrent_chats,
              CONCAT_WS(' ', u.first_name, u.last_name) AS name
            FROM support_agents a JOIN support_employers e ON e.id = a.employer_id
            JOIN users u ON u.id = a.user_id
            WHERE e.kind = 'platform' AND a.status = 'active' AND a.is_available = TRUE
              AND u.is_active = TRUE AND u.is_available_for_support = TRUE
              AND u.support_available_at > NOW() - INTERVAL '2 minutes'
            ORDER BY (SELECT COUNT(*) FROM support_conversations sc WHERE sc.agent_id = a.id
              AND sc.status NOT IN ('closed','resolved')), a.created_at
            FOR UPDATE OF a SKIP LOCKED`);
          for (const agent of agents) {
            if (!sockets.isInitialized() || !sockets.isAgentOnline(agent.id)) continue;
            const workload = await client.query(`SELECT COUNT(*)::int AS total FROM support_conversations
              WHERE agent_id = $1 AND status NOT IN ('closed','resolved')`, [agent.id]);
            if (workload.rows[0].total >= Number(agent.max_concurrent_chats || 3)) continue;
            if (!sockets.isAgentOnline(agent.id)) continue;
            await client.query(`UPDATE support_conversations SET agent_id = $2, status = 'in_progress',
              assigned_at = NOW(), updated_at = NOW() WHERE id = $1`, [id, agent.id]);
            await client.query(`INSERT INTO conversation_assignments (conversation_id, agent_id, business_id, assignment_type)
              VALUES ($1, $2, $3, 'auto')`, [id, agent.id, c.business_id]);
            await client.query(`UPDATE support_queue SET status = 'assigned', routed_to_agent_id = $2,
              claimed_at = NOW() WHERE conversation_id = $1 AND status = 'waiting'`, [id, agent.id]);
            c.agent_id = agent.id;
            c.agent_name = agent.name;
            break;
          }
        }
        if (!c.agent_id && now - new Date(c.live_wait_started_at).getTime() >= ALERT_SECONDS * 1000 && !c.founder_alert_sent_at) {
          const result = await email.sendEmail({
            to: 'emilejeanphilippe@oxsteed.com',
            subject: 'OxSteed: a customer is waiting for live support',
            text: `A customer has been waiting at least two minutes without an assigned agent.\n\nConversation: ${id}\nOpen https://oxsteed.com/admin/support/chat and go online in Support to help.\nThe customer is offered message and call/text options after five minutes.`,
            idempotencyKey: `support-founder-${id}`,
          });
          if (!result.success) throw new Error(result.error || 'Founder alert delivery failed');
          await client.query('UPDATE support_conversations SET founder_alert_sent_at = NOW() WHERE id = $1', [id]);
        }
        if (!c.agent_id && now >= new Date(c.live_wait_expires_at).getTime()) {
          await client.query('UPDATE support_conversations SET live_wait_ended_at = COALESCE(live_wait_ended_at, NOW()) WHERE id = $1', [id]);
          await client.query(`UPDATE support_queue SET status = 'removed', removed_at = NOW(),
            reason_removed = 'live_wait_expired' WHERE conversation_id = $1 AND status = 'waiting'`, [id]);
        }
        await client.query('COMMIT');
        if (c.agent_id) {
          const payload = { ticketId: id, agentId: c.agent_id, agentName: c.agent_name };
          sockets.notifyAgent(c.agent_id, 'ticket:new-assignment', payload);
          sockets.broadcastToAdmins('ticket:assigned', payload);
          sockets.broadcastToTicket(id, 'ticket:assigned', payload);
        }
      } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Support waiting processing failed', { conversationId: id, error: error.message });
      }
    }
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock(379, 1)');
    } finally { client.release(); }
  }
}

module.exports = { processWaiting, waitingState, WAIT_SECONDS, ALERT_SECONDS };
