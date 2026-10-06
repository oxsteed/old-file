const pool          = require('../db');
const socketService = require('../services/socketService');
const { broadcastGuestChatMessage } = socketService;
const logger        = require('../utils/logger');
const { sanitizeMessage, detectOffPlatformContact } = require('../utils/messageSanitizer');
const { uploadFile, getSignedDownloadUrl } = require('../utils/storage');
const { withTransaction } = require('../utils/transaction');
const { verifyConversationAccess } = require('../utils/conversationAccess');
const { AppError } = require('../middleware/errorHandler');
const { ensureBusinessConversation, mirrorMessage } = require('../services/businessConversationSync');
const { enqueueMessageNotifications } = require('../services/messageNotificationService');

function normalizeMessageAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    if (!url) return [];
    const type = typeof item.type === 'string'
      ? item.type
      : typeof item.mimeType === 'string'
        ? item.mimeType
        : null;
    const filename = typeof item.filename === 'string'
      ? item.filename
      : typeof item.name === 'string'
        ? item.name
        : null;
    // The storage key is persisted so expired signed URLs can be re-signed
    // on every read. Rows stored before this change have no key and keep
    // serving their original URL as-is.
    const key = typeof item.key === 'string' ? item.key.trim() : null;
    return [{
      url,
      key: key ? key.slice(0, 1024) : null,
      type: type ? type.slice(0, 120) : null,
      filename: filename ? filename.slice(0, 255) : null,
    }];
  });
}

/**
 * Re-sign attachment download URLs that still carry their storage key.
 * Signed URLs expire (1h); re-signing on every read keeps attachments
 * usable without storing long-lived public URLs. Attachments without a
 * key (legacy rows, data-URL fallbacks) are returned unchanged.
 */
async function refreshAttachmentUrls(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return attachments;
  return Promise.all(attachments.map(async (item) => {
    if (!item || typeof item !== 'object' || typeof item.key !== 'string' || !item.key) {
      return item;
    }
    try {
      const url = await getSignedDownloadUrl(item.key, 3600);
      return { ...item, url };
    } catch (err) {
      logger.warn('Failed to re-sign attachment URL', { err: err.message });
      return item;
    }
  }));
}

/**
 * True when a user_blocks row exists between userId and any participant of
 * the conversation: the customer, the helper, or an active business rep.
 * Used to keep blocked users from sending, editing, deleting, or reacting
 * in a shared thread.
 */
async function hasConversationBlock(db, conversationId, userId) {
  const result = await db.query(
    `SELECT 1
     FROM conversations c
     WHERE c.id = $1
       AND EXISTS (
         SELECT 1 FROM user_blocks ub
         WHERE (ub.blocker_id = $2 AND ub.blocked_id IN (c.customer_id, c.helper_id))
            OR (ub.blocked_id = $2 AND ub.blocker_id IN (c.customer_id, c.helper_id))
            OR (ub.blocker_id = $2 AND ub.blocked_id IN (
                  SELECT member_id FROM business_members
                  WHERE business_id = c.business_id AND status = 'active'
                ))
            OR (ub.blocked_id = $2 AND ub.blocker_id IN (
                  SELECT member_id FROM business_members
                  WHERE business_id = c.business_id AND status = 'active'
                ))
       )
     LIMIT 1`,
    [conversationId, userId]
  );
  return result.rows.length > 0;
}

/** Server-enforced window during which a message may be edited. */
const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Guest profile inquiries (visitors without accounts) - guest_profile_chat_inbound.
 */
function mapGuestInquiryRow(r) {
  const lastMessage = r.last_message || r.message || '';
  return {
      id: `guest-${r.id}`,
      is_guest_inquiry: true,
      job_id: null,
      customer_id: null,
      helper_id: r.helper_id,
      business_id: r.business_id,
      status: 'active',
      last_message_at: r.last_message_at || r.last_activity_at || r.created_at,
      created_at: r.created_at,
      updated_at: r.last_activity_at || r.created_at,
      other_user_name: r.guest_name,
      other_user_id: null,
      job_title: null,
      last_message: lastMessage.length > 140 ? `${lastMessage.slice(0, 137)}…` : lastMessage,
      last_message_sender_id: null,
      helper_business_name: null,
      conversation_business_name: r.conversation_business_name,
      unread_count: Number(r.unread_count) || 0,
      guest_email: r.guest_email,
      guest_message_full: r.message,
    };
}

