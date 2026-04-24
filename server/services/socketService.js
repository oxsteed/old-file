// server/services/socketService.js
// Socket helper + online-presence tracking.
//
// Presence uses Map<userId, Set<socketId>> so multiple tabs/devices are
// handled correctly — user goes "offline" only when ALL their sockets
// disconnect.

let io = null;

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

module.exports = {
  init,
  trackConnect,
  trackDisconnect,
  isOnline,
  broadcastToUser,
  broadcastToConversation,
  broadcastToAdmins,
  disconnectUserSockets,
  getSocketCount,
};
