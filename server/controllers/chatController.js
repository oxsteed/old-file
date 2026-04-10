const logger = require('../utils/logger');

// Validate OLLAMA_URL at startup to prevent SSRF via misconfigured env
const OLLAMA_URL = (() => {
  const raw = process.env.OLLAMA_URL || '';
  if (!raw) return '';
  try {
    const u = new URL(raw);
    // Only allow http/https to localhost or 127.x — not arbitrary internal hosts
    const allowedHosts = ['localhost', '127.0.0.1', '::1'];
    if (!['http:', 'https:'].includes(u.protocol)) {
      logger.warn('[Chat] OLLAMA_URL has unsupported protocol — ignoring', { url: raw });
      return '';
    }
    if (!allowedHosts.includes(u.hostname)) {
      logger.warn('[Chat] OLLAMA_URL hostname is not localhost — using as configured', { hostname: u.hostname });
    }
    return raw;
  } catch {
    logger.warn('[Chat] OLLAMA_URL is not a valid URL — ignoring', { url: raw });
    return '';
  }
})();

const SYSTEM_PROMPT = `You are OxSteed's AI assistant — friendly, concise, and knowledgeable about the OxSteed local services marketplace.

## About OxSteed
OxSteed connects customers with local skilled helpers for jobs like home repair, cleaning, moving, landscaping, plumbing, electrical work, HVAC, painting, and more.

## How It Works
- **Customers** post jobs for free. Helpers bid on them. Customer picks the best bid.
- **Helpers** list their skills, set hourly rates, and bid on jobs. Free plan available; Pro subscription adds verified badge, priority placement, and instant bid alerts.
- **Payments**: optional escrow (funds held until job is complete), credit card via Stripe. Platform fee applies.
- **Escrow**: for high-trust jobs, funds are authorized at checkout and only captured when the customer marks the job complete.
- **Messaging**: built-in chat between customer and helper once a bid is accepted.
- **Verification**: helpers can complete ID verification (Didit) and background checks (Checkr) for a verified badge.

## Key Features
- Browse helpers by skill and location, filter by distance/rating
- Post a job in under 2 minutes, get bids same day
- Rate and review helpers after job completion
- Dispute resolution available for payment issues
- Tool rentals — helpers can list equipment for rent
- SMS and email notifications for bids, messages, job updates

## Pricing
- Customers: free to post jobs; small platform fee on payments
- Helpers Free: bid on up to 5 jobs/month, basic listing
- Helpers Pro: unlimited bids, verified badge, priority in search, instant alerts (monthly subscription)
- Trial period available for new helpers

## Common Questions You Know
- To post a job: sign up as a customer → click "Post a Job" → fill in details → submit
- To become a helper: sign up as a helper → complete profile → list your skills → start bidding
- To pay: customer approves bid → checkout with card → funds held until job done
- To dispute: go to Dashboard → job → "Open Dispute" within the dispute window

## Response Guidelines
- Be warm, direct, and helpful — never robotic
- Keep answers under 4 sentences unless the question genuinely needs more detail
- Use simple formatting: bullet points for lists, **bold** for key terms
- If you don't know something specific about a user's account, tell them to check their Dashboard or email support@oxsteed.com
- Never make up pricing, policies, or features you're not sure about — say "I'm not certain — check support@oxsteed.com"
- If asked something off-topic, gently redirect: "I'm focused on OxSteed questions — happy to help with anything about the platform!"`;

