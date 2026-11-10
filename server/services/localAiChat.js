'use strict';

/**
 * Self-hosted AI client (Ollama). Security review 2026-11-10 F-04: every AI
 * call in the server goes through this module, and it can only reach the
 * Ollama hosts allow-listed in supportChatProviders.resolveOllamaUrl. There
 * is deliberately no external provider (OpenRouter, OpenAI, Meta) and no
 * environment switch to turn one on: user conversations, documents, images
 * and voice must never leave OxSteed infrastructure.
 *
 * Env (read per call):
 *   OLLAMA_URL           base URL of the Ollama server (allow-listed hosts only)
 *   OLLAMA_MODEL         default chat model (default 'qwen2.5:3b')
 *   OLLAMA_VISION_MODEL  model for turns with an image (default OLLAMA_MODEL)
 *   OLLAMA_TIMEOUT_MS    per-call timeout, clamped 5 s .. 120 s (default 60 s)
 *
 * Returns { ok: true, reply, provider: 'ollama', model } or
 * { ok: false, error } and never throws for provider failures.
 */

const { resolveOllamaUrl } = require('./supportChatProviders');

const DEFAULT_MODEL = 'qwen2.5:3b';
const DEFAULT_TIMEOUT_MS = 60_000;
const DATA_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i;

function localAiBaseUrl(env = process.env) {
  return resolveOllamaUrl(env.OLLAMA_URL).replace(/\/$/, '');
}

function isLocalAiConfigured(env = process.env) {
  return Boolean(localAiBaseUrl(env));
}

function localAiModel(env = process.env, { vision = false } = {}) {
  const base = String(env.OLLAMA_MODEL || '').trim() || DEFAULT_MODEL;
  if (!vision) return base;
  return String(env.OLLAMA_VISION_MODEL || '').trim() || base;
}

function timeoutMs(env = process.env) {
  const raw = Number(env.OLLAMA_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(120_000, Math.max(5_000, Math.round(raw)));
}

/**
 * Accepts OpenAI-style messages (content as a string or an array of
 * {type:'text'} / {type:'image_url'} parts) and returns Ollama messages
 * (string content plus an `images` array of base64 payloads). Remote image
 * URLs are dropped: the server never fetches arbitrary URLs for the model.
 */
function toOllamaMessages(messages) {
  let hasImage = false;
  const out = (Array.isArray(messages) ? messages : []).map((m) => {
    const role = ['system', 'user', 'assistant', 'tool'].includes(m?.role) ? m.role : 'user';
    if (typeof m?.content === 'string') return { role, content: m.content };
    if (!Array.isArray(m?.content)) return { role, content: String(m?.content ?? '') };
    const texts = [];
    const images = [];
    for (const part of m.content) {
      if (part?.type === 'text' && typeof part.text === 'string') texts.push(part.text);
      if (part?.type === 'image_url') {
        const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
        const match = typeof url === 'string' ? url.match(DATA_URL_RE) : null;
        if (match) images.push(match[1]);
      }
    }
    if (images.length) hasImage = true;
    return images.length ? { role, content: texts.join('\n'), images } : { role, content: texts.join('\n') };
  });
  return { messages: out, hasImage };
}

/**
 * @param {Array} messages OpenAI-style chat messages
 * @param {{temperature?:number, maxTokens?:number, model?:string,
 *          format?:'json'|object, options?:object, env?:object}} [opts]
 */
async function fetchLocalAiChat(messages, opts = {}) {
  const env = opts.env || process.env;
  const base = localAiBaseUrl(env);
  if (!base) return { ok: false, error: 'OLLAMA_URL not configured' };
  const { messages: ollamaMessages, hasImage } = toOllamaMessages(messages);
  const model = opts.model || localAiModel(env, { vision: hasImage });
  const options = { ...(opts.options || {}) };
  if (opts.temperature != null && options.temperature == null) options.temperature = opts.temperature;
  if (opts.maxTokens != null && options.num_predict == null) options.num_predict = opts.maxTokens;
  try {
    const res = await fetch(`${base}/api/chat`, {
      signal: AbortSignal.timeout(opts.timeoutMs || timeoutMs(env)),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: ollamaMessages,
        stream: false,
        ...(opts.format ? { format: opts.format } : {}),
        ...(Object.keys(options).length ? { options } : {}),
      }),
    });
    if (!res.ok) {
      const errText = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
      return { ok: false, error: `HTTP ${res.status}: ${errText.slice(0, 300)}` };
    }
    let data;
    try {
      data = typeof res.text === 'function' ? JSON.parse(await res.text()) : await res.json();
    } catch {
      return { ok: false, error: 'non-JSON response' };
    }
    const reply = String(data?.message?.content ?? '').trim();
    if (!reply) return { ok: false, error: 'empty assistant content' };
    return { ok: true, reply, provider: 'ollama', model };
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { ok: false, error: timedOut ? 'provider timeout' : (err?.message || 'provider error') };
  }
}

module.exports = {
  DEFAULT_MODEL,
  fetchLocalAiChat,
  isLocalAiConfigured,
  localAiBaseUrl,
  localAiModel,
  toOllamaMessages,
  timeoutMs,
};
