// server/services/socketService.js
// Socket helper + online-presence tracking.
//
// Presence uses Map<userId, Set<socketId>> so multiple tabs/devices are
// handled correctly - user goes "offline" only when ALL their sockets
// disconnect.

let io = null;
const pool = require('../db');
const logger = require('../utils/logger');

/** userId (string) → Set of active socketId strings */
const onlineMap = new Map();

function init(socketIo) {
  io = socketIo;
}

function trackConnect(userId, socketId) {
  const uid = String(userId);
  if (!onlineMap.has(uid)) onlineMap.set(uid, new Set());
  onlineMap.get(uid).add(socketId);
}

function trackDisconnect(userId, socketId) {
  const uid = String(userId);
  const sockets = onlineMap.get(uid);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) onlineMap.delete(uid);
}

/** Returns true if any socket for this userId is connected. */
function isOnline(userId) {
  return onlineMap.has(String(userId));
}

function broadcastToUser(userId, event, data) {
  if (!io) return;
  io.to(`user_${userId}`).emit(event, data);
}

/** Emit to all sockets in a conversation room (both participants when both are online). */
function broadcastToConversation(conversationId, event, data) {
  if (!io) return;
  io.to(`conv_${conversationId}`).emit(event, data);
}

/** Emit to all connected admins (any admin/super_admin socket in the 'admins' room). */
function broadcastToAdmins(event, data) {
  if (!io) return;
  io.to('admins').emit(event, data);
}

/** Disconnect every socket in user_{userId} (super-admin account purge, force logout). */
function disconnectUserSockets(userId) {
  if (!io) return;
  try {
    io.in(`user_${userId}`).disconnectSockets(true);
  } catch (err) {
    require('../utils/logger').warn('disconnectUserSockets failed', {
      userId: String(userId),
      error: err.message,
    });
  }
}

/** Get count of connected sockets in a room (e.g., 'admins'). */
async function getSocketCount(roomName) {
  if (!io) return 0;
  try {
    const room = io.sockets.adapter.rooms.get(roomName);
    return room ? room.size : 0;
  } catch (err) {
    require('../utils/logger').warn('getSocketCount failed', {
      room: roomName,
      error: err.message,
    });
    return 0;
  }
}

/**
 * FIX #8: Socket.IO Room Access Validation
 * Verify a user has permission to join a conversation room before allowing access.
 * Prevents IDOR/eavesdropping attacks where users guess conversation IDs.
 *
 * @param {string} conversationId - The conversation to validate access for
 * @param {string} userId - The user requesting access
 * @returns {Promise<boolean>} True if user can access the conversation
 */
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
  } catch (err) {
    logger.error('validateConversationAccess failed', { conversationId, userId, error: err.message });
    return false;
  }
}

/** Broadcast new guest session to all online helpers (guest_chat_waiting room). */
function broadcastNewGuestSession(sessionData) {
  if (!io) return;
  io.to('guest_chat_waiting').emit('guest_session:new', sessionData);
}

/** Broadcast guest session status update to admins (guest_chat_admin room). */
function broadcastGuestSessionUpdate(sessionId, sessionData) {
  if (!io) return;
  io.to('guest_chat_admin').emit('guest_session:updated', {
    sessionId,
    ...sessionData,
  });
}

/** Broadcast guest chat message to helpers and admins monitoring this session. */
function broadcastGuestChatMessage(sessionId, messageData) {
  if (!io) return;
  // Broadcast to helpers in this specific session room and admins
  io.to(`guest_session_${sessionId}`).emit('guest_chat:message', messageData);
  io.to('guest_chat_admin').emit('guest_chat:message', { sessionId, ...messageData });
}

module.exports = {
  init,
  trackConnect,
  trackDisconnect,
  isOnline,
  broadcastToUser,
  broadcastToConversation,
  broadcastToAdmins,
  broadcastNewGuestSession,
  broadcastGuestSessionUpdate,
  broadcastGuestChatMessage,
  disconnectUserSockets,
  getSocketCount,
  validateConversationAccess, // FIX #8: Room access validation
};