const getGuestInquiries = async (req, res) => {
  try {
    const userId = req.user.id;
    const filterBizId = req.query.business_id ? parseInt(req.query.business_id, 10) || null : null;
    const result = await pool.query(
      `SELECT g.id, g.helper_id, g.business_id, g.guest_name, g.guest_email, g.message, g.created_at,
              g.last_activity_at, cb.business_name AS conversation_business_name,
              COALESCE(latest.message, g.message) AS last_message,
              COALESCE(latest.created_at, g.last_guest_message_at, g.created_at) AS last_message_at,
              COALESCE(unread.unread_count, 0) + CASE
                WHEN g.message IS NOT NULL
                  AND COALESCE(unread.total_guest_messages, 0) = 0
                  AND read_cursor.last_read_at IS NULL THEN 1
                ELSE 0
              END AS unread_count
       FROM guest_profile_chat_inbound g
       LEFT JOIN businesses cb ON cb.id = g.business_id AND cb.is_active = TRUE
       LEFT JOIN guest_profile_chat_read_cursors read_cursor
         ON read_cursor.session_id = g.id AND read_cursor.reader_id = $1
       LEFT JOIN LATERAL (
         SELECT gm.message, gm.created_at
           FROM guest_profile_chat_messages gm
          WHERE gm.session_id = g.id
          ORDER BY gm.id DESC
          LIMIT 1
       ) latest ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (
                  WHERE gm.sender_type = 'guest'
                    AND gm.id > COALESCE(read_cursor.last_read_message_id, 0)
                )::INTEGER AS unread_count,
                COUNT(*) FILTER (WHERE gm.sender_type = 'guest')::INTEGER AS total_guest_messages
           FROM guest_profile_chat_messages gm
          WHERE gm.session_id = g.id
       ) unread ON TRUE
       WHERE (
         ($2::INTEGER IS NULL AND (
           g.helper_id = $1 OR (g.business_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM business_members bm
              WHERE bm.business_id = g.business_id AND bm.member_id = $1 AND bm.status = 'active'
           ))
         )) OR (
           $2::INTEGER IS NOT NULL AND g.business_id = $2::INTEGER AND (
             g.helper_id = $1 OR EXISTS (
               SELECT 1 FROM business_members bm
                WHERE bm.business_id = g.business_id AND bm.member_id = $1 AND bm.status = 'active'
             )
           )
         )
       )
       ORDER BY COALESCE(latest.created_at, g.last_activity_at, g.created_at) DESC
       LIMIT 100`,
      [userId, filterBizId],
    );

    res.json(result.rows.map(mapGuestInquiryRow));
  } catch (error) {
    logger.error('Error fetching guest inquiries', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch guest inquiries' });
  }
};

/**
 * GET /api/messages/guest-inquiries/:id - one guest inquiry (owner or active business rep).
 */
const getGuestInquiryById = async (req, res) => {
  try {
    const userId = req.user.id;
    const inquiryId = req.params.id;
    if (!inquiryId || typeof inquiryId !== 'string') {
      return res.status(400).json({ error: 'Invalid inquiry id' });
    }

    const rowRes = await pool.query(
      `SELECT g.id, g.helper_id, g.business_id, g.guest_name, g.guest_email, g.message, g.created_at,
              cb.business_name AS conversation_business_name
       FROM guest_profile_chat_inbound g
       LEFT JOIN businesses cb ON cb.id = g.business_id AND cb.is_active = TRUE
       WHERE g.id = $1`,
      [inquiryId]
    );

    const r = rowRes.rows[0];
    if (!r) return res.status(404).json({ error: 'Not found' });

    let allowed = String(r.helper_id) === String(userId);
    if (!allowed && r.business_id != null) {
      const rep = await pool.query(
        `SELECT 1 FROM business_members bm
         WHERE bm.business_id = $1 AND bm.member_id = $2 AND bm.status = 'active'`,
        [r.business_id, userId]
      );
      allowed = rep.rows.length > 0;
    }

    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    res.json(mapGuestInquiryRow(r));
  } catch (error) {
    logger.error('Error fetching guest inquiry', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch guest inquiry' });
  }
};

// Get all conversations for the current user (including business rep access)
// Optional query params: ?business_id=<id> to filter by business, ?include_archived=true to show archived,
// ?limit=<n> (default 50, max 100) and ?offset=<n> for pagination
const getConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const filterBizId = req.query.business_id ? parseInt(req.query.business_id, 10) || null : null;
    const includeArchived = req.query.include_archived === 'true';
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const requestedOffset = Number.parseInt(req.query.offset, 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 100)
      : 50;
    const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;

    const params = [userId];
    let bizFilter = '';
    if (filterBizId) {
      params.push(filterBizId);
      bizFilter = ` AND c.business_id = $${params.length}`;
    }

    // Keep the status and timestamp state machine aligned. Older rows may have
    // only one of these fields set, so the archive view accepts either signal.
    const statusFilter = includeArchived
      ? " AND (c.status IN ('active', 'archived') OR c.archived_at IS NOT NULL)"
      : " AND c.status = 'active' AND c.archived_at IS NULL";

    const result = await pool.query(
      `SELECT c.id, c.job_id, c.customer_id, c.helper_id, c.business_id, c.status,
              c.archived_at, c.last_message_at, c.created_at, c.updated_at,
              CASE
                WHEN c.customer_id = $1 AND NULLIF(cb.business_name, '') IS NOT NULL THEN cb.business_name
                WHEN c.customer_id = $1 THEN h.first_name || ' ' || h.last_name
                WHEN c.helper_id   = $1 THEN cu.first_name || ' ' || cu.last_name
                ELSE cu.first_name || ' ' || cu.last_name
              END AS other_user_name,
              CASE
                WHEN c.customer_id = $1 THEN c.helper_id
                WHEN c.helper_id   = $1 THEN c.customer_id
                ELSE c.customer_id
              END AS other_user_id,
              j.title AS job_title,
              lm.content AS last_message,
              lm.sender_id AS last_message_sender_id,
              -- helper's primary business name
              hb.business_name AS helper_business_name,
              -- business tied to this specific conversation (when business_id is set)
              cb.business_name AS conversation_business_name,
              uc.cnt AS unread_count,
              COUNT(*) OVER() AS _total_count
       FROM conversations c
       LEFT JOIN users h  ON c.helper_id   = h.id
       LEFT JOIN users cu ON c.customer_id = cu.id
       LEFT JOIN jobs j   ON c.job_id      = j.id
       LEFT JOIN businesses hb ON hb.user_id = c.helper_id AND hb.is_primary = TRUE AND hb.is_active = TRUE
       LEFT JOIN businesses cb ON cb.id = c.business_id AND cb.is_active = TRUE
       LEFT JOIN LATERAL (
         SELECT content, sender_id
         FROM messages
         WHERE conversation_id = c.id
         ORDER BY created_at DESC
         LIMIT 1
       ) lm ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS cnt
         FROM messages
         WHERE conversation_id = c.id AND sender_id != $1 AND is_read = FALSE
       ) uc ON TRUE
       WHERE (
         c.customer_id = $1
         OR c.helper_id = $1
         OR (c.business_id IS NOT NULL AND EXISTS(
           SELECT 1 FROM business_members bm
           WHERE bm.business_id = c.business_id AND bm.member_id = $1 AND bm.status = 'active'
         ))
       )${bizFilter}${statusFilter}
       ORDER BY c.last_message_at DESC NULLS LAST
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const total = result.rows.length > 0 ? parseInt(result.rows[0]._total_count, 10) : 0;
    const conversations = result.rows.map(({ _total_count, ...rest }) => rest);
    res.json({
      conversations,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    logger.error('Error fetching conversations', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
};

// Get or create a conversation
const getOrCreateConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { jobId, businessId } = req.body;
    const helperId = req.body.helperId || req.body.userId || req.body.ownerId;

    if (!helperId) return res.status(400).json({ error: 'Helper ID is required' });

    // Helpers, tool owners, and anyone with a rental listing can be messaged.
    const helperCheck = await pool.query(
      `SELECT id FROM users
       WHERE id = $1
         AND deleted_at IS NULL
         AND (
           role IN ('helper', 'helper_pro', 'broker')
           OR COALESCE(default_mode, '') = 'tool_owner'
           OR EXISTS (SELECT 1 FROM tool_rentals tr WHERE tr.user_id = users.id)
         )`,
      [helperId]
    );
    if (helperCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid helper ID' });
    }

    // Prevent users from messaging themselves
    if (String(userId) === String(helperId)) {
      return res.status(400).json({ error: 'Cannot message yourself' });
    }

    const bizId = businessId ? parseInt(businessId, 10) || null : null;
    const jobIdParam = jobId || null;

    // Audit fix: if a businessId is supplied, verify the helper is actually
    // a member of that business. Otherwise a caller could bind a
    // conversation to a foreign business and inherit its ACL.
    if (bizId) {
      const { rows: [membership] } = await pool.query(
        `SELECT 1 FROM business_members WHERE business_id = $1 AND user_id = $2 LIMIT 1`,
        [bizId, helperId]
      ).catch(() => ({ rows: [] }));
      if (!membership) {
        // Fall back: the business owner can also be messaged via the business.
        const { rows: [owned] } = await pool.query(
          `SELECT 1 FROM businesses WHERE id = $1 AND user_id = $2 LIMIT 1`,
          [bizId, helperId]
        ).catch(() => ({ rows: [] }));
        if (!owned) {
          return res.status(403).json({ error: 'Helper is not a member of this business' });
        }
      }
    }

    // Use a single consolidated query that handles all three cases with conditional WHERE
    const result = await pool.query(
      `SELECT * FROM conversations
       WHERE customer_id = $1 AND helper_id = $2
         AND (
           (job_id = $3)
           OR (job_id IS NULL AND business_id = $4)
           OR (job_id IS NULL AND business_id IS NULL AND $3 IS NULL AND $4 IS NULL)
         )`,
      [userId, helperId, jobIdParam, bizId]
    );

    if (result.rows.length > 0) {
      return res.json(result.rows[0]);
    }

    // Try to insert the conversation with the appropriate parameters
    const newConv = await pool.query(
      `INSERT INTO conversations (customer_id, helper_id, job_id, business_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [userId, helperId, jobIdParam, bizId]
    );

    if (newConv.rows.length) {
      return res.status(201).json(newConv.rows[0]);
    }

    // Concurrent insert: fetch the row that was inserted by another request
    const existing = await pool.query(
      `SELECT * FROM conversations
       WHERE customer_id = $1 AND helper_id = $2
         AND (
           (job_id = $3)
           OR (job_id IS NULL AND business_id = $4)
           OR (job_id IS NULL AND business_id IS NULL AND $3 IS NULL AND $4 IS NULL)
         )`,
      [userId, helperId, jobIdParam, bizId]
    );
    if (!existing.rows[0]) return res.status(500).json({ error: 'Failed to create conversation' });
    res.json(existing.rows[0]);
  } catch (error) {
    logger.error('Error creating conversation', { err: error.message });
    res.status(500).json({ error: 'Failed to create conversation' });
  }
};

// Get messages for a conversation
// ?mark_read=true explicitly marks inbound messages read (defaults to false);
// without it this endpoint is a pure read and never flips read state.
const getMessages = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const limit  = Math.min(Math.max(parseInt(req.query.limit)  || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset) || 0,  0);
    const markReadParam = req.query.mark_read ?? req.query.markRead
      ?? req.body?.mark_read ?? req.body?.markRead;
    const shouldMarkRead = markReadParam === true
      || markReadParam === 'true'
      || markReadParam === '1';

    // Verify user is part of conversation (direct participant or active business rep)
    const conv = await pool.query(
      `SELECT c.customer_id, c.helper_id, c.business_id, c.status, c.archived_at FROM conversations c
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
    if (conv.rows.length === 0) {
      throw new AppError('Access denied', 403, 'access_denied');
    }

    // Mark inbound messages as read only when explicitly requested, get count
    // so we only emit when needed
    if (shouldMarkRead) {
      const readResult = await pool.query(
        `UPDATE messages
         SET is_read = TRUE, read_at = NOW()
         WHERE conversation_id = $1 AND sender_id != $2 AND is_read = FALSE
         RETURNING id`,
        [conversationId, userId]
      );

      // Notify the sender that their messages were seen
      if (readResult.rows.length > 0) {
        socketService.broadcastToConversation(conversationId, 'messages:read', {
          conversationId,
          readBy: userId,
          readAt: new Date().toISOString(),
        });
      }
    }

    const result = await pool.query(
      `SELECT m.*, u.first_name || ' ' || u.last_name AS sender_name
       FROM messages m
       LEFT JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = $1 AND m.deleted_at IS NULL
       ORDER BY m.created_at ASC
       LIMIT $2 OFFSET $3`,
      [conversationId, limit, offset]
    );

    // Re-sign attachment URLs on every read; stored keys make the 1h expiry
    // a non-issue. Legacy rows without keys keep their original URL.
    const rows = await Promise.all(result.rows.map(async (row) => ({
      ...row,
      attachments: await refreshAttachmentUrls(row.attachments),
    })));
    res.json(rows);
  } catch (error) {
    next(error);
  }
};

// Get metadata for a single conversation (name, business name, job title)
const getConversationMeta = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;

    const result = await pool.query(
      `SELECT
         c.id, c.job_id, c.customer_id, c.helper_id, c.business_id, c.status,
         c.archived_at,
         CASE
           WHEN c.customer_id = $2 AND NULLIF(cb.business_name, '') IS NOT NULL THEN cb.business_name
           WHEN c.customer_id = $2 THEN h.first_name || ' ' || h.last_name
           WHEN c.helper_id   = $2 THEN cu.first_name || ' ' || cu.last_name
           ELSE cu.first_name || ' ' || cu.last_name
         END AS other_user_name,
         CASE
           WHEN c.customer_id = $2 THEN c.helper_id
           WHEN c.helper_id   = $2 THEN c.customer_id
           ELSE c.customer_id
         END AS other_user_id,
         j.title AS job_title,
         hb.business_name AS helper_business_name,
         cb.business_name AS conversation_business_name
       FROM conversations c
       LEFT JOIN users h  ON c.helper_id   = h.id
       LEFT JOIN users cu ON c.customer_id = cu.id
       LEFT JOIN jobs j   ON c.job_id      = j.id
       LEFT JOIN businesses hb ON hb.user_id = c.helper_id AND hb.is_primary = TRUE AND hb.is_active = TRUE
       LEFT JOIN businesses cb ON cb.id = c.business_id AND cb.is_active = TRUE
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

    if (result.rows.length === 0) return res.status(403).json({ error: 'Access denied' });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error fetching conversation meta', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
};

// Search messages in a conversation by keyword and/or sender
const searchMessages = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const q = (req.query.q || '').trim().slice(0, 200);
    const sender = (req.query.sender || 'all').toLowerCase();
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    // Verify user is part of conversation
    const conv = await pool.query(
      `SELECT c.customer_id, c.helper_id FROM conversations c
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
    if (conv.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

    const { customer_id, helper_id } = conv.rows[0];

    // Build query based on filters
    let whereClause = `m.conversation_id = $1 AND m.deleted_at IS NULL`;
    const params = [conversationId];

    // Filter by keyword if provided
    if (q) {
      params.push(`%${q}%`);
      whereClause += ` AND m.content ILIKE $${params.length}`;
    }

    // Filter by sender if specified (me = current user, helper = the other helper/customer)
    if (sender === 'me') {
      params.push(userId);
      whereClause += ` AND m.sender_id = $${params.length}`;
    } else if (sender === 'helper') {
      const otherId = userId === customer_id ? helper_id : customer_id;
      params.push(otherId);
      whereClause += ` AND m.sender_id = $${params.length}`;
    }

    // Combine count + select into one query using a CTE (Common Table Expression)
    // This avoids two round-trips to the database for the same filtered data
    params.push(limit);
    params.push(offset);
    const result = await pool.query(
      `WITH filtered_messages AS (
         SELECT m.*, u.first_name || ' ' || u.last_name AS sender_name,
                COUNT(*) OVER() AS total
         FROM messages m
         LEFT JOIN users u ON m.sender_id = u.id
         WHERE ${whereClause}
       )
       SELECT * FROM filtered_messages
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const total = result.rows.length > 0 ? parseInt(result.rows[0].total) : 0;

    res.json({
      results: result.rows,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    logger.error('Error searching messages', { err: error.message });
    res.status(500).json({ error: 'Failed to search messages' });
  }
};

// Send a message
const sendMessage = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const rawContent = (req.body.content || '').trim();
    const attachments = normalizeMessageAttachments(req.body.attachments);
    const clientMessageId = req.get('Idempotency-Key')
      || req.body.clientMessageId
      || req.body.client_message_id
      || null;

    if (clientMessageId && !isUuid(clientMessageId)) {
      throw new AppError('Invalid client message id', 400, 'validation_failed', {
        clientMessageId: 'Must be a valid UUID',
      });
    }

    const fields = {};
    if (!rawContent && attachments.length === 0) fields.content = 'Message content or attachment is required';
    if (rawContent.length > 4000) fields.content = 'Message too long (max 4000 characters)';
    if (Object.keys(fields).length > 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    // Sanitize message to prevent XSS (also masks phone numbers in storage)
    const content = sanitizeMessage(rawContent);

    // Off-platform contact deterrence: warn + mask, never block.
    const contactFlags = detectOffPlatformContact(rawContent);
    const warnings = (contactFlags.phone || contactFlags.email || contactFlags.url)
      ? ['off_platform_contact']
      : [];

    // Send message atomically with race condition prevention
    const {
      messagePayload,
      conv,
      replayed,
      repIds = [],
      senderName: resultSenderName,
    } = await withTransaction(pool, async (client) => {
      // Verify user is part of conversation and fetch metadata
      const convResult = await client.query(
        `SELECT c.customer_id, c.helper_id, c.business_id, c.job_id,
                c.status, c.archived_at, b.business_name
         FROM conversations c
         LEFT JOIN businesses b ON b.id = c.business_id AND b.is_active = TRUE
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

      if (convResult.rows.length === 0) {
        throw new AppError('Access denied', 403, 'access_denied');
      }

      const conv = convResult.rows[0];
      if (conv.status === 'archived' || conv.archived_at) {
        throw new AppError('Conversation is archived', 409, 'conversation_archived');
      }

      // Blocked users (either direction, including business reps) cannot
      // send into the shared thread.
      if (await hasConversationBlock(client, conversationId, userId)) {
        throw new AppError('Access denied', 403, 'blocked_by_user');
      }

      // The counterpart's account must still exist and be active.
      const counterpartId = String(userId) === String(conv.customer_id)
        ? conv.helper_id
        : conv.customer_id;
      if (counterpartId) {
        const recipientResult = await client.query(
          'SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NOT NULL',
          [counterpartId]
        );
        if (recipientResult.rows.length > 0) {
          throw new AppError('Recipient is no longer active', 410, 'recipient_inactive');
        }
      }
      const senderName = (conv.business_id && conv.business_name)
        ? conv.business_name
        : `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim();

      // Insert message
      const msgResult = await client.query(
        `INSERT INTO messages (conversation_id, sender_id, content, message_type, attachments, client_message_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (conversation_id, client_message_id)
         WHERE client_message_id IS NOT NULL DO NOTHING
         RETURNING *`,
        [
          conversationId,
          userId,
          content,
          attachments.length > 0 && !content ? 'attachment' : 'text',
          JSON.stringify(attachments),
          clientMessageId,
        ]
      );

      if (!msgResult.rows.length) {
        const replayResult = await client.query(
          `SELECT * FROM messages
           WHERE conversation_id = $1 AND client_message_id = $2`,
          [conversationId, clientMessageId]
        );
        if (!replayResult.rows.length) {
          throw new Error('Failed to create message');
        }
        return { messagePayload: replayResult.rows[0], conv, replayed: true, senderName };
      }

      // Update conversation last_message_at (atomic within transaction)
      await client.query(
        'UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
        [conversationId]
      );

      let repIds = [];
      if (conv.business_id) {
        const repsResult = await client.query(
          `SELECT member_id FROM business_members
             WHERE business_id = $1 AND status = 'active'`,
          [conv.business_id]
        );
        repIds = repsResult.rows.map(row => row.member_id).filter(id => id !== userId);
      }

      const notificationRecipients = new Set();
      const addRecipient = (recipientId) => {
        if (recipientId && String(recipientId) !== String(userId)) notificationRecipients.add(recipientId);
      };
      if (userId === conv.customer_id) addRecipient(conv.helper_id);
      else if (userId === conv.helper_id) addRecipient(conv.customer_id);
      else {
        addRecipient(conv.customer_id);
        addRecipient(conv.helper_id);
      }
      for (const repId of repIds) {
        if (String(repId) !== String(conv.helper_id)) addRecipient(repId);
      }

      await enqueueMessageNotifications({
        dbClient: client,
        messageId: msgResult.rows[0].id,
        conversationId,
        recipientIds: notificationRecipients,
        senderId: userId,
        senderName,
        body: content,
        actionUrl: `/messages/${conversationId}`,
      });

      return {
        messagePayload: msgResult.rows[0],
        conv,
        replayed: false,
        repIds,
        notificationRecipients: [...notificationRecipients],
        senderName,
      };
    }, 'send_message');

    if (!messagePayload) {
      return res.status(500).json({ error: 'Failed to send message' });
    }

    // When messaging in a business-context conversation, the sender appears as the business
    // (applies to the owner AND any active representatives)
    const { business_id, business_name, customer_id, helper_id } = conv;
    const senderName = resultSenderName || ((business_id && business_name)
      ? business_name
      : `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim());
    const fullMessagePayload = { ...messagePayload, sender_name: senderName, warnings };

    // Keep the Business Hub copy durable as well as realtime. Profile-chat
    // creation already uses this bridge, but ordinary customer messages can
    // arrive through this legacy endpoint too.
    if (business_id && String(userId) === String(customer_id)) {
      try {
        const senderResult = await pool.query(
          'SELECT first_name, last_name, email FROM users WHERE id = $1',
          [userId],
        );
        const sender = senderResult.rows[0] || {};
        const displayName = [sender.first_name, sender.last_name].filter(Boolean).join(' ') || sender.email || null;
        const businessConversationId = await ensureBusinessConversation({
          businessId: business_id,
          legacyConversationId: conversationId,
          customerId: userId,
          customerName: displayName,
          customerEmail: sender.email || `${userId}@user.local`,
        });
        if (businessConversationId) {
          await mirrorMessage({
            businessConversationId,
            senderId: userId,
            senderName: displayName,
            senderEmail: sender.email || null,
            senderType: 'customer',
            content,
            messageType: messagePayload.message_type || 'text',
            legacyMessageId: messagePayload.id,
            clientMessageId,
          });
        }
      } catch (mirrorError) {
        logger.warn('business message mirror failed', {
          err: mirrorError && mirrorError.message,
          conversationId,
          businessId: business_id,
        });
      }
    }

    // A retry with the same client ID returns the original message but must
    // not fan out a second socket event or notification.
    if (replayed) {
      return res.status(200).json(fullMessagePayload);
    }

    // Broadcast to the conversation room - both participants see it in real-time
    // if they currently have the thread open.
    // Check if this is a profile chat (job-less conversation) or a regular conversation
    const isProfileChat = !conv.job_id; // Profile chats have no associated job

    // Always broadcast message:new for all conversation types
    socketService.broadcastToConversation(conversationId, 'message:new', {
      conversationId,
      message: fullMessagePayload,
    });

    // Keep the per-business inbox list fresh for owners and representatives,
    // including customer messages sent through the unified conversation API.
    if (business_id) {
      socketService.broadcastToBusinessInbox(business_id, 'business_inbox:message', {
        business_id,
        conversation_id: conversationId,
        message_id: messagePayload.id,
        sender_id: req.user.id,
        sender_name: senderName,
        content: String(messagePayload.content || content).slice(0, 280),
        created_at: messagePayload.created_at || new Date().toISOString(),
      });
    }

    // Additionally, broadcast profile_chat:new_message for profile chats
    // (some clients like HelperConversationPage listen specifically for this event)
    if (isProfileChat) {
      socketService.broadcastToConversation(conversationId, 'profile_chat:new_message', {
        conversationId,
        message: fullMessagePayload,
        senderName: senderName,
      });
    }

    // Notify the appropriate recipient(s) via their personal room so inbox pages
    // update even when they're not currently in the conversation thread.

    if (userId === customer_id) {
      // Customer sent - notify the helper/owner
      socketService.broadcastToUser(helper_id, 'message:new', { conversationId, message: fullMessagePayload });
    } else if (userId === helper_id) {
      // Owner sent - notify the customer
      socketService.broadcastToUser(customer_id, 'message:new', { conversationId, message: fullMessagePayload });
    } else {
      // Rep sent - notify the customer; also ping the owner so they see it in their inbox
      socketService.broadcastToUser(customer_id, 'message:new', { conversationId, message: fullMessagePayload });
      socketService.broadcastToUser(helper_id, 'message:new', { conversationId, message: fullMessagePayload });
    }

    // Notify all other active reps so their inbox refreshes in real time
    for (const repId of repIds) {
      if (repId !== helper_id) { // owner already notified above
        socketService.broadcastToUser(repId, 'message:new', { conversationId, message: fullMessagePayload });
      }
    }

    res.status(201).json(fullMessagePayload);
  } catch (error) {
    next(error);
  }
};

// Delete a message (only the sender can delete)
const deleteMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId, messageId } = req.params;

    // Verify message exists and user is the sender
    const msgResult = await pool.query(
      `SELECT m.id, m.sender_id, m.conversation_id, m.deleted_at
       FROM messages m
       WHERE m.id = $1 AND m.conversation_id = $2`,
      [messageId, conversationId]
    );

    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const message = msgResult.rows[0];
    if (message.sender_id !== userId) {
      return res.status(403).json({ error: 'You can only delete your own messages' });
    }

    if (message.deleted_at) {
      return res.status(400).json({ error: 'Message is already deleted' });
    }

    // A blocked user cannot modify old messages in the shared thread
    if (await hasConversationBlock(pool, conversationId, userId)) {
      return res.status(403).json({ error: 'Access denied', code: 'blocked_by_user' });
    }

    // Soft delete the message (set deleted_at timestamp) - safeguard sender_id
    const delResult = await pool.query(
      'UPDATE messages SET deleted_at = NOW() WHERE id = $1 AND sender_id = $2 RETURNING id',
      [messageId, userId]
    );

    if (delResult.rows.length === 0) {
      return res.status(403).json({ error: 'Message ownership changed during deletion' });
    }

    // Broadcast delete event to the conversation room
    socketService.broadcastToConversation(conversationId, 'message:deleted', {
      conversationId,
      messageId,
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting message', { err: error.message });
    res.status(500).json({ error: 'Failed to delete message' });
  }
};

// Edit a message (only the sender can edit)
const editMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId, messageId } = req.params;
    const rawContent = (req.body.content || '').trim();

    if (!rawContent) return res.status(400).json({ error: 'Message content is required' });
    if (rawContent.length > 4000) return res.status(400).json({ error: 'Message too long (max 4000 chars)' });

    // Sanitize message content to prevent XSS
    const content = sanitizeMessage(rawContent);

    // Verify message exists and user is the sender
    const msgResult = await pool.query(
      `SELECT m.id, m.sender_id, m.conversation_id, m.deleted_at, m.created_at
       FROM messages m
       WHERE m.id = $1 AND m.conversation_id = $2`,
      [messageId, conversationId]
    );

    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const message = msgResult.rows[0];
    if (message.sender_id !== userId) {
      return res.status(403).json({ error: 'You can only edit your own messages' });
    }

    if (message.deleted_at) {
      return res.status(400).json({ error: 'Cannot edit a deleted message' });
    }

    // 15-minute edit window, enforced server-side
    const createdAtMs = new Date(message.created_at).getTime();
    if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > MESSAGE_EDIT_WINDOW_MS) {
      return res.status(410).json({ error: 'Edit window has expired', code: 'edit_window_expired' });
    }

    // A blocked user cannot modify old messages in the shared thread
    if (await hasConversationBlock(pool, conversationId, userId)) {
      return res.status(403).json({ error: 'Access denied', code: 'blocked_by_user' });
    }

    // Update the message with edited_at timestamp - safeguard sender_id
    const result = await pool.query(
      `UPDATE messages SET content = $1, edited_at = NOW() WHERE id = $2 AND sender_id = $3 AND deleted_at IS NULL RETURNING *`,
      [content, messageId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Cannot edit this message' });
    }

    const updatedMessage = result.rows[0];

    // Broadcast edit event to the conversation room
    socketService.broadcastToConversation(conversationId, 'message:updated', {
      conversationId,
      message: updatedMessage,
    });

    res.json(updatedMessage);
  } catch (error) {
    logger.error('Error editing message', { err: error.message });
    res.status(500).json({ error: 'Failed to edit message' });
  }
};

// Add a reaction to a message
const addReaction = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId, messageId } = req.params;
    const { reaction } = req.body;

    // Validate reaction type
    const validReactions = ['thumbs_up', 'heart', 'laugh', 'sad', 'angry', 'wow'];
    if (!reaction || !validReactions.includes(reaction)) {
      return res.status(400).json({ error: 'Invalid reaction type' });
    }

    // Verify user is part of conversation
    const conv = await pool.query(
      `SELECT c.customer_id, c.helper_id, c.business_id FROM conversations c
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
    if (conv.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

    // A blocked user cannot react in the shared thread
    if (await hasConversationBlock(pool, conversationId, userId)) {
      return res.status(403).json({ error: 'Access denied', code: 'blocked_by_user' });
    }

    // Verify message exists and belongs to this conversation
    const msg = await pool.query(
      `SELECT id FROM messages WHERE id = $1 AND conversation_id = $2 AND deleted_at IS NULL`,
      [messageId, conversationId]
    );
    if (msg.rows.length === 0) return res.status(404).json({ error: 'Message not found' });

    // Insert or ignore if reaction already exists (upsert behavior)
    const result = await pool.query(
      `INSERT INTO message_reactions (message_id, user_id, reaction)
       VALUES ($1, $2, $3)
       ON CONFLICT (message_id, user_id, reaction) DO NOTHING
       RETURNING *`,
      [messageId, userId, reaction]
    );

    // Fetch all reactions for this message to broadcast the updated state
    const reactionsResult = await pool.query(
      `SELECT reaction, COUNT(*) as count, array_agg(user_id) as users
       FROM message_reactions
       WHERE message_id = $1
       GROUP BY reaction`,
      [messageId]
    );

    // Broadcast reaction update to all participants in the conversation
    socketService.broadcastToConversation(conversationId, 'message:reaction', {
      conversationId,
      messageId,
      reaction,
      userId,
      allReactions: reactionsResult.rows,
    });

    res.status(201).json({ reaction, allReactions: reactionsResult.rows });
  } catch (error) {
    logger.error('Error adding reaction', { err: error.message });
    res.status(500).json({ error: 'Failed to add reaction' });
  }
};

// Remove a reaction from a message
const removeReaction = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId, messageId } = req.params;
    const { reaction } = req.body;

    // Validate reaction type
    const validReactions = ['thumbs_up', 'heart', 'laugh', 'sad', 'angry', 'wow'];
    if (!reaction || !validReactions.includes(reaction)) {
      return res.status(400).json({ error: 'Invalid reaction type' });
    }

    // Verify user is part of conversation
    const conv = await pool.query(
      `SELECT c.customer_id, c.helper_id, c.business_id FROM conversations c
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
    if (conv.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

    // A blocked user cannot modify old messages in the shared thread
    if (await hasConversationBlock(pool, conversationId, userId)) {
      return res.status(403).json({ error: 'Access denied', code: 'blocked_by_user' });
    }

    // Remove the reaction
    const deleteResult = await pool.query(
      `DELETE FROM message_reactions
       WHERE message_id = $1 AND user_id = $2 AND reaction = $3
       RETURNING *`,
      [messageId, userId, reaction]
    );

    if (deleteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Reaction not found' });
    }

    // Fetch updated reactions for this message
    const reactionsResult = await pool.query(
      `SELECT reaction, COUNT(*) as count, array_agg(user_id) as users
       FROM message_reactions
       WHERE message_id = $1
       GROUP BY reaction`,
      [messageId]
    );

    // Broadcast reaction update
    socketService.broadcastToConversation(conversationId, 'message:reaction_removed', {
      conversationId,
      messageId,
      reaction,
      userId,
      allReactions: reactionsResult.rows,
    });

    res.json({ reaction, allReactions: reactionsResult.rows });
  } catch (error) {
    logger.error('Error removing reaction', { err: error.message });
    res.status(500).json({ error: 'Failed to remove reaction' });
  }
};

// Archive a conversation
const archiveConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const { reason } = req.body;

    // Verify user is part of conversation
    const conv = await pool.query(
      `SELECT c.customer_id, c.helper_id, c.business_id FROM conversations c
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
    if (conv.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

    const result = await withTransaction(pool, async (client) => {
      const archived = await client.query(
        `UPDATE conversations
         SET status = 'archived', archived_at = NOW(), archived_by = $2
         WHERE id = $1 AND archived_at IS NULL AND status <> 'blocked'
         RETURNING *`,
        [conversationId, userId]
      );

      if (archived.rows.length === 0) {
        return null;
      }

      await client.query(
        `INSERT INTO conversation_archive_log (conversation_id, user_id, action, reason)
         VALUES ($1, $2, 'archived', $3)`,
        [conversationId, userId, reason || null]
      );
      await client.query(
        `UPDATE business_conversations
            SET status = 'archived', updated_at = NOW()
          WHERE legacy_conversation_id = $1`,
        [conversationId],
      );
      return archived.rows[0];
    }, 'archive_conversation');

    if (!result) return res.status(400).json({ error: 'Conversation is already archived' });

    socketService.broadcastToConversation(conversationId, 'conversation:archive_updated', {
      conversationId,
      status: 'archived',
      archivedAt: result.archived_at,
    });

    res.json(result);
  } catch (error) {
    logger.error('Error archiving conversation', { err: error.message });
    res.status(500).json({ error: 'Failed to archive conversation' });
  }
};

// Restore an archived conversation
const restoreConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;

    // Verify user is part of conversation
    const conv = await pool.query(
      `SELECT c.customer_id, c.helper_id, c.business_id FROM conversations c
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
    if (conv.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

    const result = await withTransaction(pool, async (client) => {
      const restored = await client.query(
        `UPDATE conversations
         SET status = 'active', archived_at = NULL, archived_by = NULL
         WHERE id = $1 AND status <> 'blocked'
           AND (archived_at IS NOT NULL OR status = 'archived')
         RETURNING *`,
        [conversationId]
      );

      if (restored.rows.length === 0) {
        return null;
      }

      await client.query(
        `INSERT INTO conversation_archive_log (conversation_id, user_id, action)
         VALUES ($1, $2, 'restored')`,
        [conversationId, userId]
      );
      await client.query(
        `UPDATE business_conversations
            SET status = 'active', updated_at = NOW()
          WHERE legacy_conversation_id = $1 AND status = 'archived'`,
        [conversationId],
      );
      return restored.rows[0];
    }, 'restore_conversation');

    if (!result) return res.status(400).json({ error: 'Conversation is not archived' });

    socketService.broadcastToConversation(conversationId, 'conversation:archive_updated', {
      conversationId,
      status: 'active',
      archivedAt: null,
    });

    res.json(result);
  } catch (error) {
    logger.error('Error restoring conversation', { err: error.message });
    res.status(500).json({ error: 'Failed to restore conversation' });
  }
};

// Get archived conversations for the current user
const getArchivedConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const requestedOffset = Number.parseInt(req.query.offset, 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
    const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;

    const result = await pool.query(
      `SELECT c.id, c.job_id, c.customer_id, c.helper_id, c.business_id, c.status,
              c.archived_at, c.last_message_at,
              CASE
                WHEN c.customer_id = $1 THEN h.first_name || ' ' || h.last_name
                WHEN c.helper_id   = $1 THEN cu.first_name || ' ' || cu.last_name
                ELSE cu.first_name || ' ' || cu.last_name
              END AS other_user_name,
              j.title AS job_title
       FROM conversations c
       LEFT JOIN users h  ON c.helper_id   = h.id
       LEFT JOIN users cu ON c.customer_id = cu.id
       LEFT JOIN jobs j   ON c.job_id      = j.id
       WHERE (
           c.customer_id = $1
           OR c.helper_id = $1
           OR (c.business_id IS NOT NULL AND EXISTS(
             SELECT 1 FROM business_members bm
             WHERE bm.business_id = c.business_id AND bm.member_id = $1 AND bm.status = 'active'
           ))
         )
         AND (c.archived_at IS NOT NULL OR c.status = 'archived')
       ORDER BY c.archived_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM conversations
       WHERE (
           customer_id = $1
           OR helper_id = $1
           OR (business_id IS NOT NULL AND EXISTS(
             SELECT 1 FROM business_members bm
             WHERE bm.business_id = conversations.business_id AND bm.member_id = $1 AND bm.status = 'active'
           ))
         )
         AND (archived_at IS NOT NULL OR status = 'archived')`,
      [userId]
    );

    res.json({
      archived: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
      hasMore: offset + limit < parseInt(countResult.rows[0].count),
    });
  } catch (error) {
    logger.error('Error fetching archived conversations', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch archived conversations' });
  }
};

// Get all reactions for a message
const getMessageReactions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId, messageId } = req.params;

    // Verify user is part of conversation
    const conv = await pool.query(
      `SELECT c.customer_id, c.helper_id, c.business_id FROM conversations c
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
    if (conv.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

    // Fetch all reactions and details
    const result = await pool.query(
      `SELECT
         mr.reaction,
         COUNT(*) as count,
         array_agg(json_build_object('user_id', u.id, 'name', u.first_name || ' ' || u.last_name))
           FILTER (WHERE u.id IS NOT NULL) as users,
         BOOL_OR(mr.user_id = $2) as user_reacted
       FROM message_reactions mr
       LEFT JOIN users u ON mr.user_id = u.id
       WHERE mr.message_id = $1
       GROUP BY mr.reaction`,
      [messageId, userId]
    );

    res.json(result.rows);
  } catch (error) {
    logger.error('Error fetching reactions', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch reactions' });
  }
};


/**
 * Confirm helper/owner or active business rep may access a guest inquiry session.
 */
async function assertGuestInquiryAccess(userId, inquiryId) {
  const rowRes = await pool.query(
    `SELECT g.id, g.helper_id, g.business_id, g.guest_name, g.guest_email, g.message, g.created_at,
            g.guest_verified_at, g.session_status,
            cb.business_name AS conversation_business_name
     FROM guest_profile_chat_inbound g
     LEFT JOIN businesses cb ON cb.id = g.business_id AND cb.is_active = TRUE
     WHERE g.id = $1`,
    [inquiryId]
  );
  const r = rowRes.rows[0];
  if (!r) {
    const err = new Error('Not found');
    err.status = 404;
    throw err;
  }
  let allowed = String(r.helper_id) === String(userId);
  if (!allowed && r.business_id != null) {
    const rep = await pool.query(
      `SELECT 1 FROM business_members bm
       WHERE bm.business_id = $1 AND bm.member_id = $2 AND bm.status = 'active'`,
      [r.business_id, userId]
    );
    allowed = rep.rows.length > 0;
  }
  if (!allowed) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  return r;
}

async function markGuestInquiryReadCursor(inquiryId, readerId) {
  await pool.query(
    `INSERT INTO guest_profile_chat_read_cursors
       (session_id, reader_id, last_read_message_id, last_read_at)
     SELECT g.id, $2,
            COALESCE((
              SELECT MAX(gm.id)
                FROM guest_profile_chat_messages gm
               WHERE gm.session_id = g.id AND gm.sender_type = 'guest'
            ), 0),
            NOW()
       FROM guest_profile_chat_inbound g
      WHERE g.id = $1
     ON CONFLICT (session_id, reader_id) DO UPDATE
       SET last_read_message_id = GREATEST(
             guest_profile_chat_read_cursors.last_read_message_id,
             EXCLUDED.last_read_message_id
           ),
           last_read_at = EXCLUDED.last_read_at`,
    [inquiryId, readerId],
  );
  try {
    socketService.broadcastToUser(readerId, 'messages:read', {
      conversationId: `guest-${inquiryId}`,
      readBy: readerId,
      readAt: new Date().toISOString(),
    });
  } catch (socketError) {
    logger.warn('Failed to broadcast guest inquiry read state', {
      inquiryId,
      error: socketError.message,
    });
  }
}
/**
 * GET /api/messages/guest-inquiries/:id/messages
 * Thread history for a verified (or leave-message) guest profile session.
 */
const getGuestInquiryMessages = async (req, res) => {
  try {
    const userId = req.user.id;
    const inquiryId = String(req.params.id || '').replace(/^guest-/i, '');
    if (!inquiryId) return res.status(400).json({ error: 'Invalid inquiry id' });

    await assertGuestInquiryAccess(userId, inquiryId);
    await markGuestInquiryReadCursor(inquiryId, userId);

    const { rows } = await pool.query(
      `SELECT id, session_id, sender_type, sender_name, message, created_at
       FROM guest_profile_chat_messages
       WHERE session_id = $1
       ORDER BY created_at ASC
       LIMIT 500`,
      [inquiryId]
    );

    // Seed with original inbound message when the messages table is empty
    if (!rows.length) {
      const seed = await pool.query(
        `SELECT id, guest_name, message, created_at FROM guest_profile_chat_inbound WHERE id = $1`,
        [inquiryId]
      );
      const s = seed.rows[0];
      if (s?.message) {
        return res.json([
          {
            id: `inbound-${s.id}`,
            session_id: inquiryId,
            sender_type: 'guest',
            sender_name: s.guest_name,
            message: s.message,
            content: s.message,
            created_at: s.created_at,
          },
        ]);
      }
    }

    res.json(
      rows.map((m) => ({
        id: m.id,
        session_id: m.session_id,
        sender_type: m.sender_type,
        sender_name: m.sender_name,
        message: m.message,
        content: m.message,
        created_at: m.created_at,
      }))
    );
  } catch (error) {
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    if (error.status === 403) return res.status(403).json({ error: 'Forbidden' });
    logger.error('Error fetching guest inquiry messages', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch guest inquiry messages' });
  }
};

/** Mark guest messages read when the provider is actively viewing the thread. */
const markGuestInquiryRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const inquiryId = String(req.params.id || '').replace(/^guest-/i, '');
    if (!inquiryId) return res.status(400).json({ error: 'Invalid inquiry id' });
    await assertGuestInquiryAccess(userId, inquiryId);
    await markGuestInquiryReadCursor(inquiryId, userId);
    return res.json({ success: true });
  } catch (error) {
    if (error.status === 404 || error.status === 403) {
      return res.status(error.status).json({ error: error.message });
    }
    logger.error('Error marking guest inquiry read', { err: error.message });
    return res.status(500).json({ error: 'Failed to mark guest inquiry as read' });
  }
};
/**
 * POST /api/messages/guest-inquiries/:id/messages
 * Helper/business reply into a guest live thread; emits to guest_session_* room.
 */
const replyGuestInquiryMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const inquiryId = String(req.params.id || '').replace(/^guest-/i, '');
    const message = String(req.body?.message || req.body?.content || '').trim();
    const clientMessageId = req.body?.clientMessageId
      || req.body?.client_message_id
      || req.get?.('Idempotency-Key')
      || null;
    if (!inquiryId) return res.status(400).json({ error: 'Invalid inquiry id' });
    if (!message) return res.status(400).json({ error: 'Message is required' });
    if (message.length > 4000) return res.status(400).json({ error: 'Message too long (max 4000 characters)' });
    if (clientMessageId && !isUuid(clientMessageId)) {
      return res.status(400).json({ error: 'clientMessageId must be a valid UUID', code: 'validation_failed' });
    }

    const session = await assertGuestInquiryAccess(userId, inquiryId);

    const senderName =
      String(req.user.first_name || '').trim() ||
      String(req.user.email || '').split('@')[0] ||
      'Helper';

    const { rows } = await pool.query(
      `INSERT INTO guest_profile_chat_messages
         (session_id, sender_type, sender_name, message, created_at, client_message_id)
       VALUES ($1, 'helper', $2, $3, CURRENT_TIMESTAMP, $4)
       ON CONFLICT (session_id, client_message_id)
       WHERE client_message_id IS NOT NULL
       DO NOTHING
       RETURNING id, session_id, sender_type, sender_name, message, created_at`,
      [inquiryId, senderName, message, clientMessageId]
    );
    let msg = rows[0];
    const replayed = !msg && Boolean(clientMessageId);
    if (replayed) {
      const existing = await pool.query(
        `SELECT id, session_id, sender_type, sender_name, message, created_at
         FROM guest_profile_chat_messages
         WHERE session_id = $1 AND client_message_id = $2
         LIMIT 1`,
        [inquiryId, clientMessageId]
      );
      msg = existing.rows[0];
      if (!msg) return res.status(409).json({ error: 'Message retry could not be resolved', code: 'idempotency_conflict' });
    }

    if (!replayed) {
      await pool.query(
        `UPDATE guest_profile_chat_inbound
         SET last_helper_message_at = CURRENT_TIMESTAMP,
             helper_messages_count = COALESCE(helper_messages_count, 0) + 1,
             last_activity_at = CURRENT_TIMESTAMP,
             session_status = CASE
               WHEN session_status IN (
                 'waiting_for_helper',
                 'ai_fallback_pending',
                 'ai_support_active',
                 'helper_takeover_requested'
               ) THEN 'helper_assigned'
               ELSE session_status
             END
         WHERE id = $1`,
        [inquiryId]
      ).catch(async () => {
        await pool.query(
          `UPDATE guest_profile_chat_inbound
           SET last_activity_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [inquiryId]
        ).catch(() => {});
      });
    }

    const createdAt = msg.created_at instanceof Date ? msg.created_at.toISOString() : msg.created_at;
    if (!replayed) {
      broadcastGuestChatMessage(inquiryId, {
        messageId: msg.id,
        senderType: 'helper',
        senderName,
        message,
        createdAt,
      });
    }

    // Also nudge the helper's own sockets (inbox badge / open thread refresh)
    if (!replayed) {
      try {
        socketService.broadcastToUser(session.helper_id, 'profile_chat:new_message', {
          guestInquiry: true,
          guestInquiryId: inquiryId,
          guestSessionId: inquiryId,
          message: {
            id: msg.id,
            content: message,
            sender_type: 'helper',
            sender_name: senderName,
            created_at: createdAt,
          },
          senderName,
        });
      } catch { /* ignore */ }
    }

    res.status(replayed ? 200 : 201).json({
      id: msg.id,
      session_id: inquiryId,
      sender_type: 'helper',
      sender_name: senderName,
      message,
      content: message,
      created_at: createdAt,
      idempotent: replayed,
    });
  } catch (error) {
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    if (error.status === 403) return res.status(403).json({ error: 'Forbidden' });
    logger.error('Error replying to guest inquiry', { err: error.message });
    res.status(500).json({ error: 'Failed to send guest reply' });
  }
};

module.exports = {
  getConversations,
  getGuestInquiries,
  getGuestInquiryById,
  getGuestInquiryMessages,
  markGuestInquiryRead,
  replyGuestInquiryMessage,
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
};

/**
 * POST /api/messages/conversations/:conversationId/attachments
 * Upload a file attachment for a conversation message.
 * Returns { url, key, name, size, mimeType } for the frontend to send as a message.
 * Every stored attachment uses a short-lived private download URL.
 */
async function uploadAttachment(req, res) {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;

    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    // Verify the user is a participant of this conversation
    const conv = await pool.query(
      `SELECT c.customer_id, c.helper_id, c.business_id
       FROM conversations c
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
    if (conv.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

    const { buffer, originalname, mimetype, size } = req.file;
    const key = await uploadFile(buffer, 'chat-attachments', originalname, mimetype);

    if (!key) {
      // S3 not configured - return a base64 data-URL fallback (dev only)
      const b64 = buffer.toString('base64');
      return res.json({
        url:      `data:${mimetype};base64,${b64}`,
        key:      null,
        name:     originalname,
        size,
        mimeType: mimetype,
      });
    }

    const url = await getSignedDownloadUrl(key, 3600);

    return res.json({ url, key, name: originalname, size, mimeType: mimetype });
  } catch (err) {
    logger.error('uploadAttachment error', { err: err.message });
    return res.status(500).json({ error: 'Upload failed' });
  }
}
