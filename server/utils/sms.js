// Phase 2 - SMS utility (Twilio)
// OxSteed v2
const twilio = require('twilio');
const logger = require('./logger');

let client = null;
try {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  } else {
    logger.warn('Twilio credentials not set. SMS features disabled.');
  }
} catch (err) {
  logger.warn('Twilio init failed:', err.message);
}

const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER;

async function sendSMS(to, body) {
  if (!client) {
    logger.warn('SMS not sent - Twilio not configured');
    return { success: false, error: 'Twilio not configured' };
  }
  try {
    const message = await client.messages.create({
      body,
      from: FROM_NUMBER,
      to,
    });
    return { success: true, sid: message.sid };
  } catch (err) {
    logger.error('SMS send error:', err.message);
    return { success: false, error: err.message };
  }
}

async function sendOTPSMS(phone, otp) {
  if (!client) {
    logger.warn('OTP SMS not sent - Twilio not configured');
    return { success: false, error: 'Twilio not configured' };
  }
  // 15 minutes to match email OTP expiry (sendOTPEmail in email.js)
  const body = `Your OxSteed verification code is: ${otp}. It expires in 15 minutes.`;
  return sendSMS(phone, body);
}

async function sendJobAlertSMS(phone, jobTitle, jobId) {
  if (!client) {
    logger.warn('Job alert SMS not sent - Twilio not configured');
    return { success: false, error: 'Twilio not configured' };
  }
  const body = `New job posted on OxSteed: "${jobTitle}". View details: ${process.env.CLIENT_URL || 'https://oxsteed.com'}/jobs/${jobId}`;
  return sendSMS(phone, body);
}

module.exports = { sendSMS, sendOTPSMS, sendJobAlertSMS };
