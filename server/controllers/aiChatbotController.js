const { query } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');

async function sendMessage(req, res) {
  try {
    const { businessId, conversationId } = req.params;
    const { content, language } = req.body;

    if (!content) {
      return sendValidationError(res, { content: 'Required' });
    }

    const conv = await query('SELECT * FROM support_conversations WHERE id = $1', [conversationId]);
    if (!conv.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = conv.rows[0];

    try {
      const response = await callOpenRouter(content, language || 'en');

      const msgResult = await query(
        `INSERT INTO support_conversation_messages
         (conversation_id, sender_id, message_type, content, is_ai, ai_model, is_agent)
         VALUES ($1, (SELECT id FROM users WHERE email = 'system@oxsteed.com'), 'text', $2, true, 'openrouter', false)
         RETURNING *`,
        [conversationId, response]
      );

      await query(
        'UPDATE support_conversations SET message_count = message_count + 1, agent_message_count = agent_message_count + 1 WHERE id = $1',
        [conversationId]
      );

      res.json({ success: true, data: msgResult.rows[0] });
    } catch (aiErr) {
      logger.error('AI call failed', { error: aiErr.message });
      sendError(res, 500, 'Failed to get AI response');
    }
  } catch (err) {
    logger.error('sendMessage error', { error: err.message });
    sendError(res, 500, 'Failed to send message');
  }
}

async function checkNeedsHandoff(req, res) {
  try {
    const { conversationId } = req.params;
    const { messageCount, sentiment } = req.body;

    const conv = await query('SELECT * FROM support_conversations WHERE id = $1', [conversationId]);
    if (!conv.rows.length) return sendError(res, 404, 'Conversation not found');

    let needsHandoff = false;
    const reasons = [];

    if (messageCount > 3) {
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

    if (!messageContent) {
      return sendValidationError(res, { query: 'Required' });
    }

    const result = await query(
      `SELECT kba.* FROM knowledge_base_articles kba
       JOIN knowledge_base_search_index kbsi ON kba.id = kbsi.article_id
       WHERE kba.business_id = $1 AND kba.is_published = true
       AND to_tsvector('english', kbsi.search_text) @@ plainto_tsquery('english', $2)
       ORDER BY kba.view_count DESC LIMIT 5`,
      [businessId, messageContent]
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

    if (!messageContent) {
      return sendValidationError(res, { query: 'Required' });
    }

    const words = messageContent.toLowerCase().split(/\s+/);
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
        [businessId, cat.category, language || 'en']
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
        model: 'gpt-3.5-turbo',
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
    return data.choices[0].message.content;
  } catch (err) {
    logger.error('OpenRouter API call failed', { error: err.message });
    throw err;
  }
}

module.exports = {
  sendMessage, checkNeedsHandoff, suggestKBArticles, suggestResponses
};
