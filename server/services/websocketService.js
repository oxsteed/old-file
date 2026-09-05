/**
 * WebSocket Service
 * Manages real-time communication between customers and agents
 */

const logger = require('../utils/logger');
const pool = require('../db');

class WebSocketService {
  constructor() {
    this.io = null;
    this.customerConnections = new Map(); // userId -> socketId
    this.agentConnections = new Map(); // agentId -> socketId
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
        if (!['admin', 'super_admin'].includes(socket.userRole)) return;
        const { rows } = await pool.query(
          `SELECT id FROM support_agents
           WHERE user_id = $1 AND status = 'active'
           ORDER BY created_at ASC LIMIT 1`,
          [socket.userId]
        );
        const agentId = rows[0]?.id;
        if (!agentId) return;
        this.agentConnections.set(agentId, socket.id);
        socket.data.agentId = agentId;
        socket.data.type = 'agent';
        logger.info('Agent joined dashboard', { agentId, socketId: socket.id });

        // Notify all admins that agent is online
        namespace.to('admins').emit('agent:status-changed', {
          agentId,
          status: 'online',
          timestamp: new Date().toISOString(),
        });
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

      // Customer sends message
      socket.on('message:send', (data) => {
        const { ticketId, content, timestamp } = data;
        const userId = socket.data.userId;

        if (!userId || !socket.rooms.has(`ticket:${ticketId}`) || !String(content || '').trim() || String(content).length > 5000) return;

        // Broadcast to all in ticket room (customer + agent + admins)
        namespace.to(`ticket:${ticketId}`).emit('message:new', {
          ticketId,
          sender: {
            type: 'customer',
            id: userId,
            name: socket.data.name,
            email: socket.data.email,
          },
          content,
          timestamp,
        });

        logger.info('Message sent', { ticketId, userId });
      });

      // Agent sends message
      socket.on('agent:message-send', (data) => {
        const { ticketId, content, timestamp } = data;
        const agentId = socket.data.agentId;

        if (!agentId || !socket.rooms.has(`ticket:${ticketId}`) || !String(content || '').trim() || String(content).length > 5000) return;

        // Broadcast to all in ticket room
        namespace.to(`ticket:${ticketId}`).emit('message:new', {
          ticketId,
          sender: {
            type: 'agent',
            id: agentId,
            name: 'Support Agent',
          },
          content,
          timestamp,
        });

        // Mark message as read for customer
        namespace.to(`ticket:${ticketId}`).emit('message:agent-typing', {
          ticketId,
          agentId,
          isTyping: false,
        });

        logger.info('Agent message sent', { ticketId, agentId });
      });

      // Agent typing indicator
      socket.on('agent:typing', (data) => {
        const { ticketId, isTyping } = data;
        const agentId = socket.data.agentId;

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
        const agentSocketId = this.agentConnections.get(agentId);
        if (agentSocketId) {
          this.io.to(agentSocketId).emit('ticket:assigned-to-you', {
            ticketId,
            timestamp: new Date().toISOString(),
          });
        }

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
          this.agentConnections.delete(agentId);
          // Notify admins agent is offline
          namespace.to('admins').emit('agent:status-changed', {
            agentId,
            status: 'offline',
            timestamp: new Date().toISOString(),
          });
          logger.info('Agent disconnected', { agentId });
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
    const socketId = this.agentConnections.get(agentId);
    if (socketId) {
      this.io.to(socketId).emit(event, data);
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
