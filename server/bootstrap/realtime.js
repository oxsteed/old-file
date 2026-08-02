'use strict';

const { Server } = require('socket.io');
const logger = require('../utils/logger');
const defaultSocketService = require('../services/socketService');
const defaultSupportService = require('../services/websocketService');
const { bindChatNamespace, createChatAuthenticator } = require('../realtime/chatNamespace');
const { bindRestaurantDisplayNamespace } = require('../realtime/restaurantDisplayNamespace');

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
