'use strict';

const { LOCALES } = require('./directCatalogService');

const ALLOWED_ENTITIES = ['category', 'service', 'tool'];
const MAX_PROMPT_LENGTH = 4000;
const PROVIDER_TIMEOUT_MS = Number.parseInt(process.env.DIRECT_CATALOG_AI_TIMEOUT_MS || '15000', 10);

function parseJson(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(text);
}

function validateDraft(value) {
  const draft = value && typeof value === 'object' ? value : {};
  if (!ALLOWED_ENTITIES.includes(draft.entity)) throw Object.assign(new Error('AI draft has an unsupported entity'), { statusCode: 502 });
  if (!draft.fields || typeof draft.fields !== 'object' || Array.isArray(draft.fields)) throw Object.assign(new Error('AI draft is missing structured fields'), { statusCode: 502 });
  return { entity: draft.entity, fields: draft.fields, summary: String(draft.summary || '').slice(0, 500) };
}

async function callProvider(baseUrl, apiKey, model, messages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 1800, response_format: { type: 'json_object' } }),
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) throw Object.assign(new Error(`AI provider returned HTTP ${response.status}`), { statusCode: response.status >= 500 ? 502 : 400 });
    const parsed = JSON.parse(body);
    return parseJson(parsed?.choices?.[0]?.message?.content);
  } finally {
    clearTimeout(timeout);
  }
}

async function createDraft(prompt) {
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim().slice(0, MAX_PROMPT_LENGTH) : '';
  if (!cleanPrompt) throw Object.assign(new Error('Describe the catalog change first'), { statusCode: 400 });

  const system = [
    'You are the OxSteed Direct catalog assistant.',
    'Convert one requested catalog change into JSON only. Never output SQL, HTML, markdown, or instructions.',
    `entity must be one of: ${ALLOWED_ENTITIES.join(', ')}.`,
    `nameI18n and descriptionI18n must be objects with exactly these locale keys: ${LOCALES.join(', ')}. Preserve OxSteed brand names and city proper names.`,
    'For a service, include categoryId only when the user provides an existing UUID; otherwise use categorySlug.',
    'For a service, priceCents is an integer or null and availabilityDays is an array of weekday names.',
    'For a category or tool, include iconKey only from: wrench, zap, droplets, hammer, paintbrush, trees, ruler, drill, truck, shield-check.',
    'Set isPublished false unless the user explicitly asks to publish. Set isActive true by default.',
    'Return {"entity":"service|category|tool","summary":"...","fields":{...}}.',
  ].join('\n');
  const messages = [{ role: 'system', content: system }, { role: 'user', content: cleanPrompt }];
  const attempts = [];
  if (process.env.OPENROUTER_API_KEY) attempts.push(() => callProvider(process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1', process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_TRANSLATION_MODEL || 'openai/gpt-4o-mini', messages));
  if (process.env.OPENAI_API_KEY) attempts.push(() => callProvider(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1', process.env.OPENAI_API_KEY, process.env.OPENAI_TRANSLATION_MODEL || 'gpt-4o-mini', messages));
  if (!attempts.length) throw Object.assign(new Error('Direct catalog AI is not configured. Use manual entry or configure an AI provider key on the server.'), { statusCode: 503 });

  let lastError;
  for (const attempt of attempts) {
    try { return validateDraft(await attempt()); } catch (error) { lastError = error; }
  }
  throw Object.assign(new Error(lastError?.message || 'AI draft failed validation'), { statusCode: 502 });
}

module.exports = { createDraft, MAX_PROMPT_LENGTH };
