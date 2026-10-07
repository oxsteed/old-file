'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const tokenRevocationService = require('../services/tokenRevocationService');
const { validateBeforeHandler } = require('../utils/socketAuthValidator');
const { logAdminAction } = require('../services/auditService');

// Logistics roles admitted to the operations workspace (mirrors
// server/middleware/requireInternalLogisticsWorkspace.js). Holders with an
// active operations internal access credential join the `ops_delivery` room.
const OPERATIONS_LOGISTICS_ROLES = new Set([
  'sourcing_operator',
  'logistics_coordinator',
  'warehouse_operator',
]);

/**
 * ITEM 7 (P1) — guest_chat_admin break-glass access resolution.
 *
 * The guest chat admin room carries live guest PII, so nobody auto-joins,
 * not even super_admin. Returns { allowed, grant }:
 *
 * - super_admin: allowed only while holding an active, unexpired, unrevoked
 *   grant in `investigation_access_grants` — the same purpose + named-approver
 *   model as investigationAccessService.checkInvestigationAccess, but without
 *   the per-target-user scope (a room has no single target). `grant` is the
 *   winning grant row (null when denied).
 * - admin: allowed only with a live global `manage_support` grant in
 *   `admin_permission_grants`, mirroring the REST model (T11-F01 in
 *   routes/support.js). `grant` is null (standing grant, not break-glass).
 * - any other role: denied.
 */
async function resolveGuestChatAdminAccess({ pool, userId, userRole }) {
  if (!pool || !userId) return { allowed: false, grant: null };

  if (userRole === 'super_admin') {
    const { rows } = await pool.query(
      `SELECT *
         FROM investigation_access_grants
        WHERE requester_admin_id = $1
          AND status = 'active'
          AND revoked_at IS NULL
          AND expires_at > NOW()
        ORDER BY expires_at DESC
        LIMIT 1`,
      [userId]
    );
    const grant = rows[0] || null;
    // Break-glass grants require a stated purpose and a named approver who
    // is not the grantee themselves: fail closed if the row lacks either.
    if (!grant || !grant.purpose || !grant.approver_admin_id || grant.approver_admin_id === userId) {
      return { allowed: false, grant: null };
    }
    return { allowed: true, grant };
  }

  if (userRole === 'admin') {
    // REST parity (T11-F01): global, unexpired, unrevoked manage_support grant.
    const { rows } = await pool.query(
      `SELECT 1 FROM admin_permission_grants
       WHERE grantee_id = $1 AND permissions ? 'manage_support'
         AND expires_at > NOW() AND revoked_at IS NULL AND region_id IS NULL
       LIMIT 1`,
      [userId]
    );
    return { allowed: rows.length > 0, grant: null };
  }

  return { allowed: false, grant: null };
}

/**
 * ITEM 7 (P1) — audit a super_admin's break-glass join of the guest chat
 * admin room. Writes `guest_chat_admin_break_glass_join` to `admin_audit_log`
 * with the grant id, investigation ref, purpose, approver, and expiry, and
 * runs with throwOnError:true so a failed audit write throws and the caller
 * fails closed (no room join).
 */
async function logGuestChatAdminBreakGlassJoin({ auditLog = logAdminAction, adminId, grant }) {
  await auditLog({
    adminId,
    action: 'guest_chat_admin_break_glass_join',
    targetType: 'investigation_access_grant',
    targetKey: String(grant.id),
    description:
      `Break-glass join of the guest_chat_admin room by admin ${adminId} ` +
      `under investigation grant #${grant.id} (ref: ${grant.investigation_ref || 'n/a'}, ` +
      `approved by ${grant.approver_admin_id}) for purpose: ${String(grant.purpose || '').slice(0, 220)}`,
    before: null,
    after: {
      grant_id: grant.id,
      investigation_ref: grant.investigation_ref,
      purpose: grant.purpose,
      approver_admin_id: grant.approver_admin_id,
      expires_at: grant.expires_at,
    },
    throwOnError: true,
  });
}

