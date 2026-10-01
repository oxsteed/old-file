const pool = require('../db');
const { query } = pool;
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');
const supportEmployerService = require('../services/supportEmployerService');
const WebSocketService = require('../services/websocketService');
const { logAdminAction } = require('../services/auditService');
const { withTransaction } = require('../utils/transaction');
const { sendNotification } = require('../services/notificationService');
const { isMetaConfigured, getMetaModel, fetchMetaChat } = require('../services/aiChatProvider');

const SUPPORTED_LANGUAGES = new Set(['en', 'es', 'fr', 'ht', 'ar']);

async function authorizeBusinessConversation(req, conversation) {
  if (!conversation || String(conversation.business_id) !== String(req.params.businessId)) return false;
  if (supportEmployerService.isPlatformAdmin(req.user.role)) return true;
  return supportEmployerService.userCanAccessBusinessConversations(
    req.params.businessId,
    req.user.id,
    req.user.role
  );
}

async function canAccessBusiness(req) {
  if (supportEmployerService.isPlatformAdmin(req.user.role)) return true;
  return supportEmployerService.userCanAccessBusinessConversations(
    req.params.businessId,
    req.user.id,
    req.user.role
  );
}

async function sendMessage(req, res) {
  try {
    const { businessId } = req.params;
    const conversationId = req.params.conversationId || req.body?.conversationId;
    const { content, language } = req.body;

    if (!conversationId) {
      return sendValidationError(res, { conversationId: 'Required' });
    }
    if (!content || !String(content).trim() || String(content).trim().length > 5000) {
      return sendValidationError(res, { content: 'Required and must be 5000 characters or fewer' });
    }

    const conv = await query(
      'SELECT * FROM support_conversations WHERE id = $1 AND business_id = $2',
      [conversationId, businessId]
    );
    if (!conv.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = conv.rows[0];
    if (['resolved', 'closed', 'merged'].includes(conversation.status)) {
      return sendError(res, 409, 'Closed conversations cannot receive AI drafts');
    }
    if (!(await authorizeBusinessConversation(req, conversation))) {
      return sendError(res, 403, 'Access denied');
    }
    const selectedLanguage = String(language || 'en').trim().toLowerCase();
    if (!SUPPORTED_LANGUAGES.has(selectedLanguage)) {
      return sendValidationError(res, { language: 'Unsupported language' });
    }

    try {
      const { text: response, model: aiModel } = await callAiSupportDraft(String(content).trim(), selectedLanguage);
      const draft = await query(
        `INSERT INTO support_ai_reply_drafts
         (business_id, conversation_id, requested_by, source_content, draft_content, language, ai_model)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, business_id, conversation_id, requested_by, source_content,
                   draft_content, language, ai_model, status, created_at, updated_at`,
        [businessId, conversationId, req.user.id, String(content).trim(), response, selectedLanguage, aiModel]
      );
      await logAdminAction({
        adminId: req.user.id,
        action: 'support_ai_reply_draft_previewed',
        targetType: 'support_conversation',
        targetId: conversationId,
        description: 'AI support reply draft generated for human review',
        after: { draftId: draft.rows[0]?.id, language: selectedLanguage, isPublic: false },
        req,
      });

      res.status(201).json({
        success: true,
        draft: true,
        data: draft.rows[0],
        message: 'AI draft ready for review; it has not been sent to the customer.',
      });
    } catch (aiErr) {
      logger.error('AI call failed', { error: aiErr.message });
      sendError(res, 503, 'AI draft is unavailable; use manual reply instead');
    }
  } catch (err) {
    logger.error('sendMessage error', { error: err.message });
    sendError(res, 500, 'Failed to send message');
  }
}

async function applyDraft(req, res) {
  try {
    const { businessId, draftId } = req.params;
    if (req.user.role === 'customer') return sendError(res, 403, 'Only support staff can apply AI drafts');

    const result = await withTransaction(pool, async (client) => {
      const draftResult = await client.query(
        `SELECT d.*, c.status AS conversation_status, c.customer_id, c.agent_id
         FROM support_ai_reply_drafts d
         JOIN support_conversations c ON c.id = d.conversation_id
         WHERE d.id = $1 AND d.business_id = $2
         FOR UPDATE`,
        [draftId, businessId]
      );
      if (!draftResult.rows.length) return { notFound: true };
      const draft = draftResult.rows[0];
      const conversation = {
        id: draft.conversation_id,
        business_id: businessId,
        customer_id: draft.customer_id,
        agent_id: draft.agent_id,
      };
      if (!(await authorizeBusinessConversation(req, conversation))) return { forbidden: true };
      if (draft.status !== 'pending') return { invalidState: true, status: draft.status };
      if (['resolved', 'closed', 'merged'].includes(draft.conversation_status)) return { closed: true };

      const messageResult = await client.query(
        `INSERT INTO support_conversation_messages
         (conversation_id, sender_id, message_type, content, is_ai, ai_model, is_agent)
         VALUES ($1, $2, 'text', $3, true, $4, true)
         RETURNING *`,
        [draft.conversation_id, req.user.id, draft.draft_content, draft.ai_model]
      );
      const message = messageResult.rows[0];

      await client.query(
        `UPDATE support_ai_reply_drafts
         SET status = 'applied', applied_by = $1, applied_message_id = $2,
             applied_at = NOW(), updated_at = NOW()
         WHERE id = $3 AND status = 'pending'`,
        [req.user.id, message.id, draftId]
      );
      await client.query(
        `UPDATE support_conversations
         SET message_count = message_count + 1,
             agent_message_count = agent_message_count + 1,
             first_response_at = COALESCE(first_response_at, NOW()),
             updated_at = NOW()
         WHERE id = $1`,
        [draft.conversation_id]
      );
      return { draft, message };
    }, 'apply_support_ai_reply_draft');

    if (result.notFound) return sendError(res, 404, 'AI draft not found');
    if (result.forbidden) return sendError(res, 403, 'Access denied');
    if (result.invalidState) return sendError(res, 409, `AI draft is already ${result.status}`);
    if (result.closed) return sendError(res, 409, 'Closed conversations cannot receive AI replies');

    if (result.draft.customer_id) {
      void sendNotification({
        userId: result.draft.customer_id,
        type: 'new_message',
        title: 'New support message',
        body: String(result.message.content || '').slice(0, 280),
        data: {
          supportConversationId: String(result.draft.conversation_id),
          messageId: String(result.message.id),
        },
        action_url: '/support/escalation',
        idempotencyKey: `support-ai-message:${result.draft.conversation_id}:${result.message.id}:${result.draft.customer_id}`,
      }).catch((error) => {
        logger.warn('AI support reply notification failed', {
          conversationId: result.draft.conversation_id,
          messageId: result.message.id,
          error: error.message,
        });
      });
    }

    await logAdminAction({
      adminId: req.user.id,
      action: 'support_ai_reply_draft_applied',
      targetType: 'support_conversation',
      targetId: result.draft.conversation_id,
      description: 'Human-approved AI support draft sent as a public reply',
      after: { draftId, messageId: result.message.id, isPublic: true },
      req,
    });
    WebSocketService.broadcastToTicket(result.draft.conversation_id, 'message:new', {
      ticketId: result.draft.conversation_id,
      conversationId: result.draft.conversation_id,
      messageId: result.message.id,
      content: result.message.content,
      isInternal: false,
      isAI: true,
      timestamp: result.message.created_at,
    });
    return res.status(201).json({ success: true, data: result.message });
  } catch (err) {
    logger.error('applyDraft error', { error: err.message });
    return sendError(res, 500, 'Failed to apply AI draft');
  }
}

async function discardDraft(req, res) {
  try {
    const { businessId, draftId } = req.params;
    if (req.user.role === 'customer') return sendError(res, 403, 'Only support staff can discard AI drafts');
    const draftResult = await query(
      `SELECT d.*, c.customer_id, c.agent_id
       FROM support_ai_reply_drafts d
       JOIN support_conversations c ON c.id = d.conversation_id
       WHERE d.id = $1 AND d.business_id = $2`,
      [draftId, businessId]
    );
    if (!draftResult.rows.length) return sendError(res, 404, 'AI draft not found');
    const draft = draftResult.rows[0];
    if (!(await authorizeBusinessConversation(req, { ...draft, business_id: businessId }))) return sendError(res, 403, 'Access denied');
    const result = await query(
      `UPDATE support_ai_reply_drafts
       SET status = 'discarded', updated_at = NOW()
       WHERE id = $1 AND business_id = $2 AND status = 'pending'
       RETURNING id, status, updated_at`,
      [draftId, businessId]
    );
    if (!result.rows.length) return sendError(res, 409, 'AI draft is no longer pending');
    await logAdminAction({
      adminId: req.user.id,
      action: 'support_ai_reply_draft_discarded',
      targetType: 'support_conversation',
      targetId: draft.conversation_id,
      description: 'AI support draft discarded by support staff',
      after: { draftId },
      req,
    });
    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('discardDraft error', { error: err.message });
    return sendError(res, 500, 'Failed to discard AI draft');
  }
}

async function checkNeedsHandoff(req, res) {
  try {
    const { conversationId } = req.params;
    const { messageCount, sentiment } = req.body;

    const conv = await query('SELECT * FROM support_conversations WHERE id = $1', [conversationId]);
    if (!conv.rows.length) return sendError(res, 404, 'Conversation not found');
    if (!(await authorizeBusinessConversation(req, conv.rows[0]))) {
      return sendError(res, 403, 'Access denied');
    }

    let needsHandoff = false;
    const reasons = [];

    const normalizedMessageCount = Number(messageCount);
    if (Number.isFinite(normalizedMessageCount) && normalizedMessageCount > 3) {
      needsHandoff = true;
      reasons.push('Multiple messages exchanged');
    }

    if (sentiment === 'negative') {
      needsHandoff = true;
      reasons.push('Negative sentiment detected');
    }

    res.json({
      success: true,
      data: {
        needsHandoff,
        reasons,
        recommendation: needsHandoff ? 'Route to agent' : 'Continue with AI'
      }
    });
  } catch (err) {
    logger.error('checkNeedsHandoff error', { error: err.message });
    sendError(res, 500, 'Failed to check handoff');
  }
}

async function suggestKBArticles(req, res) {
  try {
    const { businessId, conversationId } = req.params;
    const { query: messageContent } = req.query;

    if (!messageContent || String(messageContent).trim().length > 500) {
      return sendValidationError(res, { query: 'Required' });
    }
    if (!(await canAccessBusiness(req))) return sendError(res, 403, 'Access denied');

    const result = await query(
      `SELECT kba.* FROM knowledge_base_articles kba
       JOIN knowledge_base_search_index kbsi ON kba.id = kbsi.article_id
       WHERE kba.business_id = $1 AND kba.is_published = true
       AND to_tsvector('english', kbsi.search_text) @@ plainto_tsquery('english', $2)
       ORDER BY kba.view_count DESC LIMIT 5`,
      [businessId, String(messageContent).trim()]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('suggestKBArticles error', { error: err.message });
    sendError(res, 500, 'Failed to suggest articles');
  }
}

async function suggestResponses(req, res) {
  try {
    const { businessId } = req.params;
    const { query: messageContent, language } = req.query;

    if (!messageContent || String(messageContent).trim().length > 500) {
      return sendValidationError(res, { query: 'Required' });
    }
    if (!(await canAccessBusiness(req))) return sendError(res, 403, 'Access denied');

    const selectedLanguage = String(language || 'en').trim().toLowerCase();
    if (!SUPPORTED_LANGUAGES.has(selectedLanguage)) {
      return sendValidationError(res, { language: 'Unsupported language' });
    }

    const words = String(messageContent).trim().toLowerCase().split(/\s+/).slice(0, 50);
    const categories = await query(
      `SELECT DISTINCT category FROM canned_responses
       WHERE business_id = $1 AND is_active = true
       AND (title ILIKE ANY($2) OR content ILIKE ANY($3))
       LIMIT 5`,
      [businessId, words.map(w => `%${w}%`), words.map(w => `%${w}%`)]
    );

    let responses = [];
    for (const cat of categories.rows) {
      const catResponses = await query(
        `SELECT * FROM canned_responses
         WHERE business_id = $1 AND category = $2 AND is_active = true
         AND language = $3 LIMIT 2`,
        [businessId, cat.category, selectedLanguage]
      );
      responses = [...responses, ...catResponses.rows];
    }

    res.json({ success: true, data: responses.slice(0, 5) });
  } catch (err) {
    logger.error('suggestResponses error', { error: err.message });
    sendError(res, 500, 'Failed to suggest responses');
  }
}

async function callOpenRouter(content, language) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }

  const systemPrompt = `You are a helpful support chatbot. Keep responses concise and professional.
    Be empathetic and try to solve the customer's issue. If you cannot help, suggest escalation to a human agent.
    Language: ${language}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://oxsteed.com',
        'X-Title': 'OxSteed Support'
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_CHAT_MODEL
          || process.env.OPENROUTER_SUPPORT_MODEL
          || 'openrouter/free',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: content }
        ],
        temperature: 0.7,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.statusText}`);
    }

    const data = await response.json();
    const generated = data?.choices?.[0]?.message?.content;
    if (typeof generated !== 'string' || !generated.trim() || generated.trim().length > 5000) {
      throw new Error('OpenRouter returned an invalid response');
    }
    const normalized = generated.trim();
    if (/<\/?[a-z][^>]*>/i.test(normalized)) {
      throw new Error('OpenRouter returned unsupported markup');
    }
    return normalized;
  } catch (err) {
    logger.error('OpenRouter API call failed', { error: err.message });
    throw err;
  }
}

