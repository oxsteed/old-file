// server/services/socketService.js
// Socket helper + online-presence tracking. Multi-tab presence map.
//
// V2-P1-06: onlineMap is per-process socket-handle bookkeeping ONLY
// (userId -> socketIds for this process's connections). Online/offline
// ROUTING decisions must not consult it alone: trackConnect/trackDisconnect
// announce to the shared presence contract (services/realtimePresence,
// Redis hashes with TTL heartbeat), and isOnline() consults the local map
// OR the cross-process snapshot. With more than one Node process, a user
// connected to process B is still reported online by process A.

let io = null;
let mediaIo = null;
const pool = require('../db');
const logger = require('../utils/logger');
const presence = require('./realtimePresence');

const onlineMap = new Map();

function init(socketIo) {
  if (!socketIo || typeof socketIo.to !== 'function') {
    throw new TypeError('socketService.init requires a Socket.IO namespace');
  }
  if (io === socketIo) return socketIo;
  if (io) throw new Error('socketService has already been initialized');
  io = socketIo;
  return socketIo;
}

function trackConnect(userId, socketId) {
  const uid = String(userId);
  let sockets = onlineMap.get(uid);
  const firstSocket = !sockets || sockets.size === 0;
  if (!sockets) {
    sockets = new Set();
    onlineMap.set(uid, sockets);
  }
  sockets.add(socketId);
  if (firstSocket) {
    // Announce once per process; the contract dedups across processes and
    // self-heals via TTL heartbeat. Fire-and-forget: presence is advisory,
    // connection tracking itself never fails.
    presence.markOnline('user', uid).catch((err) => {
      logger.warn('socketService: presence markOnline failed', { userId: uid, error: err.message });
    });
  }
}

function trackDisconnect(userId, socketId) {
  const uid = String(userId);
  const sockets = onlineMap.get(uid);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    onlineMap.delete(uid);
    presence.markOffline('user', uid).catch((err) => {
      logger.warn('socketService: presence markOffline failed', { userId: uid, error: err.message });
    });
  }
}

/**
 * Cross-process online check: local sockets OR the shared presence
 * snapshot. Used by helper-availability and admin-assignment routing.
 */
function isOnline(userId) {
  const uid = String(userId);
  return onlineMap.has(uid) || presence.isOnline('user', uid);
}

function broadcastToUser(userId, event, data) {
  if (!io) return;
  io.to(`user_${userId}`).emit(event, data);
}

function broadcastToConversation(conversationId, event, data) {
  if (!io) return;
  io.to(`conv_${conversationId}`).emit(event, data);
}

function broadcastToAdmins(event, data) {
  if (!io) return;
  io.to('admins').emit(event, data);
}

// Generic room broadcast following the same conventions as the helpers
// above. Used by the delivery tracking event bus for participant rooms
// (`delivery_<jobId>`) whose membership is decided server-side on join.
function broadcastToRoom(room, event, data) {
  if (!io || !room) return;
  io.to(room).emit(event, data);
}

function initMedia(namespace) {
  if (!namespace || typeof namespace.to !== 'function') {
    throw new TypeError('initMedia requires a Socket.IO namespace');
  }
  if (mediaIo === namespace) return namespace;
  if (mediaIo) throw new Error('Media namespace has already been initialized');
  mediaIo = namespace;
  return namespace;
}

function broadcastToMediaPost(postId, event, data) {
  if (!mediaIo || !postId) return;
  mediaIo.to(`media_post_${postId}`).emit(event, data);
}

// Exact operational delivery-tracking events. Only admin/super_admin
// sockets join the `ops_delivery` room (on connect, next to `admins`);
// customer-safe projections go to `delivery_<jobId>` instead.
function broadcastToOpsDelivery(event, data) {
  if (!io) return;
  io.to('ops_delivery').emit(event, data);
}

function disconnectUserSockets(userId) {
  if (!io) return;
  try { io.in(`user_${userId}`).disconnectSockets(true); }
  catch (err) { logger.warn('disconnectUserSockets failed', { userId: String(userId), error: err.message }); }
}

async function getSocketCount(roomName) {
  if (!io) return 0;
  try {
    const room = io.sockets.adapter.rooms.get(roomName);
    return room ? room.size : 0;
  } catch (err) { logger.warn('getSocketCount failed', { room: roomName, error: err.message }); return 0; }
}

async function validateConversationAccess(conversationId, userId) {
  if (!conversationId || !userId) return false;
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM conversations c
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
    return rows.length > 0;
  } catch (err) { logger.error('validateConversationAccess failed', { conversationId, userId, error: err.message }); return false; }
}

function broadcastNewGuestSession(sessionData) {
  if (!io) return;
  io.to('guest_chat_waiting').emit('guest_session:new', sessionData);
}