// Reads the httpOnly oxsteed_access cookie from the WebSocket handshake
// headers. Browsers send cookies on the handshake automatically, so this lets
// clients authenticate without keeping the JWT in localStorage (XSS vector).
function cookieAccessToken(socket) {
  const cookieHeader = socket.handshake?.headers?.cookie;
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)oxsteed_access=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function createChatAuthenticator({ pool, jwtSecret }) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('Chat namespace requires a database pool');
  }
  if (!jwtSecret) {
    throw new Error('Chat namespace requires JWT_SECRET');
  }

  return async (socket, next) => {    const guestToken = socket.handshake.auth?.guestToken;
    const guestSessionId = socket.handshake.auth?.guestSessionId;
    if (guestToken && guestSessionId) {
      try {
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

    // H8a: auth tokens are accepted ONLY via the Socket.IO `auth` payload.
    // The old `handshake.query?.token` fallback is removed: query strings end
    // up in proxy/access logs, and every in-repo client already connects with
    // `auth: { token }`.
    // Audit fix: fall back to the httpOnly oxsteed_access cookie (sent by the
    // browser on the WebSocket handshake) so clients no longer need the token
    // in localStorage (XSS vector). The auth payload still takes precedence
    // (impersonation sessions).
    const token = socket.handshake.auth?.token || cookieAccessToken(socket);
    if (!token) return next(new Error('Authentication required'));

    try {
      // M22: pin the algorithm. H9: reject MFA/refresh tokens outright.
      const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
      if (decoded.isMfaToken || decoded.type === 'refresh') {
        return next(new Error('Invalid chat token'));
      }
      // H9: consult the revocation store, mirroring /support's authenticate().
      // The iat is passed so user-level revocation (logout) only invalidates
      // tokens issued before the revocation moment.
      const tokenId = crypto.createHash('sha256').update(token).digest('hex');
      if (await tokenRevocationService.isRevoked(tokenId, decoded.id, decoded.iat)) {
        return next(new Error('Token has been revoked'));
      }
      const { rows } = await pool.query(
        'SELECT is_active, role, logistics_role FROM users WHERE id = $1 AND deleted_at IS NULL',
        [decoded.id]
      );
      if (!rows[0]?.is_active) return next(new Error('Account suspended'));

      socket.userId = decoded.id;
      socket.userRole = rows[0].role;
      socket.logisticsRole = rows[0].logistics_role;
      // Kept for validateBeforeHandler re-validation on sensitive events.
      socket.accessToken = token;
      socket.tokenIssuedAt = decoded.iat;
      return next();
    } catch (err) {
      return next(new Error(err.name === 'JsonWebTokenError' ? 'Invalid token' : 'Auth check failed'));
    }
  };
}

function bindChatNamespace(namespace, { pool, socketService, logger, auditLog = logAdminAction }) {
  namespace.on('connection', async (socket) => {
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

    // Exact operational delivery-tracking events (see
    // server/services/deliveryTrackingEventBus.js) are emitted to the
    // `ops_delivery` room. Customers never join it; they receive only the
    // customer-safe `tracking:<event>` projection in `delivery_<jobId>`.
    // Membership mirrors the operations workspace: admins plus approved
    // operations-workspace staff (logistics_role with an active operations
    // internal access credential).
    if (['admin', 'super_admin'].includes(socket.userRole)) {
      socket.join('admins');
      socket.join('ops_delivery');
      // ITEM 7 (P1): the guest chat admin room carries live guest PII, so it
      // is break-glass only — nobody auto-joins, not even super_admin.
      // super_admin: needs an active, unexpired, unrevoked investigation
      // grant (join is audited before the room join). admin: needs a live
      // global manage_support grant (REST parity, T11-F01 in
      // routes/support.js). Any failure — grant check or audit write —
      // fails closed: no join.
      try {
        const { allowed, grant } = await resolveGuestChatAdminAccess({
          pool,
          userId: socket.userId,
          userRole: socket.userRole,
        });
        if (allowed) {
          if (grant) {
            await logGuestChatAdminBreakGlassJoin({ auditLog, adminId: socket.userId, grant });
          }
          socket.join('guest_chat_admin');
        }
      } catch (err) {
        logger.error('guest_chat_admin room membership check failed', {
          userId: socket.userId,
          error: err.message,
        });
      }
    } else if (OPERATIONS_LOGISTICS_ROLES.has(socket.logisticsRole)) {
      try {
        const { rows } = await pool.query(
          `SELECT 1 FROM logistics_internal_access_credentials
            WHERE user_id = $1 AND is_active = TRUE AND operations_enabled = TRUE
            LIMIT 1`,
          [socket.userId]
        );
        if (rows.length > 0) socket.join('ops_delivery');
      } catch (err) {
        logger.error('ops_delivery room membership check failed', {
          userId: socket.userId,
          error: err.message,
        });
      }
    }

    // ── Delivery tracking rooms ──────────────────────────────────────────
    // CLIENT CONTRACT: `delivery:join` subscribes this socket to the
    // customer-safe tracking stream for one delivery job. Membership is
    // decided server-side (customer, assigned driver, or operations only).
    // Tracking events are point-in-time broadcasts, not state: after any
    // reconnect the client MUST re-emit `delivery:join` and reload
    // authoritative state via
    //   GET /api/delivery/jobs/:id/tracking/customer-state
    // (or the ops exact-state endpoint), never reconstructing position
    // history from cached socket events.
    // H9: room joins gate access to data streams, so re-validate the socket's
    // token/account before honoring them (mirrors /support's sensitive
    // handlers). validateSocketUser refreshes the role from the DB, so
    // privilege changes take effect without a reconnect.
    socket.on('delivery:join', validateBeforeHandler(async (deliveryJobId) => {
      const userId = socket.userId;
      if (!deliveryJobId || !userId) return;
      try {
        const { rows } = await pool.query(
          `SELECT 1 FROM delivery_jobs j
            WHERE j.id = $1 AND (
              j.customer_user_id = $2
              OR j.helper_user_id = $2
              OR j.internal_driver_user_id = $2
              OR $3 IN ('admin', 'super_admin')
            )`,
          [deliveryJobId, userId, socket.userRole]
        );
        if (rows.length) {
          socket.join(`delivery_${deliveryJobId}`);
          logger.debug('Socket joined delivery tracking room', { userId, deliveryJobId });
        }
      } catch (err) {
        logger.error('socket delivery:join error', { message: err.message });
      }
    }));

    socket.on('delivery:leave', (deliveryJobId) => {
      if (deliveryJobId) socket.leave(`delivery_${deliveryJobId}`);
    });

    // Room membership is always decided by the server. Arbitrary client room
    // names are intentionally ignored to prevent cross-account subscriptions.
    socket.on('join', () => {});

    socket.on('conversation:join', validateBeforeHandler(async (conversationId) => {
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
    }));

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

    // Audit fix: helpers no longer auto-join the guest chat waiting room.
    // The broadcast there included PII. Helpers join explicitly when they
    // opt into guest chat.
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

module.exports = {
  bindChatNamespace,
  createChatAuthenticator,
  resolveGuestChatAdminAccess,
  logGuestChatAdminBreakGlassJoin,
};
