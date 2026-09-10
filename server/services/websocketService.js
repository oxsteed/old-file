/**
 * WebSocket Service
 * Manages real-time communication between customers and agents
 */

const logger = require('../utils/logger');
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');

class WebSocketService {
  constructor() {
    this.io = null;
    this.customerConnections = new Map(); // userId -> socketId
    this.agentConnections = new Map(); // agentId -> Set<socketId>
    this.ticketSockets = new Map(); // ticketId -> [socketIds]
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
      socket.on('ticket:join', async (data) => {
        const { ticketId } = data || {};
        if (!ticketId || (!socket.userId && socket.guestConversationId !== ticketId)) return;
        const { rows } = await pool.query(
          `SELECT 1
           FROM support_conversations sc
           LEFT JOIN support_agents sa ON sa.id = sc.agent_id
           WHERE sc.id = $1
             AND ($2 = sc.customer_id
               OR sa.user_id = $2
               OR $3 IN ('admin', 'super_admin')
               OR $4 = sc.id)`,
          [ticketId, socket.userId, socket.userRole, socket.guestConversationId]
        );
        if (!rows.length) return;
        socket.join(`ticket:${ticketId}`);

        if (!this.ticketSockets.has(ticketId)) {
          this.ticketSockets.set(ticketId, []);
        }
        this.ticketSockets.get(ticketId).push(socket.id);

        logger.info('Joined ticket room', { ticketId, userId: socket.userId, socketId: socket.id });
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
      socket.on('ticket:read', async (data) => {
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
      });

      // Persist legacy Socket.IO sends so messages cannot appear live and then
      // disappear on reload or from support exports. REST clients use the same
      // schema and continue to broadcast their own events as before.
      const persistAndBroadcastMessage = async ({ ticketId, content, senderId, senderType, isAgent }) => {
        const normalizedContent = String(content || '').trim();
        if (
          !ticketId
          || !socket.rooms.has(`ticket:${ticketId}`)
          || !normalizedContent
          || normalizedContent.length > 5000
        ) return;

        try {
          const conversation = await pool.query(
            `SELECT id, status
             FROM support_conversations
             WHERE id = $1 AND status NOT IN ('resolved', 'closed')`,
            [ticketId]
          );
          if (!conversation.rows.length) return;

          const result = await withTransaction(pool, async (client) => {
            const inserted = await client.query(
              `INSERT INTO support_conversation_messages
               (conversation_id, sender_id, message_type, content, is_agent)
               VALUES ($1, $2, 'text', $3, $4)
               RETURNING id, created_at`,
              [ticketId, senderId, normalizedContent, isAgent]
            );
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
               WHERE id = $1 AND status NOT IN ('resolved', 'closed')`,
              [ticketId, isAgent]
            );
            if (!updated.rowCount) return null;
            return inserted.rows[0];
          }, 'persist_support_socket_message');

          if (!result) return;

          namespace.to(`ticket:${ticketId}`).emit('message:new', {
            ticketId,
            messageId: result.id,
            sender: {
              type: senderType,
              id: senderId,
              name: isAgent ? 'Support Agent' : socket.data.name,
              ...(isAgent ? {} : { email: socket.data.email }),
            },
            content: normalizedContent,
            timestamp: result.created_at,
          });
          logger.info('Socket message persisted', { ticketId, senderId, isAgent });
        } catch (err) {
          socket.emit('message:send:error', { ticketId, error: 'Message could not be sent' });
          logger.warn('Socket message persistence failed', { ticketId, senderId, error: err.message });
        }
      };

      socket.on('message:send', (data) => {
        if (socket.userRole !== 'customer') return;
        void persistAndBroadcastMessage({
          ticketId: data?.ticketId,
          content: data?.content,
          senderId: socket.userId,
          senderType: 'customer',
          isAgent: false,
        });
      });

      socket.on('agent:message-send', (data) => {
        const senderId = socket.data.agentId || socket.userId;
        const isAgent = Boolean(socket.data.agentId || ['admin', 'super_admin'].includes(socket.userRole));
        if (!isAgent) return;
        void persistAndBroadcastMessage({
          ticketId: data?.ticketId,
          content: data?.content,
          senderId,
          senderType: 'agent',
          isAgent: true,
        });
      });

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

      // Assign ticket to agent
      socket.on('ticket:assign', (data) => {
        if (!['admin', 'super_admin'].includes(socket.userRole)) return;
        const { ticketId, agentId } = data;

        // Notify agent of assignment
        this.notifyAgent(agentId, 'ticket:assigned-to-you', {
          ticketId,
          timestamp: new Date().toISOString(),
        });

        // Notify customer that agent joined
        this.io.to(`ticket:${ticketId}`).emit('agent:joined', {
          ticketId,
          agentId,
          message: 'A support agent has joined the conversation.',
          timestamp: new Date().toISOString(),
        });

        logger.info('Ticket assigned via socket', { ticketId, agentId });
      });

      // Close ticket
      socket.on('ticket:close', (data) => {
        const { ticketId } = data;

        if (!socket.rooms.has(`ticket:${ticketId}`)) return;

        namespace.to(`ticket:${ticketId}`).emit('ticket:closed', {
          ticketId,
          message: 'This ticket has been closed.',
          timestamp: new Date().toISOString(),
        });

        socket.leave(`ticket:${ticketId}`);
        logger.info('Ticket closed', { ticketId });
      });

      // Disconnect
      socket.on('disconnect', () => {
        const userId = socket.data.userId;
        const agentId = socket.data.agentId;

        if (userId) {
          this.customerConnections.delete(userId);
          logger.info('Customer disconnected', { userId });
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
