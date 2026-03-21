// Phase 2 — Email utility (SendGrid / SMTP)
// OxSteed v2

const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@oxsteed.com';
const FROM_NAME = process.env.FROM_NAME || 'OxSteed';

async function sendEmail({ to, subject, text, html, templateId, dynamicData }) {
  const msg = {
    to,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject,
  };

  if (templateId) {
    msg.templateId = templateId;
    msg.dynamicTemplateData = dynamicData || {};
  } else {
    if (html) msg.html = html;
    if (text) msg.text = text;
  }

  try {
    await sgMail.send(msg);
    return { success: true };
  } catch (err) {
    console.error('Email send error:', err.response?.body || err.message);
    return { success: false, error: err.message };
  }
}

async function sendWelcomeEmail(user) {
  return sendEmail({
    to: user.email,
    subject: 'Welcome to OxSteed!',
    templateId: process.env.SG_TEMPLATE_WELCOME,
    dynamicData: {
      first_name: user.first_name,
      role: user.role,
    },
  });
}

async function sendOTPEmail(email, otp) {
  return sendEmail({
    to: email,
    subject: 'Your OxSteed verification code',
    text: `Your verification code is: ${otp}. It expires in 10 minutes.`,
    html: `<p>Your verification code is: <strong>${otp}</strong></p><p>It expires in 10 minutes.</p>`,
  });
}

async function sendPasswordResetEmail(email, resetUrl) {
  return sendEmail({
    to: email,
    subject: 'Reset your OxSteed password',
    text: `Reset your password: ${resetUrl}`,
    html: `<p>Click <a href="${resetUrl}">here</a> to reset your password. This link expires in 1 hour.</p>`,
  });
}

module.exports = { sendEmail, sendWelcomeEmail, sendOTPEmail, sendPasswordResetEmail };
