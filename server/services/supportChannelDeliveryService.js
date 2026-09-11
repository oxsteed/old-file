'use strict';

const { sendEmail } = require('../utils/email');
const smsNotificationService = require('./smsNotificationService');

const EXTERNAL_CHANNELS = new Set(['email', 'sms', 'phone', 'social']);

function normalizeChannel(value) {
  return String(value || '').trim().toLowerCase();
}

function isEmailConfigured() {
  return /^re_[A-Za-z0-9]+$/.test(String(process.env.RESEND_API_KEY || '').trim());
}

function channelCapabilities() {
  return {
    email: { supported: true, configured: isEmailConfigured(), provider: 'resend' },
    sms: { supported: true, configured: smsNotificationService.isTwilioConfigured(), provider: 'twilio' },
    phone: { supported: false, configured: false, provider: null },
    social: { supported: false, configured: false, provider: null },
  };
}

function normalizeRecipient(channel, value) {
  const recipient = String(value || '').trim();
  if (channel === 'email') return recipient.toLowerCase().slice(0, 320);
  return recipient.slice(0, 40);
}

function resultFor(status, provider, extra = {}) {
  return { status, provider, ...extra };
}

async function deliverSupportChannel({ channel, recipient, content, subject, idempotencyKey }) {
  const normalizedChannel = normalizeChannel(channel);
  const capabilities = channelCapabilities();
  const capability = capabilities[normalizedChannel];
  if (!EXTERNAL_CHANNELS.has(normalizedChannel) || !capability) {
    return resultFor('unsupported', null, {
      errorCode: 'unsupported_channel',
      error: 'This support channel does not have an outbound adapter yet',
    });
  }
  if (!capability.supported) {
    return resultFor('unsupported', capability.provider, {
      errorCode: 'unsupported_channel',
      error: `Outbound ${normalizedChannel} delivery is not configured`,
    });
  }
  const normalizedRecipient = normalizeRecipient(normalizedChannel, recipient);
  if (!normalizedRecipient) {
    return resultFor('failed', capability.provider, {
      errorCode: 'missing_recipient',
      error: 'The customer has no verified destination for this channel',
    });
  }
  if (!capability.configured) {
    return resultFor('not_configured', capability.provider, {
      errorCode: 'provider_not_configured',
      error: `${capability.provider} is not configured for outbound support delivery`,
    });
  }

  if (normalizedChannel === 'email') {
    const result = await sendEmail({
      to: normalizedRecipient,
      fromName: 'OxSteed Support',
      subject: String(subject || 'OxSteed Support').replace(/[\r\n]+/g, ' ').trim().slice(0, 200),
      text: String(content || '').slice(0, 20000),
      html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${String(content || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`,
      idempotencyKey,
    });
    return result?.success
      ? resultFor('sent', capability.provider, { providerMessageId: result.id || null })
      : resultFor('failed', capability.provider, { errorCode: 'provider_rejected', error: result?.error || 'Email provider rejected the message' });
  }

  try {
    const result = await smsNotificationService.sendConfiguredSMS(normalizedRecipient, String(content || '').slice(0, 1600));
    return resultFor('sent', capability.provider, { providerMessageId: result?.sid || null });
  } catch (error) {
    return resultFor('failed', capability.provider, {
      errorCode: 'provider_error',
      error: String(error.message || 'SMS provider rejected the message').slice(0, 2000),
    });
  }
}

module.exports = {
  EXTERNAL_CHANNELS,
  channelCapabilities,
  deliverSupportChannel,
  isEmailConfigured,
  normalizeChannel,
};
