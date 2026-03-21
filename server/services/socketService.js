// Socket service placeholder - will be initialized with actual socket.io instance
let io = null;

function init(socketIo) {
  io = socketIo;
}

function broadcastToUser(userId, event, data) {
  if (!io) return;
  io.to(`user_${userId}`).emit(event, data);
}

module.exports = { init, broadcastToUser };
