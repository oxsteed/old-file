// Support Conversations Controller
// Manages support tickets: creation, assignment, status updates, resolution

const { query } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');
const supportEmployerService = require('../services/supportEmployerService');
const WebSocketService = require('../services/websocketService');
const { logAdminAction } = require('../services/auditService');
const { sendEmail, EMAIL_ADDRESSES } = require('../utils/email');
const escapeHtml = require('../utils/escapeHtml');
const { uploadFile, getSignedDownloadUrl } = require('../utils/storage');

function normalizeAttachmentReference(attachmentUrl, attachmentName) {
  const rawUrl = String(attachmentUrl ?? '').trim();
  const rawName = String(attachmentName ?? '').trim();
  if (!rawUrl) return { url: null, name: rawName.slice(0, 255) || null };
  if (rawUrl.length > 2048) return { error: 'Attachment URL is too long' };

  if (rawUrl.startsWith('/api/storage/')) {
    return { url: rawUrl, name: rawName.slice(0, 255) || null };
  }

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return { error: 'Attachment URL must use HTTPS' };
    return { url: parsed.toString(), name: rawName.slice(0, 255) || null };
  } catch {
    return { error: 'Attachment URL must be a valid HTTPS URL' };
  }
}

// Create a new support conversation/ticket
async function createConversation(req, res) {
  try {
    const { businessId, subject, description, category, priority } = req.body;

    if (!businessId || !subject || String(subject).trim().length > 200 || String(description || '').length > 5000) {
      return sendValidationError(res, {
        businessId: 'Required',
        subject: 'Required and must be 200 characters or fewer',
        description: 'Must be 5000 characters or fewer',
      });
    }

    const validCategories = ['billing', 'technical', 'sales', 'account', 'general'];
    if (category && !validCategories.includes(category)) {
      return sendValidationError(res, { category: 'Invalid category' });
    }

    const validPriorities = ['low', 'normal', 'high', 'urgent'];
    if (priority && !validPriorities.includes(priority)) {
      return sendValidationError(res, { priority: 'Invalid priority' });
    }

    // Get SLA targets for this priority
    const slaResult = await query(
      `SELECT first_response_target_minutes, resolution_target_hours
       FROM support_sla_targets
       WHERE business_id = $1 AND priority = $2`,
      [businessId, priority || 'normal']
    );

    let slaFirstResponseTarget = null;
    let slaResolutionTarget = null;

    if (slaResult.rows.length) {
      const sla = slaResult.rows[0];
      const now = new Date();
      slaFirstResponseTarget = new Date(now.getTime() + sla.first_response_target_minutes * 60000);
      slaResolutionTarget = new Date(now.getTime() + sla.resolution_target_hours * 3600000);
    }

    // Create conversation
    const result = await query(
      `INSERT INTO support_conversations
       (business_id, customer_id, subject, description, category, priority,
        status, sla_first_response_target, sla_resolution_target)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8)
       RETURNING *`,
      [
        businessId,
        req.user.id,
        subject,
        description || null,
        category || 'general',
        priority || 'normal',
        slaFirstResponseTarget,
        slaResolutionTarget
      ]
    );

    const conversation = result.rows[0];

    // Add to queue
    await query(
      `INSERT INTO support_queue
       (business_id, conversation_id, priority, status)
       VALUES ($1, $2, $3, 'waiting')`,
      [businessId, conversation.id, priority || 'normal']
    );

    logger.info('Support conversation created', {
      conversationId: conversation.id,
      customerId: req.user.id
    });

    res.json({ success: true, data: conversation, ticketId: conversation.id, conversation });
  } catch (err) {
    logger.error('createConversation error', { error: err.message });
    sendError(res, 500, 'Failed to create conversation');
  }
}

