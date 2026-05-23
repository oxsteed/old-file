const https = require('https');
const logger = require('../../utils/logger');
const {
  TRANSLATION_RESPONSE_SCHEMA,
  validateAgainstResponseSchema,
} = require('./translationResponseSchema');

/**
 * OpenAI translation adapter (fallback path for OpenRouter).
 *
 * Uses /v1/chat/completions with response_format=json_schema (strict).
 *
 * Env vars:
 *   OPENAI_API_KEY                 (required)
 *   OPENAI_TRANSLATION_MODEL       (optional, default 'gpt-4o-mini')
 *   OPENAI_BASE_URL                (optional, default 'https://api.openai.com/v1')
 *   OPENAI_ORG_ID                  (optional)
 *   OPENAI_TIMEOUT_MS              (optional, default 20000)
 */

const DEFAULT_MODEL = process.env.OPENAI_TRANSLATION_MODEL || 'gpt-4o-mini';
const BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const TIMEOUT_MS = Math.max(1000, Number(process.env.OPENAI_TIMEOUT_MS) || 20_000);

function isConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
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
    '1. Preserve any token that matches the pattern __OXSTEED_GLOSSARY_<n>__ EXACTLY. Do not translate, modify, or remove these placeholders.',
    '2. Preserve formatting characters (line breaks, lists, punctuation density) as faithfully as the target language allows.',
    '3. Do not add commentary, explanations, or apologies.',
    '4. Return ONLY a JSON object matching the supplied schema. Do not wrap it in markdown.',
    '5. If the source text already appears to be in the target language, return it unchanged with confidence 1.',
  ].join('\n');
}

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    if (!isConfigured()) {
      const err = new Error('OPENAI_API_KEY is not configured');
      err.code = 'PROVIDER_NOT_CONFIGURED';
      reject(err);
      return;
    }
    const url = new URL(path, `${BASE_URL}/`);
    const payload = Buffer.from(JSON.stringify(body));
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': payload.length,
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    };
    if (process.env.OPENAI_ORG_ID) headers['OpenAI-Organization'] = process.env.OPENAI_ORG_ID;

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
            const err = new Error(`OpenAI ${res.statusCode}`);
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
            const err = new Error(`OpenAI non-JSON response (${res.statusCode}): ${parseErr.message}`);
            err.code = 'PROVIDER_NON_JSON';
            reject(err);
            return;
          }
          if (res.statusCode >= 400) {
            const message = parsed?.error?.message || parsed?.error || `OpenAI ${res.statusCode}`;
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
      const err = new Error(`OpenAI network error: ${e.message}`);
      err.code = 'PROVIDER_NETWORK';
      reject(err);
    });
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      const err = new Error(`OpenAI timeout after ${TIMEOUT_MS}ms`);
      err.code = 'PROVIDER_TIMEOUT';
      reject(err);
    });
    req.write(payload);
    req.end();
  });
}

function parseModelJsonContent(rawContent) {
  if (rawContent == null) {
    const err = new Error('OpenAI response missing content');
    err.code = 'PROVIDER_RESPONSE_SHAPE';
    throw err;
  }
  if (typeof rawContent === 'object') return rawContent;
  const trimmed = String(rawContent).trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch (err) {
    const e = new Error(`OpenAI returned non-JSON content: ${err.message}`);
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
    const err = new Error('OpenAI response missing message');
    err.code = 'PROVIDER_RESPONSE_SHAPE';
    throw err;
  }
  const parsed = parseModelJsonContent(message.content);
  const validated = validateAgainstResponseSchema(parsed);

  return {
    translatedText: validated.translatedText,
    sourceLanguage: validated.detectedSourceLanguage || sourceLanguage,
    targetLanguage,
    provider: 'openai',
    model: response?.model || model,
    confidence: validated.confidence,
    warnings: validated.warnings,
    raw: response,
  };
}

async function detectLanguage(text) {
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
    logger.warn('OpenAI detectLanguage failed, defaulting to en', { err: err.message, code: err.code });
  }
  return 'en';
}

async function getSupportedLanguages() {
  return [];
}

module.exports = {
  id: 'openai',
  isConfigured,
  translate,
  detectLanguage,
  getSupportedLanguages,
};
