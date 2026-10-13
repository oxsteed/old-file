// Compatibility wrapper for legacy OTP/job-alert callers. Provider setup and
// delivery now live in smsNotificationService so all SMS uses one Twilio path.
const smsNotificationService = require('../services/smsNotificationService');

async function sendSMS(to, body) {
  return smsNotificationService.sendTransactionalSMS(to, body);
}

async function sendOTPSMS(phone, otp) {
  // 15 minutes to match email OTP expiry (sendOTPEmail in email.js)
  const body = `Your OxSteed verification code is: ${otp}. It expires in 15 minutes.`;
  return sendSMS(phone, body);
}

async function sendJobAlertSMS(phone, jobTitle, jobId) {
  // Strip control characters and cap length to prevent SMS injection
  const safeTitle = String(jobTitle || '').replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ').trim().slice(0, 100);
  const body = `New job posted on OxSteed: "${safeTitle}". View details: ${process.env.CLIENT_URL || 'https://oxsteed.com'}/jobs/${jobId}`;
  return smsNotificationService.sendTransactionalSMS(phone, body);
}

module.exports = { sendSMS, sendOTPSMS, sendJobAlertSMS };
