// routes/guests.js — Guest session and verification endpoints
// No authentication required — designed for unauthenticated users

const crypto = require('crypto');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const rateLimiter = require('../middleware/rateLimiter');
const { sendEmail } = require('../utils/email');
const logger = require('../utils/logger');
const pool = require('../db');

const router = express.Router();

// Store guest sessions in-memory (can be extended to database for analytics)
const guestSessions = new Map();
const otpCache = new Map(); // { verificationId: { email, phone, code, expiresAt, attempts } }

/**
 * POST /api/guests/sessions
 * Register/renew a guest session (browser sends client-generated UUID)
 */
router.post('/sessions', async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    // Track session
    guestSessions.set(sessionId, {
      createdAt: new Date(),
      lastActivity: new Date(),
      verifications: [],
      verifiedEmails: new Set(),
    });

    res.json({ sessionId, createdAt: new Date().toISOString() });
  } catch (err) {
    logger.error('Failed to create guest session', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/guests/sessions/:sessionId/track
 * Track guest actions (views, message attempts, booking attempts)
 */
router.post('/sessions/:sessionId/track', rateLimiter.generalLimiter, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { action, data } = req.body;

    const session = guestSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    session.lastActivity = new Date();

    logger.info('Guest action tracked', {
      sessionId,
      action,
      timestamp: new Date().toISOString(),
    });

    res.json({ tracked: true });
  } catch (err) {
    logger.error('Failed to track guest action', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/guests/sessions/:sessionId/contact-verify
 * Send OTP to guest email for verification before messaging a helper
 */
router.post(
  '/sessions/:sessionId/contact-verify',
  rateLimiter.strictLimiter, // 5 requests/hour to prevent abuse
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { email, phone } = req.body;

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }

      const session = guestSessions.get(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Use crypto.randomInt — Math.random() is not cryptographically secure
      const otp = crypto.randomInt(100000, 1000000).toString();
      const verificationId = uuidv4();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      otpCache.set(verificationId, {
        email,
        phone,
        code: otp,
        expiresAt,
        attempts: 0,
      });

      try {
        await sendEmail({
          to: email,
          subject: 'Your OxSteed Verification Code',
          text: `Your OxSteed verification code is: ${otp}\n\nThis code expires in 10 minutes. Do not share it with anyone.`,
          html: `<p>Your OxSteed verification code is: <strong>${otp}</strong></p><p>This code expires in 10 minutes. Do not share it with anyone.</p>`,
        });
      } catch (emailErr) {
        otpCache.delete(verificationId);
        logger.warn('Failed to send guest verification OTP', { email, err: emailErr });
        return res.status(500).json({ error: 'Failed to send verification code. Please try again.' });
      }

      session.lastActivity = new Date();
      session.verifications.push({ verificationId, email, createdAt: new Date() });

      logger.info('Guest verification OTP sent', { sessionId, verificationId });

      res.json({
        verificationId,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (err) {
      logger.error('Failed to send verification OTP', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

/**
 * POST /api/guests/sessions/:sessionId/contact-verify/:verificationId
 * Verify OTP code submitted by guest — marks the email as verified in the session
 */
router.post(
  '/sessions/:sessionId/contact-verify/:verificationId',
  rateLimiter.strictLimiter, // 5 requests/hour to prevent brute-force
  async (req, res) => {
    try {
      const { sessionId, verificationId } = req.params;
      const { code } = req.body;

      const session = guestSessions.get(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const otpData = otpCache.get(verificationId);
      if (!otpData) {
        return res.status(404).json({ error: 'Verification code not found or expired' });
      }

      if (new Date() > otpData.expiresAt) {
        otpCache.delete(verificationId);
        return res.status(400).json({ error: 'Verification code expired. Request a new one.' });
      }

      if (otpData.attempts >= 3) {
        otpCache.delete(verificationId);
        return res.status(429).json({ error: 'Too many failed attempts. Request a new code.' });
      }

      const submittedCode = String(code).trim();

      // Use constant-time comparison to prevent timing attacks
      let isValid = false;
      if (submittedCode.length === otpData.code.length) {
        isValid = crypto.timingSafeEqual(
          Buffer.from(submittedCode),
          Buffer.from(otpData.code),
        );
      }

      if (!isValid) {
        otpData.attempts += 1;
        logger.warn('Invalid guest OTP attempt', {
          sessionId,
          verificationId,
          attempts: otpData.attempts,
        });
        return res.status(400).json({
          error: `Invalid code. ${3 - otpData.attempts} attempts remaining.`,
        });
      }

      // Success — remove OTP and mark email as verified in the session
      const verifiedEmail = otpData.email;
      otpCache.delete(verificationId);

      session.verifiedEmails.add(verifiedEmail);
      session.lastActivity = new Date();

      logger.info('Guest email verified', { sessionId });

      res.json({ verified: true, email: verifiedEmail });
    } catch (err) {
      logger.error('Failed to verify guest OTP', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

/**
 * POST /api/guests/sessions/:sessionId/contact-message
 * Create a guest-to-helper message (one-way until guest signs up)
 * Requires the guest to have verified the email address via OTP first.
 */
router.post(
  '/sessions/:sessionId/contact-message',
  rateLimiter.authLimiter, // 15 requests/15 min to prevent spam
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { helperId, message, email } = req.body;

      if (!message || message.length < 10 || message.length > 4000) {
        return res.status(400).json({ error: 'Message must be 10–4000 characters' });
      }

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Valid email required' });
      }

      const session = guestSessions.get(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Enforce email verification — callers cannot skip the OTP step
      if (!session.verifiedEmails || !session.verifiedEmails.has(email)) {
        return res.status(403).json({
          error: 'Email not verified. Please verify your email address before sending a message.',
        });
      }

      // Verify helper exists and is active
      const helperResult = await pool.query(
        `SELECT hp.user_id, u.email, u.first_name
         FROM helper_profiles hp
         JOIN users u ON u.id = hp.user_id
         WHERE hp.user_id = $1
           AND u.deleted_at IS NULL
           AND u.email_verified = TRUE
           AND u.onboarding_completed = TRUE`,
        [helperId],
      );

      if (!helperResult.rows.length) {
        return res.status(404).json({ error: 'Helper not found' });
      }

      const helper = helperResult.rows[0];

      const result = await pool.query(
        `INSERT INTO guest_conversations (guest_email, helper_id, message, guest_session_id, status, created_at)
         VALUES ($1, $2, $3, $4, 'pending', NOW())
         RETURNING id`,
        [email, helperId, message, sessionId],
      );

      // Notify helper of the new guest message
      try {
        await sendEmail({
          to: helper.email,
          subject: 'New message from a potential customer on OxSteed',
          text: `Hi ${helper.first_name},\n\nA potential customer left you a message on OxSteed:\n\n"${message}"\n\nThey provided their email: ${email}\n\nReply to them directly or log in to OxSteed to respond.\n\nThe OxSteed Team`,
          html: `<p>Hi ${helper.first_name},</p><p>A potential customer left you a message on OxSteed:</p><blockquote style="border-left:3px solid #ccc;padding-left:1em;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</blockquote><p>They provided their email: <a href="mailto:${email}">${email}</a></p><p>Reply to them directly or <a href="${process.env.CLIENT_URL || process.env.APP_URL || 'https://oxsteed.com'}">log in to OxSteed</a> to respond.</p><p>The OxSteed Team</p>`,
        });
      } catch (emailErr) {
        // Non-fatal — the message is saved; log and continue
        logger.warn('Failed to notify helper of guest message', {
          helperId,
          guestEmail: email,
          err: emailErr,
        });
      }

      logger.info('Guest message sent', {
        sessionId,
        helperId,
        messageLength: message.length,
      });

      res.json({
        id: result.rows[0].id,
        status: 'pending',
        message: 'Message sent! The helper will contact you if interested.',
      });
    } catch (err) {
      logger.error('Failed to send guest message', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// Cleanup expired OTPs every 5 minutes
setInterval(() => {
  const now = new Date();
  for (const [id, data] of otpCache.entries()) {
    if (now > data.expiresAt) {
      otpCache.delete(id);
    }
  }
}, 5 * 60 * 1000);

// Cleanup stale guest sessions older than 24 hours of inactivity
setInterval(() => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  for (const [id, session] of guestSessions.entries()) {
    if (session.lastActivity < cutoff) {
      guestSessions.delete(id);
    }
  }
}, 60 * 60 * 1000); // Run hourly

module.exports = router;
