'use strict';

function present(name) {
  return typeof process.env[name] === 'string' && process.env[name].trim().length > 0;
}

function capability(available, unavailableReason = 'configuration_missing') {
  return {
    available,
    status: available ? 'available' : 'unavailable',
    ...(available ? {} : { unavailableReason }),
  };
}

function getPublicCapabilities() {
  return {
    smsOtp: capability(
      present('TWILIO_ACCOUNT_SID') && present('TWILIO_AUTH_TOKEN') && present('TWILIO_PHONE_NUMBER')
    ),
    backgroundChecks: capability(
      present('CHECKR_API_KEY') && present('CHECKR_WEBHOOK_SECRET')
    ),
    // The AI support chat tries Meta -> OpenRouter -> Ollama, so it is available
    // when any provider is configured, not just the legacy OpenAI key.
    aiSupport: capability(
      present('OPENAI_API_KEY') ||
      present('META_AI_API_KEY') ||
      present('OPENROUTER_API_KEY') ||
      present('OLLAMA_URL')
    ),
    geocoding: capability(present('GOOGLE_MAPS_API_KEY')),
  };
}

module.exports = { getPublicCapabilities };
