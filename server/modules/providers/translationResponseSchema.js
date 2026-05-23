/**
 * JSON Schema for the structured translation response we ask LLM providers to return.
 *
 * Used by OpenRouter + OpenAI adapters via `response_format: { type: 'json_schema', ... }`.
 * Also used by the in-process validator (validateProviderResponse) in providerRegistry.js
 * so we never trust free-form model output.
 *
 * Keep this schema STRICT. Adding optional fields is fine; relaxing required[] or types
 * silently lowers the contract for downstream code (translationService persists these
 * values directly into the `translations` table).
 */

const TRANSLATION_RESPONSE_SCHEMA = {
  name: 'translation_response',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      translatedText: {
        type: 'string',
        description:
          'The translated text in the requested target language. Must preserve placeholder tokens of the form __OXSTEED_GLOSSARY_<n>__ exactly as they appeared in the input.',
      },
      detectedSourceLanguage: {
        type: ['string', 'null'],
        description:
          'BCP-47 base code (lowercase, no region subtag) of the source language the model used. Null if the caller already supplied an explicit source language.',
      },
      confidence: {
        type: ['number', 'null'],
        minimum: 0,
        maximum: 1,
        description:
          'Self-rated confidence the translation is faithful and idiomatic. Null if the model cannot estimate.',
      },
      warnings: {
        type: 'array',
        description:
          'Plain-language notes the model wants surfaced (e.g. ambiguous source, dropped formatting, untranslatable term).',
        items: { type: 'string' },
      },
    },
    required: ['translatedText', 'detectedSourceLanguage', 'confidence', 'warnings'],
  },
};

/**
 * Lightweight in-process validator — catches drift when a provider returns
 * something that *looks* like JSON but doesn't match the schema (e.g. when
 * the model ignores response_format or we're using a model without strict
 * mode).
 *
 * Throws Error with .code so the orchestrator can route it to fallback.
 */
function validateAgainstResponseSchema(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const err = new Error('Provider response is not a JSON object');
    err.code = 'PROVIDER_RESPONSE_SHAPE';
    throw err;
  }
  if (typeof value.translatedText !== 'string' || !value.translatedText.length) {
    const err = new Error('Provider response missing translatedText string');
    err.code = 'PROVIDER_RESPONSE_SHAPE';
    throw err;
  }
  if (
    value.detectedSourceLanguage !== null &&
    value.detectedSourceLanguage !== undefined &&
    typeof value.detectedSourceLanguage !== 'string'
  ) {
    const err = new Error('Provider response has invalid detectedSourceLanguage');
    err.code = 'PROVIDER_RESPONSE_SHAPE';
    throw err;
  }
  if (
    value.confidence !== null &&
    value.confidence !== undefined &&
    (typeof value.confidence !== 'number' ||
      Number.isNaN(value.confidence) ||
      value.confidence < 0 ||
      value.confidence > 1)
  ) {
    const err = new Error('Provider response has invalid confidence');
    err.code = 'PROVIDER_RESPONSE_SHAPE';
    throw err;
  }
  if (value.warnings != null && !Array.isArray(value.warnings)) {
    const err = new Error('Provider response warnings must be an array');
    err.code = 'PROVIDER_RESPONSE_SHAPE';
    throw err;
  }
  return {
    translatedText: value.translatedText,
    detectedSourceLanguage: value.detectedSourceLanguage ?? null,
    confidence: value.confidence ?? null,
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((w) => typeof w === 'string') : [],
  };
}

module.exports = {
  TRANSLATION_RESPONSE_SCHEMA,
  validateAgainstResponseSchema,
};
