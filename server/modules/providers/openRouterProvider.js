const https = require('https');
const logger = require('../../utils/logger');
const {
  TRANSLATION_RESPONSE_SCHEMA,
  validateAgainstResponseSchema,
} = require('./translationResponseSchema');

/**
 * OpenRouter translation adapter.
 *
 * Uses the OpenAI-compatible /chat/completions endpoint with
 * response_format=json_schema so the model returns a strict, parseable
 * shape (translatedText / detectedSourceLanguage / confidence / warnings).
 *
 * Env vars:
 *   OPENROUTER_API_KEY              (required)
 *   OPENROUTER_TRANSLATION_MODEL    (optional, default 'openai/gpt-4o-mini')
 *   OPENROUTER_BASE_URL             (optional, default 'https://openrouter.ai/api/v1')
 *   OPENROUTER_TIMEOUT_MS           (optional, default 20000)
 *   OPENROUTER_APP_URL              (optional, sent as HTTP-Referer per OpenRouter etiquette)
 *   OPENROUTER_APP_NAME             (optional, sent as X-Title)
 *
 * The adapter is shaped so translationService can swap it 1:1 with the
 * LibreTranslate adapter — both export `id`, `translate`, `detectLanguage`,
 * `getSupportedLanguages`.
 */

const DEFAULT_MODEL = process.env.OPENROUTER_TRANSLATION_MODEL || 'openai/gpt-4o-mini';
const BASE_URL = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
const TIMEOUT_MS = Math.max(1000, Number(process.env.OPENROUTER_TIMEOUT_MS) || 20_000);

function isConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

function buildSystemPrompt({ sourceLanguage, targetLanguage, tone }) {
  const toneLine =
    tone && tone !== 'default'
      ? `Adopt a ${tone} register without altering meaning.`
      : 'Preserve the register of the source text.';
  return [
    'You are a professional translation engine.',
    `Translate the user-provided text from ${sourceLanguage || 'the detected source language'} into ${targetLanguage}.`,
    toneLine,
    'CRITICAL RULES:',
    '1. Preserve any token that matches the pattern __OXSTEED_GLOSSARY_<n>__ EXACTLY. Do not translate, modify, or remove these placeholders — they will be substituted with brand-locked terms after your response.',
    '2. Preserve formatting characters (line breaks, lists, punctuation density) as faithfully as the target language allows.',
    '3. Do not add commentary, explanations, or apologies.',
    '4. Return ONLY a JSON object matching the supplied schema. Do not wrap it in markdown.',
    '5. If the source text already appears to be in the target language, return it unchanged with confidence 1.',
  ].join('\n');
}

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    if (!isConfigured()) {
      const err = new Error('OPENROUTER_API_KEY is not configured');
      err.code = 'PROVIDER_NOT_CONFIGURED';
      reject(err);
      return;
    }
    const url = new URL(path, `${BASE_URL}/`);
    const payload = Buffer.from(JSON.stringify(body));
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': payload.length,
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    };
    if (process.env.OPENROUTER_APP_URL) headers['HTTP-Referer'] = process.env.OPENROUTER_APP_URL;
    if (process.env.OPENROUTER_APP_NAME) headers['X-Title'] = process.env.OPENROUTER_APP_NAME;

    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 500) {
            const err = new Error(`OpenRouter ${res.statusCode}`);
            err.code = 'PROVIDER_UPSTREAM_5XX';
            err.statusCode = res.statusCode;
            err.body = data;
            reject(err);
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(data || 'null');
          } catch (parseErr) {
            const err = new Error(`OpenRouter non-JSON response (${res.statusCode}): ${parseErr.message}`);
            err.code = 'PROVIDER_NON_JSON';
            reject(err);
            return;
          }
          if (res.statusCode >= 400) {
            const message = parsed?.error?.message || parsed?.error || `OpenRouter ${res.statusCode}`;
            const err = new Error(typeof message === 'string' ? message : JSON.stringify(message));
            err.code = res.statusCode === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_4XX';
            err.statusCode = res.statusCode;
            reject(err);
            return;
          }
          resolve(parsed);
        });
      }
    );
    req.on('error', (e) => {
      const err = new Error(`OpenRouter network error: ${e.message}`);
      err.code = 'PROVIDER_NETWORK';
      reject(err);
    });
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      const err = new Error(`OpenRouter timeout after ${TIMEOUT_MS}ms`);
      err.code = 'PROVIDER_TIMEOUT';
      reject(err);
    });
    req.write(payload);
    req.end();
  });
}

function parseModelJsonContent(rawContent) {
  if (rawContent == null) {
    const err = new Error('OpenRouter response missing content');
    err.code = 'PROVIDER_RESPONSE_SHAPE';
    throw err;
  }
  if (typeof rawContent === 'object') return rawContent;
  const trimmed = String(rawContent).trim();
  // Models sometimes wrap JSON in ```json fences even when response_format is set.
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch (err) {
    const e = new Error(`OpenRouter returned non-JSON content: ${err.message}`);
    e.code = 'PROVIDER_NON_JSON';
    throw e;
  }
}

async function translate({ text, sourceLanguage, targetLanguage, tone }) {
  const model = DEFAULT_MODEL;
  const body = {
    model,
    messages: [
      { role: 'system', content: buildSystemPrompt({ sourceLanguage, targetLanguage, tone }) },
      { role: 'user', content: text },
    ],
    temperature: 0.2,
    response_format: {
      type: 'json_schema',
      json_schema: TRANSLATION_RESPONSE_SCHEMA,
    },
  };

  const response = await postJson('/chat/completions', body);
  const message = response?.choices?.[0]?.message;
  if (!message) {
    const err = new Error('OpenRouter response missing message');
    err.code = 'PROVIDER_RESPONSE_SHAPE';
    throw err;
  }
  const parsed = parseModelJsonContent(message.content);
  const validated = validateAgainstResponseSchema(parsed);

  return {
    translatedText: validated.translatedText,
    sourceLanguage: validated.detectedSourceLanguage || sourceLanguage,
    targetLanguage,
    provider: 'openrouter',
    model: response?.model || model,
    confidence: validated.confidence,
    warnings: validated.warnings,
    raw: response,
  };
}

async function detectLanguage(text) {
  // Reuse the translate endpoint with target=auto. Tiny prompt, separate model
  // budget, model returns detectedSourceLanguage.
  if (!text || !text.trim()) return 'en';
  try {
    const result = await translate({
      text: text.slice(0, 400),
      sourceLanguage: null,
      targetLanguage: 'en',
      tone: 'default',
    });
    if (result.sourceLanguage) {
      return String(result.sourceLanguage).toLowerCase().split(/[-_]/)[0];
    }
  } catch (err) {
    logger.warn('OpenRouter detectLanguage failed, defaulting to en', { err: err.message, code: err.code });
  }
  return 'en';
}

async function getSupportedLanguages() {
  // OpenRouter doesn't expose a list endpoint; we trust the `languages` table.
  // Returning [] signals the localeService to use its own seed list.
  return [];
}

module.exports = {
  id: 'openrouter',
  isConfigured,
  translate,
  detectLanguage,
  getSupportedLanguages,
};
