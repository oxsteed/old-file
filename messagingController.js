/**
 * Messaging System Controller
 * Handles business-level messaging with channels, direct messages, and real-time support
 * Supports team communication and customer interactions
 *
 * Features:
 * - Business channels (public team channels, private channels)
 * - Direct messaging between team members
 * - Customer messaging (from booking/appointment context)
 * - Message history with pagination
 * - Read receipts and presence tracking
 * - File attachments via S3
 * - Real-time Socket.IO integration (see socketService.js)
 *
 * Database:
 * - messaging_channels: Team and customer channels
 * - messaging_channel_members: Channel membership tracking
 * - messaging_messages: Individual messages with optional attachments
 * - messaging_read_receipts: Per-user read status
 * - messaging_conversations: Direct message conversations (helper tables for DM context)
 */

const { pool } = require('../db');
const { AppError } = require('../utils/apiError');
const { logger } = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const { uploadFile, getPublicUrl, deleteFile } = require('../utils/storage');

// ============================================================================
// Channel Management (Team & Public Channels)
// ============================================================================

/**
 * List all channels for a business
 * GET /api/businesses/{businessId}/messaging/channels
 * Query params: type (team|customer|all), page, limit
 */
async function listChannels(req, res, next) {
  try {
    const { businessId } = req.params;
    const { type = 'all', page = 0, limit = 50 } = req.query;
    const userId = req.user.id;

    // Validate business ownership
    const bizCheck = await pool.query(
      'SELECT id FROM businesses WHERE id = $1 AND user_id = $2',
      [businessId, userId]
    );
    if (!bizCheck.rows.length) {
      throw new AppError('Unauthorized', 403, 'not_authorized');
    }

    const typeFilter = type === 'all' ? '' : `AND type = '${type}'`;
    const offset = page * limit;

    // Get channels where user is a member
    const result = await pool.query(
      `
      SELECT
        mc.id, mc.business_id, mc.name, mc.type, mc.description,
        mc.is_active, mc.created_by, mc.created_at,
        COUNT(DISTINCT mm.user_id) as member_count,
        COUNT(DISTINCT CASE WHEN mm.user_id = $3 THEN 1 END) as user_is_member,
        MAX(mm2.last_message_at) as last_activity
      FROM messaging_channels mc
      LEFT JOIN messaging_channel_members mm ON mc.id = mm.channel_id
      LEFT JOIN messaging_channel_members mm2 ON mc.id = mm2.channel_id
      WHERE mc.business_id = $1 ${typeFilter}
      GROUP BY mc.id
      HAVING COUNT(DISTINCT CASE WHEN mm.user_id = $3 THEN 1 END) > 0
      ORDER BY mc.created_at DESC
      LIMIT $4 OFFSET $5
      `,
      [businessId, type === 'all' ? null : type, userId, limit, offset]
    );

    // Get total count
    const countResult = await pool.query(
      `
      SELECT COUNT(*) as total FROM messaging_channels mc
      LEFT JOIN messaging_channel_members mm ON mc.id = mm.channel_id
      WHERE mc.business_id = $1 AND mm.user_id = $2 ${typeFilter}
      `,
      [businessId, userId]
    );

    const channels = result.rows.map(ch => ({
      id: ch.id,
      businessId: ch.business_id,
      name: ch.name,
      type: ch.type,
      description: ch.description,
      isActive: ch.is_active,
      createdBy: ch.created_by,
      createdAt: ch.created_at,
      memberCount: parseInt(ch.member_count),
      userIsMember: parseInt(ch.user_is_member) > 0,
      lastActivity: ch.last_activity,
    }));

    res.json({
      success: true,
      data: channels,
      total: parseInt(countResult.rows[0].total),
      page,
      limit,
    });
  } catch (error) {
    logger.error('messagingController.listChannels', { error, params: req.params });
    next(error);
  }
}

/**
 * Get a single channel with member list
 * GET /api/businesses/{businessId}/messaging/channels/{channelId}
 */
