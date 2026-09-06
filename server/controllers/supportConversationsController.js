// Support Conversations Controller
// Manages support tickets: creation, assignment, status updates, resolution

const { query } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');
const supportEmployerService = require('../services/supportEmployerService');
const WebSocketService = require('../services/websocketService');
const { sendEmail, EMAIL_ADDRESSES } = require('../utils/email');
const escapeHtml = require('../utils/escapeHtml');
const { uploadFile, getSignedDownloadUrl } = require('../utils/storage');

// Create a new support conversation/ticket
async function createConversation(req, res) {
  try {
    const { businessId, subject, description, category, priority } = req.body;

    if (!businessId || !subject) {
      return sendValidationError(res, {
        businessId: 'Required',
        subject: 'Required'
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
    const { status, priority, agentId, limit = 50, offset = 0 } = req.query;

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
        sc.sla_first_response_breached, sc.sla_resolution_breached
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
        scm.is_agent, scm.is_ai, scm.status, scm.read_at, scm.created_at,
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

    res.json({
      success: true,
      data: {
        ...conversation,
        messages: messages.rows
      }
    });
  } catch (err) {
    logger.error('getConversation error', { error: err.message });
    sendError(res, 500, 'Failed to get conversation');
  }
}

// Update conversation status
async function updateConversationStatus(req, res) {
  try {
    const { conversationId } = req.params;
    const { status, resolutionStatus, internalNotes } = req.body;

    if (!status) {
      return sendValidationError(res, { status: 'Required' });
    }

    const validStatuses = ['open', 'in_progress', 'waiting_for_customer', 'waiting_for_agent', 'resolved', 'closed', 'escalated'];
    if (!validStatuses.includes(status)) {
      return sendValidationError(res, { status: 'Invalid status' });
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
      updateSql += `, resolved_at = CURRENT_TIMESTAMP, closed_at = NULL, resolution_status = $${params.length + 1}`;
      params.push(resolutionStatus || 'resolved');
    } else if (status === 'closed') {
      updateSql += `, closed_at = CURRENT_TIMESTAMP, resolution_status = $${params.length + 1}`;
      params.push(resolutionStatus || 'resolved');
    } else if (status === 'open') {
      updateSql += `, resolved_at = NULL, closed_at = NULL, agent_id = NULL, assigned_at = NULL`;
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

    const statusPayload = {
      ticketId: conversationId,
      conversationId,
      status,
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
      messageType = 'text',
      attachmentUrl,
      attachmentName,
      isInternal = false,
    } = req.body;

    const normalizedContent = String(content || '').trim();
    if ((!normalizedContent && !req.file) || normalizedContent.length > 5000) {
      return sendValidationError(res, { content: 'Required' });
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
    if (isInternal && !isAgent) {
      return sendError(res, 403, 'Only support staff can add internal notes');
    }

    if (req.file && (!req.file.mimetype || !req.file.mimetype.startsWith('image/'))) {
      return sendValidationError(res, { file: 'Only image attachments are allowed' });
    }

    let storedAttachmentUrl = attachmentUrl || null;
    let storedAttachmentName = attachmentName || null;
    if (req.file) {
      const key = await uploadFile(req.file.buffer, 'support-conversations', req.file.originalname, req.file.mimetype);
      storedAttachmentUrl = await getSignedDownloadUrl(key, 7 * 24 * 60 * 60);
      storedAttachmentName = req.file.originalname;
    }

    const storedMessageType = isInternal ? 'internal_note' : (req.file ? 'image' : messageType);

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
      isInternal
    });

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
      isInternal,
    };

    // Private notes must never enter the customer ticket room.
    if (!isInternal) {
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
  updateConversationStatus,
  addMessage,
  sendConversationEmail,
  getConversationStats
};
