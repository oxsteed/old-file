const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { conversationMessageLimiter, userChatLimiter, strictLimiter } = require('../middleware/rateLimiter');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const pool = require('../db');
const logger = require('../utils/logger');
const {
  getConversations,
  getGuestInquiries,
  getGuestInquiryById,
  getOrCreateConversation,
  getConversationMeta,
  getMessages,
  searchMessages,
  sendMessage,
  deleteMessage,
  editMessage,
  addReaction,
  removeReaction,
  getMessageReactions,
  archiveConversation,
  restoreConversation,
  getArchivedConversations,
  uploadAttachment,
} = require('../controllers/messageController');

// All routes require authentication
router.use(authenticate);

// GET /api/messages/guest-inquiries - profile visitors without accounts (helper inbox)
router.get('/guest-inquiries', getGuestInquiries);

// GET /api/messages/guest-inquiries/:id - single inquiry (UUID)
router.get('/guest-inquiries/:id', getGuestInquiryById);

// GET /api/messages/conversations - Get all conversations
router.get('/conversations', getConversations);

// POST /api/messages/conversations - Create or get existing conversation
router.post('/conversations', getOrCreateConversation);

// GET /api/messages/conversations/:conversationId/meta - conversation name, job title, business
router.get('/conversations/:conversationId/meta', getConversationMeta);

// GET /api/messages/conversations/:conversationId - Get messages for a conversation
router.get('/conversations/:conversationId', getMessages);

// GET /api/messages/conversations/:conversationId/search - Search messages in conversation
router.get('/conversations/:conversationId/search', searchMessages);

// POST /api/messages/conversations/:conversationId - Send a message
// Apply both user-level (global) and conversation-level rate limits
// User limit prevents chat spam across all conversations
// Conversation limit prevents spam within a single conversation
router.post('/conversations/:conversationId', userChatLimiter, conversationMessageLimiter, sendMessage);

// DELETE /api/messages/conversations/:conversationId/:messageId - Delete a message
router.delete('/conversations/:conversationId/:messageId', deleteMessage);

// PUT /api/messages/conversations/:conversationId/:messageId - Edit a message
router.put('/conversations/:conversationId/:messageId', editMessage);

// GET /api/messages/conversations/:conversationId/:messageId/reactions - Get all reactions for a message
router.get('/conversations/:conversationId/:messageId/reactions', getMessageReactions);

// POST /api/messages/conversations/:conversationId/:messageId/reactions - Add a reaction
router.post('/conversations/:conversationId/:messageId/reactions', addReaction);

// DELETE /api/messages/conversations/:conversationId/:messageId/reactions - Remove a reaction
router.delete('/conversations/:conversationId/:messageId/reactions', removeReaction);

// GET /api/messages/archived - Get archived conversations for current user
router.get('/archived', getArchivedConversations);

// POST /api/messages/conversations/:conversationId/archive - Archive a conversation
router.post('/conversations/:conversationId/archive', archiveConversation);

// POST /api/messages/conversations/:conversationId/restore - Restore an archived conversation
router.post('/conversations/:conversationId/restore', restoreConversation);

// POST /api/messages/conversations/:conversationId/attachments - Upload a file/image attachment
// Accepts a single file under the field name "file" (max 10 MB, images + docs)
router.post('/conversations/:conversationId/attachments', upload.single('file'), validateFileUpload, uploadAttachment);

// ── User blocking (Guideline 1.2) ────────────────────────────────────────────

// POST /api/messages/users/:userId/block - Block a user
router.post('/users/:userId/block', strictLimiter, async (req, res) => {
  const blockerId  = req.user.id;
  const blockedId  = parseInt(req.params.userId, 10);
  if (!blockedId || blockerId === blockedId) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }
  try {
    await pool.query(
      `INSERT INTO user_blocks (blocker_id, blocked_id)
       VALUES ($1, $2)
       ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
      [blockerId, blockedId]
    );
    logger.info('User blocked', { blockerId, blockedId });
    res.json({ success: true });
  } catch (err) {
    logger.error('Block user error', { message: err.message });
    res.status(500).json({ error: 'Failed to block user' });
  }
});

// DELETE /api/messages/users/:userId/block - Unblock a user
router.delete('/users/:userId/block', async (req, res) => {
  const blockerId = req.user.id;
  const blockedId = parseInt(req.params.userId, 10);
  try {
    await pool.query(
      'DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2',
      [blockerId, blockedId]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Unblock user error', { message: err.message });
    res.status(500).json({ error: 'Failed to unblock user' });
  }
});

// GET /api/messages/users/blocked - List blocked users
router.get('/users/blocked', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ub.blocked_id AS id, u.first_name, u.last_name, u.email, ub.created_at AS blocked_at
       FROM user_blocks ub
       JOIN users u ON u.id = ub.blocked_id
       WHERE ub.blocker_id = $1
       ORDER BY ub.created_at DESC`,
      [req.user.id]
    );
    res.json({ blockedUsers: rows });
  } catch (err) {
    logger.error('Get blocked users error', { message: err.message });
    res.status(500).json({ error: 'Failed to load blocked users' });
  }
});

// ── General content reporting (Guideline 1.2) ────────────────────────────────

// POST /api/messages/report - Report a user or piece of content
// contentType: 'user' | 'message' | 'job' | 'review' | 'profile'
// reason: 'spam' | 'harassment' | 'fraud' | 'inappropriate' | 'other'
router.post('/report', strictLimiter, async (req, res) => {
  const reporterId = req.user.id;
  const { reportedUserId, contentType, contentId, reason, description } = req.body;

  const validTypes   = ['user', 'message', 'job', 'review', 'profile'];
  const validReasons = ['spam', 'harassment', 'fraud', 'inappropriate', 'other'];

  if (!validTypes.includes(contentType)) {
    return res.status(400).json({ error: 'Invalid content type', validTypes });
  }
  if (!validReasons.includes(reason)) {
    return res.status(400).json({ error: 'Invalid reason', validReasons });
  }
  if (reportedUserId && reporterId === parseInt(reportedUserId, 10)) {
    return res.status(400).json({ error: 'Cannot report yourself' });
  }

  try {
    await pool.query(
      `INSERT INTO content_reports
         (reporter_id, reported_user_id, content_type, content_id, reason, description)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        reporterId,
        reportedUserId || null,
        contentType,
        contentId || null,
        reason,
        description || null,
      ]
    );
    logger.info('Content reported', { reporterId, reportedUserId, contentType, reason });
    res.json({ success: true, message: 'Report submitted. Our team will review it.' });
  } catch (err) {
    logger.error('Content report error', { message: err.message });
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

module.exports = router;