async function getChannel(req, res, next) {
  try {
    const { businessId, channelId } = req.params;
    const userId = req.user.id;

    // Verify user is a member
    const memberCheck = await pool.query(
      `
      SELECT mcm.user_id FROM messaging_channel_members mcm
      JOIN messaging_channels mc ON mcm.channel_id = mc.id
      WHERE mc.id = $1 AND mc.business_id = $2 AND mcm.user_id = $3
      `,
      [channelId, businessId, userId]
    );
    if (!memberCheck.rows.length) {
      throw new AppError('Channel not found', 404, 'not_found');
    }

    // Get channel details with member list
    const channelResult = await pool.query(
      'SELECT * FROM messaging_channels WHERE id = $1 AND business_id = $2',
      [channelId, businessId]
    );
    if (!channelResult.rows.length) {
      throw new AppError('Channel not found', 404, 'not_found');
    }

    const channel = channelResult.rows[0];

    // Get members
    const membersResult = await pool.query(
      `
      SELECT
        mcm.user_id, u.display_name, u.profile_photo_url,
        mcm.joined_at, mcm.is_admin,
        COALESCE(mcm.last_read_at, now()) as last_read_at
      FROM messaging_channel_members mcm
      JOIN users u ON mcm.user_id = u.id
      WHERE mcm.channel_id = $1
      ORDER BY mcm.joined_at ASC
      `,
      [channelId]
    );

    // Get unread message count
    const unreadResult = await pool.query(
      `
      SELECT COUNT(*) as unread_count FROM messaging_messages
      WHERE channel_id = $1 AND created_at > COALESCE(
        (SELECT last_read_at FROM messaging_channel_members WHERE channel_id = $1 AND user_id = $2),
        now() - interval '999 days'
      )
      `,
      [channelId, userId]
    );

    res.json({
      success: true,
      data: {
        id: channel.id,
        businessId: channel.business_id,
        name: channel.name,
        type: channel.type,
        description: channel.description,
        isActive: channel.is_active,
        createdBy: channel.created_by,
        createdAt: channel.created_at,
        members: membersResult.rows.map(m => ({
          userId: m.user_id,
          displayName: m.display_name,
          profilePhotoUrl: m.profile_photo_url,
          joinedAt: m.joined_at,
          isAdmin: m.is_admin,
          lastReadAt: m.last_read_at,
        })),
        unreadCount: parseInt(unreadResult.rows[0].unread_count),
      },
    });
  } catch (error) {
    logger.error('messagingController.getChannel', { error, params: req.params });
    next(error);
  }
}

/**
 * Create a new channel
 * POST /api/businesses/{businessId}/messaging/channels
 * Body: { name, type (team|customer), description?, memberIds? }
 */
async function createChannel(req, res, next) {
  try {
    const { businessId } = req.params;
    const { name, type, description = '', memberIds = [] } = req.body;
    const userId = req.user.id;

    // Validate inputs
    if (!name || name.trim().length === 0 || name.length > 200) {
      throw new AppError('Channel name required (1-200 chars)', 400, 'validation_failed');
    }
    if (!['team', 'customer'].includes(type)) {
      throw new AppError('Invalid channel type', 400, 'validation_failed');
    }
    if (description.length > 2000) {
      throw new AppError('Description too long (max 2000 chars)', 400, 'validation_failed');
    }

    // Verify business ownership
    const bizCheck = await pool.query(
      'SELECT id FROM businesses WHERE id = $1 AND user_id = $2',
      [businessId, userId]
    );
    if (!bizCheck.rows.length) {
      throw new AppError('Unauthorized', 403, 'not_authorized');
    }

    // Create channel in transaction
    const channel = await withTransaction(async (client) => {
      const result = await client.query(
        `
        INSERT INTO messaging_channels
        (business_id, name, type, description, created_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        `,
        [businessId, name.trim(), type, description.trim(), userId]
      );

      const channelId = result.rows[0].id;

      // Add creator as member
      await client.query(
        `
        INSERT INTO messaging_channel_members
        (channel_id, user_id, is_admin, joined_at)
        VALUES ($1, $2, true, now())
        `,
        [channelId, userId]
      );

      // Add other members if provided
      if (memberIds.length > 0) {
        const uniqueMembers = [...new Set(memberIds)].filter(id => id !== userId);
        if (uniqueMembers.length > 0) {
          const placeholders = uniqueMembers
            .map((_, i) => `($1, $${i + 2}, false, now())`)
            .join(',');
          await client.query(
            `INSERT INTO messaging_channel_members (channel_id, user_id, is_admin, joined_at) VALUES ${placeholders}`,
            [channelId, ...uniqueMembers]
          );
        }
      }

      return result.rows[0];
    });

    logger.info('Channel created', { channelId: channel.id, businessId, type });

    res.status(201).json({
      success: true,
      data: {
        id: channel.id,
        businessId: channel.business_id,
        name: channel.name,
        type: channel.type,
        description: channel.description,
        createdBy: channel.created_by,
        createdAt: channel.created_at,
      },
    });
  } catch (error) {
    logger.error('messagingController.createChannel', { error, body: req.body });
    next(error);
  }
}

