const {
  PinpointSMSVoiceV2Client,
  SendTextMessageCommand,
} = require('@aws-sdk/client-pinpoint-sms-voice-v2');
const logger = require('../utils/logger');

const ENABLED = 'true';
let client;

function isEnabled() {
  return String(process.env.AWS_SMS_ADMIN_VERIFICATION_ENABLED || '').toLowerCase() === ENABLED;
}

function getConfiguration() {
  return {
    enabled: isEnabled(),
    region: process.env.AWS_SMS_REGION || process.env.AWS_REGION || '',
    originationIdentity: String(process.env.AWS_SMS_ORIGINATION_IDENTITY || '').trim(),
  };
}

function getClient() {
  const config = getConfiguration();
  if (!config.enabled || !config.region || !config.originationIdentity) return null;
  if (!client) {
    const clientConfig = { region: config.region, maxAttempts: 2 };
    const accessKeyId = process.env.AWS_SMS_ACCESS_KEY_ID || process.env.AWS_LOCATION_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SMS_SECRET_ACCESS_KEY || process.env.AWS_LOCATION_SECRET_ACCESS_KEY;
    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = { accessKeyId, secretAccessKey };
    }
    client = new PinpointSMSVoiceV2Client(clientConfig);
  }
  return client;
}

function createProviderError(code, message, statusCode = 503) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

async function sendVerificationCode({ phoneNumber, code }) {
  const config = getConfiguration();
  if (!config.enabled) {
    throw createProviderError('aws_sms_disabled', 'AWS phone verification is not enabled.');
  }
  if (!config.region || !config.originationIdentity) {
    throw createProviderError('aws_sms_not_configured', 'AWS phone verification is not configured with a region and origination identity.');
  }

  const smsClient = getClient();
  try {
    const response = await smsClient.send(new SendTextMessageCommand({
      DestinationPhoneNumber: phoneNumber,
      OriginationIdentity: config.originationIdentity,
      MessageBody: `Your OxSteed verification code is: ${code}. It expires in 15 minutes.`,
      MessageType: 'TRANSACTIONAL',
    }));

    logger.info('AWS phone verification SMS queued', {
      provider: 'aws_end_user_messaging_sms',
      messageId: response?.MessageId || null,
      phoneSuffix: String(phoneNumber).slice(-4),
    });

    return {
      provider: 'aws_end_user_messaging_sms',
      messageId: response?.MessageId || null,
    };
  } catch (error) {
    logger.error('AWS phone verification SMS failed', {
      provider: 'aws_end_user_messaging_sms',
      error: error?.name || error?.message || 'unknown_error',
      phoneSuffix: String(phoneNumber).slice(-4),
    });
    throw createProviderError('aws_sms_send_failed', 'AWS could not send the verification code.', 502);
  }
}

function resetForTests() {
  client = undefined;
}

module.exports = {
  getConfiguration,
  isEnabled,
  sendVerificationCode,
  resetForTests,
};
