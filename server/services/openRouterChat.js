'use strict';

/**
 * Shared OpenRouter chat-completions client for the AI paths that must not
 * call the Meta Model API (Emile's 2026-10-14 standing rule: OpenRouter-only
 * on every user-facing path; server/services/aiChatProvider.js stays defined
 * but unused). Mirrors the established OpenRouter call pattern in
 * chatController (OpenAI-compatible POST {base}/chat/completions, Bearer
 * OPENROUTER_API_KEY, {model, messages, temperature, max_tokens},
 * AbortSignal timeout) and returns the same {ok:true, reply} /
 * {ok:false, error} shape as fetchMetaChat so call sites swap 1:1.
 *
 * Env vars (read per call so an ops change needs no code change):
 *   OPENROUTER_API_KEY      (required)
 *   OPENROUTER_BASE_URL     (optional, default 'https://openrouter.ai/api/v1')
 *   OPENROUTER_CHAT_MODEL   (optional)
 *   OPENROUTER_SUPPORT_MODEL(optional, fallback when OPENROUTER_CHAT_MODEL is unset)
 *   OPENROUTER_TIMEOUT_MS   (optional, clamped 5s..60s, default 25s)
 */

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openrouter/free';
const DEFAULT_TIMEOUT_MS = 25_000;

function isOpenRouterConfigured(env = process.env) {
  return (
    typeof env.OPENROUTER_API_KEY === 'string' &&
    env.OPENROUTER_API_KEY.trim().length > 0
  );
}

/**
 * Chat model for the OpenRouter paths. OPENROUTER_CHAT_MODEL wins, then
 * OPENROUTER_SUPPORT_MODEL, then the free router. Read per call.
 */
function openRouterChatModel(env = process.env) {
  const pick = [env.OPENROUTER_CHAT_MODEL, env.OPENROUTER_SUPPORT_MODEL].find(
    (v) => typeof v === 'string' && v.trim().length > 0,
  );
  return pick ? pick.trim() : DEFAULT_MODEL;
}

function providerTimeoutMs() {
  const raw = Number(process.env.OPENROUTER_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(60_000, Math.max(5_000, Math.round(raw)));
}

/**
 * POST a chat-completions request to OpenRouter.
 * @param {string} model - model id, e.g. 'openrouter/free'
 * @param {Array<{role:string,content:string}>} messages
 * @param {{temperature?:number, maxTokens?:number}} [options]
 * @returns {Promise<{ok:true, reply:string}|{ok:false, error:string}>}
 */
async function fetchOpenRouterChat(model, messages, options = {}) {
  const { temperature = 0.65, maxTokens = 400 } = options;
  if (!isOpenRouterConfigured()) {
    return { ok: false, error: 'OPENROUTER_API_KEY not set' };
  }
  const baseUrl = (process.env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      // A hung provider must not hold the request (and the user) open.
      signal: AbortSignal.timeout(providerTimeoutMs()),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
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
    // Network errors and timeouts fail closed; callers map these to their
    // own safe rejected/null shapes and never surface provider errors.
    const code = err?.name === 'TimeoutError' ? 'provider timeout' : err?.message || 'provider error';
    return { ok: false, error: code };
  }
}

module.exports = {
  isOpenRouterConfigured,
  openRouterChatModel,
  fetchOpenRouterChat,
};
