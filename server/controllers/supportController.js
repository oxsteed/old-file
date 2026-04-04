const { sendEmail, EMAIL_ADDRESSES } = require('../utils/email');

exports.submitSupportRequest = async (req, res) => {
  try {
    const { name, email, subject, message, category } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email, and message are required.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    if (message.length > 5000) {
      return res.status(400).json({ error: 'Message is too long (max 5000 characters).' });
    }

    const categoryLabel = category || 'General';
    const subjectLine = subject ? `[Support] ${subject}` : `[Support] ${categoryLabel} inquiry`;

    await sendEmail({
      to: EMAIL_ADDRESSES.support,
      from: EMAIL_ADDRESSES.support,
      fromName: 'OxSteed Support',
      subject: subjectLine,
      text: `Support request from: ${name} <${email}>\nCategory: ${categoryLabel}\n\n${message}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">OxSteed Support Request</h2>
          <table style="width:100%; border-collapse:collapse; margin-bottom:16px;">
            <tr><td style="padding:6px 0; color:#6b7280; width:100px;">From</td><td style="padding:6px 0; font-weight:600;">${name} &lt;${email}&gt;</td></tr>
            <tr><td style="padding:6px 0; color:#6b7280;">Category</td><td style="padding:6px 0;">${categoryLabel}</td></tr>
          </table>
          <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:16px; white-space:pre-wrap;">${message}</div>
          <p style="color:#9ca3af; font-size:12px; margin-top:16px;">Reply directly to this email to respond to the user at ${email}.</p>
        </div>
      `,
    });

    // Send confirmation to the user
    await sendEmail({
      to: email,
      from: EMAIL_ADDRESSES.support,
      fromName: 'OxSteed Support',
      subject: 'We received your support request',
      text: `Hi ${name},\n\nThank you for reaching out. We received your support request and will get back to you as soon as possible.\n\nIf your request is urgent, you can also email us directly at support@oxsteed.com.\n\n— OxSteed Support Team`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">OxSteed Support</h2>
          <p>Hi <strong>${name}</strong>,</p>
          <p>Thank you for reaching out. We received your support request and will get back to you as soon as possible.</p>
          <p>If your request is urgent, you can also email us directly at <a href="mailto:support@oxsteed.com">support@oxsteed.com</a>.</p>
          <p>— OxSteed Support Team</p>
        </div>
      `,
    });

    console.log(`[Support] Request submitted by ${email} — category: ${categoryLabel}`);
    res.json({ success: true, message: 'Support request submitted. Check your email for confirmation.' });
  } catch (err) {
    console.error('[Support] submitSupportRequest error:', err);
    res.status(500).json({ error: 'Failed to submit support request. Please email support@oxsteed.com directly.' });
  }
};
