/**
 * WebSocket Service
 * Manages real-time communication between customers and agents
 */

const logger = require('../utils/logger');

class WebSocketService {
  constructor() {
    this.io = null;
    this.customerConnections = new Map(); // userId -> socketId
    this.agentConnections = new Map(); // agentId -> socketId
    this.ticketSockets = new Map(); // ticketId -> [socketIds]
  }

  /**
   * Initialize Socket.io with server
   */
  initialize(server) {
    const socketIo = require('socket.io')(server, {
      cors: {
        origin: process.env.CLIENT_URL || 'http://localhost:5173',
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    this.io = socketIo;

    // ── Customer connections ──
    socketIo.on('connection', (socket) => {
      logger.info('Socket connected', { socketId: socket.id });

      // Customer joins widget
      socket.on('customer:join', (data) => {
        const { userId, visitorEmail, visitorName } = data;
        this.customerConnections.set(userId, socket.id);
        socket.data.userId = userId;
        socket.data.type = 'customer';
        socket.data.email = visitorEmail;
        socket.data.name = visitorName;
        logger.info('Customer joined widget', { userId, socketId: socket.id });
      });

      // Agent joins dashboard
      socket.on('agent:join', (data) => {
        const { agentId } = data;
        this.agentConnections.set(agentId, socket.id);
        socket.data.agentId = agentId;
        socket.data.type = 'agent';
        logger.info('Agent joined dashboard', { agentId, socketId: socket.id });

        // Notify all admins that agent is online
        socketIo.to('admins').emit('agent:status-changed', {
          agentId,
          status: 'online',
          timestamp: new Date().toISOString(),
        });
      });

      // Admin joins support dashboard
      socket.on('admin:join', (data) => {
        socket.join('admins');
        socket.data.type = 'admin';
        logger.info('Admin joined dashboard', { socketId: socket.id });
      });

      // Customer joins specific ticket chat
      socket.on('ticket:join', (data) => {
        const { ticketId, userId } = data;
        socket.join(`ticket:${ticketId}`);

        if (!this.ticketSockets.has(ticketId)) {
          this.ticketSockets.set(ticketId, []);
        }
        this.ticketSockets.get(ticketId).push(socket.id);

        logger.info('Joined ticket room', { ticketId, userId, socketId: socket.id });
      });

      // Customer sends message
      socket.on('message:send', (data) => {
        const { ticketId, content, timestamp } = data;
        const userId = socket.data.userId;

        // Broadcast to all in ticket room (customer + agent + admins)
        socketIo.to(`ticket:${ticketId}`).emit('message:new', {
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

        // Broadcast to all in ticket room
        socketIo.to(`ticket:${ticketId}`).emit('message:new', {
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
        socketIo.to(`ticket:${ticketId}`).emit('message:agent-typing', {
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

        socketIo.to(`ticket:${ticketId}`).emit('agent:typing-indicator', {
          ticketId,
          agentId,
          isTyping,
        });
      });

      // Assign ticket to agent
      socket.on('ticket:assign', (data) => {
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

        socketIo.to(`ticket:${ticketId}`).emit('ticket:closed', {
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
          socketIo.to('admins').emit('agent:status-changed', {
            agentId,
            status: 'offline',
            timestamp: new Date().toISOString(),
          });
          logger.info('Agent disconnected', { agentId });
        }
      });
    });

    logger.info('WebSocket service initialized');
    return socketIo;
  }

  /**
   * Send notification to customer
   */
  notifyCustomer(userId, event, data) {
    const socketId = this.customerConnections.get(userId);
    if (socketId) {
      this.io.to(socketId).emit(event, data);
    }
  }

  /**
   * Send notification to agent
   */
  notifyAgent(agentId, event, data) {
    const socketId = this.agentConnections.get(agentId);
    if (socketId) {
      this.io.to(socketId).emit(event, data);
    }
  }

  /**
   * Broadcast to ticket room
   */
  broadcastToTicket(ticketId, event, data) {
    this.io.to(`ticket:${ticketId}`).emit(event, data);
  }

  /**
   * Broadcast to all admins
   */
  broadcastToAdmins(event, data) {
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