/**
 * Update channel details
 * PUT /api/businesses/{businessId}/messaging/channels/{channelId}
 * Body: { name?, description?, is_active? }
 */
async function updateChannel(req, res, next) {
  try {
    const { businessId, channelId } = req.params;
    const { name, description, is_active } = req.body;
    const userId = req.user.id;

    // Check if user is channel admin
    const adminCheck = await pool.query(
      `
      SELECT mcm.is_admin FROM messaging_channel_members mcm
      JOIN messaging_channels mc ON mcm.channel_id = mc.id
      WHERE mc.id = $1 AND mc.business_id = $2 AND mcm.user_id = $3
      `,
      [channelId, businessId, userId]
    );
    if (!adminCheck.rows.length || !adminCheck.rows[0].is_admin) {
      throw new AppError('Unauthorized', 403, 'not_authorized');
    }

    // Build update query
    const updates = [];
    const params = [channelId, businessId];
    if (name !== undefined) {
      if (name.length === 0 || name.length > 200) {
        throw new AppError('Channel name required (1-200 chars)', 400, 'validation_failed');
      }
      updates.push('name = $' + (params.length + 1));
      params.push(name.trim());
    }
    if (description !== undefined) {
      if (description.length > 2000) {
        throw new AppError('Description too long', 400, 'validation_failed');
      }
      updates.push('description = $' + (params.length + 1));
      params.push(description.trim());
    }
    if (is_active !== undefined) {
      updates.push('is_active = $' + (params.length + 1));
      params.push(is_active);
    }

    if (updates.length === 0) {
      throw new AppError('No updates provided', 400, 'validation_failed');
    }

    const result = await pool.query(
      `UPDATE messaging_channels SET ${updates.join(', ')}, updated_at = now()
       WHERE id = $1 AND business_id = $2 RETURNING *`,
      params
    );

    if (!result.rows.length) {
      throw new AppError('Channel not found', 404, 'not_found');
    }

    logger.info('Channel updated', { channelId, updates });

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('messagingController.updateChannel', { error, params: req.params });
    next(error);
  }
}

/**
 * Delete a channel
 * DELETE /api/businesses/{businessId}/messaging/channels/{channelId}
 */
async function deleteChannel(req, res, next) {
  try {
    const { businessId, channelId } = req.params;
    const userId = req.user.id;

    // Verify user is channel admin
    const adminCheck = await pool.query(
      `
      SELECT mcm.is_admin FROM messaging_channel_members mcm
      JOIN messaging_channels mc ON mcm.channel_id = mc.id
      WHERE mc.id = $1 AND mc.business_id = $2 AND mcm.user_id = $3
      `,
      [channelId, businessId, userId]
    );
    if (!adminCheck.rows.length || !adminCheck.rows[0].is_admin) {
      throw new AppError('Unauthorized', 403, 'not_authorized');
    }

    // Soft delete: mark as inactive and archive messages
    await withTransaction(async (client) => {
      await client.query(
        'UPDATE messaging_channels SET is_active = false, deleted_at = now() WHERE id = $1',
        [channelId]
      );
      // Messages are kept for compliance (soft delete only)
    });

    logger.info('Channel deleted', { channelId, businessId });

    res.json({ success: true, message: 'Channel deleted' });
  } catch (error) {
    logger.error('messagingController.deleteChannel', { error, params: req.params });
    next(error);
  }
}

