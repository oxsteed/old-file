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
  'growth-ollama',
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

// ── Per-locale quality settings for the AI support chat (item 7) ─────────

const SUPPORT_CHAT_LOCALES = Object.freeze(['en', 'es', 'fr', 'ht', 'ar']);
const DEFAULT_SUPPORT_CHAT_MODEL = 'openrouter/free';
// Spanish/French/Haitian Creole/Arabic replies need more tokens than English
// for the same content (longer words, non-Latin script), so they get more
// headroom instead of being cut off mid-step.
const DEFAULT_SUPPORT_MAX_TOKENS = 700;
const LOCALE_TOKEN_FACTOR = Object.freeze({ en: 1, es: 1.15, fr: 1.15, ht: 1.25, ar: 1.35 });
const MIN_MAX_TOKENS = 200;
const MAX_MAX_TOKENS = 1500;

function supportLocale(language) {
  return SUPPORT_CHAT_LOCALES.includes(language) ? language : 'en';
}

/**
 * OpenRouter model for a support-chat locale. OPENROUTER_CHAT_MODEL_<LOCALE>
 * (e.g. OPENROUTER_CHAT_MODEL_HT) wins, then OPENROUTER_CHAT_MODEL, then
 * OPENROUTER_SUPPORT_MODEL, then the free router. Read per call so an ops
 * change needs no code change.
 */
function supportChatModelForLocale(language, env = process.env) {
  const loc = supportLocale(language);
  const perLocale = env[`OPENROUTER_CHAT_MODEL_${loc.toUpperCase()}`];
  const pick = [perLocale, env.OPENROUTER_CHAT_MODEL, env.OPENROUTER_SUPPORT_MODEL]
    .find((v) => typeof v === 'string' && v.trim());
  return pick ? pick.trim() : DEFAULT_SUPPORT_CHAT_MODEL;
}

/** max_tokens for a support-chat locale (OPENROUTER_CHAT_MAX_TOKENS base). */
function supportChatMaxTokens(language, env = process.env) {
  const raw = Number(env.OPENROUTER_CHAT_MAX_TOKENS);
  const base = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SUPPORT_MAX_TOKENS;
  const scaled = Math.round(base * (LOCALE_TOKEN_FACTOR[supportLocale(language)] || 1));
  return Math.min(MAX_MAX_TOKENS, Math.max(MIN_MAX_TOKENS, scaled));
}

module.exports = {
  SUPPORT_CHAT_LOCALES,
  DEFAULT_SUPPORT_CHAT_MODEL,
  supportChatModelForLocale,
  supportChatMaxTokens,
  OLLAMA_ALLOWED_HOSTS,
  resolveOllamaUrl,
  isOpenRouterConfigured,
  isSupportChatProviderConfigured,
};