function broadcastGuestSessionUpdate(sessionId, sessionData) {
  if (!io) return;
  io.to('guest_chat_admin').emit('guest_session:updated', { sessionId, ...sessionData });
}

function broadcastGuestChatMessage(sessionId, messageData) {
  if (!io) return;
  io.to(`guest_session_${sessionId}`).emit('guest_chat:message', messageData);
  // Parity event for verified profile guests listening on /chat (ChatPanel).
  io.to(`guest_session_${sessionId}`).emit('profile_chat:new_message', {
    guestSessionId: sessionId,
    guestInquiry: true,
    message: {
      id: messageData?.messageId,
      content: messageData?.message,
      sender_type: messageData?.senderType,
      sender_name: messageData?.senderName,
      created_at: messageData?.createdAt,
    },
    senderName: messageData?.senderName,
  });
  io.to('guest_chat_admin').emit('guest_chat:message', { sessionId, ...messageData });
}

// Phase 1b: per-business workspace rooms.

async function listUserBusinessIds(userId) {
  if (!userId) return [];
  try {
    const { rows } = await pool.query(
      `SELECT b.id FROM businesses b WHERE b.user_id = $1
       UNION
       SELECT bm.business_id AS id FROM business_members bm
        WHERE bm.member_id = $1 AND bm.status = 'active'`,
      [userId]
    );
    return rows.map(r => r.id);
  } catch (err) { logger.warn('listUserBusinessIds failed', { userId: String(userId), error: err.message }); return []; }
}

async function joinBusinessRooms(socket, userId) {
  if (!socket || !userId) return [];
  const ids = await listUserBusinessIds(userId);
  for (const bid of ids) {
    try {
      socket.join(`business_${bid}_inbox`);
      socket.join(`business_${bid}_calendar`);
    } catch (err) { logger.warn('socket.join business room failed', { businessId: bid, error: err.message }); }
  }
  return ids;
}

function broadcastToBusinessInbox(businessId, event, data) {
  if (!io || !businessId) return;
  io.to(`business_${businessId}_inbox`).emit(event, data);
}

// Public, read-only restaurant-display namespace.
//
// In-store TV/kiosk/customer screens are NOT authenticated, but the main
// Socket.IO namespace requires a JWT. So those screens connect to a separate
// `/restaurant-display` namespace (its own middleware, no auth) and only ever
// receive PII-free "something changed" pings (queue number + status — data
// already shown publicly on the wall board). They then refetch over REST.
let displayNs = null;
function initRestaurantDisplay(ns) {
  if (!ns || typeof ns.to !== 'function') {
    throw new TypeError('initRestaurantDisplay requires a Socket.IO namespace');
  }
  if (displayNs === ns) return ns;
  if (displayNs) throw new Error('restaurant display namespace has already been initialized');
  displayNs = ns;
  return ns;
}

function shutdown() {
  onlineMap.clear();
  io = null;
  mediaIo = null;
  displayNs = null;
}

function broadcastToRestaurantDisplay(restaurantId, event, data) {
  if (!displayNs || !restaurantId) return;
  try { displayNs.to(`rdisplay_${restaurantId}`).emit(event, data); }
  catch (err) { logger.warn('broadcastToRestaurantDisplay failed', { restaurantId, error: err.message }); }
}

function broadcastToBusinessCalendar(businessId, event, data) {
  if (!io || !businessId) return;
  io.to(`business_${businessId}_calendar`).emit(event, data);
}

async function validateBusinessRoomAccess(businessId, userId) {
  if (!businessId || !userId) return false;
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM businesses b
       WHERE b.id = $1 AND (
         b.user_id = $2
         OR EXISTS (
           SELECT 1 FROM business_members bm
           WHERE bm.business_id = b.id AND bm.member_id = $2 AND bm.status = 'active'
         )
       )`,
      [businessId, userId]
    );
    return rows.length > 0;
  } catch (err) { logger.warn('validateBusinessRoomAccess failed', { businessId, userId: String(userId), error: err.message }); return false; }
}

module.exports = {
  init, trackConnect, trackDisconnect, isOnline,
  broadcastToUser, broadcastToConversation, broadcastToAdmins,
  broadcastToRoom, broadcastToOpsDelivery,
  initMedia, broadcastToMediaPost,
  broadcastNewGuestSession, broadcastGuestSessionUpdate, broadcastGuestChatMessage,
  disconnectUserSockets, getSocketCount, validateConversationAccess,
  joinBusinessRooms, listUserBusinessIds,
  broadcastToBusinessInbox, broadcastToBusinessCalendar, validateBusinessRoomAccess,
  initRestaurantDisplay, broadcastToRestaurantDisplay, shutdown,
};
