const db = require('../db');
const logger = require('../utils/logger');
const crypto = require('crypto');
const { hashIP } = require('../utils/encryption');

const TERMS_VERSION = '1.0';
const TERMS_CONTENT = {
  version: '1.0',
  lastUpdated: '2026-04-19',
  sections: {
    paymentObligation: 'Customer agrees to send payment to the tool owner by the agreed-upon rental end date.',
    returnObligation: 'Customer agrees to return the tool in the condition agreed upon, by the agreed-upon return date.',
    platformFacilitator: 'OxSteed is a technology facilitator only. OxSteed does not control user behavior and is not liable for user actions.',
    disputes: 'Disputes regarding payment are resolved through your bank\'s chargeback process. Disputes regarding tool condition are resolved through chargebacks.',
    reporting: 'Either party can report bad behavior. OxSteed reviews reports and may take action (warnings, suspensions, bans).',
    acknowledgment: 'Both parties acknowledge that they have read and agree to these terms.'
  }
};

const getTerms = async (req, res) => {
  try {
    res.json(TERMS_CONTENT);
  } catch (err) {
    logger.error('getTerms error', { err });
    res.status(500).json({ error: 'Failed to load terms' });
  }
};

const acceptTerms = async (req, res) => {
  try {
    const { bookingId, userRole } = req.body;
    const userId = req.user.id;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('user-agent') || '';

    // Hash IP and user-agent for privacy (stored hashed, not plaintext)
    const hashedIp = hashIP(ipAddress);
    const hashedUserAgent = crypto.createHash('sha256').update(userAgent).digest('hex');

    // Validate user role
    if (!['customer', 'owner'].includes(userRole)) {
      return res.status(400).json({ error: 'Invalid user role' });
    }

    // Verify booking exists and user is part of it
    const bookingResult = await db.query(
      `SELECT * FROM tool_rentals_bookings
       WHERE id = $1 AND (customer_id = $2 OR owner_id = $2)`,
      [bookingId, userId]
    );

    if (!bookingResult.rows[0]) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];

    // Verify user role matches their booking role
    if (userRole === 'customer' && booking.customer_id !== userId) {
      return res.status(403).json({ error: 'You are not the customer on this booking' });
    }
    if (userRole === 'owner' && booking.owner_id !== userId) {
      return res.status(403).json({ error: 'You are not the owner on this booking' });
    }

    // Check if already accepted
    const existingResult = await db.query(
      `SELECT id FROM tool_rental_terms_acceptance
       WHERE booking_id = $1 AND user_id = $2`,
      [bookingId, userId]
    );

    if (existingResult.rows[0]) {
      return res.status(400).json({ error: 'You have already accepted these terms' });
    }

    // Record acceptance with hashed IP and user-agent for privacy
    const result = await db.query(
      `INSERT INTO tool_rental_terms_acceptance
       (booking_id, user_id, user_role, terms_version, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, accepted_at, user_role`,
      [bookingId, userId, userRole, TERMS_VERSION, hashedIp, hashedUserAgent]
    );

    const acceptance = result.rows[0];

    res.json({
      accepted: true,
      acceptedAt: acceptance.accepted_at,
      termsVersion: TERMS_VERSION
    });

    logger.info('Terms accepted', {
      bookingId,
      userId,
      userRole,
      termsVersion: TERMS_VERSION
    });
  } catch (err) {
    logger.error('acceptTerms error', { err });
    res.status(500).json({ error: 'Failed to accept terms' });
  }
};

const getBookingTermsStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;

    // Check if user is part of this booking
    const bookingResult = await db.query(
      `SELECT * FROM tool_rentals_bookings
       WHERE id = $1 AND (customer_id = $2 OR owner_id = $2)`,
      [bookingId, userId]
    );

    if (!bookingResult.rows[0]) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Get acceptance status for both parties
    const acceptanceResult = await db.query(
      `SELECT user_role, accepted_at FROM tool_rental_terms_acceptance
       WHERE booking_id = $1`,
      [bookingId]
    );

    const acceptances = {};
    acceptanceResult.rows.forEach(row => {
      acceptances[row.user_role] = row.accepted_at;
    });

    res.json({
      bookingId,
      customerAccepted: !!acceptances.customer,
      ownerAccepted: !!acceptances.owner,
      bothAccepted: !!acceptances.customer && !!acceptances.owner,
      acceptances
    });
  } catch (err) {
    logger.error('getBookingTermsStatus error', { err });
    res.status(500).json({ error: 'Failed to load terms status' });
  }
};

module.exports = { getTerms, acceptTerms, getBookingTermsStatus };
