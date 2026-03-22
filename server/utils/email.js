// Phase 2 - Email utility (Resend API)
// OxSteed v2

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.SMTP_FROM || 'noreply@oxsteed.com';
const FROM_NAME = process.env.FROM_NAME || 'OxSteed';

let emailConfigured = false;
if (RESEND_API_KEY && RESEND_API_KEY.startsWith('re_')) {
  emailConfigured = true;
} else {
  console.warn('Resend API key not set or invalid. Email features disabled.');
}

async function sendEmail({ to, subject, text, html }) {
  if (!emailConfigured) {
    console.warn('Email not sent - Resend not configured');
    return { success: false, error: 'Email not configured' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [to],
        subject,
        text,
        html,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Resend API error:', data);
      return { success: false, error: data.message || 'Email send failed' };
    }

    console.log('Email sent successfully to:', to);
    return { success: true, id: data.id };
  } catch (err) {
    console.error('Email send error:', err);
    return { success: false, error: err.message };
  }
}

async function sendWelcomeEmail(user) {
  return sendEmail({
    to: user.email,
    subject: 'Welcome to OxSteed!',
    text: `Hi ${user.first_name}, welcome to OxSteed! Your account has been created successfully.`,
    html: `<p>Hi <strong>${user.first_name}</strong>,</p><p>Welcome to OxSteed! Your account has been created successfully.</p><p>You can now browse listings or post your skills on our platform.</p><p>- The OxSteed Team</p>`,
  });
}

async function sendOTPEmail(email, otp) {
  return sendEmail({
    to: email,
    subject: 'Your OxSteed verification code',
    text: `Your verification code is: ${otp}. It expires in 15 minutes.`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;"><h2 style="color: #2563eb;">OxSteed</h2><p>Your verification code is:</p><p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1e40af; padding: 16px; background: #f0f4ff; border-radius: 8px; text-align: center;">${otp}</p><p style="color: #666;">This code expires in 15 minutes. If you didn't request this, you can safely ignore this email.</p></div>`,
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
