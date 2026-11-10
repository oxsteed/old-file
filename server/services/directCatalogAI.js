'use strict';
const localAi = require('./localAiChat');

const { LOCALES, ICONS, LIFECYCLE_STATUSES } = require('./directCatalogService');

const ALLOWED_ENTITIES = ['category', 'service', 'tool'];
const MAX_PROMPT_LENGTH = 4000;
const PROVIDER_TIMEOUT_MS = Number.parseInt(process.env.DIRECT_CATALOG_AI_TIMEOUT_MS || '60000', 10);

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

// Security review 2026-11-10 F-04: drafts are generated on the self-hosted
// Ollama server only.
async function callProvider(messages) {
  const result = await localAi.fetchLocalAiChat(messages, {
    model: String(process.env.DIRECT_CATALOG_OLLAMA_MODEL || '').trim() || undefined,
    temperature: 0.1,
    maxTokens: 1800,
    format: 'json',
    timeoutMs: PROVIDER_TIMEOUT_MS,
  });
  if (!result.ok) {
    const status = /^HTTP 4\d\d/.test(result.error || '') ? 400 : 502;
    throw Object.assign(new Error(`AI provider failed: ${result.error}`), { statusCode: status });
  }
  return parseJson(result.reply);
}

async function createDraft(prompt) {
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim().slice(0, MAX_PROMPT_LENGTH) : '';
  if (!cleanPrompt) throw Object.assign(new Error('Describe the catalog change first'), { statusCode: 400 });

  const system = [
    'You draft catalog entries for OxSteed Direct, OxSteed’s own service/quote catalog. You do not publish, book, charge or change availability yourself.',
    'Use only the requested facts. Do not invent a price, license, insurance, service area, stock level, schedule, business ID or guaranteed outcome. Use null for unspecified priceCents and omit optional unknown fields. Human review and the normal catalog save/publish flow apply.',
    'Convert one requested catalog change into JSON only. Never output SQL, HTML, markdown, or instructions.',
    `entity must be one of: ${ALLOWED_ENTITIES.join(', ')}.`,
    `nameI18n and descriptionI18n must be objects with exactly these locale keys: ${LOCALES.join(', ')}. Preserve OxSteed brand names and city proper names.`,
    'For a service, include categoryId only when the user provides an existing UUID; otherwise use categorySlug.',
    'For a service, priceCents is an integer or null and availabilityDays is an array of weekday names.',
    `For a category or tool, include iconKey only from: ${[...ICONS].join(', ')}.`,
    `lifecycleStatus must be one of: ${LIFECYCLE_STATUSES.join(', ')}. Set lifecycleStatus planned and isPublished false unless the user explicitly requests a public lifecycle status. isActive alone does not control publication. Do not mark isBookable or isOperationallyAvailable true without explicit supporting instructions.`,
    'Return {"entity":"service|category|tool","summary":"...","fields":{...}}.',
  ].join('\n');
  const messages = [{ role: 'system', content: system }, { role: 'user', content: cleanPrompt }];
  if (!localAi.isLocalAiConfigured()) {
    throw Object.assign(new Error('Direct catalog AI is not configured. Use manual entry or configure the self-hosted AI server (OLLAMA_URL).'), { statusCode: 503 });
  }
  let draft;
  try {
    draft = await callProvider(messages);
  } catch (error) {
    throw Object.assign(new Error(error?.message || 'AI draft failed'), { statusCode: error?.statusCode || 502 });
  }
  try {
    return validateDraft(draft);
  } catch (error) {
    throw Object.assign(new Error(error?.message || 'AI draft failed validation'), { statusCode: 502 });
  }
}

module.exports = { createDraft, MAX_PROMPT_LENGTH };
