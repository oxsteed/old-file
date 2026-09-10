'use strict';

const { Server } = require('socket.io');
const logger = require('../utils/logger');
const defaultSocketService = require('../services/socketService');
const defaultSupportService = require('../services/websocketService');
const { bindChatNamespace, createChatAuthenticator } = require('../realtime/chatNamespace');
const { bindRestaurantDisplayNamespace } = require('../realtime/restaurantDisplayNamespace');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const tokenRevocationService = require('../services/tokenRevocationService');

const REALTIME_INSTANCE = Symbol.for('oxsteed.realtime.instance');

function createRealtimeServer({
  httpServer,
  allowedOrigins,
  pool,
  jwtSecret,
  socketService = defaultSocketService,
  supportService = defaultSupportService,
  log = logger,
}) {
  if (!httpServer) throw new TypeError('Realtime bootstrap requires an HTTP server');
  if (httpServer[REALTIME_INSTANCE]) {
    throw new Error('Realtime server has already been initialized for this HTTP server');
  }

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
    pingInterval: 20000,
    pingTimeout: 15000,
    // Support guests need polling fallback; authenticated chat clients continue
    // to request WebSocket-only transport on their side.
    transports: ['websocket', 'polling'],
    perMessageDeflate: { threshold: 512 },
  });

  httpServer[REALTIME_INSTANCE] = io;

  try {
    const chat = io.of('/chat');
    chat.use(createChatAuthenticator({ pool, jwtSecret }));
    bindChatNamespace(chat, { pool, socketService, logger: log });
    socketService.init(chat);

    const support = io.of('/support');
    support.use(async (socket, next) => {
      const guestToken = socket.handshake.auth?.guestToken;
      const guestConversationId = socket.handshake.auth?.conversationId;
      if (guestToken && guestConversationId) {
        try {
          const tokenHash = crypto.createHash('sha256').update(String(guestToken)).digest('hex');
          const { rows } = await pool.query(
            `SELECT id FROM support_conversations
             WHERE id = $1 AND guest_access_token_hash = $2
               AND guest_token_expires_at > NOW()`,
            [guestConversationId, tokenHash]
          );
          if (!rows.length) return next(new Error('Invalid guest support token'));
          socket.guestConversationId = guestConversationId;
          socket.guestToken = guestToken;
          return next();
        } catch (err) {
          return next(new Error('Guest support authentication failed'));
        }
      }
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Authentication required'));
      try {
        const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
        if (decoded.isMfaToken || decoded.type === 'refresh') {
          return next(new Error('Invalid support token'));
        }
        const tokenId = crypto.createHash('sha256').update(token).digest('hex');
        if (await tokenRevocationService.isRevoked(tokenId, decoded.id, decoded.iat)) {
          return next(new Error('Token has been revoked'));
        }
        const { rows } = await pool.query(
          'SELECT id, role, is_active FROM users WHERE id = $1 AND deleted_at IS NULL',
          [decoded.id]
        );
        if (!rows[0]?.is_active) return next(new Error('Account suspended'));
        socket.userId = decoded.id;
        socket.userRole = rows[0].role;
        socket.accessToken = token;
        socket.tokenIssuedAt = decoded.iat;
        return next();
      } catch (err) {
        return next(new Error(err.name === 'JsonWebTokenError' ? 'Invalid token' : 'Auth check failed'));
      }
    });
    supportService.initialize(support);

    const restaurantDisplay = io.of('/restaurant-display');
    bindRestaurantDisplayNamespace(restaurantDisplay);
    socketService.initRestaurantDisplay(restaurantDisplay);

    log.info('Realtime server initialized', {
      namespaces: ['/chat', '/support', '/restaurant-display'],
    });

    let closed = false;
    return {
      io,
      namespaces: { chat, support, restaurantDisplay },
      async close() {
        if (closed) return;
        closed = true;
        supportService.shutdown?.();
        socketService.shutdown?.();
        io.disconnectSockets(true);
        await new Promise((resolve) => io.close(resolve));
      },
    };
  } catch (err) {
    supportService.shutdown?.();
    socketService.shutdown?.();
    delete httpServer[REALTIME_INSTANCE];
    io.close();
    throw err;
  }
}

module.exports = { createRealtimeServer, REALTIME_INSTANCE };