// Get conversations for a business
async function listConversations(req, res) {
  try {
    const { businessId } = req.params;
    const { status, priority, agentId } = req.query;
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);

    const can = await supportEmployerService.userCanAccessBusinessConversations(
      businessId,
      req.user.id,
      req.user.role
    );
    if (!can) return sendError(res, 403, 'Access denied');

    let sql = `
      SELECT
        sc.id, sc.business_id, sc.customer_id,
        COALESCE(
          NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
          u.email, sc.guest_name
        ) as customer_name,
        u.email as customer_email,
        sc.subject, sc.description, sc.category, sc.priority,
        sc.status, sc.agent_id, sa.user_id as agent_user_id,
        COALESCE(
          NULLIF(BTRIM(CONCAT_WS(' ', au.first_name, au.last_name)), ''),
          au.email
        ) as agent_name,
        sc.message_count, sc.customer_message_count, sc.agent_message_count,
        sc.created_at, sc.updated_at, sc.resolved_at,
        sc.sla_first_response_breached, sc.sla_resolution_breached,
        (
          SELECT COUNT(*)::int
          FROM support_conversation_messages unread_scm
          WHERE unread_scm.conversation_id = sc.id
            AND unread_scm.is_agent = FALSE
            AND COALESCE(unread_scm.message_type, 'text') <> 'internal_note'
            AND unread_scm.read_by_recipient = FALSE
        ) AS unread_count
      FROM support_conversations sc
      LEFT JOIN users u ON sc.customer_id = u.id
      LEFT JOIN support_agents sa ON sc.agent_id = sa.id
      LEFT JOIN users au ON sa.user_id = au.id
      WHERE sc.business_id = $1
    `;

    const params = [businessId];

    if (status) {
      sql += ` AND sc.status = $${params.length + 1}`;
      params.push(status);
    }
    if (priority) {
      sql += ` AND sc.priority = $${params.length + 1}`;
      params.push(priority);
    }
    if (agentId) {
      sql += ` AND sc.agent_id = $${params.length + 1}`;
      params.push(agentId);
    }

    sql += ` ORDER BY sc.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await query(sql, params);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('listConversations error', { error: err.message });
    sendError(res, 500, 'Failed to list conversations');
  }
}

// Get single conversation details
async function getConversation(req, res) {
  try {
    const { conversationId } = req.params;

    const result = await query(
      `SELECT
        sc.*,
        (
          SELECT jsonb_build_object(
            'id', scr.id,
            'rating', scr.rating,
            'comment', scr.comment,
            'created_at', scr.created_at,
            'updated_at', scr.updated_at
          )
          FROM support_conversation_reviews scr
          WHERE scr.conversation_id = sc.id
        ) AS review,
        COALESCE(
          NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
          u.email, sc.guest_name
        ) as customer_name,
        COALESCE(u.email, sc.guest_email) as customer_email,
        sa.id as agent_id,
        sa.user_id as agent_user_id,
        COALESCE(
          NULLIF(BTRIM(CONCAT_WS(' ', au.first_name, au.last_name)), ''),
          au.email
        ) as agent_name
      FROM support_conversations sc
      LEFT JOIN users u ON sc.customer_id = u.id
      LEFT JOIN support_agents sa ON sc.agent_id = sa.id
      LEFT JOIN users au ON sa.user_id = au.id
      WHERE sc.id = $1`,
      [conversationId]
    );

    if (!result.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = result.rows[0];

    const isCustomer = req.user.id === conversation.customer_id;
    const isPlatformAdmin = supportEmployerService.isPlatformAdmin(req.user.role);
    let isAssignedAgent = false;
    if (!isCustomer && conversation.agent_id) {
      const ag = await query('SELECT user_id FROM support_agents WHERE id = $1', [conversation.agent_id]);
      isAssignedAgent = ag.rows.length && ag.rows[0].user_id === req.user.id;
    }
    let canBiz = false;
    if (!isCustomer && !isAssignedAgent && !isPlatformAdmin) {
      canBiz = await supportEmployerService.userCanAccessBusinessConversations(
        conversation.business_id,
        req.user.id,
        req.user.role
      );
    }
    if (!isCustomer && !canBiz && !isAssignedAgent && !isPlatformAdmin) {
      return sendError(res, 403, 'Access denied');
    }

    // Get messages
    const messages = await query(
      `SELECT
        scm.id, scm.conversation_id, scm.sender_id, scm.message_type, scm.content,
        scm.attachment_url, scm.attachment_name,
        scm.is_agent, scm.is_ai, scm.status, scm.read_at, scm.edited_at, scm.edit_count, scm.created_at,
        COALESCE(
          NULLIF(BTRIM(CONCAT_WS(' ', sender.first_name, sender.last_name)), ''),
          sender.email
        ) AS sender_name
      FROM support_conversation_messages scm
      LEFT JOIN users sender ON sender.id = scm.sender_id
      WHERE scm.conversation_id = $1
        AND ($2::boolean = FALSE OR scm.message_type <> 'internal_note')
      ORDER BY scm.created_at ASC`,
      [conversationId, isCustomer]
    );

    let customerHistory = null;
    const customerEmail = String(conversation.customer_email || '').trim().toLowerCase();
    if (!isCustomer && customerEmail) {
      const historyParams = [conversationId, customerEmail];
      // Business IDs are UUIDs in the support schema. Keep the parameter
      // uncast so business-scoped agents can load verified customer history.
      const historyScope = isPlatformAdmin ? '' : ' AND sc.business_id = $3';
      if (!isPlatformAdmin) historyParams.push(conversation.business_id);

      const historyResult = await query(
        `SELECT
           sc.id, sc.business_id, sc.subject, sc.status, sc.priority,
           sc.message_count, sc.customer_message_count, sc.agent_message_count,
           sc.created_at, sc.updated_at, sc.resolved_at,
           COALESCE(
             NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
             u.email, sc.guest_name, 'Customer'
           ) AS customer_name,
           COALESCE(u.email, sc.guest_email) AS customer_email
         FROM support_conversations sc
         LEFT JOIN users u ON u.id = sc.customer_id
         WHERE sc.id <> $1
           AND LOWER(BTRIM(COALESCE(u.email, sc.guest_email))) = $2
           AND (sc.customer_id IS NOT NULL OR sc.guest_verified_at IS NOT NULL)
           ${historyScope}
         ORDER BY sc.created_at DESC
         LIMIT 25`,
        historyParams
      );

      const historyRows = historyResult.rows || [];
      const historyIds = historyRows.map((row) => row.id);
      let historyMessages = [];
      if (historyIds.length) {
        const historyMessagesResult = await query(
          `SELECT
             scm.id, scm.conversation_id, scm.sender_id, scm.message_type, scm.content,
             scm.attachment_url, scm.attachment_name,
             scm.is_agent, scm.is_ai, scm.status, scm.read_at, scm.edited_at, scm.edit_count, scm.created_at,
             COALESCE(
               NULLIF(BTRIM(CONCAT_WS(' ', sender.first_name, sender.last_name)), ''),
               sender.email
             ) AS sender_name
           FROM support_conversation_messages scm
           LEFT JOIN users sender ON sender.id = scm.sender_id
           WHERE scm.conversation_id = ANY($1::uuid[])
           ORDER BY scm.created_at ASC
           LIMIT 500`,
          [historyIds]
        );
        historyMessages = historyMessagesResult.rows || [];
      }

      const messagesByConversation = new Map();
      historyMessages.forEach((message) => {
        const existing = messagesByConversation.get(message.conversation_id) || [];
        existing.push(message);
        messagesByConversation.set(message.conversation_id, existing);
      });

      customerHistory = {
        email: conversation.customer_email,
        previousConversationCount: historyRows.length,
        conversations: historyRows.map((history) => ({
          ...history,
          messages: messagesByConversation.get(history.id) || [],
        })),
      };
    }

    res.json({
      success: true,
      data: {
        ...conversation,
        messages: messages.rows,
        ...(customerHistory ? { customerHistory } : {}),
      }
    });
  } catch (err) {
    logger.error('getConversation error', { error: err.message });
    sendError(res, 500, 'Failed to get conversation');
  }
}

async function authorizeConversationAccess(conversationId, req) {
  const result = await query(
    `SELECT sc.*,
            COALESCE(u.email, sc.guest_email) AS customer_email,
            COALESCE(
              NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
              u.email, sc.guest_name, 'Customer'
            ) AS customer_name
     FROM support_conversations sc
     LEFT JOIN users u ON u.id = sc.customer_id
     WHERE sc.id = $1`,
    [conversationId]
  );
  if (!result.rows.length) return { conversation: null, allowed: false };

  const conversation = result.rows[0];
  const isCustomer = req.user?.id === conversation.customer_id;
  const isPlatformAdmin = supportEmployerService.isPlatformAdmin(req.user?.role);
  let isAssignedAgent = false;
  if (conversation.agent_id) {
    const agent = await query('SELECT user_id FROM support_agents WHERE id = $1', [conversation.agent_id]);
    isAssignedAgent = agent.rows[0]?.user_id === req.user?.id;
  }
  let canManageBusiness = false;
  if (!isCustomer && !isAssignedAgent && !isPlatformAdmin && conversation.business_id != null) {
    canManageBusiness = await supportEmployerService.userCanAccessBusinessConversations(
      conversation.business_id,
      req.user.id,
      req.user.role
    );
  }

  return {
    conversation,
    isCustomer,
    isPlatformAdmin,
    isAssignedAgent,
    allowed: isCustomer || isPlatformAdmin || isAssignedAgent || canManageBusiness,
  };
}

async function updateCustomerMessage(req, res) {
  const conversationId = req.params.conversationId;
  const messageId = req.params.messageId;
  const content = String(req.body?.content ?? req.body?.message ?? '').trim();
  if (!content || content.length > 5000) {
    return sendValidationError(res, { content: 'Message is required and must be 5000 characters or fewer' });
  }

  try {
    const access = await authorizeConversationAccess(conversationId, req);
    if (!access.conversation) return sendError(res, 404, 'Conversation not found');
    if (!access.isCustomer) return sendError(res, 403, 'Only the customer can edit this message');
    if (['resolved', 'closed'].includes(access.conversation.status)) {
      return sendError(res, 409, 'Closed conversations cannot be edited');
    }

    const result = await query(
      `UPDATE support_conversation_messages
       SET original_content = COALESCE(original_content, content),
           content = $1,
           edited_at = NOW(),
           edit_count = edit_count + 1,
           updated_at = NOW()
       WHERE id = $2
         AND conversation_id = $3
         AND sender_id = $4
         AND is_agent = FALSE
         AND message_type <> 'internal_note'
         AND created_at > NOW() - INTERVAL '15 minutes'
       RETURNING id, content, attachment_url, attachment_name, message_type,
                 is_agent, edited_at, edit_count, created_at`,
      [content, messageId, conversationId, req.user.id]
    );
    if (!result.rows.length) return sendError(res, 409, 'This message is no longer editable');

    const message = result.rows[0];
    const payload = {
      ticketId: conversationId,
      conversationId,
      messageId: message.id,
      sender: { type: 'customer', id: req.user.id },
      content: message.content,
      attachmentUrl: message.attachment_url,
      attachmentName: message.attachment_name,
      messageType: message.message_type,
      editedAt: message.edited_at,
      editCount: message.edit_count,
      timestamp: message.created_at,
    };
    WebSocketService.broadcastToTicket(conversationId, 'message:updated', payload);
    WebSocketService.broadcastToAdmins('support:conversation-updated', payload);
    return res.json({ success: true, data: message });
  } catch (err) {
    logger.error('updateCustomerMessage error', { conversationId, messageId, error: err.message });
    return sendError(res, 500, 'Failed to edit message');
  }
}

async function updateAgentMessage(req, res) {
  const conversationId = req.params.conversationId;
  const messageId = req.params.messageId;
  const content = String(req.body?.content ?? req.body?.message ?? '').trim();
  if (!content || content.length > 5000) {
    return sendValidationError(res, { content: 'Message is required and must be 5000 characters or fewer' });
  }

  try {
    const access = await authorizeConversationAccess(conversationId, req);
    if (!access.conversation) return sendError(res, 404, 'Conversation not found');
    if (!access.allowed || access.isCustomer) return sendError(res, 403, 'Only support staff can edit this message');
    if (['resolved', 'closed'].includes(access.conversation.status)) {
      return sendError(res, 409, 'Closed conversations cannot be edited');
    }

    const result = await query(
      `UPDATE support_conversation_messages
       SET original_content = COALESCE(original_content, content),
           content = $1,
           edited_at = NOW(),
           edit_count = edit_count + 1,
           updated_at = NOW()
       WHERE id = $2
         AND conversation_id = $3
         AND is_agent = TRUE
         AND message_type <> 'internal_note'
         AND created_at > NOW() - INTERVAL '15 minutes'
         AND (sender_id = $4 OR $5::boolean = TRUE)
       RETURNING id, content, attachment_url, attachment_name, message_type,
                 is_agent, edited_at, edit_count, created_at, sender_id` ,
      [content, messageId, conversationId, req.user.id, access.isPlatformAdmin]
    );
    if (!result.rows.length) return sendError(res, 409, 'This message is no longer editable');

    const message = result.rows[0];
    const payload = {
      ticketId: conversationId,
      conversationId,
      messageId: message.id,
      sender: { type: 'agent', id: message.sender_id },
      content: message.content,
      attachmentUrl: message.attachment_url,
      attachmentName: message.attachment_name,
      messageType: message.message_type,
      editedAt: message.edited_at,
      editCount: message.edit_count,
      timestamp: message.created_at,
    };
    const editCount = Number(message.edit_count || 0);
    await logAdminAction({
      adminId: req.user.id,
      action: 'support_message_edited',
      targetType: 'support_conversation_message',
      targetId: message.id,
      description: 'Public support reply edited by authorized staff',
      before: { editCount: Math.max(0, editCount - 1), isPublic: true },
      after: { editCount, isPublic: true },
      req,
    });
    WebSocketService.broadcastToTicket(conversationId, 'message:updated', payload);
    WebSocketService.broadcastToAdmins('support:conversation-updated', payload);
    return res.json({ success: true, data: message });
  } catch (err) {
    logger.error('updateAgentMessage error', { conversationId, messageId, error: err.message });
    return sendError(res, 500, 'Failed to edit message');
  }
}

async function markConversationRead(req, res) {
  const conversationId = req.params.conversationId;
  try {
    const access = await authorizeConversationAccess(conversationId, req);
    if (!access.conversation) return sendError(res, 404, 'Conversation not found');
    if (!access.allowed) return sendError(res, 403, 'Access denied');

    const result = await query(
      `UPDATE support_conversation_messages
       SET read_by_recipient = TRUE,
           read_at = COALESCE(read_at, NOW()),
           status = 'read',
           updated_at = NOW()
       WHERE conversation_id = $1
         AND sender_id <> $2
         AND COALESCE(message_type, 'text') <> 'internal_note'
         AND read_by_recipient = FALSE
       RETURNING id, read_at`,
      [conversationId, req.user.id]
    );
    const readAt = result.rows[0]?.read_at || null;
    const payload = {
      ticketId: conversationId,
      conversationId,
      userId: req.user.id,
      markedCount: result.rows.length,
      readAt,
    };
    WebSocketService.broadcastToTicket(conversationId, 'messages:read', payload);
    WebSocketService.broadcastToAdmins('support:conversation-updated', payload);
    return res.json({ success: true, data: { markedCount: result.rows.length, readAt } });
  } catch (err) {
    logger.error('markConversationRead error', { conversationId, error: err.message });
    return sendError(res, 500, 'Failed to mark conversation as read');
  }
}

function transcriptFilename(subject, conversationId, suffix = '') {
  const safeSubject = String(subject || 'support-conversation')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'support-conversation';
  return `oxsteed-${safeSubject}-${String(conversationId).slice(0, 8)}${suffix ? `-${suffix}` : ''}.txt`;
}

function buildTranscript(conversation, messages, { includeInternal = false } = {}) {
  const lines = [
    'OxSteed Support Conversation',
    `Subject: ${conversation.subject || 'Support request'}`,
    `Started: ${conversation.created_at ? new Date(conversation.created_at).toISOString() : '-'}`,
    `Status: ${conversation.status || '-'}`,
    '',
  ];
  for (const message of messages) {
    const isInternal = message.message_type === 'internal_note';
    if (isInternal && !includeInternal) continue;
    const sender = isInternal
      ? 'Internal support note'
      : (message.is_agent ? 'OxSteed Support' : (conversation.customer_name || 'Customer'));
    const timestamp = message.created_at ? new Date(message.created_at).toISOString() : '-';
    lines.push(`[${timestamp}] ${sender}`);
    if (message.content) lines.push(String(message.content));
    if (message.attachment_name) lines.push(`Attachment: ${message.attachment_name}`);
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

async function downloadConversation(req, res) {
  const conversationId = req.params.conversationId;
  try {
    const access = await authorizeConversationAccess(conversationId, req);
    if (!access.conversation) return sendError(res, 404, 'Conversation not found');
    if (!access.allowed) return sendError(res, 403, 'Access denied');
    const includeInternal = !access.isCustomer && ['true', '1', 'yes'].includes(String(req.query.include_internal || '').toLowerCase());
    if (!access.isCustomer) {
      void logAdminAction({
        adminId: req.user.id,
        action: includeInternal ? 'support_case_record_downloaded' : 'support_transcript_downloaded',
        targetType: 'support_conversation',
        targetId: conversationId,
        description: includeInternal
          ? 'Authorized staff downloaded a full support case record'
          : 'Authorized staff downloaded a customer-visible support transcript',
        req,
      });
    }

    const { rows: messages } = await query(
      `SELECT content, attachment_name, message_type, is_agent, created_at
       FROM support_conversation_messages
       WHERE conversation_id = $1
         AND ($2::boolean = true OR COALESCE(message_type, 'text') <> 'internal_note')
       ORDER BY created_at ASC`,
      [conversationId, includeInternal]
    );
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${transcriptFilename(access.conversation.subject, conversationId, includeInternal ? 'case-record' : '')}"`);
    return res.send(buildTranscript(access.conversation, messages, { includeInternal }));
  } catch (err) {
    logger.error('downloadConversation error', { conversationId, error: err.message });
    return sendError(res, 500, 'Failed to download conversation');
  }
}