// ============================================================================
// Message Management
// ============================================================================

/**
 * Get messages in a channel with pagination
 * GET /api/businesses/{businessId}/messaging/channels/{channelId}/messages
 * Query params: page, limit, before (timestamp for older messages)
 */
async function getChannelMessages(req, res, next) {
  try {
    const { businessId, channelId } = req.params;
    const { page = 0, limit = 50, before } = req.query;
    const userId = req.user.id;

    // Verify membership
    const memberCheck = await pool.query(
      `
      SELECT user_id FROM messaging_channel_members
      WHERE channel_id = $1 AND user_id = $2
      `,
      [channelId, userId]
    );
    if (!memberCheck.rows.length) {
      throw new AppError('Access denied', 403, 'access_denied');
    }

    // Build query
    const offset = page * limit;
    const beforeClause = before ? `AND mm.created_at < $4` : '';
    const params = [channelId, limit, offset];
    if (before) params.splice(2, 0, new Date(before).toISOString());

    const result = await pool.query(
      `
      SELECT
        mm.id, mm.channel_id, mm.sender_id, u.display_name, u.profile_photo_url,
        mm.content, mm.message_type, mm.attachment_url, mm.created_at, mm.edited_at,
        COUNT(DISTINCT mr.user_id) as reaction_count,
        array_agg(DISTINCT mr.emoji) FILTER (WHERE mr.emoji IS NOT NULL) as reactions
      FROM messaging_messages mm
      JOIN users u ON mm.sender_id = u.id
      LEFT JOIN messaging_reactions mr ON mm.id = mr.message_id
      WHERE mm.channel_id = $1 ${beforeClause}
      GROUP BY mm.id, u.id
      ORDER BY mm.created_at DESC
      LIMIT $2 OFFSET $3
      `,
      params
    );

    // Mark as read
    await pool.query(
      `UPDATE messaging_channel_members SET last_read_at = now()
       WHERE channel_id = $1 AND user_id = $2`,
      [channelId, userId]
    );

    res.json({
      success: true,
      data: result.rows
        .reverse() // Reverse to get chronological order
        .map(m => ({
          id: m.id,
          channelId: m.channel_id,
          senderId: m.sender_id,
          senderName: m.display_name,
          senderPhoto: m.profile_photo_url,
          content: m.content,
          messageType: m.message_type,
          attachmentUrl: m.attachment_url,
          createdAt: m.created_at,
          editedAt: m.edited_at,
          reactions: m.reactions || [],
        })),
      page,
      limit,
    });
  } catch (error) {
    logger.error('messagingController.getChannelMessages', { error, params: req.params });
    next(error);
  }
}

/**
 * Send a message to a channel
 * POST /api/businesses/{businessId}/messaging/channels/{channelId}/messages
 * Body: { content, messageType (text|system|file), attachment? (file object) }
 */
async function sendMessage(req, res, next) {
  try {
    const { businessId, channelId } = req.params;
    const { content, messageType = 'text' } = req.body;
    const userId = req.user.id;
    const file = req.files?.attachment;

    // Validate membership
    const memberCheck = await pool.query(
      `SELECT user_id FROM messaging_channel_members WHERE channel_id = $1 AND user_id = $2`,
      [channelId, userId]
    );
    if (!memberCheck.rows.length) {
      throw new AppError('Access denied', 403, 'access_denied');
    }

    // Validate content
    if (!content || content.trim().length === 0) {
      throw new AppError('Message content required', 400, 'validation_failed');
    }
    if (content.length > 5000) {
      throw new AppError('Message too long (max 5000 chars)', 400, 'validation_failed');
    }
    if (!['text', 'system', 'file'].includes(messageType)) {
      throw new AppError('Invalid message type', 400, 'validation_failed');
    }

    let attachmentUrl = null;
    if (file) {
      // Upload to S3
      try {
        const key = `messages/${channelId}/${Date.now()}-${file.name}`;
        attachmentUrl = await uploadFile(key, file.data);
      } catch (storageError) {
        logger.warn('File upload failed, continuing without attachment', { error: storageError });
      }
    }

    // Create message
    const result = await withTransaction(async (client) => {
      const msgResult = await client.query(
        `
        INSERT INTO messaging_messages
        (channel_id, sender_id, content, message_type, attachment_url)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        `,
        [channelId, userId, content.trim(), messageType, attachmentUrl]
      );

      // Update channel last activity
      await client.query(
        `UPDATE messaging_channel_members SET last_message_at = now()
         WHERE channel_id = $1`,
        [channelId]
      );

      return msgResult.rows[0];
    });

    logger.info('Message sent', { messageId: result.id, channelId, userId });

    // Broadcast to connected users via Socket.IO (see socketService.js)
    // broadcastToConversation(channelId, 'message:new', { message: result });

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('messagingController.sendMessage', { error, params: req.params });
    next(error);
  }
}

