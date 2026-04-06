const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama-api-p116fo3uwyxytib7ph3yleei:11434';

const SYSTEM_PROMPT = `You are OxSteed's friendly AI assistant. OxSteed is a local services marketplace where customers post jobs and skilled helpers bid on them.

Key facts about OxSteed:
- Customers can post jobs for free (home repair, cleaning, moving, landscaping, etc.)
- Helpers list their skills and bid on jobs
- OxSteed offers optional escrow payment protection
- Pro subscriptions give helpers verified badges, priority placement, and bid alerts
- Users can message each other through the built-in chat
- Background checks and ID verification are available for helpers

Be concise, helpful, and friendly. If you don't know something specific about a user's account, suggest they contact support@oxsteed.com or check their dashboard. Keep responses under 3 sentences when possible.`;

exports.chatMessage = async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Build conversation with system prompt
    const ollamaMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.slice(-10).map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: String(m.content).slice(0, 1000),
      })),
    ];

    const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || 'qwen2.5:3b',
        messages: ollamaMessages,
        stream: false,
        options: { temperature: 0.7, num_predict: 256 },
      }),
    });

    if (!ollamaRes.ok) {
      console.error('[Chat] Ollama error:', ollamaRes.status, await ollamaRes.text());
      return res.status(502).json({ error: 'AI service temporarily unavailable' });
    }

    const data = await ollamaRes.json();
    res.json({ reply: data.message?.content || 'Sorry, I could not generate a response.' });
  } catch (err) {
    console.error('[Chat] Error:', err.message);
    res.status(500).json({ error: 'AI service temporarily unavailable. Please try again.' });
  }
};
