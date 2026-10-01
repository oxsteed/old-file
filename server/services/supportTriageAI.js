'use strict';

const ALLOWED_CATEGORIES = new Set([
  'account',
  'billing',
  'escalations',
  'general',
  'sales',
  'shipping',
  'support_request',
  'technical',
]);
const ALLOWED_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const ALLOWED_SKILLS = new Set([
  'account',
  'billing',
  'escalations',
  'general',
  'sales',
  'shipping',
  'technical',
]);
const MAX_MESSAGE_LENGTH = 5000;
const TIMEOUT_MS = Math.max(500, Math.min(5000, Number(process.env.SUPPORT_AI_TIMEOUT_MS) || 2500));

function providerConfig() {
  if (process.env.OPENROUTER_API_KEY) {
    return {
      baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_SUPPORT_MODEL || process.env.OPENROUTER_TRANSLATION_MODEL || 'openrouter/free',
      provider: 'openrouter',
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_SUPPORT_MODEL || process.env.OPENAI_TRANSLATION_MODEL || 'gpt-4o-mini',
      provider: 'openai',
    };
  }
  return null;
}

function fallback(category, reason = 'provider_unavailable') {
  return {
    category: ALLOWED_CATEGORIES.has(category) ? category : 'general',
    confidence: 0,
    priority: 'normal',
    summary: null,
    suggestedSkills: [],
    provider: 'fallback',
    fallbackReason: reason,
  };
}

function parseJson(raw) {
  const text = String(raw || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  return JSON.parse(text);
}

function validateResult(value, requestedCategory) {
  const result = value && typeof value === 'object' ? value : {};
  const category = String(result.category || requestedCategory || 'general').toLowerCase();
  const priority = String(result.priority || 'normal').toLowerCase();
  const confidence = Number(result.confidence);
  if (!ALLOWED_CATEGORIES.has(category)) throw new Error('AI returned an unsupported support category');
  if (!ALLOWED_PRIORITIES.has(priority)) throw new Error('AI returned an unsupported support priority');
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('AI returned an invalid support confidence');
  }

  const suggestedSkills = Array.isArray(result.suggestedSkills)
    ? result.suggestedSkills
      .map((skill) => String(skill).toLowerCase().trim())
      .filter((skill, index, skills) => ALLOWED_SKILLS.has(skill) && skills.indexOf(skill) === index)
      .slice(0, 5)
    : [];

  return {
    category,
    confidence: Math.round(confidence * 100) / 100,
    priority,
    summary: result.summary == null ? null : String(result.summary).trim().slice(0, 500),
    suggestedSkills,
    provider: 'configured',
  };
}

async function callProvider(config, messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
    const parsed = JSON.parse(body);
    return parseJson(parsed?.choices?.[0]?.message?.content);
  } finally {
    clearTimeout(timer);
  }
}

async function analyze({ message, category }) {
  const cleanMessage = String(message || '').trim().slice(0, MAX_MESSAGE_LENGTH);
  const config = providerConfig();
  if (!config || !cleanMessage) return fallback(category, config ? 'empty_message' : 'provider_not_configured');

  const messages = [
    {
      role: 'system',
      content: [
        'You triage OxSteed customer support messages for a human support team.',
        'Return JSON only with exactly: category, confidence, priority, summary, suggestedSkills.',
        'Never output SQL, HTML, markdown, secrets, or instructions.',
        `category must be one of: ${Array.from(ALLOWED_CATEGORIES).join(', ')}.`,
        `priority must be one of: ${Array.from(ALLOWED_PRIORITIES).join(', ')}.`,
        `suggestedSkills may only contain: ${Array.from(ALLOWED_SKILLS).join(', ')}.`,
        'confidence is a number from 0 to 1. Keep summary under 500 characters.',
        `The current UI category is ${category || 'general'}; do not downgrade an explicit urgent or safety concern.`,
      ].join('\n'),
    },
    { role: 'user', content: cleanMessage },
  ];

  const result = await callProvider(config, messages);
  return { ...validateResult(result, category), provider: config.provider, model: config.model };
}

module.exports = {
  MAX_MESSAGE_LENGTH,
  analyze,
  fallback,
  providerConfig,
  validateResult,
};
