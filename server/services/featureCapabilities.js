'use strict';

const { isSupportChatProviderConfigured } = require('./supportChatProviders');

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
    // The AI support chat calls OpenRouter -> Ollama only (Meta and OpenAI
    // were removed), so it is available exactly when one of those can answer.
    // An OLLAMA_URL the chat would reject (non-allowlisted host) does not count.
    aiSupport: capability(isSupportChatProviderConfigured()),
    geocoding: capability(present('GOOGLE_MAPS_API_KEY')),
  };
}

module.exports = { getPublicCapabilities };
