const logger = require('../../utils/logger');
const libreTranslateProvider = require('./libreTranslateProvider');
const openRouterProvider = require('./openRouterProvider');
const openAIProvider = require('./openAIProvider');

/**
 * Provider registry with explicit fallback chain.
 *
 * Selection priority:
 *   1. Caller can pass `providerId` explicitly (used by tests and admin retries).
 *   2. TRANSLATION_PRIMARY_PROVIDER env var picks the head of the chain.
 *   3. TRANSLATION_PROVIDER (legacy) is honored as a single-provider override.
 *   4. Default chain is: openrouter -> openai -> libretranslate.
 *
 * Any provider that isn't configured (env var missing) is silently skipped.
 * This means a deploy that only has OPENROUTER_API_KEY runs OpenRouter-only,
 * and a deploy with no AI keys but a LibreTranslate URL still works.
 *
 * Fallback behavior — `translateWithFallback(input)` walks the chain in order.
 * It only falls back on errors that have a `code` in the FALLBACK_TRIGGERS set
 * (network failures, upstream 5xx, timeouts, rate limits, malformed responses,
 * or PROVIDER_NOT_CONFIGURED). A 4xx error that is NOT a rate-limit is treated
 * as a deterministic caller error and is re-thrown without fallback.
 */

const ALL_PROVIDERS = {
  openrouter: openRouterProvider,
  openai: openAIProvider,
  libretranslate: libreTranslateProvider,
};

const DEFAULT_CHAIN = ['openrouter', 'openai', 'libretranslate'];

const FALLBACK_TRIGGERS = new Set([
  'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_NETWORK',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UPSTREAM_5XX',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_NON_JSON',
  'PROVIDER_RESPONSE_SHAPE',
]);

function providerIsConfigured(provider) {
  if (!provider) return false;
  if (typeof provider.isConfigured === 'function') return provider.isConfigured();
  // libretranslate doesn't export isConfigured; assume yes if module loaded.
  return true;
}

function resolveChain() {
  // Explicit env override wins (e.g. dev wants to force LibreTranslate).
  const legacy = (process.env.TRANSLATION_PROVIDER || '').trim().toLowerCase();
  if (legacy && ALL_PROVIDERS[legacy]) {
    return [legacy];
  }

  const primary = (process.env.TRANSLATION_PRIMARY_PROVIDER || '').trim().toLowerCase();
  const extra = (process.env.TRANSLATION_FALLBACK_PROVIDERS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (primary && ALL_PROVIDERS[primary]) {
    const chain = [primary, ...extra.filter((id) => id !== primary && ALL_PROVIDERS[id])];
    return chain.length ? chain : DEFAULT_CHAIN.slice();
  }

  return DEFAULT_CHAIN.slice();
}

function listConfiguredChain() {
  return resolveChain()
    .map((id) => ({ id, provider: ALL_PROVIDERS[id] }))
    .filter(({ provider }) => providerIsConfigured(provider));
}

/**
 * Backwards-compatible single-provider accessor used by older code that
 * doesn't call translateWithFallback directly. Returns the first
 * configured provider in the chain.
 */
function getTranslationProvider() {
  const chain = listConfiguredChain();
  if (chain.length) return chain[0].provider;
  // Last resort — even if unconfigured, return libreTranslate so the service
  // surfaces a useful "not configured" error instead of crashing on undefined.
  return libreTranslateProvider;
}

/**
 * Iterate the configured chain calling `provider.translate(input)`. Returns
 * the first successful result. Falls back when the error code is in
 * FALLBACK_TRIGGERS. Throws the last error if all providers fail.
 *
 * `onAttempt({ providerId, ok, err })` is invoked once per attempt for
 * observability hooks (audit log, metrics).
 */
async function translateWithFallback(input, { onAttempt } = {}) {
  const chain = listConfiguredChain();
  if (!chain.length) {
    const err = new Error('No translation provider is configured');
    err.code = 'NO_PROVIDER_CONFIGURED';
    err.statusCode = 503;
    throw err;
  }

  let lastErr;
  for (const { id, provider } of chain) {
    try {
      const result = await provider.translate(input);
      if (typeof onAttempt === 'function') {
        try { onAttempt({ providerId: id, ok: true }); } catch (_) { /* observability must not break flow */ }
      }
      return result;
    } catch (err) {
      lastErr = err;
      if (typeof onAttempt === 'function') {
        try { onAttempt({ providerId: id, ok: false, err }); } catch (_) { /* observability */ }
      }
      const triggersFallback = FALLBACK_TRIGGERS.has(err.code);
      if (!triggersFallback) {
        // Deterministic 4xx (unsupported language, bad payload). Don't retry.
        throw err;
      }
      logger.warn('Translation provider failed, trying next', {
        providerId: id,
        errCode: err.code,
        message: err.message,
      });
    }
  }

  // Whole chain exhausted.
  const wrapped = new Error(
    `All translation providers failed (last: ${lastErr?.code || 'unknown'}: ${lastErr?.message || 'no message'})`
  );
  wrapped.code = 'ALL_PROVIDERS_FAILED';
  wrapped.statusCode = 502;
  wrapped.cause = lastErr;
  throw wrapped;
}

/**
 * Walk the chain for language detection. Same fallback rules.
 */
async function detectWithFallback(text, { onAttempt } = {}) {
  const chain = listConfiguredChain();
  if (!chain.length) return 'en';

  for (const { id, provider } of chain) {
    if (typeof provider.detectLanguage !== 'function') continue;
    try {
      const lang = await provider.detectLanguage(text);
      if (lang) {
        if (typeof onAttempt === 'function') {
          try { onAttempt({ providerId: id, ok: true }); } catch (_) { /* observability */ }
        }
        return lang;
      }
    } catch (err) {
      if (typeof onAttempt === 'function') {
        try { onAttempt({ providerId: id, ok: false, err }); } catch (_) { /* observability */ }
      }
      if (!FALLBACK_TRIGGERS.has(err.code)) throw err;
      logger.warn('Language detect provider failed, trying next', {
        providerId: id,
        errCode: err.code,
        message: err.message,
      });
    }
  }
  return 'en';
}

function getModelPolicyVersion() {
  return process.env.TRANSLATION_MODEL_POLICY_VERSION || 'policy-v1';
}

function getProviderById(id) {
  return ALL_PROVIDERS[String(id || '').toLowerCase()] || null;
}

/**
 * Test seam — lets unit tests register a fake provider without touching env vars.
 * Returns a restore function.
 */
function __testOverrideProvider(id, provider) {
  const previous = ALL_PROVIDERS[id];
  ALL_PROVIDERS[id] = provider;
  return () => {
    if (previous) ALL_PROVIDERS[id] = previous;
    else delete ALL_PROVIDERS[id];
  };
}

module.exports = {
  getTranslationProvider,
  translateWithFallback,
  detectWithFallback,
  getModelPolicyVersion,
  resolveChain,
  listConfiguredChain,
  getProviderById,
  __testOverrideProvider,
};
