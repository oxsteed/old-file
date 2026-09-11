// Support Conversations Controller
// Manages support tickets: creation, assignment, status updates, resolution

const pool = require('../db');
const { query } = pool;
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');
const supportEmployerService = require('../services/supportEmployerService');
const WebSocketService = require('../services/websocketService');
const { logAdminAction } = require('../services/auditService');
const { sendEmail, EMAIL_ADDRESSES } = require('../utils/email');
const { sendSupportEmail, retryFailedSupportEmails } = require('../services/supportEmailOutbox');
const escapeHtml = require('../utils/escapeHtml');
const { uploadFile, getSignedDownloadUrl, deleteFile } = require('../utils/storage');
const { withTransaction } = require('../utils/transaction');
const CLIENT_MESSAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function notifyCustomerOfAgentReply(conversation, message) {
  const recipient = String(conversation.customer_email || '').trim();
  if (!recipient || conversation.customer_email_notifications === false) return;

  const subject = String(conversation.subject || 'Support conversation')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 180);
  const content = String(message.content || '').trim();
  const safeName = escapeHtml(conversation.customer_name || 'there');
  const safeContent = escapeHtml(content).replace(/\n/g, '<br>');
  const attachmentLine = message.attachment_url
    ? '<p style="color:#6b7280">Your support reply also includes an attachment. Open your OxSteed support conversation to view it.</p>'
    : '';

  const result = await sendSupportEmail({
    conversationId: conversation.id,
    kind: 'agent_reply',
    to: recipient,
    from: EMAIL_ADDRESSES.support,
    fromName: 'OxSteed Support',
    subject: `OxSteed Support: ${subject}`,
    text: `Hi ${conversation.customer_name || 'there'},\n\nOxSteed Support replied to your conversation:\n\n${content}\n\nOpen your OxSteed support conversation to continue the discussion.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
      <h2 style="color:#ea580c">OxSteed Support</h2>
      <p>Hi ${safeName},</p>
      <p>OxSteed Support replied to your conversation:</p>
      <p style="line-height:1.7">${safeContent}</p>
      ${attachmentLine}
      <p>Open your OxSteed support conversation to continue the discussion.</p>
      <p style="margin-top:28px;color:#6b7280">OxSteed Support<br>+1 (937) 408-5169</p>
    </div>`,
    idempotencyKey: `support-reply-${message.id}`,
  });
  if (!result?.success) {
    logger.warn('Customer support reply email was not delivered', {
      conversationId: conversation.id,
      messageId: message.id,
      error: result?.error || 'unknown error',
    });
  }
}

async function notifyCustomerOfConversationStatus(conversation, status, resolutionSummary, transitionAt) {
  const recipient = String(conversation.customer_email || '').trim();
  if (!recipient || conversation.customer_email_notifications === false) return;

  const subject = String(conversation.subject || 'Support conversation')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 180);
  const customerName = String(conversation.customer_name || 'there').trim();
  const safeName = escapeHtml(customerName);
  const safeStatus = status === 'closed' ? 'closed' : 'resolved';
  const safeSummary = String(resolutionSummary || '').trim();
  const summaryLine = safeSummary
    ? `\nResolution summary:\n${safeSummary}\n`
    : '';
  const summaryHtml = safeSummary
    ? `<p><strong>Resolution summary</strong></p><p style="line-height:1.7">${escapeHtml(safeSummary).replace(/\n/g, '<br>')}</p>`
    : '';

  const result = await sendSupportEmail({
    conversationId: conversation.id,
    kind: 'conversation_status',
    to: recipient,
    from: EMAIL_ADDRESSES.support,
    fromName: 'OxSteed Support',
    subject: `OxSteed Support: ${subject} ${safeStatus}`,
    text: `Hi ${customerName},\n\nYour OxSteed support conversation has been ${safeStatus}.${summaryLine}\nIf you still need help, reply through your OxSteed support conversation or contact support.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
      <h2 style="color:#ea580c">OxSteed Support</h2>
      <p>Hi ${safeName},</p>
      <p>Your support conversation has been ${safeStatus}.</p>
      ${summaryHtml}
      <p>If you still need help, reply through your OxSteed support conversation or contact support.</p>
      <p style="margin-top:28px;color:#6b7280">OxSteed Support<br>+1 (937) 408-5169</p>
    </div>`,
    idempotencyKey: `support-status-${conversation.id}-${safeStatus}-${new Date(transitionAt || Date.now()).getTime()}`,
  });
  if (!result?.success) {
    logger.warn('Customer support status email was not delivered', {
      conversationId: conversation.id,
      status: safeStatus,
      error: result?.error || 'unknown error',
    });
  }
}

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
    const channel = String(req.body?.channel || 'web_chat').trim().toLowerCase();

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

    const validChannels = ['web_chat', 'email', 'sms', 'phone', 'social'];
    if (!validChannels.includes(channel)) {
      return sendValidationError(res, { channel: 'Invalid support channel' });
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
        channel, status, last_channel_message_at, sla_first_response_target, sla_resolution_target)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', CURRENT_TIMESTAMP, $8, $9)
       RETURNING *`,
      [
        businessId,
        req.user.id,
        subject,
        description || null,
        category || 'general',
        priority || 'normal',
        channel,
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
        sc.subject, sc.description, sc.category, sc.priority, sc.channel,
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
    const channel = String(req.query.channel || '').trim().toLowerCase();
    if (channel) {
      if (!['web_chat', 'email', 'sms', 'phone', 'social'].includes(channel)) {
        return sendValidationError(res, { channel: 'Invalid support channel' });
      }
      sql += ` AND sc.channel = $${params.length + 1}`;
      params.push(channel);
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
        ,(
          SELECT jsonb_build_object(
            'pending', COUNT(*) FILTER (WHERE seo.status IN ('pending', 'sending')),
            'failed', COUNT(*) FILTER (WHERE seo.status = 'failed'),
            'sent', COUNT(*) FILTER (WHERE seo.status = 'sent')
          )
          FROM support_email_outbox seo
          WHERE seo.conversation_id = sc.id
        ) AS email_delivery
      FROM support_conversations sc
      LEFT JOIN users u ON sc.customer_id = u.id
      LEFT JOIN support_agents sa ON sc.agent_id = sa.id
      LEFT JOIN users au ON sa.user_id = au.id
      WHERE sc.id = $1`,
      [conversationId]
    );

    if (!result.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = result.rows[0];
    const emailDelivery = conversation.email_delivery;
    // Delivery state is operational metadata for authorized support staff, not
    // customer-facing conversation content.
    delete conversation.email_delivery;

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
        scm.id, scm.conversation_id, scm.sender_id, scm.message_type, scm.channel, scm.content,
        scm.attachment_url, scm.attachment_name,
        scm.is_agent, scm.is_ai, scm.status, scm.read_by_recipient, scm.read_at, scm.edited_at, scm.edit_count, scm.redacted_at, scm.created_at,
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
             scm.id, scm.conversation_id, scm.sender_id, scm.message_type, scm.channel, scm.content,
             scm.attachment_url, scm.attachment_name,
             scm.is_agent, scm.is_ai, scm.status, scm.read_by_recipient, scm.read_at, scm.edited_at, scm.edit_count, scm.redacted_at, scm.created_at,
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
        ...(!isCustomer && emailDelivery ? { emailDelivery } : {}),
        ...(customerHistory ? { customerHistory } : {}),
      }
    });
  } catch (err) {
    logger.error('getConversation error', { error: err.message });
    sendError(res, 500, 'Failed to get conversation');
  }
}