exports.chatMessage = async (req, res) => {
  try {
    const { messages, pageContext } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // 4. Page context awareness — append current page info to system prompt
    let systemPrompt = SYSTEM_PROMPT;
    if (pageContext?.path) {
      const pathHint = pageContext.path.startsWith('/post-job')
        ? 'The user is currently on the Post a Job page.'
        : pageContext.path.startsWith('/helpers')
        ? 'The user is currently browsing helpers.'
        : pageContext.path.startsWith('/dashboard')
        ? 'The user is currently in their Dashboard.'
        : pageContext.path.startsWith('/subscription')
        ? 'The user is currently on the Subscription page.'
        : null;
      if (pathHint) systemPrompt += `\n\n## Current Page Context\n${pathHint} Tailor your response to be relevant to what they are doing.`;
    }

    // Sanitize and limit conversation history
    const history = messages
      .slice(-12)
      .map(m => ({
        role: ['user', 'assistant'].includes(m.role) ? m.role : 'user',
        content: String(m.content || '').slice(0, 1500),
      }))
      .filter(m => m.content.trim());

    const ollamaMessages = [
      { role: 'system', content: systemPrompt },
      ...history,
    ];

    const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || 'qwen2.5:3b',
        messages: ollamaMessages,
        stream: false,
        options: {
          temperature: 0.65,
          num_predict: 400,
          top_p: 0.9,
          repeat_penalty: 1.1,
        },
      }),
    });

    if (!ollamaRes.ok) {
      const errText = await ollamaRes.text().catch(() => '');
      logger.error('[Chat] Ollama error', { status: ollamaRes.status, body: errText });
      return res.status(502).json({ error: 'AI service temporarily unavailable' });
    }

    const data = await ollamaRes.json();
    const reply = (data.message?.content || '').trim();

    if (!reply) {
      return res.status(502).json({ error: 'AI returned an empty response' });
    }

    res.json({ reply });
  } catch (err) {
    logger.error('[Chat] Error', { message: err.message });
    res.status(500).json({ error: 'AI service temporarily unavailable. Please try again.' });
  }
};


const pool          = require('../db');
const socketService = require('../services/socketService');

/**
 * Build an AI system prompt that knows about a specific helper's profile.
 */
function buildHelperSystemPrompt(helper, skills) {
  const skillList = skills.length
    ? skills.map(s => `${s.skill_name}${s.hourly_rate ? ` ($${parseFloat(s.hourly_rate).toFixed(0)}/hr)` : ''}`).join(', ')
    : 'Not listed yet';

  return `You are an AI assistant representing ${helper.first_name} ${helper.last_name}, a helper on the OxSteed local services marketplace. Answer questions as if you are their assistant — knowledgeable, helpful, and professional.

## About This Helper
- Name: ${helper.first_name} ${helper.last_name}
- Headline: ${helper.profile_headline || 'Skilled local helper'}
- Bio: ${helper.bio_long || helper.bio_short || 'Experienced local professional available for hire.'}
- Location: ${[helper.service_city, helper.service_state].filter(Boolean).join(', ') || 'Local area'}
- Service radius: ${helper.service_radius_miles || 10} miles
- Skills: ${skillList}
- Identity verified: ${helper.is_identity_verified ? 'Yes' : 'Not yet'}
- Background checked: ${helper.is_background_checked ? 'Yes' : 'Not yet'}
- Average rating: ${helper.avg_rating ? `${parseFloat(helper.avg_rating).toFixed(1)} / 5` : 'New helper'}
- Jobs completed: ${helper.completed_jobs_count || 0}

## Your Role
- Answer questions about this helper's availability, skills, pricing, and experience
- If asked about booking or pricing specifics you don't know, invite the customer to send a message to the helper directly
- Be warm, professional, and represent this helper well
- Keep responses concise (2-4 sentences unless detail is clearly needed)
- If asked about things unrelated to this helper or OxSteed, politely redirect`;
}

/**
 * POST /api/chat/profile-message
 * Handles messages sent from a helper's profile page.
 *
 * Routing logic:
 *   destination=helper  AND helper online AND customer authenticated
 *     → saves to conversations table + notifies helper via socket (live)
 *   otherwise
 *     → AI response using helper's profile as context
 */
