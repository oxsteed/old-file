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
    aiSupport: capability(present('OPENAI_API_KEY')),
    geocoding: capability(present('GOOGLE_MAPS_API_KEY')),
  };
}

module.exports = { getPublicCapabilities };