/**
 * Edit a message
 * PUT /api/businesses/{businessId}/messaging/channels/{channelId}/messages/{messageId}
 * Body: { content }
 */
async function editMessage(req, res, next) {
  try {
    const { businessId, channelId, messageId } = req.params;
    const { content } = req.body;
    const userId = req.user.id;

    // Validate content
    if (!content || content.length === 0 || content.length > 5000) {
      throw new AppError('Content required (1-5000 chars)', 400, 'validation_failed');
    }

    // Verify ownership
    const msgCheck = await pool.query(
      `
      SELECT sender_id FROM messaging_messages
      WHERE id = $1 AND channel_id = $2
      `,
      [messageId, channelId]
    );
    if (!msgCheck.rows.length || msgCheck.rows[0].sender_id !== userId) {
      throw new AppError('Cannot edit this message', 403, 'access_denied');
    }

    const result = await pool.query(
      `UPDATE messaging_messages SET content = $1, edited_at = now()
       WHERE id = $2 RETURNING *`,
      [content.trim(), messageId]
    );

    logger.info('Message edited', { messageId });

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('messagingController.editMessage', { error, params: req.params });
    next(error);
  }
}

/**
 * Delete a message
 * DELETE /api/businesses/{businessId}/messaging/channels/{channelId}/messages/{messageId}
 */
async function deleteMessage(req, res, next) {
  try {
    const { messageId, channelId } = req.params;
    const userId = req.user.id;

    // Verify ownership
    const msgCheck = await pool.query(
      `SELECT sender_id, attachment_url FROM messaging_messages WHERE id = $1 AND channel_id = $2`,
      [messageId, channelId]
    );
    if (!msgCheck.rows.length || msgCheck.rows[0].sender_id !== userId) {
      throw new AppError('Cannot delete this message', 403, 'access_denied');
    }

    // Delete attachment if exists
    if (msgCheck.rows[0].attachment_url) {
      try {
        const key = msgCheck.rows[0].attachment_url.split('/').pop();
        await deleteFile(key);
      } catch (storageError) {
        logger.warn('File deletion failed', { error: storageError });
      }
    }

    // Soft delete message
    await pool.query(
      `UPDATE messaging_messages SET deleted_at = now() WHERE id = $1`,
      [messageId]
    );

    logger.info('Message deleted', { messageId });

    res.json({ success: true, message: 'Message deleted' });
  } catch (error) {
    logger.error('messagingController.deleteMessage', { error, params: req.params });
    next(error);
  }
}

// ============================================================================
// Reactions
// ============================================================================

/**
 * Add emoji reaction to a message
 * POST /api/businesses/{businessId}/messaging/channels/{channelId}/messages/{messageId}/react
 * Body: { emoji }
 */