exports.profileChatMessage = async (req, res) => {
  try {
    const { helperId, messages: msgHistory = [], destination = 'helper' } = req.body;

    if (!helperId) return res.status(400).json({ error: 'helperId is required' });
    if (!Array.isArray(msgHistory) || msgHistory.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Fetch helper row
    const helperRes = await pool.query(
      `SELECT id, first_name, last_name, profile_headline, bio_long, bio_short,
              service_city, service_state, service_radius_miles,
              is_identity_verified, is_background_checked,
              avg_rating, completed_jobs_count
         FROM users WHERE id = $1`,
      [helperId]
    );
    if (!helperRes.rows.length) return res.status(404).json({ error: 'Helper not found' });
    const helper = helperRes.rows[0];

    // Fetch helper's listed skills for context
    const skillsRes = await pool.query(
      `SELECT skill_name, hourly_rate FROM user_skills
        WHERE user_id = $1 AND is_available = true LIMIT 20`,
      [helperId]
    ).catch(() => ({ rows: [] }));

    const helperOnline = socketService.isOnline(helperId);
    const userId = req.user?.id;

    // ── Live mode: authenticated customer + helper online + destination=helper ──
    if (destination === 'helper' && helperOnline && userId) {
      // Get or create conversation
      const existingConv = await pool.query(
        `SELECT id FROM conversations
          WHERE (customer_id = $1 AND helper_id = $2)
             OR (customer_id = $2 AND helper_id = $1)
          LIMIT 1`,
        [userId, helperId]
      );

      let conversationId;
      if (existingConv.rows.length) {
        conversationId = existingConv.rows[0].id;
      } else {
        const newConv = await pool.query(
          `INSERT INTO conversations (customer_id, helper_id)
           VALUES ($1, $2) RETURNING id`,
          [userId, helperId]
        );
        conversationId = newConv.rows[0].id;
      }

      // Save message
      const lastMsg = msgHistory[msgHistory.length - 1];
      const content = String(lastMsg.content || '').trim().slice(0, 2000);
      if (!content) return res.status(400).json({ error: 'Empty message' });

      const msgRow = await pool.query(
        `INSERT INTO messages (conversation_id, sender_id, content)
         VALUES ($1, $2, $3) RETURNING *`,
        [conversationId, userId, content]
      );
      await pool.query(
        `UPDATE conversations SET last_message_at = NOW() WHERE id = $1`,
        [conversationId]
      );

      // Notify helper via socket
      const senderRes = await pool.query(
        'SELECT first_name, last_name, profile_photo_url FROM users WHERE id = $1',
        [userId]
      ).catch(() => ({ rows: [] }));
      const sender = senderRes.rows[0];

      socketService.broadcastToUser(helperId, 'profile_chat:new_message', {
        conversationId,
        message:      msgRow.rows[0],
        senderName:   sender ? `${sender.first_name} ${sender.last_name}` : 'A customer',
        senderAvatar: sender?.profile_photo_url || null,
      });

      return res.json({
        type:           'live',
        conversationId,
        message:        msgRow.rows[0],
        helperOnline:   true,
      });
    }

    // ── AI mode: helper offline, unauthenticated, or destination=oxsteed ──
    const systemPrompt = destination === 'oxsteed'
      ? `You are OxSteed's customer support AI. Answer questions about the OxSteed platform — how to post jobs, payments, subscriptions, and policies. Be concise and helpful. For account-specific issues refer users to support@oxsteed.com.`
      : buildHelperSystemPrompt(helper, skillsRes.rows);

    const ollamaMessages = [
      { role: 'system', content: systemPrompt },
      ...msgHistory.slice(-10).map(m => ({
        role:    ['user', 'assistant'].includes(m.role) ? m.role : 'user',
        content: String(m.content || '').slice(0, 1500),
      })).filter(m => m.content.trim()),
    ];

    const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:   process.env.OLLAMA_MODEL || 'qwen2.5:3b',
        messages: ollamaMessages,
        stream:  false,
        options: { temperature: 0.6, num_predict: 350, top_p: 0.9 },
      }),
    });

    if (!ollamaRes.ok) {
      logger.error('[ProfileChat] Ollama error', { status: ollamaRes.status });
      return res.status(502).json({ error: 'AI service temporarily unavailable' });
    }

    const data  = await ollamaRes.json();
    const reply = (data.message?.content || '').trim();

    return res.json({
      type:           'ai',
      reply,
      helperOnline:   helperOnline,
      authorType:     destination === 'oxsteed' ? 'oxsteed_ai' : 'helper_ai',
    });
  } catch (err) {
    logger.error('[ProfileChat] Error', { message: err.message });
    res.status(500).json({ error: 'Chat service temporarily unavailable.' });
  }
};
