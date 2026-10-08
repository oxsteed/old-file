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
const { resolveSocketAccessToken } = require('../utils/accessCookie');

const REALTIME_INSTANCE = Symbol.for('oxsteed.realtime.instance');

/**
 * Attach the shared Socket.IO Redis adapter when REDIS_URL is set, so
 * broadcasts reach sockets on every Node process.
 *
 * Fail-closed design:
 *  - REDIS_URL set + attach succeeds: cross-process delivery enabled.
 *  - REDIS_URL set + attach fails: the service is marked unhealthy and all
 *    notify* calls return false instead of silently dropping messages.
 *  - REDIS_URL unset: single-process mode; a warning is logged.
 */
function attachSharedAdapter(io, { supportService, log }) {
  if (!process.env.REDIS_URL) {
    log.warn('Realtime: REDIS_URL not set, running single-process mode (no shared adapter)');
    return null;
  }
  let createAdapter;
  try {
    ({ createAdapter } = require('@socket.io/redis-adapter'));
  } catch (err) {
    log.error('Realtime: @socket.io/redis-adapter is not installed; refusing to run multi-process-blind');
    supportService.setRealtimeHealth?.(false);
    return null;
  }
  const Redis = require('ioredis');
  const clientOptions = {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      return Math.min(Math.max(times * 200, 200), 5000);
    },
  };
  const pubClient = new Redis(process.env.REDIS_URL, clientOptions);
  const subClient = new Redis(process.env.REDIS_URL, clientOptions);

  const markUnhealthy = (reason) => {
    log.error('Realtime: adapter unhealthy, delivery will be refused (fail-closed)', { reason });
    supportService.setRealtimeHealth?.(false);
  };
  const markHealthy = () => supportService.setRealtimeHealth?.(true);

  for (const client of [pubClient, subClient]) {
    client.on('error', (err) => markUnhealthy(err.message));
    client.on('reconnecting', () => markUnhealthy('reconnecting'));
    client.on('ready', () => markHealthy());
  }

  Promise.all([pubClient.ping(), subClient.ping()])
    .then(() => {
      io.adapter(createAdapter(pubClient, subClient));
      log.info('Realtime: shared Redis adapter attached (cross-process delivery enabled)');
      markHealthy();
    })
    .catch((err) => markUnhealthy(`attach failed: ${err.message}`));

  return { pubClient, subClient };
}

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
    chat.use(createChatAuthenticator({ pool, jwtSecret, allowedOrigins }));
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
      // Explicit auth payload first (impersonation / native), then the httpOnly
      // cookie. The cookie is parsed without throwing and only honoured from an
      // allowed Origin (CSWSH guard), see utils/accessCookie.
      let token = null;
      try {
        ({ token } = resolveSocketAccessToken(socket, { allowedOrigins }));
      } catch (_) {
        token = null;
      }
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

    // Shared adapter for cross-process delivery (E02). Async attach; the
    // service fails closed on notify* until the adapter reports healthy.
    const adapterClients = attachSharedAdapter(io, { supportService, log });

    // V2-P1-06: one process-wide presence heartbeat for every locally-online
    // entity ('agent', 'customer', 'user'). Idempotent; the support service
    // delegates here too, so there is exactly one timer per process.
    require('../services/realtimePresence').startPresenceHeartbeat();

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
        // Disconnect sockets BEFORE quitting Redis: disconnectSockets publishes
        // to other nodes via the Redis adapter, which fails with "Connection is
        // closed" if the pub/sub clients are already quit.
        try { io.disconnectSockets(true); } catch (err) { log.warn('Realtime: disconnectSockets failed', { error: err.message }); }
        await new Promise((resolve) => io.close(resolve));
        for (const client of [adapterClients?.pubClient, adapterClients?.subClient]) {
          try { await client?.quit(); } catch (err) { log.warn('Realtime: adapter client quit failed', { error: err.message }); }
        }
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
