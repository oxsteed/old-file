/**
 * WebSocket Service
 * Manages real-time communication between customers and agents
 */

const logger = require('../utils/logger');
const { TERMINAL_CONVERSATION_STATUS_SQL } = require('./supportConversationTerminal');
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const { validateBeforeHandler } = require('../utils/socketAuthValidator');
const { sendNotification } = require('./notificationService');

const CLIENT_MESSAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─────────────────────────────────────────────────────────────────
// ticket:join authorization query
// ─────────────────────────────────────────────────────────────────
// NOTE: `current_user` is a reserved keyword in Postgres and cannot be used
// as an unquoted table alias, so the users self-join below uses `cu`.
function buildTicketJoinQuery(ticketId, userId, userRole, guestConversationId) {
  return {
    text: `SELECT 1
           FROM support_conversations sc
           LEFT JOIN support_agents sa ON sa.id = sc.agent_id
           LEFT JOIN users cu
             ON cu.id = $2
            AND cu.is_active = TRUE
            AND cu.deleted_at IS NULL
           WHERE sc.id = $1
             AND (
               ($2 IS NULL AND $4 = sc.id)
               OR (
                 cu.id IS NOT NULL
                 AND ($2 = sc.customer_id
                   OR sa.user_id = $2
                   OR cu.role IN ('admin', 'super_admin'))
               )
             )`,
    params: [ticketId, userId, userRole, guestConversationId],
  };
}

class WebSocketService {
  constructor() {
    this.io = null;
    this.customerConnections = new Map(); // userId -> socketId
    this.agentConnections = new Map(); // agentId -> Set<socketId>
    this.ticketSockets = new Map(); // ticketId -> [socketIds]
    this.ticketViewers = new Map(); // ticketId -> Map<socketId, true>
  }

  broadcastTicketViewerPresence(ticketId) {
    if (!this.io) return;
    const viewers = this.ticketViewers.get(ticketId);
    this.io.to(`staff-ticket:${ticketId}`).emit('ticket:viewer-presence', {
      ticketId,
      viewerCount: viewers?.size || 0,
    });
    this.io.to(`staff-ticket:${ticketId}`).emit('ticket:viewer-details', {
      ticketId,
      viewers: Array.from(viewers?.values() || []),
    });
  }

  async registerTicketViewer(socket, ticketId) {
    if (!socket.userId || socket.guestConversationId || socket.userRole === 'customer') return;
    const room = `staff-ticket:${ticketId}`;
    socket.join(room);
    let viewer = { id: socket.userId, name: 'Support staff', role: socket.userRole || 'support' };

    // Reserve the socket before the async profile lookup. Without this,
    // concurrent joins can both read the old map and overwrite each other.
    const viewers = this.ticketViewers.get(ticketId) || new Map();
    viewers.set(socket.id, viewer);
    this.ticketViewers.set(ticketId, viewers);
    this.broadcastTicketViewerPresence(ticketId);

    try {
      const { rows } = await pool.query(
        `SELECT id, first_name, last_name, email, role
         FROM users
         WHERE id = $1
         LIMIT 1`,
        [socket.userId]
      );
      const user = rows[0];
      if (user) {
        viewer = {
          id: user.id,
          name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'Support staff',
          role: user.role || socket.userRole || 'support',
        };
      }
    } catch (error) {
      logger.warn('Could not resolve support viewer name', { ticketId, userId: socket.userId, error: error.message });
    }
    if (!socket.connected || !socket.rooms.has(room)) return;
    const currentViewers = this.ticketViewers.get(ticketId);
    if (!currentViewers?.has(socket.id)) return;
    currentViewers.set(socket.id, viewer);
    this.broadcastTicketViewerPresence(ticketId);
  }

  unregisterTicketViewer(socket, ticketId) {
    const viewers = this.ticketViewers.get(ticketId);
    if (!viewers?.delete(socket.id)) return;
    if (viewers.size) this.ticketViewers.set(ticketId, viewers);
    else this.ticketViewers.delete(ticketId);
    socket.leave(`staff-ticket:${ticketId}`);
    this.broadcastTicketViewerPresence(ticketId);
  }

