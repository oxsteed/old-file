// Phase 2 — SMS utility (Twilio)
// OxSteed v2

const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER;

async function sendSMS(to, body) {
  try {
    const message = await client.messages.create({
      body,
      from: FROM_NUMBER,
      to,
    });
    return { success: true, sid: message.sid };
  } catch (err) {
    console.error('SMS send error:', err.message);
    return { success: false, error: err.message };
  }
}

async function sendOTPSMS(phone, otp) {
  return sendSMS(phone, `Your OxSteed verification code is: ${otp}. It expires in 10 minutes.`);
}

async function sendJobAlertSMS(phone, jobTitle, jobLocation) {
  return sendSMS(
    phone,
    `New job on OxSteed: "${jobTitle}" in ${jobLocation}. Open the app to view details.`
  );
}

module.exports = { sendSMS, sendOTPSMS, sendJobAlertSMS };
