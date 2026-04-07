const logger = require('../utils/logger');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama-api-p116fo3uwyxytib7ph3yleei:11434';

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
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
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
      { role: 'system', content: SYSTEM_PROMPT },
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
