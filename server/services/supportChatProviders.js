'use strict';

/**
 * Provider configuration for the AI chat paths in chatController
 * (support chat, profile chat, financial advisor). The chain is
 * OpenRouter -> Ollama; Meta and OpenAI are not used (see 73b35845).
 * featureCapabilities uses the same rules so the `aiSupport` capability is
 * on exactly when at least one provider in that chain can answer.
 */

// Ollama hosts the server may call. Anything else is ignored to prevent SSRF
// through a misconfigured OLLAMA_URL.
const OLLAMA_ALLOWED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '::1',
  'ollama-api',
  'ollama-api-p116fo3uwyxytib7ph3yleei',
];

/**
 * Returns the validated Ollama base URL, or '' when unset or not allowed.
 * `log` (optional) receives the same warnings the controller always logged.
 */
function resolveOllamaUrl(raw, log = null) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return '';
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol)) {
      log?.warn('[Chat] OLLAMA_URL has unsupported protocol - ignoring', { url: value });
      return '';
    }
    // URL.hostname wraps IPv6 literals in brackets.
    const hostname = u.hostname.replace(/^\[|\]$/g, '');
    if (!OLLAMA_ALLOWED_HOSTS.includes(hostname)) {
      log?.warn('[Chat] OLLAMA_URL hostname is not localhost - ignoring to prevent SSRF', { hostname: u.hostname });
      return '';
    }
    return value;
  } catch {
    log?.warn('[Chat] OLLAMA_URL is not a valid URL - ignoring', { url: value });
    return '';
  }
}

function isOpenRouterConfigured(env = process.env) {
  return typeof env.OPENROUTER_API_KEY === 'string' && env.OPENROUTER_API_KEY.trim().length > 0;
}

/** True when at least one provider the chat chain actually calls is usable. */
function isSupportChatProviderConfigured(env = process.env) {
  return isOpenRouterConfigured(env) || Boolean(resolveOllamaUrl(env.OLLAMA_URL));
}

module.exports = {
  OLLAMA_ALLOWED_HOSTS,
  resolveOllamaUrl,
  isOpenRouterConfigured,
  isSupportChatProviderConfigured,
};