  /**
   * Attach support events to the shared /support namespace.
   */
  initialize(namespace) {
    if (!namespace || typeof namespace.on !== 'function' || typeof namespace.to !== 'function') {
      throw new TypeError('WebSocketService.initialize requires a Socket.IO namespace');
    }
    if (this.io === namespace) return namespace;
    if (this.io) throw new Error('WebSocketService has already been initialized');

    this.io = namespace;
    const service = this;

    // ── Customer connections ──
    namespace.on('connection', (socket) => {
      logger.info('Socket connected', { socketId: socket.id });

      // Customer joins widget
      socket.on('customer:join', (data) => {
        const { visitorEmail, visitorName } = data || {};
        const userId = socket.userId;
        if (userId) this.customerConnections.set(userId, socket.id);
        socket.data.userId = userId;
        socket.data.type = 'customer';
        socket.data.email = visitorEmail;
        socket.data.name = visitorName;
        logger.info('Customer joined widget', { userId, socketId: socket.id });
      });

      // Agent joins dashboard
      socket.on('agent:join', async () => {
        if (!socket.userId) return;
        const { rows } = await pool.query(
          `SELECT id FROM support_agents
           WHERE user_id = $1 AND status = 'active'
           ORDER BY created_at ASC LIMIT 1`,
          [socket.userId]
        );
        const agentId = rows[0]?.id;
        if (!agentId) return;
        const agentSocketIds = this.agentConnections.get(agentId) || new Set();
        const wasOffline = agentSocketIds.size === 0;
        agentSocketIds.add(socket.id);
        this.agentConnections.set(agentId, agentSocketIds);
        socket.data.agentId = agentId;
        socket.data.type = 'agent';
        logger.info('Agent joined dashboard', { agentId, socketId: socket.id });

        if (wasOffline) {
          namespace.to('admins').emit('agent:status-changed', {
            agentId,
            status: 'online',
            timestamp: new Date().toISOString(),
          });
        }
      });

      // Admin joins support dashboard
      socket.on('admin:join', (data) => {
        if (!['admin', 'super_admin'].includes(socket.userRole)) return;
        socket.join('admins');
        socket.data.type = 'admin';
        logger.info('Admin joined dashboard', { socketId: socket.id });
      });

      // Customer joins specific ticket chat
      socket.on('ticket:join', async (data, acknowledgement) => {
        const { ticketId } = data || {};
        if (!ticketId || (!socket.userId && socket.guestConversationId !== ticketId)) return;
        const { text, params } = buildTicketJoinQuery(
          ticketId, socket.userId, socket.userRole, socket.guestConversationId
        );
        const { rows } = await pool.query(text, params);
        if (!rows.length) return;
        socket.join(`ticket:${ticketId}`);

        if (!this.ticketSockets.has(ticketId)) {
          this.ticketSockets.set(ticketId, []);
        }
        const ticketSocketIds = this.ticketSockets.get(ticketId);
        if (!ticketSocketIds.includes(socket.id)) ticketSocketIds.push(socket.id);

        // Staff-only collision awareness. The customer remains in the normal
        // ticket room, while agent/admin viewers use a separate room so no
        // internal presence signal can reach the customer client.
        await this.registerTicketViewer(socket, ticketId);

        logger.info('Joined ticket room', { ticketId, userId: socket.userId, socketId: socket.id });
        if (typeof acknowledgement === 'function') {
          acknowledgement({
            joined: true,
            ticketId,
            viewerCount: this.ticketViewers.get(ticketId)?.size || 0,
          });
        }
      });

      // Customer typing presence is ephemeral and only broadcasts inside an
      // already-authorized ticket room. It is intentionally never persisted.
      socket.on('customer:typing', (data) => {
        const { ticketId, isTyping } = data || {};
        if (
          !ticketId
          || !socket.rooms.has(`ticket:${ticketId}`)
          || (socket.data.type !== 'customer' && !socket.guestConversationId)
        ) return;
        namespace.to(`ticket:${ticketId}`).emit('customer:typing-indicator', {
          ticketId,
          isTyping: Boolean(isTyping),
        });
      });

      // Mark agent messages as read for a customer or verified guest. Room
      // membership is the authorization boundary for this realtime action.
      socket.on('ticket:read', validateBeforeHandler(async function(data) {
        const { ticketId } = data || {};
        if (!ticketId || !socket.rooms.has(`ticket:${ticketId}`)) return;
        if (socket.guestConversationId !== ticketId && socket.userRole !== 'customer') return;
        try {
          await pool.query(
            `UPDATE support_conversation_messages
             SET read_by_recipient = TRUE, read_at = COALESCE(read_at, NOW()), status = 'read'
             WHERE conversation_id = $1 AND is_agent = TRUE AND COALESCE(read_by_recipient, FALSE) = FALSE`,
            [ticketId]
          );
          namespace.to(`ticket:${ticketId}`).emit('ticket:read', {
            ticketId,
            readerType: socket.guestConversationId ? 'guest' : 'customer',
            readAt: new Date().toISOString(),
          });
        } catch (err) {
          logger.warn('ticket:read failed', { ticketId, error: err.message });
        }
      }));

      // Persist legacy Socket.IO sends so messages cannot appear live and then
      // disappear on reload or from support exports. REST clients use the same
      // schema and continue to broadcast their own events as before.
      const persistAndBroadcastMessage = async ({ ticketId, content, senderId, senderType, isAgent, clientMessageId }) => {
        const normalizedContent = String(content || '').trim();
        const normalizedClientMessageId = String(clientMessageId || '').trim() || null;
        if (
          !ticketId
          || !socket.rooms.has(`ticket:${ticketId}`)
          || !normalizedContent
          || normalizedContent.length > 5000
          || (normalizedClientMessageId && !CLIENT_MESSAGE_ID_PATTERN.test(normalizedClientMessageId))
        ) return;

        try {
          const conversation = await pool.query(
            `SELECT id, status
             FROM support_conversations
             WHERE id = $1 AND status NOT IN (${TERMINAL_CONVERSATION_STATUS_SQL})`,
            [ticketId]
          );
          if (!conversation.rows.length) return;

          const result = await withTransaction(pool, async (client) => {
            const inserted = await client.query(
              `INSERT INTO support_conversation_messages
               (conversation_id, sender_id, message_type, content, is_agent, client_message_id)
               VALUES ($1, $2, 'text', $3, $4, $5)
               ON CONFLICT (conversation_id, client_message_id) WHERE client_message_id IS NOT NULL DO NOTHING
               RETURNING id, created_at`,
              [ticketId, senderId, normalizedContent, isAgent, normalizedClientMessageId]
            );
            if (!inserted.rows.length) {
              const existing = await client.query(
                `SELECT id, created_at, content
                 FROM support_conversation_messages
                 WHERE conversation_id = $1 AND client_message_id = $2`,
                [ticketId, normalizedClientMessageId]
              );
              if (!existing.rows.length) return null;
              return { message: existing.rows[0], duplicate: true };
            }
            const countColumn = isAgent ? 'agent_message_count' : 'customer_message_count';
            const updated = await client.query(
              `UPDATE support_conversations
               SET message_count = message_count + 1,
                   ${countColumn} = ${countColumn} + 1,
                   updated_at = NOW(),
                   first_response_at = CASE
                     WHEN $2::boolean AND first_response_at IS NULL THEN NOW()
                     ELSE first_response_at
                   END,
                   status = CASE
                     WHEN $2::boolean AND status IN ('open', 'waiting_for_agent') THEN 'in_progress'
                     ELSE status
                   END
               WHERE id = $1 AND status NOT IN (${TERMINAL_CONVERSATION_STATUS_SQL})`,
              [ticketId, isAgent]
            );
            if (!updated.rowCount) return null;
            return { message: inserted.rows[0], duplicate: false };
          }, 'persist_support_socket_message');

          if (!result) return;

          if (result.duplicate) return;

          try {
            const { rows: recipients } = await pool.query(
              `SELECT sc.customer_id, sa.user_id AS agent_user_id
                 FROM support_conversations sc
                 LEFT JOIN support_agents sa ON sa.id = sc.agent_id
                WHERE sc.id = $1`,
              [ticketId],
            );
            const recipientId = isAgent
              ? recipients[0]?.customer_id
              : recipients[0]?.agent_user_id;
            if (recipientId && String(recipientId) !== String(senderId)) {
              void sendNotification({
                userId: recipientId,
                type: 'new_message',
                title: isAgent ? 'New support message' : 'Support customer replied',
                body: normalizedContent,
                data: {
                  supportConversationId: String(ticketId),
                  messageId: String(result.message.id),
                },
                action_url: '/support/escalation',
                idempotencyKey: `support-socket-message:${ticketId}:${result.message.id}:${recipientId}`,
              }).catch((error) => {
                logger.warn('Support socket notification failed', {
                  ticketId,
                  messageId: result.message.id,
                  recipientId,
                  error: error.message,
                });
              });
            }
          } catch (notificationError) {
            logger.warn('Support socket recipient lookup failed', {
              ticketId,
              messageId: result.message.id,
              error: notificationError.message,
            });
          }

          namespace.to(`ticket:${ticketId}`).emit('message:new', {
            ticketId,
            messageId: result.message.id,
            sender: {
              type: senderType,
              id: senderId,
              name: isAgent ? 'Support Agent' : socket.data.name,
              ...(isAgent ? {} : { email: socket.data.email }),
            },
            content: normalizedContent,
            timestamp: result.message.created_at,
          });
          logger.info('Socket message persisted', { ticketId, senderId, isAgent });
        } catch (err) {
          socket.emit('message:send:error', { ticketId, error: 'Message could not be sent' });
          logger.warn('Socket message persistence failed', { ticketId, senderId, error: err.message });
        }
      };

      socket.on('message:send', validateBeforeHandler(async function(data) {
        if (socket.userRole !== 'customer') return;
        await persistAndBroadcastMessage({
          ticketId: data?.ticketId,
          content: data?.content,
          senderId: socket.userId,
          senderType: 'customer',
          isAgent: false,
          clientMessageId: data?.clientMessageId || data?.client_message_id,
        });
      }));

      socket.on('agent:message-send', validateBeforeHandler(async function(data) {
        const senderId = socket.data.agentId || socket.userId;
        const isAgent = Boolean(socket.data.agentId || ['admin', 'super_admin'].includes(socket.userRole));
        if (!isAgent) return;
        await persistAndBroadcastMessage({
          ticketId: data?.ticketId,
          content: data?.content,
          senderId,
          senderType: 'agent',
          isAgent: true,
          clientMessageId: data?.clientMessageId || data?.client_message_id,
        });
      }));

      // Agent typing indicator
      socket.on('agent:typing', (data) => {
        const { ticketId, isTyping } = data;
        const agentId = socket.data.agentId
          || (['admin', 'super_admin'].includes(socket.userRole) ? socket.userId : null);

        if (!agentId || !ticketId || !socket.rooms.has(`ticket:${ticketId}`)) return;
        namespace.to(`ticket:${ticketId}`).emit('agent:typing-indicator', {
          ticketId,
          agentId,
          isTyping,
        });
      });

      // Assign ticket to agent. REST remains the source of truth for the
      // assignment write; this legacy event only delivers notifications after
      // validating the current ticket and agent scope.
      socket.on('ticket:assign', validateBeforeHandler(async function(data) {
        if (!['admin', 'super_admin'].includes(socket.userRole)) return;
        const { ticketId, agentId } = data || {};
        if (!ticketId || !agentId) return;

        const conversation = await pool.query(
          `SELECT id, business_id
           FROM support_conversations
           WHERE id = $1 AND status NOT IN (${TERMINAL_CONVERSATION_STATUS_SQL})`,
          [ticketId]
        );
        const ticket = conversation.rows[0];
        if (!ticket) return;

        const agent = await pool.query(
          `SELECT sa.id
           FROM support_agents sa
           JOIN support_employers se ON se.id = sa.employer_id
           WHERE sa.id = $1 AND sa.status = 'active'
             AND (se.kind = 'platform' OR (se.kind = 'business' AND se.business_id = $2))`,
          [agentId, ticket.business_id]
        );
        if (!agent.rows.length) return;

        const timestamp = new Date().toISOString();
        service.notifyAgent(agentId, 'ticket:assigned-to-you', {
          ticketId,
          timestamp,
        });
        namespace.to(`ticket:${ticketId}`).emit('agent:joined', {
          ticketId,
          agentId,
          message: 'A support agent has joined the conversation.',
          timestamp,
        });
        logger.info('Ticket assignment notification sent via socket', { ticketId, agentId });
      }));

      // Close ticket. This legacy event remains supported for older dashboards,
      // but it must follow the same authorization and persistence boundary as
      // the REST lifecycle endpoint before notifying any connected clients.
      socket.on('ticket:close', validateBeforeHandler(async function(data) {
        const { ticketId } = data || {};
        if (!ticketId || !socket.userId || !socket.rooms.has(`ticket:${ticketId}`)) return;
        if (!['admin', 'super_admin'].includes(socket.userRole)) {
          const assigned = await pool.query(
            `SELECT sc.id
             FROM support_conversations sc
             JOIN support_agents sa ON sa.id = sc.agent_id
             WHERE sc.id = $1 AND sa.user_id = $2 AND sa.status = 'active'`,
            [ticketId, socket.userId]
          );
          if (!assigned.rows.length) return;
        }

        try {
          const closed = await withTransaction(pool, async (client) => {
            const updated = await client.query(
              `UPDATE support_conversations
               SET status = 'closed',
                   closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP),
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $1 AND status NOT IN (${TERMINAL_CONVERSATION_STATUS_SQL})
               RETURNING id, status, closed_at`,
              [ticketId]
            );
            if (!updated.rows.length) return null;

            await client.query(
              `UPDATE support_queue
               SET status = 'removed', removed_at = COALESCE(removed_at, CURRENT_TIMESTAMP),
                   reason_removed = 'closed'
               WHERE conversation_id = $1 AND status <> 'removed'`,
              [ticketId]
            );
            await client.query(
              `UPDATE conversation_assignments
               SET status = 'completed', released_at = COALESCE(released_at, CURRENT_TIMESTAMP),
                   duration_seconds = COALESCE(
                     duration_seconds,
                     EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - claimed_at))::integer
                   )
               WHERE conversation_id = $1 AND status = 'active'`,
              [ticketId]
            );
            return updated.rows[0];
          }, 'close_support_socket_ticket');

          if (!closed) return;

          const payload = {
            ticketId,
            status: closed.status,
            message: 'This ticket has been closed.',
            timestamp: closed.closed_at || new Date().toISOString(),
          };
          namespace.to(`ticket:${ticketId}`).emit('ticket:status-changed', payload);
          namespace.to(`ticket:${ticketId}`).emit('ticket:closed', payload);
          this.unregisterTicketViewer(socket, ticketId);
          socket.leave(`ticket:${ticketId}`);
          logger.info('Ticket closed', { ticketId, closedBy: socket.userId });
        } catch (err) {
          socket.emit('ticket:close:error', { ticketId, error: 'Ticket could not be closed' });
          logger.warn('Ticket close failed', { ticketId, error: err.message });
        }
      }));

      // Disconnect
      socket.on('disconnect', () => {
        const userId = socket.data.userId;
        const agentId = socket.data.agentId;

        if (userId) {
          if (this.customerConnections.get(userId) === socket.id) {
            this.customerConnections.delete(userId);
          }
          logger.info('Customer disconnected', { userId });
        }

        for (const [ticketId, socketIds] of this.ticketSockets.entries()) {
          const remaining = socketIds.filter((socketId) => socketId !== socket.id);
          if (remaining.length) this.ticketSockets.set(ticketId, remaining);
          else this.ticketSockets.delete(ticketId);
        }

        for (const ticketId of this.ticketViewers.keys()) {
          this.unregisterTicketViewer(socket, ticketId);
        }

        if (agentId) {
          const agentSocketIds = this.agentConnections.get(agentId);
          agentSocketIds?.delete(socket.id);

          if (!agentSocketIds?.size) {
            this.agentConnections.delete(agentId);
            namespace.to('admins').emit('agent:status-changed', {
              agentId,
              status: 'offline',
              timestamp: new Date().toISOString(),
            });
          }

          logger.info('Agent disconnected', {
            agentId,
            socketId: socket.id,
            remainingConnections: agentSocketIds?.size || 0,
          });
        }
      });
    });

    logger.info('WebSocket service initialized');
    return namespace;
  }

