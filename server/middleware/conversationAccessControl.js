// VULN #16 FIX: Prevent conversation participant enumeration
// Don't leak information about participants through real-time events

const logger = require('../utils/logger');

/**
 * Middleware to prevent enumeration of conversation participants
 * Ensures join/leave events are only visible to conversation members
 */
function preventParticipantEnumeration(req, res, next) {
  // For endpoints that list conversation participants, only return to members
  if (req.path.includes('/participants') || req.path.includes('/members')) {
    // Validate requester is a member before returning list
    if (!req.conversationMembership) {
      return res.status(403).json({
        error: 'Access denied',
        code: 'not_conversation_member'
      });
    }
  }

  next();
}

/**
 * Socket.IO event sanitization
 * Don't broadcast "user joined" if the joining user can't see the listener
 */
function shouldBroadcastJoinEvent(socket, conversationId, joinedUserId) {
  // Only broadcast join events to conversation members
  // Non-members should not know about participant activity
  // This is enforced by Socket.IO room membership (user only in conv_X room if verified)
  return socket.rooms.has(`conv_${conversationId}`);
}

module.exports = {
  preventParticipantEnumeration,
  shouldBroadcastJoinEvent
};