async function getCustomer360(req, res) {
  const conversationId = req.params.conversationId;
  try {
    const access = await authorizeConversationAccess(conversationId, req);
    if (!access.conversation) return sendError(res, 404, 'Conversation not found');
    if (!access.allowed || access.isCustomer) return sendError(res, 403, 'Only support staff can view customer context');

    const customerId = access.conversation.customer_id || null;
    const customerEmail = String(access.conversation.customer_email || '').trim().toLowerCase();
    const businessId = access.conversation.business_id || null;
    const businessScope = access.isPlatformAdmin ? '' : ' AND sc.business_id = $3';
    const supportParams = access.isPlatformAdmin
      ? [customerId, customerEmail]
      : [customerId, customerEmail, businessId];

    const queryOptional = async (sql, params, label) => {
      try {
        const result = await query(sql, params);
        return result.rows || [];
      } catch (error) {
        // A missing optional product table should not take the support console down.
        logger.warn('Customer 360 optional source unavailable', { source: label, error: error.message });
        return [];
      }
    };

    const profileResult = await query(
      `SELECT id, email, first_name, last_name, phone, preferred_language,
              email_verified, is_verified, created_at
       FROM users
       WHERE ($1::uuid IS NOT NULL AND id = $1)
          OR ($2::text <> '' AND LOWER(email) = $2)
       ORDER BY CASE WHEN $1::uuid IS NOT NULL AND id = $1 THEN 0 ELSE 1 END
       LIMIT 1`,
      [customerId, customerEmail]
    );

    const [supportConversations, conversationMessages, internalNotes, jobs, payments, marketplaceOrders, foodOrders, attachments, emailHistory, assignmentHistory] = await Promise.all([
      queryOptional(
        `SELECT sc.id, sc.subject, sc.status, sc.priority, sc.channel, sc.external_thread_id,
                sc.created_at, sc.updated_at,
                sc.resolved_at, sc.message_count, sc.customer_message_count, sc.agent_message_count,
                sa.id AS agent_id,
                COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', au.first_name, au.last_name)), ''), au.email) AS agent_name,
                scr.rating AS review_rating
         FROM support_conversations sc
         LEFT JOIN users u ON u.id = sc.customer_id
         LEFT JOIN support_agents sa ON sa.id = sc.agent_id
         LEFT JOIN users au ON au.id = sa.user_id
         LEFT JOIN support_conversation_reviews scr ON scr.conversation_id = sc.id
         WHERE (( $1::uuid IS NOT NULL AND sc.customer_id = $1)
             OR ($2::text <> '' AND LOWER(COALESCE(u.email, sc.guest_email)) = $2))
           AND (sc.customer_id IS NOT NULL OR sc.guest_verified_at IS NOT NULL)
           ${businessScope}
         ORDER BY sc.updated_at DESC, sc.created_at DESC
         LIMIT 50`,
        supportParams,
        'support conversations'
      ),
      queryOptional(
        `SELECT scm.id, scm.conversation_id, scm.is_agent, scm.is_ai,
                scm.message_type, LEFT(scm.content, 500) AS content,
                scm.status, scm.created_at, sc.subject,
                COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email, 'Customer') AS sender_name
         FROM support_conversation_messages scm
         JOIN support_conversations sc ON sc.id = scm.conversation_id
         LEFT JOIN users cu ON cu.id = sc.customer_id
         LEFT JOIN users u ON u.id = scm.sender_id
         WHERE scm.message_type <> 'internal_note'
           AND scm.redacted_at IS NULL
           AND (( $1::uuid IS NOT NULL AND sc.customer_id = $1)
             OR ($2::text <> '' AND LOWER(COALESCE(cu.email, sc.guest_email)) = $2))
           AND (sc.customer_id IS NOT NULL OR sc.guest_verified_at IS NOT NULL)
           ${businessScope}
         ORDER BY scm.created_at DESC
         LIMIT 200`,
        supportParams,
        'support message history'
      ),
      queryOptional(
        `SELECT scm.id, scm.conversation_id, scm.content, scm.created_at,
                sc.subject,
                COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email, 'Support team') AS author_name
         FROM support_conversation_messages scm
         JOIN support_conversations sc ON sc.id = scm.conversation_id
         LEFT JOIN users cu ON cu.id = sc.customer_id
         LEFT JOIN users u ON u.id = scm.sender_id
         WHERE scm.message_type = 'internal_note'
           AND (( $1::uuid IS NOT NULL AND sc.customer_id = $1)
             OR ($2::text <> '' AND LOWER(COALESCE(cu.email, sc.guest_email)) = $2))
           AND (sc.customer_id IS NOT NULL OR sc.guest_verified_at IS NOT NULL)
           ${businessScope}
         ORDER BY scm.created_at DESC
         LIMIT 100`,
        supportParams,
        'internal notes'
      ),
      queryOptional(
        `SELECT j.id, j.title, j.status, j.budget_min, j.budget_max, j.job_value,
                j.customer_total, j.created_at, j.updated_at, j.location_city, j.location_state
         FROM jobs j
         WHERE j.client_id = $1
         ORDER BY j.updated_at DESC, j.created_at DESC
         LIMIT 50`,
        [customerId],
        'jobs'
      ),
      queryOptional(
        `SELECT p.id, p.job_id, p.amount, p.currency, p.status, p.escrow_status,
                p.created_at, p.updated_at
         FROM payments p
         WHERE p.payer_id = $1
         ORDER BY p.updated_at DESC, p.created_at DESC
         LIMIT 50`,
        [customerId],
        'payments'
      ),
      queryOptional(
        `SELECT mo.id, mo.status, mo.total_cents, mo.created_at, mo.updated_at
         FROM marketplace_orders mo
         WHERE mo.customer_id = $1
         ORDER BY mo.updated_at DESC, mo.created_at DESC
         LIMIT 50`,
        [customerId],
        'marketplace orders'
      ),
      queryOptional(
        `SELECT fo.id, fo.status, fo.payment_status, fo.total_cents, fo.currency_code,
                fo.created_at, fo.updated_at
         FROM food_orders fo
         WHERE fo.customer_id = $1
         ORDER BY fo.updated_at DESC, fo.created_at DESC
         LIMIT 50`,
        [customerId],
        'food orders'
      ),
      queryOptional(
        `SELECT scm.id, scm.conversation_id, scm.attachment_url, scm.attachment_name,
                scm.created_at, sc.subject
         FROM support_conversation_messages scm
         JOIN support_conversations sc ON sc.id = scm.conversation_id
         LEFT JOIN users u ON u.id = sc.customer_id
         WHERE scm.attachment_url IS NOT NULL
           AND scm.redacted_at IS NULL
           AND (( $1::uuid IS NOT NULL AND sc.customer_id = $1)
             OR ($2::text <> '' AND LOWER(COALESCE(u.email, sc.guest_email)) = $2))
           AND (sc.customer_id IS NOT NULL OR sc.guest_verified_at IS NOT NULL)
           ${businessScope}
         ORDER BY scm.created_at DESC
         LIMIT 100`,
        supportParams,
        'support attachments'
      ),
      queryOptional(
        `SELECT seo.id, seo.conversation_id, seo.kind, seo.recipient, seo.subject,
                seo.status, seo.attempts, seo.sent_at, seo.last_error,
                seo.created_at, seo.updated_at
         FROM support_email_outbox seo
         JOIN support_conversations sc ON sc.id = seo.conversation_id
         LEFT JOIN users cu ON cu.id = sc.customer_id
         WHERE (( $1::uuid IS NOT NULL AND sc.customer_id = $1)
             OR ($2::text <> '' AND LOWER(COALESCE(cu.email, sc.guest_email)) = $2))
           AND (sc.customer_id IS NOT NULL OR sc.guest_verified_at IS NOT NULL)
           ${businessScope}
         ORDER BY seo.created_at DESC
         LIMIT 100`,
        supportParams,
        'support email history'
      ),
      queryOptional(
        `SELECT ca.id, ca.conversation_id, ca.agent_id, ca.assignment_type, ca.status,
                ca.claimed_at, ca.released_at,
                COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', au.first_name, au.last_name)), ''), au.email, 'Support team') AS agent_name
         FROM conversation_assignments ca
         JOIN support_conversations sc ON sc.id = ca.conversation_id
         JOIN support_agents sa ON sa.id = ca.agent_id
         LEFT JOIN users cu ON cu.id = sc.customer_id
         LEFT JOIN users au ON au.id = sa.user_id
         WHERE (( $1::uuid IS NOT NULL AND sc.customer_id = $1)
             OR ($2::text <> '' AND LOWER(COALESCE(cu.email, sc.guest_email)) = $2))
           AND (sc.customer_id IS NOT NULL OR sc.guest_verified_at IS NOT NULL)
           ${businessScope}
         ORDER BY ca.claimed_at DESC
         LIMIT 100`,
        supportParams,
        'support assignment history'
      ),
    ]);

    const priorAgents = Array.from(new Map([
      ...supportConversations
        .filter((row) => row.agent_id && row.agent_name)
        .map((row) => [row.agent_id, { id: row.agent_id, name: row.agent_name }]),
      ...assignmentHistory
        .filter((row) => row.agent_id && row.agent_name)
        .map((row) => [row.agent_id, { id: row.agent_id, name: row.agent_name }]),
    ]).values());

    return res.json({
      success: true,
      data: {
        profile: profileResult.rows[0] || {
          id: customerId,
          email: access.conversation.customer_email || null,
          first_name: null,
          last_name: null,
          phone: null,
          preferred_language: null,
        },
        currentConversationId: conversationId,
        supportConversations,
        internalNotes,
        conversationMessages,
        jobs,
        payments,
        orders: { marketplace: marketplaceOrders, food: foodOrders },
        attachments,
        emailHistory,
        assignmentHistory,
        priorAgents,
        summary: {
          conversations: supportConversations.length,
          jobs: jobs.length,
          payments: payments.length,
          orders: marketplaceOrders.length + foodOrders.length,
          attachments: attachments.length,
          internalNotes: internalNotes.length,
        },
      },
    });
  } catch (err) {
    logger.error('getCustomer360 error', { conversationId, error: err.message });
    return sendError(res, 500, 'Failed to load customer context');
  }
}

