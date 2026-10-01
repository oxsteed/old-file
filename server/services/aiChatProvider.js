/**
 * Meta Model API chat provider (Muse Spark family).
 *
 * OpenAI-compatible `POST {base}/chat/completions` with Bearer auth.
 * Returns the same `{ ok, reply } / { ok: false, error }` shape as the
 * existing OpenRouter/Ollama fetchers in chatController so it drops into
 * the same fallback chains.
 *
 * Env vars:
 *   META_AI_API_KEY    (required)  Key from the dev.meta.ai console (LLM|...).
 *   META_AI_BASE_URL   (optional)  Default 'https://api.meta.ai/v1'.
 *   META_AI_MODEL      (optional)  Default 'muse-spark-1.3'.
 *   META_AI_TIMEOUT_MS (optional)  Default 20000.
 *
 * When META_AI_API_KEY is absent the provider reports itself as not
 * configured and callers skip it, preserving today's behavior exactly.
 */

const logger = require('../utils/logger');

const DEFAULT_BASE_URL = 'https://api.meta.ai/v1';
const DEFAULT_MODEL = 'muse-spark-1.3';
const DEFAULT_TIMEOUT_MS = 20_000;

function getConfig() {
  return {
    apiKey: process.env.META_AI_API_KEY || '',
    baseUrl: (process.env.META_AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
    model: process.env.META_AI_MODEL || DEFAULT_MODEL,
    timeoutMs: Math.max(1000, Number(process.env.META_AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
  };
}

function isMetaConfigured() {
  return Boolean(process.env.META_AI_API_KEY);
}

function getMetaModel() {
  return process.env.META_AI_MODEL || DEFAULT_MODEL;
}

/**
 * POST a chat-completions request to the Meta Model API.
 * @param {string} model - model id, e.g. 'muse-spark-1.3'
 * @param {Array<{role:string,content:string}>} messages
 * @param {{temperature?:number, maxTokens?:number}} [options]
 * @returns {Promise<{ok:true, reply:string}|{ok:false, error:string}>}
 */
async function fetchMetaChat(model, messages, options = {}) {
  const { apiKey, baseUrl, timeoutMs } = getConfig();
  if (!apiKey) {
    return { ok: false, error: 'META_AI_API_KEY not set' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.65,
        max_tokens: options.maxTokens ?? 400,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${errText.slice(0, 500)}` };
    }
    const data = await res.json();
    let content = data.choices?.[0]?.message?.content;
    if (content == null) content = '';
    if (typeof content !== 'string') content = String(content);
    const reply = content.trim();
    if (!reply) {
      return { ok: false, error: 'empty assistant content' };
    }
    return { ok: true, reply };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: `Meta AI timeout after ${timeoutMs}ms` };
    }
    logger.warn('[MetaAI] chat request failed', { error: err.message });
    return { ok: false, error: err.message || 'Meta AI request failed' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  isMetaConfigured,
  getMetaModel,
  fetchMetaChat,
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
};