  shutdown() {
    this.customerConnections.clear();
    this.agentConnections.clear();
    this.ticketSockets.clear();
    this.ticketViewers.clear();
    this.io = null;
  }

  /**
   * Send notification to customer
   */
  notifyCustomer(userId, event, data) {
    if (!this.io) return;
    const socketId = this.customerConnections.get(userId);
    if (socketId) {
      this.io.to(socketId).emit(event, data);
    }
  }

  /**
   * Send notification to agent
   */
  notifyAgent(agentId, event, data) {
    if (!this.io) return;
    const socketIds = this.agentConnections.get(agentId);
    if (socketIds) {
      for (const socketId of socketIds) {
        this.io.to(socketId).emit(event, data);
      }
    }
  }

  /**
   * Broadcast to ticket room
   */
  broadcastToTicket(ticketId, event, data) {
    if (!this.io) return;
    this.io.to(`ticket:${ticketId}`).emit(event, data);
  }

  /**
   * Broadcast to all admins
   */
  broadcastToAdmins(event, data) {
    if (!this.io) return;
    this.io.to('admins').emit(event, data);
  }

  /**
   * Check if agent is online
   */
  isAgentOnline(agentId) {
    return this.agentConnections.has(agentId);
  }

  /**
   * Get active agent count
   */
  getActiveAgentCount() {
    return this.agentConnections.size;
  }

  isInitialized() {
    return Boolean(this.io);
  }

  /**
   * Get all connected users (customers + agents)
   */
  getConnectionStatus() {
    return {
      customers: this.customerConnections.size,
      agents: this.agentConnections.size,
      tickets: this.ticketSockets.size,
    };
  }
}

module.exports = new WebSocketService();

// Exposed for unit tests of the ticket:join authorization SQL.
WebSocketService.prototype.buildTicketJoinQuery = buildTicketJoinQuery;