async function addReaction(req, res, next) {
  try {
    const { messageId, channelId } = req.params;
    const { emoji } = req.body;
    const userId = req.user.id;

    if (!emoji || emoji.length === 0) {
      throw new AppError('Emoji required', 400, 'validation_failed');
    }

    // Verify message exists
    const msgCheck = await pool.query(
      `SELECT id FROM messaging_messages WHERE id = $1 AND channel_id = $2`,
      [messageId, channelId]
    );
    if (!msgCheck.rows.length) {
      throw new AppError('Message not found', 404, 'not_found');
    }

    // Add reaction (ignore if duplicate)
    await pool.query(
      `
      INSERT INTO messaging_reactions (message_id, user_id, emoji)
      VALUES ($1, $2, $3)
      ON CONFLICT (message_id, user_id, emoji) DO NOTHING
      `,
      [messageId, userId, emoji]
    );

    logger.info('Reaction added', { messageId, emoji, userId });

    res.status(201).json({ success: true, message: 'Reaction added' });
  } catch (error) {
    logger.error('messagingController.addReaction', { error, params: req.params });
    next(error);
  }
}

/**
 * Remove emoji reaction
 * DELETE /api/businesses/{businessId}/messaging/channels/{channelId}/messages/{messageId}/react/{emoji}
 */
async function removeReaction(req, res, next) {
  try {
    const { messageId, channelId, emoji } = req.params;
    const userId = req.user.id;

    await pool.query(
      `DELETE FROM messaging_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
      [messageId, userId, emoji]
    );

    logger.info('Reaction removed', { messageId, emoji });

    res.json({ success: true, message: 'Reaction removed' });
  } catch (error) {
    logger.error('messagingController.removeReaction', { error, params: req.params });
    next(error);
  }
}

// ============================================================================
// Channel Membership
// ============================================================================

/**
 * Add members to channel
 * POST /api/businesses/{businessId}/messaging/channels/{channelId}/members
 * Body: { userIds }
 */
async function addChannelMembers(req, res, next) {
  try {
    const { channelId } = req.params;
    const { userIds } = req.body;
    const userId = req.user.id;

    // Verify admin
    const adminCheck = await pool.query(
      `SELECT is_admin FROM messaging_channel_members WHERE channel_id = $1 AND user_id = $2`,
      [channelId, userId]
    );
    if (!adminCheck.rows.length || !adminCheck.rows[0].is_admin) {
      throw new AppError('Unauthorized', 403, 'not_authorized');
    }

    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new AppError('User IDs required', 400, 'validation_failed');
    }

    // Add members
    const uniqueIds = [...new Set(userIds)];
    const placeholders = uniqueIds
      .map((_, i) => `($1, $${i + 2}, false, now())`)
      .join(',');

    await pool.query(
      `
      INSERT INTO messaging_channel_members (channel_id, user_id, is_admin, joined_at)
      VALUES ${placeholders}
      ON CONFLICT (channel_id, user_id) DO NOTHING
      `,
      [channelId, ...uniqueIds]
    );

    logger.info('Members added to channel', { channelId, count: uniqueIds.length });

    res.status(201).json({
      success: true,
      message: `Added ${uniqueIds.length} member(s)`,
    });
  } catch (error) {
    logger.error('messagingController.addChannelMembers', { error });
    next(error);
  }
}

/**
 * Remove member from channel
 * DELETE /api/businesses/{businessId}/messaging/channels/{channelId}/members/{memberId}
 */
async function removeChannelMember(req, res, next) {
  try {
    const { channelId, memberId } = req.params;
    const userId = req.user.id;

    // Verify admin or self
    if (memberId !== userId) {
      const adminCheck = await pool.query(
        `SELECT is_admin FROM messaging_channel_members WHERE channel_id = $1 AND user_id = $2`,
        [channelId, userId]
      );
      if (!adminCheck.rows.length || !adminCheck.rows[0].is_admin) {
        throw new AppError('Unauthorized', 403, 'not_authorized');
      }
    }

    await pool.query(
      `DELETE FROM messaging_channel_members WHERE channel_id = $1 AND user_id = $2`,
      [channelId, memberId]
    );

    logger.info('Member removed from channel', { channelId, memberId });

    res.json({ success: true, message: 'Member removed' });
  } catch (error) {
    logger.error('messagingController.removeChannelMember', { error });
    next(error);
  }
}

module.exports = {
  listChannels,
  getChannel,
  createChannel,
  updateChannel,
  deleteChannel,
  getChannelMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  addReaction,
  removeReaction,
  addChannelMembers,
  removeChannelMember,
};
