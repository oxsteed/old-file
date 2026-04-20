// routes/guests.js — Guest session and verification endpoints
// No authentication required — designed for unauthenticated users

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const rateLimiter = require('../middleware/rateLimiter');
const { sendOTP } = require('../utils/email');
const { logger } = require('../utils/logger');
const pool = require('../db');

const router = express.Router();

// Store guest sessions in-memory (can be extended to database for analytics)
const guestSessions = new Map();
const otpCache = new Map(); // { verificationId: { email, phone, code, expiresAt } }

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
    });

    res.json({ sessionId, createdAt: new Date().toISOString() });
  } catch (err) {
    logger.error('Failed to create guest session', err);
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

    // Update last activity
    session.lastActivity = new Date();

    // Log action (optional: store in database for analytics)
    logger.info('Guest action tracked', {
      sessionId,
      action,
      data,
      timestamp: new Date().toISOString(),
    });

    res.json({ tracked: true });
  } catch (err) {
    logger.error('Failed to track guest action', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/guests/sessions/:sessionId/contact-verify
 * Send OTP to guest email/phone for verification
 * Prevents spam while keeping friction low
 */
router.post(
  '/sessions/:sessionId/contact-verify',
  rateLimiter.strictLimiter, // 5 requests/hour to prevent abuse
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { email, phone } = req.body;

      // Validate email
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }

      const session = guestSessions.get(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Generate 6-digit OTP
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const verificationId = uuidv4();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store OTP
      otpCache.set(verificationId, {
        email,
        phone,
        code: otp,
        expiresAt,
        attempts: 0,
      });

      // Send OTP email
      try {
        await sendOTP(email, otp, {
          subject: 'Your OxSteed Verification Code',
          context: {
            code: otp,
            expiresIn: '10 minutes',
            action: 'verify email to contact a helper',
          },
        });
      } catch (emailErr) {
        logger.warn('Failed to send verification OTP', emailErr);
        return res.status(500).json({ error: 'Failed to send verification code. Please try again.' });
      }

      // Update session
      session.lastActivity = new Date();
      session.verifications.push({
        verificationId,
        email,
        createdAt: new Date(),
      });

      logger.info('Guest verification OTP sent', {
        sessionId,
        email,
        verificationId,
      });

      res.json({
        verificationId,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (err) {
      logger.error('Failed to send verification OTP', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

/**
 * POST /api/guests/sessions/:sessionId/contact-verify/:verificationId
 * Verify OTP code submitted by guest
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

      // Check expiration
      if (new Date() > otpData.expiresAt) {
        otpCache.delete(verificationId);
        return res.status(400).json({ error: 'Verification code expired. Request a new one.' });
      }

      // Check attempt count (max 3 attempts)
      if (otpData.attempts >= 3) {
        otpCache.delete(verificationId);
        return res.status(429).json({ error: 'Too many failed attempts. Request a new code.' });
      }

      // Verify code (constant-time comparison to prevent timing attacks)
      const submittedCode = String(code).trim();
      const isValid = submittedCode === otpData.code;

      if (!isValid) {
        otpData.attempts += 1;
        logger.warn('Invalid OTP attempt', {
          sessionId,
          verificationId,
          attempts: otpData.attempts,
        });
        return res.status(400).json({
          error: `Invalid code. ${3 - otpData.attempts} attempts remaining.`,
        });
      }

      // Success — remove OTP from cache
      otpCache.delete(verificationId);

      logger.info('Guest email verified', {
        sessionId,
        email: otpData.email,
      });

      res.json({
        verified: true,
        email: otpData.email,
      });
    } catch (err) {
      logger.error('Failed to verify OTP', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

/**
 * POST /api/guests/sessions/:sessionId/contact-message
 * Create a guest-to-helper message (one-way until guest signs up)
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

      // Verify helper exists
      const helperResult = await pool.query(
        'SELECT id, user_id, require_contact_signup FROM helper_profiles WHERE user_id = $1',
        [helperId],
      );

      if (!helperResult.rows.length) {
        return res.status(404).json({ error: 'Helper not found' });
      }

      const helper = helperResult.rows[0];

      // Create guest conversation record
      const result = await pool.query(
        `INSERT INTO guest_conversations (guest_email, helper_id, message, guest_session_id, status, created_at)
         VALUES ($1, $2, $3, $4, 'pending', NOW())
         RETURNING id`,
        [email, helperId, message, sessionId],
      );

      // TODO: Send email to helper notifying them of the message

      logger.info('Guest message sent', {
        sessionId,
        email,
        helperId,
        messageLength: message.length,
      });

      res.json({
        id: result.rows[0].id,
        status: 'pending',
        message: 'Message sent! The helper will contact you if interested.',
      });
    } catch (err) {
      logger.error('Failed to send guest message', err);
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

module.exports = router;
