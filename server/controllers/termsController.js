const db = require('../db');
const logger = require('../utils/logger');
const crypto = require('crypto');
const { hashIP } = require('../utils/encryption');
const { AppError } = require('../middleware/errorHandler');

const TERMS_VERSION = '1.0';
const TERMS_CONTENT = {
  version: '1.0',
  lastUpdated: '2026-05-11',
  sections: {
    peerAgreement: 'Tool rentals are informal peer-to-peer agreements between the tool owner and renter. OxSteed helps neighbors document listings, booking dates, messages, reports, and agreement acceptance.',
    platformFacilitator: 'OxSteed is a technology facilitator only. OxSteed is not the tool owner, renter, inspector, insurer, carrier, mechanic, guarantor, or a party to the rental agreement.',
    toolDescription: 'The owner is responsible for providing an accurate tool description, including condition, brand, model, known limitations, owner rules, deposit expectations, and replacement value when applicable.',
    renterInspection: 'The renter is responsible for inspecting the tool before use and deciding whether the tool is appropriate and safe for the renter\'s intended use.',
    useRisk: 'The renter assumes ordinary risks of tool use, including injury or property damage caused by use, misuse, transport, storage, or failure to follow the owner\'s rules or manufacturer guidance.',
    damageLoss: 'The renter may be responsible to the owner for damage beyond normal wear, loss, theft, missing parts, late return, or failure to return the tool clean and working, as documented by the parties.',
    deposits: 'Deposits and refunds are obligations between owner and renter unless OxSteed explicitly provides an escrow or payment-hold feature for that booking.',
    insurance: 'General insurance may not cover rented equipment, peer-to-peer tools, theft, misuse, or damage. Each party is responsible for understanding their own insurance coverage.',
    reporting: 'Either party can report bad behavior. OxSteed may review reports, messages, booking records, and evidence and may take platform action such as warnings, restrictions, suspensions, or bans.',
    noGuarantee: 'OxSteed does not guarantee tool condition, safety, availability, return, payment, refund, repair, replacement, or dispute outcome.',
    acknowledgment: 'Both parties acknowledge that they have read and agree to these peer rental terms before moving forward.'
  }
};

const getTerms = async (req, res, next) => {
  try {
    res.json(TERMS_CONTENT);
  } catch (err) {
    next(err);
  }
};

const acceptTerms = async (req, res, next) => {
  try {
    const { bookingId, userRole } = req.body;
    const userId = req.user.id;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('user-agent') || '';

    // Validate user role
    if (!['customer', 'owner'].includes(userRole)) {
      throw new AppError('Invalid user role', 400, 'validation_failed', { userRole: 'Must be customer or owner' });
    }

    // Hash IP and user-agent for privacy (stored hashed, not plaintext)
    const hashedIp = hashIP(ipAddress);
    const hashedUserAgent = crypto.createHash('sha256').update(userAgent).digest('hex');

    // Verify booking exists and user is part of it
    const bookingResult = await db.query(
      `SELECT * FROM tool_rentals_bookings
       WHERE id = $1 AND (customer_id = $2 OR owner_id = $2)`,
      [bookingId, userId]
    );

    if (!bookingResult.rows[0]) {
      throw new AppError('Booking not found', 404, 'not_found');
    }

    const booking = bookingResult.rows[0];

    // Verify user role matches their booking role
    if (userRole === 'customer' && booking.customer_id !== userId) {
      throw new AppError('You are not the customer on this booking', 403, 'forbidden');
    }
    if (userRole === 'owner' && booking.owner_id !== userId) {
      throw new AppError('You are not the owner on this booking', 403, 'forbidden');
    }

    // Check if already accepted
    const existingResult = await db.query(
      `SELECT id FROM tool_rental_terms_acceptance
       WHERE booking_id = $1 AND user_id = $2`,
      [bookingId, userId]
    );

    if (existingResult.rows[0]) {
      throw new AppError('You have already accepted these terms', 400, 'already_exists');
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

    logger.info('Terms accepted', {
      bookingId,
      userId,
      userRole,
      termsVersion: TERMS_VERSION
    });

    res.json({
      accepted: true,
      acceptedAt: acceptance.accepted_at,
      termsVersion: TERMS_VERSION
    });
  } catch (err) {
    next(err);
  }
};

const getBookingTermsStatus = async (req, res, next) => {
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
      throw new AppError('Booking not found', 404, 'not_found');
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
    next(err);
  }
};

module.exports = { getTerms, acceptTerms, getBookingTermsStatus };