async function getConversationLifecycle(req, res) {
  const conversationId = req.params.conversationId;
  try {
    const access = await authorizeConversationAccess(conversationId, req);
    if (!access.conversation) return sendError(res, 404, 'Conversation not found');
    if (!access.allowed || access.isCustomer) {
      return sendError(res, 403, 'Only support staff can view conversation lifecycle history');
    }

    const result = await query(
      `SELECT
         e.id, e.conversation_id, e.status_from, e.status_to,
         e.changed_by, e.change_reason, e.metadata, e.changed_at,
         COALESCE(
           NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
           u.email
         ) AS changed_by_name
       FROM support_conversation_lifecycle_events e
       LEFT JOIN users u ON u.id = e.changed_by
       WHERE e.conversation_id = $1
       ORDER BY e.changed_at ASC, e.id ASC
       LIMIT 200`,
      [conversationId]
    );

    return res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getConversationLifecycle error', { conversationId, error: err.message });
    return sendError(res, 500, 'Failed to load conversation lifecycle');
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

async function redactSupportMessage(req, res) {
  const conversationId = req.params.conversationId;
  const messageId = req.params.messageId;
  const reason = String(req.body?.reason || req.body?.redactionReason || '').trim();
  if (reason.length > 1000) {
    return sendValidationError(res, { reason: 'Reason must be 1000 characters or fewer' });
  }

  try {
    const access = await authorizeConversationAccess(conversationId, req);
    if (!access.conversation) return sendError(res, 404, 'Conversation not found');
    if (!access.allowed || access.isCustomer) return sendError(res, 403, 'Only support staff can redact this message');

    const result = await query(
      `UPDATE support_conversation_messages
       SET original_content = COALESCE(original_content, content),
           content = '[Message redacted by support staff]',
           attachment_url = NULL,
           attachment_name = NULL,
           redacted_at = COALESCE(redacted_at, NOW()),
           redacted_by = COALESCE(redacted_by, $3),
           redaction_reason = COALESCE(redaction_reason, NULLIF($4, '')),
           updated_at = NOW()
       WHERE id = $1 AND conversation_id = $2 AND redacted_at IS NULL
       RETURNING id, content, attachment_url, attachment_name, message_type,
                 is_agent, redacted_at, edited_at, edit_count, created_at, sender_id`,
      [messageId, conversationId, req.user.id, reason]
    );
    if (!result.rows.length) return sendError(res, 409, 'This message is already redacted or was not found');

    const message = result.rows[0];
    const payload = {
      ticketId: conversationId,
      conversationId,
      messageId: message.id,
      sender: { type: message.is_agent ? 'agent' : 'customer', id: message.sender_id },
      content: message.content,
      attachmentUrl: null,
      attachmentName: null,
      messageType: message.message_type,
      redacted: true,
      redactedAt: message.redacted_at,
      timestamp: message.created_at,
    };
    await logAdminAction({
      adminId: req.user.id,
      action: 'support_message_redacted',
      targetType: 'support_conversation_message',
      targetId: message.id,
      description: 'Support message content and attachment references redacted',
      after: { redacted: true, reasonProvided: Boolean(reason), isPublic: message.message_type !== 'internal_note' },
      req,
    });
    if (message.message_type !== 'internal_note') {
      WebSocketService.broadcastToTicket(conversationId, 'message:updated', payload);
    }
    WebSocketService.broadcastToAdmins('support:conversation-updated', payload);
    return res.json({ success: true, data: message });
  } catch (err) {
    logger.error('redactSupportMessage error', { conversationId, messageId, error: err.message });
    return sendError(res, 500, 'Failed to redact message');
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

    const result = await withTransaction(pool, async (client) => {
      const reopened = await client.query(
        `UPDATE support_conversations
         SET status = 'reopened', resolved_at = NULL, closed_at = NULL,
             resolution_status = NULL, resolution_summary = NULL,
             resolution_reason_code = NULL, updated_at = NOW()
         WHERE id = $1 AND status = 'resolved'
         RETURNING *`,
        [conversationId]
      );
      if (!reopened.rows.length) return null;

      await client.query(
        `UPDATE support_queue
         SET status = 'waiting', removed_at = NULL, reason_removed = NULL,
             routed_to_agent_id = NULL
         WHERE conversation_id = $1`,
        [conversationId]
      );
      return reopened;
    }, 'reopen_customer_support_conversation');
    if (!result) return sendError(res, 409, 'This conversation changed before it could be reopened');
    const payload = { ticketId: conversationId, conversationId, status: 'reopened', updatedBy: req.user.id, timestamp: new Date().toISOString() };
    WebSocketService.broadcastToTicket(conversationId, 'ticket:status-changed', payload);
    WebSocketService.broadcastToAdmins('support:conversation-updated', payload);
    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('reopenCustomerConversation error', { conversationId, error: err.message });
    return sendError(res, 500, 'Failed to reopen conversation');
  }
}

async function mergeConversation(req, res) {
  const sourceConversationId = req.params.conversationId;
  const targetConversationId = String(
    req.body?.targetConversationId || req.body?.target_conversation_id || ''
  ).trim();
  const mergeReason = String(req.body?.reason || '').trim();

  if (!targetConversationId || targetConversationId === sourceConversationId) {
    return sendValidationError(res, { targetConversationId: 'Choose a different target conversation' });
  }
  if (mergeReason.length > 1000) {
    return sendValidationError(res, { reason: 'Merge reason must be 1000 characters or fewer' });
  }

  try {
    const sourceAccess = await authorizeConversationAccess(sourceConversationId, req);
    const targetAccess = await authorizeConversationAccess(targetConversationId, req);
    if (!sourceAccess.conversation || !targetAccess.conversation) {
      return sendError(res, 404, 'Conversation not found');
    }
    if (
      sourceAccess.isCustomer || targetAccess.isCustomer
      || !sourceAccess.allowed || !targetAccess.allowed
    ) {
      return sendError(res, 403, 'Only authorized support staff can merge conversations');
    }

    const source = sourceAccess.conversation;
    const target = targetAccess.conversation;
    const sameBusiness = source.business_id == null || target.business_id == null
      ? source.business_id === target.business_id
      : String(source.business_id) === String(target.business_id);
    const sameCustomer = source.customer_id && target.customer_id
      ? String(source.customer_id) === String(target.customer_id)
      : String(source.customer_email || '').trim().toLowerCase() === String(target.customer_email || '').trim().toLowerCase()
        && Boolean(String(source.customer_email || '').trim());

    if (!sameBusiness || !sameCustomer) {
      return sendError(res, 409, 'Conversations must belong to the same customer and business');
    }
    if (source.merged_into_conversation_id) {
      return sendError(res, 409, 'This conversation has already been merged');
    }
    if (['resolved', 'closed', 'merged'].includes(target.status)) {
      return sendError(res, 409, 'The target conversation must still be active');
    }

    const result = await withTransaction(pool, async (client) => {
      const locked = await client.query(
        `SELECT id, business_id, customer_id, status, message_count,
                customer_message_count, agent_message_count,
                merged_into_conversation_id
         FROM support_conversations
         WHERE id IN ($1, $2)
         ORDER BY id
         FOR UPDATE`,
        [sourceConversationId, targetConversationId]
      );
      const lockedById = new Map(locked.rows.map((row) => [String(row.id), row]));
      const lockedSource = lockedById.get(String(sourceConversationId));
      const lockedTarget = lockedById.get(String(targetConversationId));
      if (!lockedSource || !lockedTarget) return null;
      if (lockedSource.merged_into_conversation_id || ['resolved', 'closed', 'merged'].includes(lockedTarget.status)) {
        return { conflict: true };
      }

      const movedMessages = await client.query(
        `UPDATE support_conversation_messages
         SET conversation_id = $2, updated_at = NOW()
         WHERE conversation_id = $1`,
        [sourceConversationId, targetConversationId]
      );
      const counts = await client.query(
        `SELECT COUNT(*)::int AS message_count,
                COUNT(*) FILTER (WHERE is_agent = FALSE AND message_type <> 'internal_note')::int AS customer_message_count,
                COUNT(*) FILTER (WHERE is_agent = TRUE AND message_type <> 'internal_note')::int AS agent_message_count
         FROM support_conversation_messages
         WHERE conversation_id = $1`,
        [targetConversationId]
      );
      const updatedTarget = await client.query(
        `UPDATE support_conversations
         SET message_count = $2,
             customer_message_count = $3,
             agent_message_count = $4,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, status, message_count, customer_message_count, agent_message_count`,
        [
          targetConversationId,
          counts.rows[0]?.message_count || 0,
          counts.rows[0]?.customer_message_count || 0,
          counts.rows[0]?.agent_message_count || 0,
        ]
      );
      const updatedSource = await client.query(
        `UPDATE support_conversations
         SET status = 'merged', merged_into_conversation_id = $2,
             merged_at = NOW(), merged_by = $3, merge_reason = NULLIF($4, ''),
             agent_id = NULL, assigned_at = NULL, updated_at = NOW()
         WHERE id = $1 AND merged_into_conversation_id IS NULL
         RETURNING id, status, merged_into_conversation_id, merged_at, merge_reason`,
        [sourceConversationId, targetConversationId, req.user.id, mergeReason]
      );
      if (!updatedSource.rows.length || !updatedTarget.rows.length) return { conflict: true };

      await client.query(
        `UPDATE support_queue
         SET status = 'removed', removed_at = NOW(), reason_removed = 'merged'
         WHERE conversation_id = $1 AND status <> 'removed'`,
        [sourceConversationId]
      );
      await client.query(
        `UPDATE conversation_assignments
         SET status = 'completed', released_at = COALESCE(released_at, NOW()),
             duration_seconds = COALESCE(duration_seconds, EXTRACT(EPOCH FROM (NOW() - claimed_at))::integer)
         WHERE conversation_id = $1 AND status = 'active'`,
        [sourceConversationId]
      );
      return {
        source: updatedSource.rows[0],
        target: updatedTarget.rows[0],
        movedMessages: movedMessages.rowCount || 0,
      };
    }, 'merge_support_conversations');

    if (!result) return sendError(res, 404, 'Conversation not found');
    if (result.conflict) return sendError(res, 409, 'This conversation changed before it could be merged');

    await logAdminAction({
      adminId: req.user.id,
      action: 'support_conversations_merged',
      targetType: 'support_conversation',
      targetId: sourceConversationId,
      description: `Merged support conversation into ${targetConversationId}`,
      before: { status: source.status, targetConversationId },
      after: { status: 'merged', targetConversationId, movedMessages: result.movedMessages, reason: mergeReason || null },
      req,
    });
    const payload = {
      ticketId: targetConversationId,
      conversationId: targetConversationId,
      mergedConversationId: sourceConversationId,
      movedMessages: result.movedMessages,
      updatedBy: req.user.id,
      timestamp: new Date().toISOString(),
    };
    WebSocketService.broadcastToTicket(sourceConversationId, 'ticket:merged', payload);
    WebSocketService.broadcastToTicket(targetConversationId, 'ticket:merged', payload);
    WebSocketService.broadcastToAdmins('support:conversation-updated', payload);
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error('mergeConversation error', { sourceConversationId, targetConversationId, error: err.message });
    return sendError(res, 500, 'Failed to merge conversations');
  }
}

// Update conversation status
async function updateConversationStatus(req, res) {
  try {
    const { conversationId } = req.params;
    const { status, resolutionStatus, internalNotes } = req.body;
    const rawResolutionSummary = req.body?.resolutionSummary ?? req.body?.resolution_summary;
    const resolutionSummary = rawResolutionSummary == null ? null : String(rawResolutionSummary).trim();
    const normalizedResolutionStatus = resolutionStatus == null ? null : String(resolutionStatus).trim();
    const normalizedInternalNotes = internalNotes == null ? null : String(internalNotes).trim();
    const resolutionReasonCode = String(
      req.body?.resolutionReasonCode ?? req.body?.resolution_reason_code ?? ''
    ).trim().toLowerCase();

    if (!status) {
      return sendValidationError(res, { status: 'Required' });
    }

    const validStatuses = ['open', 'pending', 'reopened', 'in_progress', 'waiting_for_customer', 'waiting_for_agent', 'resolved', 'closed', 'escalated'];
    if (!validStatuses.includes(status)) {
      return sendValidationError(res, { status: 'Invalid status' });
    }
    if (resolutionSummary && resolutionSummary.length > 2000) {
      return sendValidationError(res, { resolutionSummary: 'Must be 2000 characters or fewer' });
    }
    if (normalizedResolutionStatus && normalizedResolutionStatus.length > 100) {
      return sendValidationError(res, { resolutionStatus: 'Must be 100 characters or fewer' });
    }
    if (normalizedInternalNotes && normalizedInternalNotes.length > 5000) {
      return sendValidationError(res, { internalNotes: 'Must be 5000 characters or fewer' });
    }
    const validResolutionReasonCodes = [
      'resolved', 'duplicate', 'how_to', 'bug_fixed', 'billing',
      'customer_no_response', 'not_supported', 'spam', 'other',
    ];
    if (resolutionReasonCode && !validResolutionReasonCodes.includes(resolutionReasonCode)) {
      return sendValidationError(res, { resolutionReasonCode: 'Invalid resolution reason code' });
    }

    // Get conversation
    const convResult = await query(
      `SELECT sc.*, COALESCE(u.email, sc.guest_email) AS customer_email,
              COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
                u.email, sc.guest_name, 'Customer') AS customer_name,
              COALESCE(np.email_notifications, TRUE) AS customer_email_notifications
       FROM support_conversations sc
       LEFT JOIN users u ON u.id = sc.customer_id
       LEFT JOIN notification_preferences np ON np.user_id = sc.customer_id
       WHERE sc.id = $1`,
      [conversationId]
    );
    if (!convResult.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = convResult.rows[0];
    const statusChanged = conversation.status !== status;

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
      updateSql += `, resolved_at = CURRENT_TIMESTAMP, closed_at = NULL, resolution_status = $${params.length + 1}, resolution_summary = NULLIF($${params.length + 2}, ''), resolution_reason_code = $${params.length + 3}`;
      params.push(normalizedResolutionStatus || 'resolved');
      params.push(resolutionSummary || '');
      params.push(resolutionReasonCode || 'other');
    } else if (status === 'closed') {
      updateSql += `, closed_at = CURRENT_TIMESTAMP, resolution_status = $${params.length + 1}, resolution_summary = NULLIF($${params.length + 2}, ''), resolution_reason_code = $${params.length + 3}`;
      params.push(normalizedResolutionStatus || 'resolved');
      params.push(resolutionSummary || '');
      params.push(resolutionReasonCode || 'other');
    } else if (status === 'open' || status === 'reopened') {
      updateSql += `, resolved_at = NULL, closed_at = NULL, agent_id = NULL, assigned_at = NULL, resolution_status = NULL, resolution_summary = NULL, resolution_reason_code = NULL`;
    } else if (status === 'in_progress') {
      updateSql += `, resolved_at = NULL, closed_at = NULL`;
    }

    if (normalizedInternalNotes) {
      updateSql += `, internal_notes = $${params.length + 1}`;
      params.push(normalizedInternalNotes);
    }

    updateSql += ` WHERE id = $${params.length + 1} RETURNING *`;
    params.push(conversationId);

    const result = await withTransaction(pool, async (client) => {
      const updated = await client.query(updateSql, params);
      if (!updated.rows.length) return null;

      if (status === 'resolved' || status === 'closed') {
        await client.query(
          `UPDATE support_queue
           SET status = 'removed', removed_at = NOW(), reason_removed = $1
           WHERE conversation_id = $2 AND status <> 'removed'`,
          [status, conversationId]
        );
        await client.query(
          `UPDATE conversation_assignments
           SET status = 'completed', released_at = COALESCE(released_at, NOW()),
               duration_seconds = COALESCE(
                 duration_seconds,
                 EXTRACT(EPOCH FROM (NOW() - claimed_at))::integer
               )
           WHERE conversation_id = $1 AND status = 'active'`,
          [conversationId]
        );
      } else if (status === 'open' || status === 'pending' || status === 'reopened') {
        await client.query(
          `UPDATE support_queue
           SET status = 'waiting', removed_at = NULL, reason_removed = NULL,
               routed_to_agent_id = NULL
           WHERE conversation_id = $1`,
          [conversationId]
        );
      }
      return updated;
    }, 'update_support_conversation_status');
    if (!result) return sendError(res, 409, 'This conversation changed before its status could be updated');

    logger.info('Conversation status updated', { conversationId, status });
    await logAdminAction({
      adminId: req.user.id,
      action: 'support_conversation_status_changed',
      targetType: 'support_conversation',
      targetId: conversationId,
      description: `Support conversation status changed to ${status}`,
      before: { status: conversation.status },
      after: {
        status: result.rows[0]?.status || status,
        resolutionStatus: result.rows[0]?.resolution_status || null,
        resolutionReasonCode: result.rows[0]?.resolution_reason_code || null,
      },
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

    if (statusChanged && (status === 'resolved' || status === 'closed')) {
      // Realtime status delivery is primary; email is a durable fallback for
      // customers who are offline. Never let provider failure block the case
      // transition that was already committed above.
      void notifyCustomerOfConversationStatus(
        conversation,
        status,
        result.rows[0]?.resolution_summary,
        status === 'closed' ? result.rows[0]?.closed_at : result.rows[0]?.resolved_at
      ).catch((error) => {
        logger.warn('Customer support status email failed', {
          conversationId,
          status,
          error: error.message,
        });
      });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('updateConversationStatus error', { error: err.message });
    sendError(res, 500, 'Failed to update conversation');
  }
}

// Add message to conversation
async function addMessage(req, res) {
  let uploadedKey = null;
  try {
    const { conversationId } = req.params;
    const {
      content,
      message: legacyMessage,
      messageType = 'text',
      attachmentUrl,
      attachmentName,
      isInternal,
      is_internal: snakeCaseInternal,
      clientMessageId: bodyClientMessageId,
      client_message_id: snakeCaseClientMessageId,
    } = req.body || {};

    const normalizedContent = String(content ?? legacyMessage ?? '').trim();
    const clientMessageId = String(
      bodyClientMessageId || snakeCaseClientMessageId || req.get?.('Idempotency-Key') || ''
    ).trim() || null;
    if (clientMessageId && !CLIENT_MESSAGE_ID_PATTERN.test(clientMessageId)) {
      return sendValidationError(res, { clientMessageId: 'Must be a UUID v4 request identifier' });
    }
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
      uploadedKey = await uploadFile(req.file.buffer, 'support-conversations', req.file.originalname, req.file.mimetype);
      storedAttachmentUrl = await getSignedDownloadUrl(uploadedKey, 7 * 24 * 60 * 60);
      storedAttachmentName = req.file.originalname;
    }

    const storedMessageType = isInternalMessage ? 'internal_note' : (req.file ? 'image' : normalizedMessageType);
    // Image-only replies are valid, but the database content column is not
    // nullable. Keep a stable label alongside the attachment metadata.
    const messageContent = normalizedContent || 'Attachment';

    // Keep the message, counters, and customer re-entry transition together so
    // a failed counter update cannot leave the conversation partially written.
    const result = await withTransaction(pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO support_conversation_messages
             (conversation_id, sender_id, message_type, content, attachment_url, attachment_name, is_agent, client_message_id, channel)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (conversation_id, client_message_id) WHERE client_message_id IS NOT NULL DO NOTHING
         RETURNING *`,
        [conversationId, req.user.id, storedMessageType, messageContent, storedAttachmentUrl, storedAttachmentName, isAgent, clientMessageId, conversation.channel || 'web_chat']
      );

      if (!inserted.rows.length) {
        const existing = await client.query(
          `SELECT * FROM support_conversation_messages
           WHERE conversation_id = $1 AND client_message_id = $2`,
          [conversationId, clientMessageId]
        );
        if (!existing.rows.length) throw new Error('Idempotent support message could not be recovered');
        if (String(existing.rows[0].sender_id) !== String(req.user.id)) {
          const conflict = new Error('This message request identifier is already in use');
          conflict.statusCode = 409;
          throw conflict;
        }
        return { rows: existing.rows, duplicate: true };
      }

      const countCol = isAgent ? 'agent_message_count' : 'customer_message_count';
      await client.query(
        `UPDATE support_conversations
         SET message_count = message_count + 1,
             ${countCol} = ${countCol} + 1,
             last_channel_message_at = NOW(),
             updated_at = NOW(),
             first_response_at = CASE
               WHEN $2::boolean AND first_response_at IS NULL THEN NOW()
               ELSE first_response_at
             END,
             status = CASE
               WHEN $2::boolean AND status IN ('open', 'pending', 'reopened', 'waiting_for_agent') THEN 'in_progress'
               ELSE status
             END
         WHERE id = $1`,
        [conversationId, isAgent]
      );

      if (!isAgent && conversation.status === 'waiting_for_customer') {
        await client.query(
          'UPDATE support_conversations SET status = $1 WHERE id = $2',
          ['in_progress', conversationId]
        );
      }
      return { rows: inserted.rows, duplicate: false };
    }, 'add_support_conversation_message');

    const message = result.rows[0];
    if (result.duplicate && uploadedKey) {
      // A concurrent retry may upload before the unique request key wins.
      // Remove that unused object instead of leaving an orphan in storage.
      await deleteFile(uploadedKey).catch((cleanupError) => {
        logger.warn('Failed to clean up duplicate support attachment', {
          conversationId,
          key: uploadedKey,
          error: cleanupError.message,
        });
      });
    }
    logger.info('Message added to conversation', {
      conversationId,
      isAgent,
      messageType: storedMessageType,
      isInternal: isInternalMessage
    });
    if (isAgent && !result.duplicate) {
      void logAdminAction({
        adminId: req.user.id,
        action: 'support_message_created',
        targetType: 'support_conversation_message',
        targetId: message.id,
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
      messageId: message.id,
      ticketId: conversationId,
      sender: {
        type: isAgent ? 'agent' : 'customer',
        id: req.user.id,
        name: req.user.name
          || [req.user.first_name, req.user.last_name].filter(Boolean).join(' ').trim()
          || req.user.email
          || (isAgent ? 'Support specialist' : 'Customer'),
      },
      content: message.content || messageContent,
      attachmentUrl: message.attachment_url || storedAttachmentUrl,
      attachmentName: message.attachment_name || storedAttachmentName,
      messageType: message.message_type || storedMessageType,
      timestamp: message.created_at,
      isInternal: isInternalMessage,
    };

    // Private notes must never enter the customer ticket room.
    if (!isInternalMessage && !result.duplicate) {
      WebSocketService.broadcastToTicket(conversationId, 'message:new', eventPayload);
    }
    if (!result.duplicate) WebSocketService.broadcastToAdmins('support:conversation-updated', eventPayload);
    if (isAgent && !isInternalMessage && !result.duplicate) {
      // Realtime delivery is primary; email is the durable fallback for a
      // customer who is offline or has missed the live event.
      void notifyCustomerOfAgentReply(conversation, message).catch((error) => {
        logger.warn('Customer support reply email failed', {
          conversationId,
          messageId: message.id,
          error: error.message,
        });
      });
    }

    res.json({ success: true, data: message, idempotent: Boolean(result.duplicate) });
  } catch (err) {
    if (uploadedKey) {
      await deleteFile(uploadedKey).catch((cleanupError) => {
        logger.warn('Failed to clean up failed support attachment', {
          conversationId: req.params.conversationId,
          key: uploadedKey,
          error: cleanupError.message,
        });
      });
    }
    logger.error('addMessage error', { error: err.message });
    if (err.statusCode) return sendError(res, err.statusCode, err.message);
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

async function retryConversationEmailDelivery(req, res) {
  const conversationId = req.params.conversationId;
  try {
    const access = await authorizeConversationAccess(conversationId, req);
    if (!access.conversation) return sendError(res, 404, 'Conversation not found');
    if (!access.allowed || access.isCustomer) return sendError(res, 403, 'Only support staff can retry customer notifications');

    const result = await retryFailedSupportEmails(conversationId);
    await logAdminAction({
      adminId: req.user.id,
      action: 'support_email_delivery_retried',
      targetType: 'support_conversation',
      targetId: conversationId,
      description: `Queued ${result.queued} failed customer notification${result.queued === 1 ? '' : 's'} for retry`,
      after: { queued: result.queued },
      req,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error('retryConversationEmailDelivery error', { conversationId, error: err.message });
    return sendError(res, 500, 'Failed to retry customer notifications');
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
  getConversationLifecycle,
  getCustomer360,
  updateCustomerMessage,
  updateAgentMessage,
  redactSupportMessage,
  markConversationRead,
  downloadConversation,
  createConversationReview,
  reopenCustomerConversation,
  mergeConversation,
  updateConversationStatus,
  addMessage,
  sendConversationEmail,
  retryConversationEmailDelivery,
  getConversationStats
};