async function createConversationReview(req, res) {
  const conversationId = req.params.conversationId;
  const rating = Number(req.body?.rating);
  const comment = String(req.body?.comment || '').trim();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length > 1000) {
    return sendValidationError(res, { rating: 'Choose a rating from 1 to 5', comment: 'Feedback must be 1000 characters or fewer' });
  }

  try {
    const access = await authorizeConversationAccess(conversationId, req);
    if (!access.conversation) return sendError(res, 404, 'Conversation not found');
    if (!access.isCustomer) return sendError(res, 403, 'Only the customer can submit a review');
    if (!['resolved', 'closed'].includes(access.conversation.status)) {
      return sendError(res, 409, 'Reviews are available after the conversation is finished');
    }
    const result = await query(
      `INSERT INTO support_conversation_reviews (conversation_id, customer_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (conversation_id) DO UPDATE
       SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = NOW()
       RETURNING id, conversation_id, rating, comment, created_at, updated_at`,
      [conversationId, req.user.id, rating, comment || null]
    );
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('createConversationReview error', { conversationId, error: err.message });
    return sendError(res, 500, 'Failed to save conversation review');
  }
}

async function reopenCustomerConversation(req, res) {
  const conversationId = req.params.conversationId;
  try {
    const access = await authorizeConversationAccess(conversationId, req);
    if (!access.conversation) return sendError(res, 404, 'Conversation not found');
    if (!access.isCustomer) return sendError(res, 403, 'Only the customer can reopen this conversation');
    if (access.conversation.status !== 'resolved') {
      return sendError(res, 409, 'Only resolved conversations can be reopened');
    }

    const result = await query(
      `UPDATE support_conversations
       SET status = 'open', resolved_at = NULL, closed_at = NULL,
           resolution_status = NULL, resolution_summary = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'resolved'
       RETURNING *`,
      [conversationId]
    );
    if (!result.rows.length) return sendError(res, 409, 'This conversation changed before it could be reopened');
    await query(
      `UPDATE support_queue
       SET status = 'waiting', removed_at = NULL, reason_removed = NULL,
           routed_to_agent_id = NULL
       WHERE conversation_id = $1`,
      [conversationId]
    );
    const payload = { ticketId: conversationId, conversationId, status: 'open', updatedBy: req.user.id, timestamp: new Date().toISOString() };
    WebSocketService.broadcastToTicket(conversationId, 'ticket:status-changed', payload);
    WebSocketService.broadcastToAdmins('support:conversation-updated', payload);
    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('reopenCustomerConversation error', { conversationId, error: err.message });
    return sendError(res, 500, 'Failed to reopen conversation');
  }
}

