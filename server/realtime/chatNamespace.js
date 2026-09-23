'use strict';

const jwt = require('jsonwebtoken');

function createChatAuthenticator({ pool, jwtSecret }) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('Chat namespace requires a database pool');
  }
  if (!jwtSecret) {
    throw new Error('Chat namespace requires JWT_SECRET');
  }

  return async (socket, next) => {
    const guestToken = socket.handshake.auth?.guestToken;
    const guestSessionId = socket.handshake.auth?.guestSessionId;
    if (guestToken && guestSessionId) {
      try {
        const crypto = require('crypto');
        const tokenHash = crypto.createHash('sha256').update(String(guestToken)).digest('hex');
        const { rows } = await pool.query(
          `SELECT id, helper_id, business_id, guest_name, guest_email
             FROM guest_profile_chat_inbound
            WHERE id = $1
              AND guest_access_token_hash = $2
              AND guest_token_expires_at > NOW()
              AND guest_verified_at IS NOT NULL`,
          [guestSessionId, tokenHash]
        );
        if (!rows.length) return next(new Error('Invalid guest profile token'));
        socket.isGuest = true;
        socket.guestSessionId = rows[0].id;
        socket.guestHelperId = rows[0].helper_id;
        socket.guestBusinessId = rows[0].business_id;
        socket.guestName = rows[0].guest_name;
        socket.guestEmail = rows[0].guest_email;
        // Guests are not tracked as provider presence.
        return next();
      } catch (err) {
        return next(new Error('Guest profile authentication failed'));
      }
    }

    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const decoded = jwt.verify(token, jwtSecret);
      const { rows } = await pool.query(
        'SELECT is_active, role FROM users WHERE id = $1 AND deleted_at IS NULL',
        [decoded.id]
      );
      if (!rows[0]?.is_active) return next(new Error('Account suspended'));

      socket.userId = decoded.id;
      socket.userRole = rows[0].role;
      return next();
    } catch (err) {
      return next(new Error(err.name === 'JsonWebTokenError' ? 'Invalid token' : 'Auth check failed'));
    }
  };
}

function bindChatNamespace(namespace, { pool, socketService, logger }) {
  namespace.on('connection', (socket) => {
    if (socket.isGuest) {
      socket.join(`guest_session_${socket.guestSessionId}`);
      logger.debug('Guest socket connected to /chat', {
        guestSessionId: socket.guestSessionId,
        helperId: socket.guestHelperId,
        socketId: socket.id,
      });
      socket.on('disconnect', () => {
        logger.debug('Guest socket disconnected', { socketId: socket.id });
      });
      return;
    }

    const userId = socket.userId;
    socket.join(`user_${userId}`);

    if (['admin', 'super_admin'].includes(socket.userRole)) {
      socket.join('admins');
      socket.join('guest_chat_admin');
    }

    // Room membership is always decided by the server. Arbitrary client room
    // names are intentionally ignored to prevent cross-account subscriptions.
    socket.on('join', () => {});

    socket.on('conversation:join', async (conversationId) => {
      if (!conversationId) return;
      try {
        const start = Date.now();
        const { rows } = await pool.query(
          `SELECT id FROM conversations c
           WHERE c.id = $1 AND (
             c.customer_id = $2
             OR c.helper_id = $2
             OR (c.business_id IS NOT NULL AND EXISTS(
               SELECT 1 FROM business_members bm
               WHERE bm.business_id = c.business_id AND bm.member_id = $2 AND bm.status = 'active'
             ))
           )`,
          [conversationId, userId]
        );

        const elapsed = Date.now() - start;
        if (elapsed < 50) {
          await new Promise((resolve) => setTimeout(resolve, 50 - elapsed));
        }

        if (rows.length) {
          socket.join(`conv_${conversationId}`);
          logger.debug('Socket joined conversation room', { userId, conversationId });
        }
      } catch (err) {
        logger.error('socket conversation:join error', { message: err.message });
      }
    });

    socket.on('conversation:leave', (conversationId) => {
      if (conversationId) socket.leave(`conv_${conversationId}`);
    });

    socket.on('typing:start', (conversationId) => {
      if (conversationId && socket.rooms.has(`conv_${conversationId}`)) {
        socket.to(`conv_${conversationId}`).emit('user:typing', { conversationId, userId });
      }
    });

    socket.on('typing:stop', (conversationId) => {
      if (conversationId && socket.rooms.has(`conv_${conversationId}`)) {
        socket.to(`conv_${conversationId}`).emit('user:stopped_typing', { conversationId, userId });
      }
    });

    const emitBusinessTyping = async (event, payload) => {
      const businessId = payload?.businessId;
      const conversationId = payload?.conversationId;
      if (!businessId || !conversationId) return;
      if (!(await socketService.validateBusinessRoomAccess(businessId, userId))) return;
      socket.to(`business_${businessId}_inbox`).emit(event, {
        businessId,
        conversationId,
        userId,
      });
    };

    socket.on('business:typing:start', (payload) => {
      emitBusinessTyping('business:user:typing', payload).catch((err) => {
        logger.warn('business typing start failed', { userId, error: err?.message });
      });
    });

    socket.on('business:typing:stop', (payload) => {
      emitBusinessTyping('business:user:stopped_typing', payload).catch((err) => {
        logger.warn('business typing stop failed', { userId, error: err?.message });
      });
    });

    if (['helper', 'helper_pro', 'broker'].includes(socket.userRole)) {
      socket.join('guest_chat_waiting');
      logger.debug('Helper joined guest chat waiting room', { userId });
    }

    socketService.trackConnect(userId, socket.id);
    logger.debug('Socket connected', { userId, role: socket.userRole, socketId: socket.id });

    socketService.joinBusinessRooms(socket, userId).then((businessIds) => {
      if (businessIds?.length) {
        logger.debug('Socket joined business workspace rooms', {
          userId,
          socketId: socket.id,
          businessIds,
        });
      }
    }).catch((err) => {
      logger.warn('joinBusinessRooms failed', { userId, error: err?.message });
    });

    socket.on('disconnect', () => {
      socketService.trackDisconnect(userId, socket.id);
      logger.debug('Socket disconnected', { socketId: socket.id });
    });
  });
}

module.exports = { bindChatNamespace, createChatAuthenticator };
