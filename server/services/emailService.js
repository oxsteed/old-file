// server/services/emailService.js
//
// Supports two sending modes:
//
//  1. Per-user SMTP — when a `smtpConfig` object is passed, a transporter is
//     created on-the-fly using the owner's own credentials.  This is the
//     intended path for tool-rental booking emails so they appear to come from
//     the owner's own address.
//
//  2. Platform fallback — when no `smtpConfig` is supplied the service falls
//     back to the platform-level SMTP env vars (SMTP_HOST, SMTP_USER, etc.).
//     If those are also absent the send is skipped with a warning so the app
//     never crashes at startup or at runtime due to missing mail config.

const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

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
// Strip SMTP header-injection characters (CR, LF, NUL) from display names.
function sanitizeHeaderValue(str) {
  return String(str || '').replace(/[\r\n\0]/g, ' ').trim();
}

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
 * Returns the platform-level transporter built from env vars, or null if the
 * env vars are not configured.  Created lazily and cached.
 */
let _platformTransport = null;
function getPlatformTransport() {
  if (_platformTransport) return _platformTransport;
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  _platformTransport = buildTransport({
    host: SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: SMTP_USER,
    pass: SMTP_PASS,
  });
  return _platformTransport;
}

/**
 * Send an email.
 *
 * @param {object}  options
 * @param {string}  options.to          Recipient address
 * @param {string}  options.subject     Subject line
 * @param {string}  options.html        HTML body
 * @param {string}  [options.from]      Override the From address
 * @param {object}  [options.smtpConfig] Per-user SMTP credentials:
 *                                        { host, port, secure, user, pass, fromName }
 *                                       When provided the email is sent via the
 *                                       user's own mail server instead of the
 *                                       platform account.
 */
async function send({ to, subject, html, from, smtpConfig }) {
  let transporter;
  let fromAddress;

  if (smtpConfig && smtpConfig.host && smtpConfig.user && smtpConfig.pass) {
    // --- per-user path ---
    transporter = buildTransport(smtpConfig);
    const displayName = sanitizeHeaderValue(smtpConfig.fromName || smtpConfig.user);
    fromAddress = from || `"${displayName}" <${smtpConfig.user}>`;
  } else {
    // --- platform fallback path ---
    transporter = getPlatformTransport();
    if (!transporter) {
      logger.warn('emailService: no SMTP config available — email skipped', { to, subject });
      return null;
    }
    fromAddress = from ||
      process.env.SMTP_FROM ||
      `"OxSteed" <${process.env.SMTP_USER}>`;
  }

  const info = await transporter.sendMail({
    from: fromAddress,
    to,
    subject,
    html,
  });

  logger.info('emailService: sent', { messageId: info.messageId, to });
  return info;
}

module.exports = { send };
