// server/services/emailService.js
//
// Supports two sending modes:
//
//  1. Per-user SMTP - when a `smtpConfig` object is passed, a transporter is
//     created on-the-fly using the owner's own credentials.  This is the
//     intended path for tool-rental booking emails so they appear to come from
//     the owner's own address.
//
//  2. Platform delivery - when no `smtpConfig` is supplied, use the shared
//     Resend transport. Platform SMTP is intentionally not a second delivery
//     system; this keeps retry and idempotency semantics consistent.
//
// Review P3-849 (two email systems): this file is the service-level API, not
// a competing delivery system. The actual platform transport lives in
// utils/email.js (sendEmail / sendEmailOrThrow, Resend). NEW code should:
//   * use utils/email.js sendEmail / sendEmailOrThrow for platform mail
//     (branded templates in utils/emailTemplate.js), or
//   * use emailService.send when the mail must go out through a specific
//     user's own SMTP credentials (the per-user path above).
// Do not build new delivery paths on nodemailer directly: the only other
// direct nodemailer use is the provider-health probe (transporter.verify),
// which sends nothing.

const nodemailer = require('nodemailer');
const logger = require('../utils/logger');
const { maskEmail } = require('../utils/directQuote');

/**
 * Build a nodemailer transporter from an SMTP config object.
 *
 * @param {object} cfg
 * @param {string} cfg.host
 * @param {number} [cfg.port=587]
 * @param {boolean} [cfg.secure=false]  true = port 465 (SSL), false = STARTTLS
 * @param {string} cfg.user
 * @param {string} cfg.pass
 * @returns {import('nodemailer').Transporter}
 */
function buildTransport(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port || 587,
    secure: cfg.secure === true,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });
}

/**
 * Send an email.
 *
 * @param {object}  options
 * @param {string}  options.to          Recipient address
 * @param {string}  options.subject     Subject line
 * @param {string}  options.html        HTML body
 * @param {string}  [options.from]      Override the From address
 * @param {string}  [options.text] Plain-text body for platform delivery
 * @param {string}  [options.idempotencyKey] Provider idempotency key
 * @param {object}  [options.smtpConfig] Per-user SMTP credentials:
 *                                        { host, port, secure, user, pass, fromName }
 *                                       When provided the email is sent via the
 *                                       user's own mail server instead of the
 *                                       platform account.
 */
async function send({ to, subject, html, text, from, smtpConfig, idempotencyKey, headers }) {
  let transporter;
  let fromAddress;

  if (smtpConfig && smtpConfig.host && smtpConfig.user && smtpConfig.pass) {
    // --- per-user path ---
    transporter = buildTransport(smtpConfig);
    const displayName = smtpConfig.fromName || smtpConfig.user;
    fromAddress = from || `"${displayName}" <${smtpConfig.user}>`;
  } else {
    // --- shared platform Resend path ---
    const resend = require('../utils/email');
    const result = await resend.sendEmail({
      to,
      subject,
      html,
      text: text || String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      ...(from ? { from: String(from).match(/<([^>]+)>/)?.[1] || from } : {}),
      idempotencyKey,
      headers,
    });
    if (result?.success === true) {
      logger.info('emailService: sent via Resend', { messageId: result.id });
      return { messageId: result.id, provider: 'resend' };
    }
    if (result?.code === 'email_not_configured') {
      logger.error('emailService: Resend is not configured - email not sent', { subject });
      return null;
    }
    throw new resend.EmailDeliveryError(result?.error || 'Email send failed', result?.code);
  }

  const info = await transporter.sendMail({
    from: fromAddress,
    to,
    subject,
    html,
  });

  // Review P3-852: mask the recipient address in logs (PII).
  logger.info('emailService: sent', { messageId: info.messageId, to: maskEmail(to) });
  return info;
}

module.exports = { send };