// Update conversation status
async function updateConversationStatus(req, res) {
  try {
    const { conversationId } = req.params;
    const { status, resolutionStatus, internalNotes } = req.body;
    const rawResolutionSummary = req.body?.resolutionSummary ?? req.body?.resolution_summary;
    const resolutionSummary = rawResolutionSummary == null ? null : String(rawResolutionSummary).trim();

    if (!status) {
      return sendValidationError(res, { status: 'Required' });
    }

    const validStatuses = ['open', 'in_progress', 'waiting_for_customer', 'waiting_for_agent', 'resolved', 'closed', 'escalated'];
    if (!validStatuses.includes(status)) {
      return sendValidationError(res, { status: 'Invalid status' });
    }
    if (resolutionSummary && resolutionSummary.length > 2000) {
      return sendValidationError(res, { resolutionSummary: 'Must be 2000 characters or fewer' });
    }

    // Get conversation
    const convResult = await query(
      'SELECT * FROM support_conversations WHERE id = $1',
      [conversationId]
    );
    if (!convResult.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = convResult.rows[0];

    const isPlatformAdmin = supportEmployerService.isPlatformAdmin(req.user.role);
    let isAssignedAgent = false;
    if (conversation.agent_id) {
      const ag = await query('SELECT user_id FROM support_agents WHERE id = $1', [conversation.agent_id]);
      isAssignedAgent = ag.rows[0]?.user_id === req.user.id;
    }
    const can = isPlatformAdmin
      || isAssignedAgent
      || await supportEmployerService.userCanAdministrateBusiness(conversation.business_id, req.user.id);
    if (!can) return sendError(res, 403, 'Access denied');

    // Update status
    let updateSql = `
      UPDATE support_conversations
      SET status = $1, updated_at = CURRENT_TIMESTAMP
    `;
    const params = [status];

    if (status === 'resolved') {
      updateSql += `, resolved_at = CURRENT_TIMESTAMP, closed_at = NULL, resolution_status = $${params.length + 1}, resolution_summary = NULLIF($${params.length + 2}, '')`;
      params.push(resolutionStatus || 'resolved');
      params.push(resolutionSummary || '');
    } else if (status === 'closed') {
      updateSql += `, closed_at = CURRENT_TIMESTAMP, resolution_status = $${params.length + 1}, resolution_summary = NULLIF($${params.length + 2}, '')`;
      params.push(resolutionStatus || 'resolved');
      params.push(resolutionSummary || '');
    } else if (status === 'open') {
      updateSql += `, resolved_at = NULL, closed_at = NULL, agent_id = NULL, assigned_at = NULL, resolution_status = NULL, resolution_summary = NULL`;
    } else if (status === 'in_progress') {
      updateSql += `, resolved_at = NULL, closed_at = NULL`;
    }

    if (internalNotes) {
      updateSql += `, internal_notes = $${params.length + 1}`;
      params.push(internalNotes);
    }

    updateSql += ` WHERE id = $${params.length + 1} RETURNING *`;
    params.push(conversationId);

    const result = await query(updateSql, params);

    if (status === 'resolved' || status === 'closed') {
      await query(
        `UPDATE support_queue
         SET status = 'removed', removed_at = NOW(), reason_removed = $1
         WHERE conversation_id = $2 AND status <> 'removed'`,
        [status, conversationId]
      );
      await query(
        `UPDATE conversation_assignments
         SET status = 'completed', released_at = COALESCE(released_at, NOW()),
             duration_seconds = COALESCE(
               duration_seconds,
               EXTRACT(EPOCH FROM (NOW() - claimed_at))::integer
             )
         WHERE conversation_id = $1 AND status = 'active'`,
        [conversationId]
      );
    } else if (status === 'open') {
      await query(
        `UPDATE support_queue
         SET status = 'waiting', removed_at = NULL, reason_removed = NULL,
             routed_to_agent_id = NULL
         WHERE conversation_id = $1`,
        [conversationId]
      );
    }

    logger.info('Conversation status updated', { conversationId, status });
    await logAdminAction({
      adminId: req.user.id,
      action: 'support_conversation_status_changed',
      targetType: 'support_conversation',
      targetId: conversationId,
      description: `Support conversation status changed to ${status}`,
      before: { status: conversation.status },
      after: { status: result.rows[0]?.status || status, resolutionStatus: result.rows[0]?.resolution_status || null },
      req,
    });

    const statusPayload = {
      ticketId: conversationId,
      conversationId,
      status,
      resolutionSummary: result.rows[0]?.resolution_summary || null,
      updatedBy: req.user.id,
      timestamp: new Date().toISOString(),
    };
    WebSocketService.broadcastToTicket(conversationId, 'ticket:status-changed', statusPayload);
    WebSocketService.broadcastToAdmins('support:conversation-updated', statusPayload);

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('updateConversationStatus error', { error: err.message });
    sendError(res, 500, 'Failed to update conversation');
  }
}

// Add message to conversation
async function addMessage(req, res) {
  try {
    const { conversationId } = req.params;
    const {
      content,
      message,
      messageType = 'text',
      attachmentUrl,
      attachmentName,
      isInternal,
      is_internal: snakeCaseInternal,
    } = req.body || {};

    const normalizedContent = String(content ?? message ?? '').trim();
    const normalizedMessageType = typeof messageType === 'string' ? messageType.trim().toLowerCase() : '';
    const internalRequested = isInternal ?? snakeCaseInternal;
    const isInternalMessage = ['true', '1', 'yes', 'on'].includes(
      String(internalRequested || '').toLowerCase()
    );
    if ((!normalizedContent && !req.file) || normalizedContent.length > 5000) {
      return sendValidationError(res, { content: 'Required' });
    }
    if (!['text', 'image'].includes(normalizedMessageType)) {
      return sendValidationError(res, { messageType: 'Must be text or image' });
    }

    // Get conversation
    const convResult = await query(
      'SELECT * FROM support_conversations WHERE id = $1',
      [conversationId]
    );
    if (!convResult.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = convResult.rows[0];

    const isCustomer = req.user.id === conversation.customer_id;
    const isPlatformAdmin = supportEmployerService.isPlatformAdmin(req.user.role);
    let isAssignedAgent = false;
    if (conversation.agent_id) {
      const ag = await query('SELECT user_id FROM support_agents WHERE id = $1', [conversation.agent_id]);
      isAssignedAgent = ag.rows.length && ag.rows[0].user_id === req.user.id;
    }
    let canManageBusiness = false;
    if (!isCustomer && !isAssignedAgent && !isPlatformAdmin) {
      canManageBusiness = await supportEmployerService.userCanAdministrateBusiness(
        conversation.business_id,
        req.user.id
      );
      if (!canManageBusiness) return sendError(res, 403, 'Access denied');
    }

    const isAgent = isAssignedAgent || canManageBusiness || isPlatformAdmin;
    if (isInternalMessage && !isAgent) {
      return sendError(res, 403, 'Only support staff can add internal notes');
    }

    if (req.file && (!req.file.mimetype || !req.file.mimetype.startsWith('image/'))) {
      return sendValidationError(res, { file: 'Only image attachments are allowed' });
    }

    const attachment = normalizeAttachmentReference(attachmentUrl, attachmentName);
    if (attachment.error) {
      return sendValidationError(res, { attachmentUrl: attachment.error });
    }

    let storedAttachmentUrl = attachment.url;
    let storedAttachmentName = attachment.name;
    if (req.file) {
      const key = await uploadFile(req.file.buffer, 'support-conversations', req.file.originalname, req.file.mimetype);
      storedAttachmentUrl = await getSignedDownloadUrl(key, 7 * 24 * 60 * 60);
      storedAttachmentName = req.file.originalname;
    }

    const storedMessageType = isInternalMessage ? 'internal_note' : (req.file ? 'image' : normalizedMessageType);

    // Add message
    const result = await query(
      `INSERT INTO support_conversation_messages
       (conversation_id, sender_id, message_type, content, attachment_url, attachment_name, is_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [conversationId, req.user.id, storedMessageType, normalizedContent || null, storedAttachmentUrl, storedAttachmentName, isAgent]
    );

    // Update conversation message counts
    const countCol = isAgent ? 'agent_message_count' : 'customer_message_count';
    await query(
      `UPDATE support_conversations
       SET message_count = message_count + 1,
           ${countCol} = ${countCol} + 1,
           updated_at = NOW(),
           first_response_at = CASE
             WHEN $2::boolean AND first_response_at IS NULL THEN NOW()
             ELSE first_response_at
           END,
           status = CASE
             WHEN $2::boolean AND status IN ('open', 'waiting_for_agent') THEN 'in_progress'
             ELSE status
           END
       WHERE id = $1`,
      [conversationId, isAgent]
    );

    // Auto-transition status if customer sends message while waiting_for_customer
    if (!isAgent && conversation.status === 'waiting_for_customer') {
      await query(
        'UPDATE support_conversations SET status = $1 WHERE id = $2',
        ['in_progress', conversationId]
      );
    }

    logger.info('Message added to conversation', {
      conversationId,
      isAgent,
      messageType: storedMessageType,
      isInternal: isInternalMessage
    });
    if (isAgent) {
      void logAdminAction({
        adminId: req.user.id,
        action: 'support_message_created',
        targetType: 'support_conversation_message',
        targetId: result.rows[0].id,
        description: isInternalMessage
          ? 'Internal support note created'
          : 'Public support reply created',
        after: {
          messageType: storedMessageType,
          isPublic: !isInternalMessage,
          hasAttachment: Boolean(storedAttachmentUrl || storedAttachmentName),
        },
        req,
      });
    }

    const eventPayload = {
      messageId: result.rows[0].id,
      ticketId: conversationId,
      sender: {
        type: isAgent ? 'agent' : 'customer',
        id: req.user.id,
        name: req.user.name
          || [req.user.first_name, req.user.last_name].filter(Boolean).join(' ').trim()
          || req.user.email
          || (isAgent ? 'Support specialist' : 'Customer'),
      },
      content: normalizedContent,
      attachmentUrl: storedAttachmentUrl,
      attachmentName: storedAttachmentName,
      messageType: storedMessageType,
      timestamp: result.rows[0].created_at,
      isInternal: isInternalMessage,
    };

    // Private notes must never enter the customer ticket room.
    if (!isInternalMessage) {
      WebSocketService.broadcastToTicket(conversationId, 'message:new', eventPayload);
    }
    WebSocketService.broadcastToAdmins('support:conversation-updated', eventPayload);

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('addMessage error', { error: err.message });
    sendError(res, 500, 'Failed to add message');
  }
}

// Send an audited email follow-up from the support conversation workspace.
async function sendConversationEmail(req, res) {
  const conversationId = req.params.conversationId;
  const subject = String(req.body?.subject || '').trim();
  const content = String(req.body?.content || '').trim();
  const requestId = String(req.body?.requestId || '').trim();

  if (!subject || subject.length > 200 || /[\r\n]/.test(subject) ||
      !content || content.length > 5000 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return sendValidationError(res, {
      subject: 'Subject is required, must be one line, and must be 200 characters or fewer',
      content: 'Message is required and must be 5000 characters or fewer',
      requestId: 'A valid request identifier is required',
    });
  }

  try {
    const { rows } = await query(
      `SELECT sc.id, sc.business_id, sc.customer_id, sc.agent_id, sc.guest_verified_at,
              COALESCE(u.email, sc.guest_email) AS customer_email,
              COALESCE(
                NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
                u.email, sc.guest_name, 'Customer'
              ) AS customer_name
       FROM support_conversations sc
       LEFT JOIN users u ON u.id = sc.customer_id
       WHERE sc.id = $1`,
      [conversationId]
    );
    if (!rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = rows[0];
    const isPlatformAdmin = supportEmployerService.isPlatformAdmin(req.user.role);
    let isAssignedAgent = false;
    if (conversation.agent_id) {
      const agent = await query('SELECT user_id FROM support_agents WHERE id = $1', [conversation.agent_id]);
      isAssignedAgent = agent.rows[0]?.user_id === req.user.id;
    }
    const canManageBusiness = !isPlatformAdmin && !isAssignedAgent
      ? await supportEmployerService.userCanAdministrateBusiness(conversation.business_id, req.user.id)
      : false;
    if (!isPlatformAdmin && !isAssignedAgent && !canManageBusiness) {
      return sendError(res, 403, 'Access denied');
    }
    if (!conversation.customer_email || (!conversation.customer_id && !conversation.guest_verified_at)) {
      return sendError(res, 409, 'A verified customer email is not available');
    }

    const adminName = [req.user.first_name, req.user.last_name].filter(Boolean).join(' ').trim()
      || req.user.email
      || 'OxSteed Support';
    const { rows: messageRows } = await query(
      `INSERT INTO support_conversation_messages
         (conversation_id, sender_id, message_type, content, email_subject,
          email_request_id, is_agent, status)
       VALUES ($1, $2, 'outbound_email', $3, $4, $5, TRUE, 'sending')
       ON CONFLICT (email_request_id) WHERE email_request_id IS NOT NULL DO NOTHING
       RETURNING id, created_at`,
      [conversationId, req.user.id, content, subject, requestId]
    );
    if (!messageRows.length) {
      const existing = await query(
        `SELECT id, status, created_at FROM support_conversation_messages
         WHERE email_request_id = $1 AND conversation_id = $2`,
        [requestId, conversationId]
      );
      if (existing.rows[0]?.status === 'sent') {
        return res.status(200).json({ success: true, duplicate: true, data: existing.rows[0] });
      }
      return sendError(
        res,
        existing.rows[0]?.status === 'sending' ? 409 : 502,
        existing.rows[0]?.status === 'sending'
          ? 'This email is already being sent'
          : 'The previous email attempt failed; please try again'
      );
    }
    const message = messageRows[0];
    const safeName = escapeHtml(conversation.customer_name);
    const safeContent = escapeHtml(content).replace(/\n/g, '<br>');
    const result = await sendEmail({
      to: conversation.customer_email,
      from: EMAIL_ADDRESSES.support,
      fromName: 'OxSteed Support',
      subject,
      text: `Hi ${conversation.customer_name},\n\n${content}\n\nOxSteed Support`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
        <h2 style="color:#ea580c">OxSteed Support</h2>
        <p>Hi ${safeName},</p>
        <p style="line-height:1.7">${safeContent}</p>
        <p style="margin-top:28px;color:#6b7280">OxSteed Support<br>+1 (937) 408-5169</p>
      </div>`,
      idempotencyKey: `support-conversation-email-${requestId}`,
    });

    await query(
      `UPDATE support_conversation_messages
       SET status = $1, email_provider_id = $2, updated_at = NOW()
       WHERE id = $3`,
      [result.success ? 'sent' : 'failed', result.id || null, message.id]
    );
    if (!result.success) {
      logger.error('Support follow-up email failed', {
        conversationId,
        adminId: req.user.id,
        error: result.error,
      });
      return sendError(res, 502, 'The email provider did not accept this message');
    }

    await query(
      `UPDATE support_conversations
       SET message_count = message_count + 1,
           agent_message_count = agent_message_count + 1,
           first_response_at = COALESCE(first_response_at, NOW()),
           updated_at = NOW()
       WHERE id = $1`,
      [conversationId]
    );
    const eventPayload = {
      ticketId: conversationId,
      conversationId,
      messageId: message.id,
      sender: { type: 'agent', id: req.user.id, name: adminName },
      content,
      messageType: 'outbound_email',
      subject,
      timestamp: message.created_at,
    };
    WebSocketService.broadcastToTicket(conversationId, 'message:new', eventPayload);
    WebSocketService.broadcastToAdmins('support:conversation-updated', eventPayload);
    logger.info('Support follow-up email sent', { conversationId, adminId: req.user.id });
    return res.status(201).json({
      success: true,
      data: { id: message.id, status: 'sent', created_at: message.created_at },
    });
  } catch (err) {
    logger.error('sendConversationEmail error', { conversationId, error: err.message });
    return sendError(res, 500, 'Failed to send support follow-up email');
  }
}

// Get conversation stats for a business
async function getConversationStats(req, res) {
  try {
    const { businessId } = req.params;

    const can = await supportEmployerService.userCanAccessBusinessConversations(
      businessId,
      req.user.id,
      req.user.role
    );
    if (!can) return sendError(res, 403, 'Access denied');

    const result = await query(
      `SELECT
        COUNT(*) as total_conversations,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_conversations,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_conversations,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_conversations,
        AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as avg_resolution_hours
      FROM support_conversations
      WHERE business_id = $1`,
      [businessId]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('getConversationStats error', { error: err.message });
    sendError(res, 500, 'Failed to get stats');
  }
}

module.exports = {
  createConversation,
  listConversations,
  getConversation,
  updateCustomerMessage,
  updateAgentMessage,
  markConversationRead,
  downloadConversation,
  createConversationReview,
  reopenCustomerConversation,
  updateConversationStatus,
  addMessage,
  sendConversationEmail,
  getConversationStats
};