/**
 * Same support-draft contract as callOpenRouter, but served by the Meta
 * Model API (Muse Spark). Applies the same output guardrails: non-empty,
 * max 5000 chars, no HTML markup.
 */
async function callMetaAI(content, language) {
  const model = getMetaModel();
  const systemPrompt = `You are a helpful support chatbot. Keep responses concise and professional.
    Be empathetic and try to solve the customer's issue. If you cannot help, suggest escalation to a human agent.
    Language: ${language}`;

  const result = await fetchMetaChat(model, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content },
  ], { temperature: 0.7, maxTokens: 1500 });

  if (!result.ok) {
    const err = new Error(`Meta AI draft failed: ${result.error}`);
    err.code = 'META_AI_FAILED';
    throw err;
  }
  const normalized = result.reply.trim();
  if (!normalized || normalized.length > 5000) {
    throw new Error('Meta AI returned an invalid response');
  }
  if (/<\/?[a-z][^>]*>/i.test(normalized)) {
    throw new Error('Meta AI returned unsupported markup');
  }
  return { text: normalized, model: `meta/${model}` };
}

/**
 * Support-draft provider chain: Meta (Muse Spark) first when configured,
 * OpenRouter as fallback. Returns { text, model } so the draft row records
 * which provider actually generated it.
 */
async function callAiSupportDraft(content, language) {
  if (isMetaConfigured()) {
    try {
      return await callMetaAI(content, language);
    } catch (err) {
      logger.warn('Meta AI support draft failed, falling back to OpenRouter', { error: err.message });
    }
  }
  const text = await callOpenRouter(content, language);
  return { text, model: 'openrouter' };
}

module.exports = {
  sendMessage, applyDraft, discardDraft, checkNeedsHandoff, suggestKBArticles, suggestResponses
};
