const pool = require('../db');
const crypto = require('crypto');
const { attributePromotionConversion } = require('../analytics/promotionAttribution');
const bookingDeposits = require('../services/bookingDepositService');
const { checkScheduleAgreementGate } = require('../services/chatAgreements');
const availabilityService = require('../services/helperAvailabilityService');
const { sendValidationError, sendError } = require('../utils/apiError');
const logger = require('../utils/logger');
const { uuidv4 } = require('../utils/uuid');
const { sendNotification } = require('../services/notificationService');
const { broadcastToUser } = require('../services/socketService');
const recipientSvc = require('../services/bookingRecipientService');
const bookingLifecycle = require('../services/bookingRequestLifecycle');
const { buildIcsEvent } = require('../utils/ics');
const { withTransaction } = require('../utils/transaction');
const { emitDomainEvent, serviceEventProps } = require('../growth/emit');
const { publicHelperStandingPredicate } = require('./helpersController');

const DEFAULT_CONFIRMATION_HOURS = 24;
const MIN_CONFIRMATION_HOURS = 1;
const MAX_CONFIRMATION_HOURS = 168;
const HELPER_ROLES = ['helper', 'helper_pro', 'broker'];
// G-6/G-7: both status links (recipient invite + site-contact status) live
// 7 days from creation. No product precedent for a token TTL exists
// (quote lookup codes are 15-minute one-time challenges; invoice public
// tokens never expire), so 7 days is the recorded D-10 decision.
const STATUS_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const WEEKDAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * G-6/G-7: resolve an account by email for a recipient / site contact.
 * Returns the user id when an active, non-deleted account matches, else
 * null (the booking stays a named, token-linked recipient/contact). A
 * non-matching or malformed email is never an error: the booker sees
 * recipientUserId null in the response and can correct it.
 */
async function resolveUserIdByEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return null;
  try {
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE lower(email) = $1 AND deleted_at IS NULL AND is_active = TRUE LIMIT 1`,
      [clean]
    );
    return rows[0] ? String(rows[0].id) : null;
  } catch (err) {
    logger.warn('Failed to resolve booking contact by email', { error: err.message });
    return null;
  }
}

/**
 * G-6/G-7: deliver the status link through the channel booking
 * confirmations already use: sendNotification (in-app notification plus
 * push/email per the recipient's prefs) with a realtime socket event.
 * No new channel is invented. Named-only recipients/contacts have no
 * account, so there is nobody to notify: the booker shares the link from
 * the booking card (BookingRequestCard copy-link UI).
 */
async function deliverBookingStatusLinks(booking) {
  const deliveries = [];
  // Group 3 (item 146): a party who ended notifications for this booking
  // gets no further link delivery.
  if (booking.recipient_user_id && booking.recipient_token
    && !(await recipientSvc.isMuted(booking.id, { userId: String(booking.recipient_user_id) }))) {
    deliveries.push((async () => {
      try {
        broadcastToUser(booking.recipient_user_id, 'booking:recipient_invite', {
          bookingId: booking.id,
          status: booking.status,
        });
        await sendNotification({
          userId: booking.recipient_user_id,
          type: 'booking_recipient_invite',
          body: `${booking.service_name}, ${booking.requested_date}`,
          data: { bookingId: booking.id },
          action_url: `/bookings/status/${booking.recipient_token}`,
          idempotencyKey: `booking-recipient-invite:${booking.id}:${booking.recipient_user_id}`,
        });
      } catch (err) {
        logger.warn('Failed to deliver recipient invite link', { bookingId: booking.id, error: err.message });
      }
    })());
  }
  if (booking.site_contact_user_id && booking.status_token
    && !(await recipientSvc.isMuted(booking.id, { userId: String(booking.site_contact_user_id) }))) {
    deliveries.push((async () => {
      try {
        broadcastToUser(booking.site_contact_user_id, 'booking:site_contact_link', {
          bookingId: booking.id,
          status: booking.status,
        });
        await sendNotification({
          userId: booking.site_contact_user_id,
          type: 'booking_site_contact_link',
          body: `${booking.service_name}, ${booking.requested_date}`,
          data: { bookingId: booking.id },
          action_url: `/bookings/status/${booking.status_token}`,
          idempotencyKey: `booking-site-contact-link:${booking.id}:${booking.site_contact_user_id}`,
        });
      } catch (err) {
        logger.warn('Failed to deliver site-contact status link', { bookingId: booking.id, error: err.message });
      }
    })());
  }
  await Promise.allSettled(deliveries);
}

/**
 * G-6/G-7: the invite/status link is usable while it is neither revoked
 * nor past its 7-day expiry. Expired and revoked links answer exactly
 * like unknown ones (404) so they leak nothing.
 */
function inviteLinkUsable(booking) {
  if (!booking) return false;
  if (booking.status_token_revoked_at) return false;
  if (booking.status_token_expires_at && new Date(booking.status_token_expires_at) <= new Date()) return false;
  return true;
}

/**
 * G-6/G-7: shape a booking for the viewer. The booker sees everything
 * including both links. The recipient sees the booking without the
 * site-contact link (and never any payment internals: the transform
 * carries none). The site contact gets a scoped subset only: status,
 * schedule, address, helper reference, and their own contact details.
 * Nobody else reaches this helper (getBookingRequest 403s first).
 */
function bookingViewForUser(booking, userId) {
  // The ownership label rides on the transform (item 54) for every view.
  const full = transformBooking(booking);
  const isBooker = userId && String(userId) === String(booking.customer_id);
  if (isBooker) {
    return { ...full, recipientToken: booking.recipient_token || null };
  }
  const isSiteContact =
    userId && booking.site_contact_user_id && String(userId) === String(booking.site_contact_user_id);
  if (isSiteContact) {
    return {
      id: full.id,
      serviceName: full.serviceName,
      status: full.status,
      requestedDate: full.requestedDate,
      requestedStartTime: full.requestedStartTime,
      requestedEndTime: full.requestedEndTime,
      serviceLocation: full.serviceLocation,
      description: full.description,
      helperId: full.helperId,
      siteContactName: full.siteContactName,
      // Group 3 (D-43): phone numbers are masked in every non-booker view.
      siteContactPhone: recipientSvc.maskPhone(full.siteContactPhone),
      statusTokenExpiresAt: full.statusTokenExpiresAt,
      conversationId: full.conversationId,
      ownershipLabel: full.ownershipLabel,
      bookedByDelegate: full.bookedByDelegate,
    };
  }
  const { statusToken, ...rest } = full;
  // Group 3 (D-43): the recipient sees masked phones, never raw numbers.
  if (rest.recipientPhone) rest.recipientPhone = recipientSvc.maskPhone(rest.recipientPhone);
  if (rest.siteContactPhone) rest.siteContactPhone = recipientSvc.maskPhone(rest.siteContactPhone);
  return rest;
}

/**
 * If pending and past expires_at, mark expired (single-row).
 */
async function expireIfStale(bookingRow) {
  if (!bookingRow || bookingRow.status !== 'pending') return bookingRow;
  const exp = new Date(bookingRow.expires_at);
  if (exp > new Date()) return bookingRow;

  if (bookingRow.auto_post_on_expiry && bookingRow.customer_id) {
    try {
      const posted = await autoPostExpiredBooking(bookingRow.id);
      if (posted?.booking) return posted.booking;
    } catch (err) {
      logger.warn('Failed to auto-post stale booking during read', {
        bookingId: bookingRow.id,
        error: err.message,
      });
    }
  }

  const r = await pool.query(
    `UPDATE booking_requests
     SET status = 'expired', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [bookingRow.id]
  );
  if (r.rows.length) {
    await logBookingAudit(bookingRow.id, 'expired', null, 'system', 'pending', 'expired');
    return r.rows[0];
  }
  return bookingRow;
}

/**
 * Build job wizard prefill from a booking row.
 * Returns structured fields — the client assembles any locale-specific description text.
 */
function buildJobPrefillPayload(booking) {
  return {
    // The client uses serviceName as the job title (truncated if needed)
    title: String(booking.service_name || '').slice(0, 80) || null,
    // Pass structured fields so the client can build the description in the right language
    serviceName: booking.service_name || null,
    requestedDate: booking.requested_date || null,
    requestedStartTime: booking.requested_start_time || null,
    requestedEndTime: booking.requested_end_time || null,
    locationInput: booking.service_location || '',
    description: booking.description || '',
    notes: '',
    preferredHelperId: booking.helper_id,
    preferredHelperName: null,
    sourceBookingId: booking.id,
    // G-7: carry the site contact onto the job post prefill.
    siteContactName: booking.site_contact_name || null,
    siteContactPhone: booking.site_contact_phone || null,
    siteContactUserId: booking.site_contact_user_id || null,
    statusToken: booking.status_token || null,
  };
}

function nextDateForPreferredDay(day) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const key = String(day || '').trim().toLowerCase();
  const target = WEEKDAY_INDEX[key];
  if (target === undefined) return today.toISOString().slice(0, 10);
  let delta = (target - today.getDay() + 7) % 7;
  if (delta === 0) delta = 7;
  const next = new Date(today);
  next.setDate(today.getDate() + delta);
  return next.toISOString().slice(0, 10);
}

/**
 * Create a new booking request
 * POST /api/bookings
 */
exports.createBookingRequest = async (req, res) => {
  try {
    // Group 2, item 51 (delegate leg): a delegate with 'book' scope books
    // on the owner's behalf. The booking's customer stays the owner (the
    // deposit payer); booked_by records the delegate, so the ownership
    // label (54) always shows both. Anyone else passing onBehalfOfOwnerId
    // gets a 403, never a booking on a stranger's account.
    let customerId = req.user.id;
    let bookedByUserId = req.user.id;
    const onBehalfOfOwnerId = req.body && req.body.onBehalfOfOwnerId
      ? String(req.body.onBehalfOfOwnerId) : null;
    if (onBehalfOfOwnerId) {
      if (onBehalfOfOwnerId === String(req.user.id)) {
        return sendValidationError(res, { onBehalfOfOwnerId: 'You are already the booker.' });
      }
      const householdSvc = require('../services/householdDelegationService');
      const delegation = await householdSvc.findActiveDelegation(pool, onBehalfOfOwnerId, req.user.id);
      if (!delegation || !householdSvc.hasScope(delegation, 'book')) {
        return sendError(res, 403, 'You do not hold booking scope for this household', 'DELEGATE_SCOPE_DENIED');
      }
      customerId = onBehalfOfOwnerId;
    }
    const {
      helperId: helperIdInput,
      businessId,
      serviceName,
      requestedDate,
      requestedStartTime,
      requestedEndTime,
      serviceLocation,
      description,
      confirmationHours,
      availabilityMode = 'scheduled',
      autoPostOnExpiry = false,
      conversationId,
      guestSessionId,
      serviceId,
      timezone,
      // G-6: book for another person. The booker stays customer_id (and the
      // deposit payer); the recipient is who the work is for. An account is
      // attached by id, or by email (resolved server-side); otherwise the
      // recipient is named-only and token-linked.
      recipientUserId,
      recipientName,
      recipientPhone,
      recipientEmail,
      // G-7: site contact who coordinates arrival on site.
      siteContactName,
      siteContactPhone,
      siteContactUserId,
      siteContactEmail,
      source,
    } = req.body;

    // A booking now targets either a specific helper, a business (which routes
    // to its owner as the default acceptor), or both. Per migration 214, the
    // business_id column on booking_requests preserves the link to the business
    // even when the request is dispatched to the owner helper for confirmation.
    let helperId = helperIdInput;
    let business = null;
    if (businessId) {
      const bizRes = await pool.query(
        `SELECT id, user_id, business_name, is_active, is_listed, is_hidden_by_admin
           FROM businesses
          WHERE id = $1`,
        [businessId]
      );
      business = bizRes.rows[0];
      if (!business) return sendError(res, 404, 'Business not found', 'BUSINESS_NOT_FOUND');
      if (!business.is_active || business.is_listed === false || business.is_hidden_by_admin) {
        return sendError(res, 400, 'Business is not accepting bookings', 'BUSINESS_INACTIVE');
      }
      if (!helperId) helperId = business.user_id;
    }

    const errors = {};
    const normalizedAvailabilityMode = String(availabilityMode || 'scheduled').trim().toLowerCase();
    const requestOnly = normalizedAvailabilityMode === 'request_only';
    if (!['scheduled', 'request_only'].includes(normalizedAvailabilityMode)) {
      errors.availabilityMode = 'Invalid availability mode';
    }
    if (!helperId && !businessId) errors.helperId = 'Helper ID or Business ID is required';
    if (!serviceName || !String(serviceName).trim()) errors.serviceName = 'Service name is required';
    if (!requestedDate) errors.requestedDate = 'Date is required';
    if (!requestOnly && !requestedStartTime) errors.requestedStartTime = 'Start time is required';
    if (!requestOnly && !requestedEndTime) errors.requestedEndTime = 'End time is required';

    let hours = DEFAULT_CONFIRMATION_HOURS;
    if (confirmationHours !== undefined && confirmationHours !== null && confirmationHours !== '') {
      const n = parseInt(String(confirmationHours), 10);
      if (!Number.isFinite(n) || n < MIN_CONFIRMATION_HOURS || n > MAX_CONFIRMATION_HOURS) {
        errors.confirmationHours = `Must be between ${MIN_CONFIRMATION_HOURS} and ${MAX_CONFIRMATION_HOURS}`;
      } else {
        hours = n;
      }
    }

    if (Object.keys(errors).length > 0) {
      return sendValidationError(res, errors);
    }

    if (customerId === helperId) {
      return sendValidationError(res, { helperId: 'Cannot book with yourself' });
    }

    // G-6: the recipient is a different person from the booker. A named
    // recipient needs no account; an account recipient must exist.
    const cleanRecipientName = String(recipientName || '').trim().slice(0, 200) || null;
    const cleanRecipientPhone = String(recipientPhone || '').trim().slice(0, 40) || null;
    const cleanSiteContactName = String(siteContactName || '').trim().slice(0, 200) || null;
    const cleanSiteContactPhone = String(siteContactPhone || '').trim().slice(0, 40) || null;
    let cleanRecipientUserId = recipientUserId ? String(recipientUserId) : null;
    let cleanSiteContactUserId = siteContactUserId ? String(siteContactUserId) : null;
    // G-6/G-7: an email attaches an existing account when one matches;
    // a non-matching email stays a named, token-linked party.
    if (!cleanRecipientUserId && recipientEmail) {
      cleanRecipientUserId = await resolveUserIdByEmail(recipientEmail);
    }
    if (!cleanSiteContactUserId && siteContactEmail) {
      cleanSiteContactUserId = await resolveUserIdByEmail(siteContactEmail);
    }
    if (cleanRecipientUserId === customerId) {
      return sendValidationError(res, { recipientUserId: 'The recipient must be someone other than the booker' });
    }
    if (cleanRecipientUserId || cleanSiteContactUserId) {
      const usersRes = await pool.query(
        'SELECT id FROM users WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL',
        [[cleanRecipientUserId, cleanSiteContactUserId].filter(Boolean)]
      );
      const found = new Set(usersRes.rows.map((r) => String(r.id)));
      if (cleanRecipientUserId && !found.has(cleanRecipientUserId)) {
        return sendError(res, 404, 'Recipient not found', 'RECIPIENT_NOT_FOUND');
      }
      if (cleanSiteContactUserId && !found.has(cleanSiteContactUserId)) {
        return sendError(res, 404, 'Site contact not found', 'SITE_CONTACT_NOT_FOUND');
      }
    }
    if (cleanRecipientUserId && cleanRecipientUserId === helperId) {
      return sendValidationError(res, { recipientUserId: 'The recipient cannot be the helper' });
    }
    // G-7: a site contact gets a single-booking signed status link at
    // booking time (status + arrival window only, no amounts, no billing).
    // G-6: a recipient gets their own invite token on the same link: the
    // two roles never share a token, so a site contact cannot accept or
    // decline on the recipient's behalf. Both links expire in 7 days.
    const hasRecipient = Boolean(cleanRecipientUserId || cleanRecipientName || cleanRecipientPhone);
    const hasSiteContact = Boolean(cleanSiteContactName || cleanSiteContactPhone || cleanSiteContactUserId);
    const statusToken = (hasRecipient || hasSiteContact) ? crypto.randomBytes(32).toString('hex') : null;
    const recipientToken = hasRecipient ? crypto.randomBytes(32).toString('hex') : null;
    const statusTokenExpiresAt = statusToken ? new Date(Date.now() + STATUS_LINK_TTL_MS) : null;

    if (!requestOnly && requestedStartTime >= requestedEndTime) {
      return sendValidationError(res, { requestedEndTime: 'End time must be after start time' });
    }

    const reqDate = new Date(`${requestedDate}T12:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (reqDate < today) {
      return sendValidationError(res, { requestedDate: 'Cannot book in the past' });
    }

    // The confirmation deadline cannot extend beyond the requested service
    // date (or selected start time). This keeps the deadline usable for
    // next-day requests while still allowing longer windows for later dates.
    const deadlineTarget = requestOnly
      ? new Date(`${requestedDate}T23:59:00`)
      : new Date(`${requestedDate}T${requestedStartTime}:00`);
    const deadlineLimitHours = Math.max(
      MIN_CONFIRMATION_HOURS,
      Math.min(MAX_CONFIRMATION_HOURS, Math.floor((deadlineTarget.getTime() - Date.now()) / 3600000)),
    );
    if (Number.isNaN(deadlineTarget.getTime())) {
      return sendValidationError(res, { requestedDate: 'Invalid date' });
    }
    if (!requestOnly && deadlineTarget <= new Date()) {
      return sendValidationError(res, { requestedStartTime: 'Requested start time must be in the future' });
    }
    if (confirmationHours === undefined || confirmationHours === null || confirmationHours === '') {
      hours = Math.min(DEFAULT_CONFIRMATION_HOURS, deadlineLimitHours);
    }
    if (hours > deadlineLimitHours) {
      return sendValidationError(res, {
        confirmationHours: `Deadline must be no later than ${deadlineLimitHours} hours before the requested service date`,
      });
    }

    const helperResult = await pool.query(
      `SELECT u.id, u.role, u.is_active, u.deleted_at,
              (${publicHelperStandingPredicate('u')}) AS helper_capability_granted,
              COALESCE(hp.is_hidden_by_admin, FALSE) AS is_hidden_by_admin,
              COALESCE(hp.allow_booking, TRUE) AS allow_booking
         FROM users u
         LEFT JOIN helper_profiles hp ON hp.user_id = u.id
        WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [helperId]
    );
    if (helperResult.rows.length === 0) {
      return sendError(res, 404, 'Helper not found', 'HELPER_NOT_FOUND');
    }
    if (!helperResult.rows[0].is_active || helperResult.rows[0].is_hidden_by_admin) {
      return sendError(res, 400, 'Helper is not accepting bookings', 'HELPER_INACTIVE');
    }
    if (!business && !HELPER_ROLES.includes(helperResult.rows[0].role) && !helperResult.rows[0].helper_capability_granted) {
      return sendError(res, 400, 'User is not accepting bookings', 'INVALID_HELPER');
    }
    // Review P1-204: the helper's "allow booking" privacy switch is enforced
    // (business bookings follow the business's own listing state instead).
    if (!business && helperResult.rows[0].allow_booking === false) {
      return sendError(res, 403, 'This helper is not taking bookings right now', 'BOOKING_DISABLED');
    }

    // A scheduled request commits to a concrete time: verify it is truly free
    // (schedule, blocks, existing appointments) before the request exists.
    // Request-only bookings carry no agreed time yet and skip this check.
    if (!requestOnly) {
      const slotCheck = await bookingLifecycle.validateBookingSlot({
        helperId: business ? null : helperId,
        businessId: business ? business.id : null,
        date: requestedDate,
        start: requestedStartTime,
        end: requestedEndTime,
      });
      if (!slotCheck.ok) {
        return sendError(res, 409, slotCheck.message || 'Requested time is not available', slotCheck.code, {
          reason: slotCheck.reason,
        });
      }
    }

    
    if (conversationId || guestSessionId) {
      const agreementGate = await checkScheduleAgreementGate(pool, {
        conversationId: conversationId || null,
        guestSessionId: guestSessionId || null,
      });
      if (agreementGate.blocked) {
        return sendError(res, 409, 'Accept the required agreement before scheduling', 'agreement_required', {
          agreements: agreementGate.agreements,
        });
      }
    }

const bookingId = uuidv4();
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    const result = await withTransaction(pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO booking_requests (
          id, customer_id, helper_id, business_id, service_name, requested_date,
          requested_start_time, requested_end_time, service_location,
          description, expires_at, confirmation_hours,
          availability_mode, auto_post_on_expiry,
          conversation_id, guest_session_id, source, service_id, timezone,
          booked_by_user_id, recipient_user_id, recipient_name, recipient_phone,
          site_contact_name, site_contact_phone, site_contact_user_id, status_token,
          recipient_token, status_token_expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                  $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)
         RETURNING *`,
        [
          bookingId,
          customerId,
          helperId,
          businessId || null,
          String(serviceName).trim(),
          requestedDate,
          requestOnly ? null : requestedStartTime,
          requestOnly ? null : requestedEndTime,
          serviceLocation || null,
          description || null,
          expiresAt,
          hours,
          normalizedAvailabilityMode,
          requestOnly && Boolean(autoPostOnExpiry),
          conversationId || null,
          guestSessionId || null,
          source || (conversationId || guestSessionId ? 'messenger_picker' : 'calendar'),
          serviceId != null ? String(serviceId) : null,
          timezone || null,
          bookedByUserId,
          cleanRecipientUserId,
          cleanRecipientName,
          cleanRecipientPhone,
          cleanSiteContactName,
          cleanSiteContactPhone,
          cleanSiteContactUserId,
          statusToken,
          recipientToken,
          statusTokenExpiresAt,
        ]
      );
      await emitDomainEvent(client, 'booking.requested', serviceEventProps({ service_id: serviceId }), { userId: customerId, req });
      return inserted;
    }, 'booking_requested_growth');

    const booking = result.rows[0];

    await logBookingAudit(bookingId, 'created', bookedByUserId,
      bookedByUserId === customerId ? 'customer' : 'delegate', 'pending', 'pending');
    await notifyHelperOfBooking(helperId, booking);
    // G-6/G-7: deliver the status link to the recipient / site contact
    // accounts (in-app notification channel); named-only parties get the
    // link from the booker via the booking card.
    await deliverBookingStatusLinks(booking);

    logger.info('Booking request created', {
      bookingId,
      customerId,
      helperId,
      confirmationHours: hours,
    });

    res.status(201).json({
      success: true,
      // The booker alone sees the recipient invite token (to share with a
      // named recipient); reads never carry it.
      data: { ...transformBooking(booking), recipientToken: booking.recipient_token || null },
    });
    // Growth Center attribution (visit -> booking); after the response.
    attributePromotionConversion(req, { businessId: booking.business_id, helperUserId: booking.helper_id,
      conversionType: 'booking', referenceId: booking.id });
  } catch (err) {
    logger.error('Error creating booking request', { error: err.message, stack: err.stack });
    sendError(res, 500, 'Failed to create booking request');
  }
};

exports.getBookingRequest = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user?.id;

    const result = await pool.query(
      'SELECT * FROM booking_requests WHERE id = $1',
      [bookingId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Booking request not found');
    }

    const booking = result.rows[0];

    const isCustomer = userId && String(userId) === String(booking.customer_id);
    // G-6: the recipient the work is for can read the booking too.
    const isRecipient = userId && booking.recipient_user_id && String(userId) === String(booking.recipient_user_id);
    // G-7: the site contact gets a scoped read of the booking they are
    // attached to (status, schedule, address, helper contact); no money,
    // no recipient details, no status link, no modification.
    const isSiteContact = userId && booking.site_contact_user_id && String(userId) === String(booking.site_contact_user_id);
    // Group 2: an accepted household delegate of the owner (book, schedule,
    // or prepare scope) reads the booking the same way a recipient does:
    // no status link, no payment internals (the transform carries none).
    let isDelegate = false;
    if (userId && !isCustomer && !isRecipient && !isSiteContact) {
      const householdSvc = require('../services/householdDelegationService');
      const delegation = await householdSvc.findActiveDelegation(pool, booking.customer_id, userId);
      isDelegate = Boolean(delegation && ['book', 'schedule', 'prepare'].some((s) => householdSvc.hasScope(delegation, s)));
    }
    const isProvider = userId && (await bookingLifecycle.isProviderForBooking(userId, booking));
    if (userId && !isCustomer && !isRecipient && !isSiteContact && !isDelegate && !isProvider) {
      return sendError(res, 403, 'Not authorized to view this booking');
    }

    const view = bookingViewForUser(booking, userId);
    if (isCustomer || isProvider) {
      const pending = await bookingLifecycle.pendingRescheduleProposalsForBookings([booking.id]);
      view.pendingRescheduleProposal = pending.get(String(booking.id)) || null;
    }
    // Group 3 (D-42): the recipient and site contact see the provider's
    // name so they can confirm who arrives. Phones stay masked by the view.
    if (isRecipient || isSiteContact) {
      const helper = await recipientSvc.helperName(booking.helper_id);
      view.helperName = helper?.fullName || null;
    }

    res.json({
      success: true,
      data: view,
    });
  } catch (err) {
    logger.error('Error fetching booking request', { error: err.message });
    sendError(res, 500, 'Failed to fetch booking request');
  }
};

// ─── getBookingIcal ─────────────────────────────────────────────────
// GET /api/bookings/:bookingId/ical (G1-A7)
// Returns a valid RFC 5545 .ics file for the booking's scheduled visit.
// Same parties who may read the booking may export it (booker,
// recipient, site contact, household delegate, provider). A request-only
// booking has no concrete time, so it refuses instead of exporting a
// guessed time. Times are wall-clock values, emitted floating.
exports.getBookingIcal = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user?.id;

    const { rows } = await pool.query(
      `SELECT id, customer_id, helper_id, business_id, service_name,
              status, requested_date, requested_start_time, requested_end_time,
              service_location, description, availability_mode,
              recipient_user_id, site_contact_user_id, conversation_id, guest_session_id
         FROM booking_requests WHERE id = $1`,
      [bookingId]
    );
    if (!rows.length) return sendError(res, 404, 'Booking request not found');

    const booking = rows[0];
    const isCustomer = userId && String(userId) === String(booking.customer_id);
    const isRecipient = userId && booking.recipient_user_id && String(userId) === String(booking.recipient_user_id);
    const isSiteContact = userId && booking.site_contact_user_id && String(userId) === String(booking.site_contact_user_id);
    let isDelegate = false;
    if (userId && !isCustomer && !isRecipient && !isSiteContact) {
      const householdSvc = require('../services/householdDelegationService');
      const delegation = await householdSvc.findActiveDelegation(pool, booking.customer_id, userId);
      isDelegate = Boolean(delegation && ['book', 'schedule', 'prepare'].some((s) => householdSvc.hasScope(delegation, s)));
    }
    const isProvider = userId && (await bookingLifecycle.isProviderForBooking(userId, booking));
    if (!isCustomer && !isRecipient && !isSiteContact && !isDelegate && !isProvider) {
      return sendError(res, 403, 'Not authorized to view this booking');
    }

    if (!booking.requested_date || !booking.requested_start_time) {
      return sendError(res, 400, 'This booking has no scheduled time to export', 'no_scheduled_time');
    }
    const datePart = booking.requested_date instanceof Date
      ? booking.requested_date.toISOString().slice(0, 10)
      : String(booking.requested_date).slice(0, 10);
    const start = new Date(`${datePart}T${String(booking.requested_start_time).slice(0, 8)}`);
    const end = booking.requested_end_time
      ? new Date(`${datePart}T${String(booking.requested_end_time).slice(0, 8)}`)
      : new Date(start.getTime() + 60 * 60 * 1000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return sendError(res, 400, 'This booking has no scheduled time to export', 'no_scheduled_time');
    }

    const ics = buildIcsEvent({
      uid: `oxsteed-booking-${booking.id}@oxsteed.com`,
      title: booking.service_name || 'OxSteed Booking',
      start,
      end,
      location: booking.service_location || '',
      description: `OxSteed booking. Status: ${booking.status}.`,
      status: booking.status === 'accepted' ? 'CONFIRMED' : 'TENTATIVE',
    });

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="oxsteed-booking-${booking.id}.ics"`);
    res.send(ics);
  } catch (err) {
    logger.error('Failed to generate booking iCal', { bookingId: req.params?.bookingId, error: err.message });
    return sendError(res, 500, 'Failed to generate calendar file', 'INTERNAL_ERROR');
  }
};

/**
 * G-7: single-booking signed-token status link for the site contact.
 * Public, token-gated: status and arrival window only. No amounts, no
 * billing, no customer/helper identity, no payment state. Reuses the
 * public-token pattern (/quotes/view/:token, /invoice/p/:public_token).
 * G-6: the same URL also serves the recipient invite token; only that
 * token can accept or decline (canRespondAsRecipient), and only while
 * consent is still pending. Expired or revoked links 404 like unknown
 * ones. Both links share one 7-day expiry.
 */
exports.getPublicBookingStatus = async (req, res) => {
  try {
    const token = String(req.params.token || '');
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return sendError(res, 404, 'Booking status link not found');
    }
    const { rows } = await pool.query(
      `SELECT b.id, b.service_name, b.status, b.requested_date,
              b.requested_start_time, b.requested_end_time,
              b.site_contact_name, b.site_contact_user_id, b.status_token, b.recipient_token,
              b.recipient_consent_status, b.recipient_consented_at,
              b.status_token_expires_at, b.status_token_revoked_at,
              b.recipient_user_id, b.recipient_name, b.helper_id,
              b.care_instructions,
              COALESCE(a.arrived_at, ba.arrived_at) AS arrived_at
         FROM booking_requests b
         LEFT JOIN appointments a ON a.id = b.appointment_id
         LEFT JOIN business_appointments ba ON ba.id = b.business_appointment_id
        WHERE b.status_token = $1 OR b.recipient_token = $1`,
      [token]
    );
    if (!rows.length) {
      // Group 3 (D-40): a sponsorship invite token opens the sponsor
      // preview, not the visit status: amount, deadline, service, date.
      const { rows: sponsorRows } = await pool.query(
        `SELECT s.*, b.service_name, b.status AS booking_status, b.requested_date,
                b.requested_start_time, b.requested_end_time
           FROM booking_sponsorships s JOIN booking_requests b ON b.id = s.booking_id
          WHERE s.invite_token = $1 LIMIT 1`,
        [token]
      );
      if (!sponsorRows.length) return sendError(res, 404, 'Booking status link not found');
      // G3-25: refresh the sponsorship's expiry on every preview, so
      // the page never shows an expired invite as still payable.
      // Lazy require: bookingRecipientController does not require this
      // controller back, but keep the load lazy like the other
      // controller-to-controller calls in this file.
      // eslint-disable-next-line global-require
      const recipientController = require('./bookingRecipientController');
      const s = await recipientController.refreshSponsorship(sponsorRows[0]);
      return res.json({
        success: true,
        data: {
          isSponsorPreview: true,
          sponsorshipId: String(s.id),
          sponsorshipStatus: s.status,
          amountCents: Number(s.amount_cents),
          paymentDeadlineAt: s.payment_deadline_at || null,
          serviceName: s.service_name,
          status: s.booking_status,
          requestedDate: s.requested_date,
          requestedStartTime: s.requested_start_time,
          requestedEndTime: s.requested_end_time,
        },
      });
    }
    const row = rows[0];
    // D-600 (G3-18): the caller already holds the token, so naming the
    // failure (expired vs revoked) leaks nothing and lets the page offer
    // renewal for an expired link.
    if (!inviteLinkUsable(row)) {
      if (row.status_token_revoked_at) return sendError(res, 404, 'This status link was revoked', 'link_revoked');
      return sendError(res, 404, 'This status link has expired', 'link_expired');
    }
    const isRecipientToken = row.recipient_token && String(row.recipient_token) === token;
    // Group 3 (D-42): first name plus last initial once accepted, so the
    // person at the door can confirm the provider. D-48: care instructions
    // appear on the token page once the visit is done.
    const helper = await recipientSvc.helperName(row.helper_id);
    // D-596 (item 148): a token party who archived the visit sees the
    // archived flag on the public status page, so the page can show the
    // visit as archived; the visit stays readable through the link.
    const { rows: archiveRows } = await pool.query(
      `SELECT 1 FROM booking_visit_archives WHERE booking_id = $1 AND token_hash = $2 LIMIT 1`,
      [row.id, recipientSvc.tokenHash(token)]
    );
    return res.json({
      success: true,
      data: {
        serviceName: row.service_name,
        status: row.status,
        archived: archiveRows.length > 0,
        requestedDate: row.requested_date,
        requestedStartTime: row.requested_start_time,
        requestedEndTime: row.requested_end_time,
        arrivedAt: row.arrived_at,
        siteContactName: row.site_contact_name || null,
        // D-602 (G3-33): the relay hides the site-contact target when no
        // linked site-contact account exists.
        hasSiteContactAccount: Boolean(row.site_contact_user_id),
        hasRecipient: Boolean(row.recipient_user_id || row.recipient_name),
        recipientConsentStatus: row.recipient_consent_status || 'pending',
        recipientConsentedAt: row.recipient_consented_at || null,
        statusTokenExpiresAt: row.status_token_expires_at || null,
        canRespondAsRecipient: Boolean(isRecipientToken && (row.recipient_consent_status || 'pending') === 'pending'),
        helperDoorName: ['accepted', 'completed'].includes(row.status) ? (helper?.doorName || null) : null,
        careInstructions: row.status === 'completed' ? (row.care_instructions || null) : null,
      },
    });
  } catch (err) {
    logger.error('Error fetching public booking status', { error: err.message });
    sendError(res, 500, 'Failed to fetch booking status');
  }
};

/**
 * G-6: the recipient accepts or declines via their invite token.
 * Public, token-gated, optional auth: a signed-in recipient whose account
 * is not yet linked is linked on accept (their account becomes
 * recipient_user_id); decline never links. The booker and the helper can
 * never respond as the recipient, and the site-contact token cannot
 * respond at all (only the recipient token opens this endpoint).
 */
exports.respondToRecipientInvite = async (req, res) => {
  try {
    const token = String(req.params.token || '');
    const decision = String(req.body?.decision || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return sendError(res, 404, 'Booking status link not found');
    }
    if (decision !== 'accepted' && decision !== 'declined') {
      return sendValidationError(res, { decision: 'Decision must be accepted or declined' });
    }
    const { rows } = await pool.query(
      'SELECT * FROM booking_requests WHERE recipient_token = $1',
      [token]
    );
    const booking = rows[0];
    if (!booking || !inviteLinkUsable(booking)) {
      return sendError(res, 404, 'Booking status link not found');
    }
    if ((booking.recipient_consent_status || 'pending') !== 'pending') {
      return sendError(res, 409, 'The recipient has already responded', 'recipient_already_responded');
    }
    const actorId = req.user?.id ? String(req.user.id) : null;
    if (actorId && actorId === String(booking.customer_id)) {
      return sendError(res, 403, 'Only the recipient can respond to this invite');
    }
    if (actorId && actorId === String(booking.helper_id)) {
      return sendError(res, 403, 'Only the recipient can respond to this invite');
    }
    if (actorId && booking.recipient_user_id && actorId !== String(booking.recipient_user_id)) {
      return sendError(res, 403, 'Only the recipient can respond to this invite');
    }
    const linkAccount = decision === 'accepted' && actorId && !booking.recipient_user_id;
    const method = actorId && (linkAccount || booking.recipient_user_id) ? 'account' : 'token';
    const updated = await pool.query(
      `UPDATE booking_requests
          SET recipient_consent_status = $2,
              recipient_consented_at = CURRENT_TIMESTAMP,
              recipient_consent_method = $3,
              recipient_user_id = COALESCE($4, recipient_user_id),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND recipient_consent_status = 'pending'
        RETURNING *`,
      [booking.id, decision, method, linkAccount ? actorId : null]
    );
    if (!updated.rows.length) {
      return sendError(res, 409, 'The recipient has already responded', 'recipient_already_responded');
    }
    await logBookingAudit(booking.id, `recipient_${decision}`, linkAccount ? actorId : null, 'recipient', booking.status, booking.status);
    try {
      broadcastToUser(booking.customer_id, 'booking:updated', { bookingId: booking.id, status: booking.status });
      await sendNotification({
        userId: booking.customer_id,
        type: 'booking_recipient_response',
        body: `${booking.service_name}, ${booking.requested_date}`,
        data: { bookingId: booking.id, recipientConsentStatus: decision },
        action_url: '/my-bookings',
        idempotencyKey: `booking-recipient-response:${booking.id}:${decision}`,
      });
    } catch (notifyErr) {
      logger.warn('Failed to notify booker of recipient response', { error: notifyErr.message });
    }
    return res.json({
      success: true,
      data: {
        bookingId: booking.id,
        recipientConsentStatus: decision,
        recipientConsentedAt: updated.rows[0].recipient_consented_at,
      },
    });
  } catch (err) {
    logger.error('Error recording recipient response', { error: err.message });
    sendError(res, 500, 'Failed to record response');
  }
};

/**
 * G-6: the account-linked recipient accepts or declines from their own
 * account (no token needed). Same consent record as the token path.
 */
exports.respondAsRecipient = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const decision = String(req.body?.decision || '').trim().toLowerCase();
    if (decision !== 'accepted' && decision !== 'declined') {
      return sendValidationError(res, { decision: 'Decision must be accepted or declined' });
    }
    const { rows } = await pool.query('SELECT * FROM booking_requests WHERE id = $1', [bookingId]);
    const booking = rows[0];
    if (!booking) return sendError(res, 404, 'Booking request not found');
    if (!booking.recipient_user_id || String(booking.recipient_user_id) !== String(req.user.id)) {
      return sendError(res, 403, 'Only the recipient can respond to this booking');
    }
    if (!inviteLinkUsable(booking)) {
      return sendError(res, 410, 'The invite link has expired or was revoked', 'invite_expired');
    }
    if ((booking.recipient_consent_status || 'pending') !== 'pending') {
      return sendError(res, 409, 'The recipient has already responded', 'recipient_already_responded');
    }
    const updated = await pool.query(
      `UPDATE booking_requests
          SET recipient_consent_status = $2,
              recipient_consented_at = CURRENT_TIMESTAMP,
              recipient_consent_method = 'account',
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND recipient_consent_status = 'pending'
        RETURNING *`,
      [booking.id, decision]
    );
    if (!updated.rows.length) {
      return sendError(res, 409, 'The recipient has already responded', 'recipient_already_responded');
    }
    await logBookingAudit(booking.id, `recipient_${decision}`, req.user.id, 'recipient', booking.status, booking.status);
    try {
      broadcastToUser(booking.customer_id, 'booking:updated', { bookingId: booking.id, status: booking.status });
      await sendNotification({
        userId: booking.customer_id,
        type: 'booking_recipient_response',
        body: `${booking.service_name}, ${booking.requested_date}`,
        data: { bookingId: booking.id, recipientConsentStatus: decision },
        action_url: '/my-bookings',
        idempotencyKey: `booking-recipient-response:${booking.id}:${decision}`,
      });
    } catch (notifyErr) {
      logger.warn('Failed to notify booker of recipient response', { error: notifyErr.message });
    }
    return res.json({
      success: true,
      data: {
        bookingId: booking.id,
        recipientConsentStatus: decision,
        recipientConsentedAt: updated.rows[0].recipient_consented_at,
      },
    });
  } catch (err) {
    logger.error('Error recording recipient response', { error: err.message });
    sendError(res, 500, 'Failed to record response');
  }
};

/**
 * G-6/G-7: the booker revokes the invite/status links before acceptance.
 * Booking-level: both links die at once (recorded D-10). Once the
 * recipient has accepted, the booking stands and revocation is refused.
 */
exports.revokeStatusLink = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { rows } = await pool.query('SELECT * FROM booking_requests WHERE id = $1', [bookingId]);
    const booking = rows[0];
    if (!booking) return sendError(res, 404, 'Booking request not found');
    if (String(booking.customer_id) !== String(req.user.id)) {
      return sendError(res, 403, 'Only the booker can revoke the status link');
    }
    if (booking.status_token_revoked_at) {
      return sendError(res, 409, 'The status link is already revoked', 'link_already_revoked');
    }
    if ((booking.recipient_consent_status || 'pending') !== 'pending') {
      return sendError(res, 400, 'The recipient has already responded; the link cannot be revoked', 'link_already_accepted');
    }
    if (!booking.status_token && !booking.recipient_token) {
      return sendError(res, 400, 'This booking has no status link to revoke', 'no_status_link');
    }
    const updated = await pool.query(
      `UPDATE booking_requests
          SET status_token_revoked_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status_token_revoked_at IS NULL
        RETURNING *`,
      [booking.id]
    );
    await logBookingAudit(bookingId, 'status_link_revoked', req.user.id, 'customer', booking.status, booking.status);
    // Group 3 (item 120): the removed account parties get a confirmation
    // that their access ended.
    const removedNotified = { recipient: false, siteContact: false };
    if (booking.recipient_user_id) {
      removedNotified.recipient = await recipientSvc.notifyAccountParty({
        booking,
        userId: booking.recipient_user_id,
        type: 'booking_contact_removed',
        body: `${booking.service_name}, ${booking.requested_date}`,
        actionUrl: '/my-bookings',
        idempotencyKey: `booking-contact-removed:${booking.id}:recipient`,
      });
    }
    if (booking.site_contact_user_id) {
      removedNotified.siteContact = await recipientSvc.notifyAccountParty({
        booking,
        userId: booking.site_contact_user_id,
        type: 'booking_contact_removed',
        body: `${booking.service_name}, ${booking.requested_date}`,
        actionUrl: '/my-bookings',
        idempotencyKey: `booking-contact-removed:${booking.id}:site-contact`,
      });
    }
    const view = bookingViewForUser(updated.rows[0], req.user.id);
    view.removedNotified = removedNotified;
    return res.json({ success: true, data: view });
  } catch (err) {
    logger.error('Error revoking status link', { error: err.message });
    sendError(res, 500, 'Failed to revoke status link');
  }
};

exports.getMyBookingRequests = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { status, helperId } = req.query;

    // G-6/G-7: the booker's own list also carries the bookings they are
    // the recipient or the site contact of, each shaped for that role.
    let query = 'SELECT * FROM booking_requests WHERE customer_id = $1 OR recipient_user_id = $1 OR site_contact_user_id = $1';
    const params = [customerId];

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    if (helperId) {
      query += ` AND helper_id = $${params.length + 1}`;
      params.push(helperId);
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    // Group 3 (item 148): an archived visit stays out of the linked
    // party's list unless they ask for it. The booker's own list is
    // never filtered by another party's archive.
    const archivedIds = new Set();
    if (req.query?.includeArchived !== 'true') {
      const { rows: archivedRows } = await pool.query(
        'SELECT booking_id FROM booking_visit_archives WHERE user_id = $1',
        [customerId]
      );
      for (const archivedRow of archivedRows) archivedIds.add(String(archivedRow.booking_id));
    }
    const pending = await bookingLifecycle.pendingRescheduleProposalsForBookings(
      result.rows.map((r) => r.id),
    );
    const rows = [];
    for (const row of result.rows) {
      const isBookerRow = String(row.customer_id) === String(customerId);
      if (!isBookerRow && archivedIds.has(String(row.id))) continue;
      const view = bookingViewForUser(await expireIfStale(row), customerId);
      view.pendingRescheduleProposal = pending.get(String(row.id)) || null;
      rows.push(view);
    }

    res.json({
      success: true,
      data: rows,
    });
  } catch (err) {
    logger.error('Error fetching my bookings', { error: err.message });
    sendError(res, 500, 'Failed to fetch booking requests');
  }
};

exports.getIncomingBookingRequests = async (req, res) => {
  try {
    const providerUserId = req.user.id;
    const { status, statuses } = req.query;
    let statusList;
    if (statuses) {
      statusList = String(statuses)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    const rows = await bookingLifecycle.listIncomingForProvider(providerUserId, {
      status: statusList ? undefined : status,
      statuses: statusList,
    });
    const pending = await bookingLifecycle.pendingRescheduleProposalsForBookings(
      rows.map((r) => r.id),
    );
    for (const row of rows) {
      row.pendingRescheduleProposal = pending.get(String(row.id)) || null;
    }

    res.json({
      success: true,
      data: rows,
    });
  } catch (err) {
    logger.error('Error fetching incoming bookings', { error: err.message });
    sendError(res, 500, 'Failed to fetch incoming bookings');
  }
};


exports.acceptBookingRequest = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const actorId = req.user.id;

    const booking = await bookingLifecycle.loadBooking(bookingId);
    if (!booking) {
      return sendError(res, 404, 'Booking request not found');
    }
    if (!(await bookingLifecycle.isBookingManagerForBooking(actorId, booking))) {
      return sendError(res, 403, 'Only the provider or a business manager can accept this booking', 'forbidden');
    }

    let result;
    try {
      result = await bookingLifecycle.acceptBookingRequest({
        booking,
        actorId,
        actorType: 'helper',
        appointmentSource: 'calendar_accept',
      });
    } catch (e) {
      const status = e.status || 400;
      return sendError(res, status, e.message || 'Cannot accept booking', e.code);
    }

    const updated = result.booking;
    await notifyCustomerOfBookingResponse(booking.customer_id, updated, 'accepted');

    // Post chat status when linked to a conversation (glue: calendar → messenger)
    if (updated.conversation_id || updated.guest_session_id) {
      try {
        const chatCtrl = require('./chatBookingRequestsController');
        if (typeof chatCtrl.postStatusToThreadForLifecycle === 'function') {
          const actorName =
            [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || 'Provider';
          await chatCtrl.postStatusToThreadForLifecycle({
            booking: updated,
            event: 'accepted',
            actorId,
            actorName,
          });
        }
      } catch (e) {
        logger.warn('Calendar accept chat status post skipped', { error: e.message });
      }
    }

    logger.info('Booking request accepted', { bookingId, actorId });

    res.json({
      success: true,
      data: transformBooking(updated),
      appointmentId: result.appointment?.id || updated.appointment_id || null,
    });
  } catch (err) {
    logger.error('Error accepting booking request', { error: err.message });
    sendError(res, 500, 'Failed to accept booking request');
  }
};


exports.declineBookingRequest = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const actorId = req.user.id;
    const { reason } = req.body || {};

    const booking = await bookingLifecycle.loadBooking(bookingId);
    if (!booking) {
      return sendError(res, 404, 'Booking request not found');
    }
    if (!(await bookingLifecycle.isBookingManagerForBooking(actorId, booking))) {
      return sendError(res, 403, 'Only the provider or a business manager can decline this booking', 'forbidden');
    }

    let result;
    try {
      result = await bookingLifecycle.declineBookingRequest({
        booking,
        actorId,
        actorType: 'helper',
        reason: reason || null,
      });
    } catch (e) {
      const status = e.status || 400;
      return sendError(res, status, e.message || 'Cannot decline booking', e.code);
    }

    const updated = result.booking;
    await notifyCustomerOfBookingResponse(booking.customer_id, updated, 'declined');

    if (updated.conversation_id || updated.guest_session_id) {
      try {
        const chatCtrl = require('./chatBookingRequestsController');
        if (typeof chatCtrl.postStatusToThreadForLifecycle === 'function') {
          const actorName =
            [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || 'Provider';
          await chatCtrl.postStatusToThreadForLifecycle({
            booking: updated,
            event: 'declined',
            actorId,
            actorName,
            reason: reason || '',
          });
        }
      } catch (e) {
        logger.warn('Calendar decline chat status post skipped', { error: e.message });
      }
    }

    logger.info('Booking request declined', { bookingId, actorId });

    res.json({
      success: true,
      data: transformBooking(updated),
    });
  } catch (err) {
    logger.error('Error declining booking request', { error: err.message });
    sendError(res, 500, 'Failed to decline booking request');
  }
};


/**
 * Customer cancels pending or accepted booking (pending → cancelled, accepted → accepted_cancelled)
 */
exports.cancelBookingRequest = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const customerId = req.user.id;

    const result = await pool.query(
      'SELECT * FROM booking_requests WHERE id = $1',
      [bookingId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Booking request not found');
    }

    const booking = result.rows[0];

    // G-6: the booker or the recipient may cancel. The deposit settles
    // against the booker (booking.customer_id) either way.
    const isBooker = booking.customer_id === customerId;
    const isRecipient = booking.recipient_user_id && String(booking.recipient_user_id) === String(customerId);
    if (!isBooker && !isRecipient) {
      return sendError(res, 403, 'Only the customer or the recipient can cancel this booking request');
    }

    if (booking.status === 'pending') {
      const updatedResult = await withTransaction(pool, async (client) => {
        const updated = await client.query(
          `UPDATE booking_requests
           SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND status IN ('pending', 'expired')
           RETURNING *`,
          [bookingId]
        );
        if (updated.rows.length) {
          await emitDomainEvent(client, 'booking.cancelled', serviceEventProps(updated.rows[0]), { userId: customerId, req });
        }
        return updated;
      }, 'booking_cancelled_growth');
      if (!updatedResult.rows.length) {
        return sendError(res, 400, 'Booking is no longer pending');
      }
      await logBookingAudit(bookingId, 'cancelled', customerId, 'customer', 'pending', 'cancelled');
      bookingDeposits.settleTerminalBookingSoon(bookingId, 'customer_cancelled');
      await notifyHelperOfBookingCancellation(booking.helper_id, updatedResult.rows[0]);
      return res.json({ success: true, data: transformBooking(updatedResult.rows[0]) });
    }

    if (booking.status === 'accepted') {
      const updatedResult = await withTransaction(pool, async (client) => {
        const updated = await client.query(
          `UPDATE booking_requests
           SET status = 'accepted_cancelled', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND status = 'accepted'
           RETURNING *`,
          [bookingId]
        );
        if (updated.rows.length) {
          await emitDomainEvent(client, 'booking.cancelled', serviceEventProps(updated.rows[0]), { userId: customerId, req });
        }
        return updated;
      }, 'booking_cancelled_growth');
      if (!updatedResult.rows.length) {
        return sendError(res, 400, 'Booking cannot be cancelled');
      }
      // Cancelling an accepted booking must also cancel the confirmed
      // appointment it created (helper or business calendar).
      try {
        await bookingLifecycle.cancelLinkedAppointment(updatedResult.rows[0], updatedResult.rows[0].helper_id);
      } catch (e) {
        logger.warn('Failed to cancel linked appointment on customer cancel', { error: e.message });
      }
      await logBookingAudit(
        bookingId,
        'accepted_cancelled',
        customerId,
        'customer',
        'accepted',
        'accepted_cancelled'
      );
      bookingDeposits.settleTerminalBookingSoon(bookingId, 'customer_cancelled');
      await notifyHelperOfBookingCancellation(booking.helper_id, updatedResult.rows[0]);
      return res.json({ success: true, data: transformBooking(updatedResult.rows[0]) });
    }

    return sendError(res, 400, `Cannot cancel a ${booking.status} booking request`);
  } catch (err) {
    logger.error('Error cancelling booking request', { error: err.message });
    sendError(res, 500, 'Failed to cancel booking request');
  }
};

/**
 * Helper cancels after accepting (e.g. conflict) → accepted_cancelled
 */
exports.helperCancelAcceptedBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const helperId = req.user.id;
    const { reason } = req.body;

    const result = await pool.query(
      'SELECT * FROM booking_requests WHERE id = $1',
      [bookingId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Booking request not found');
    }

    const booking = result.rows[0];

    if (!(await bookingLifecycle.isBookingManagerForBooking(helperId, booking))) {
      return sendError(res, 403, 'Only the provider or a business manager can cancel this booking', 'forbidden');
    }

    if (booking.status !== 'accepted') {
      return sendError(res, 400, 'Only accepted bookings can be cancelled by the helper here');
    }

    const updatedResult = await withTransaction(pool, async (client) => {
      const updated = await client.query(
        `UPDATE booking_requests
         SET status = 'accepted_cancelled',
             helper_response_reason = COALESCE($2, helper_response_reason),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'accepted'
         RETURNING *`,
        [bookingId, reason || null]
      );
      if (updated.rows.length) {
        await emitDomainEvent(client, 'booking.cancelled', serviceEventProps(updated.rows[0]), {
          userId: helperId,
          req,
        });
      }
      return updated;
    }, 'booking_helper_cancelled_growth');

    const updated = updatedResult.rows[0];
    if (!updated) {
      return sendError(res, 400, 'Booking cannot be cancelled', 'booking_not_cancellable');
    }

    // Cancelling an accepted booking must also cancel the confirmed
    // appointment it created (helper or business calendar).
    try {
      await bookingLifecycle.cancelLinkedAppointment(updated, updated.helper_id);
    } catch (e) {
      logger.warn('Failed to cancel linked appointment on helper cancel', { error: e.message });
    }

    await logBookingAudit(
      bookingId,
      'helper_accepted_cancel',
      helperId,
      'helper',
      'accepted',
      'accepted_cancelled'
    );
    bookingDeposits.settleTerminalBookingSoon(bookingId, 'helper_cancelled');
    await notifyCustomerOfBookingResponse(booking.customer_id, updated, 'accepted_cancelled');

    res.json({
      success: true,
      data: transformBooking(updated),
    });
  } catch (err) {
    logger.error('Error helper-cancelling booking', { error: err.message });
    sendError(res, 500, 'Failed to cancel booking');
  }
};

/**
 * G-37: transfer an accepted booking to another eligible provider.
 * Preserves the booking (status stays accepted), its deposit (payment_*
 * columns untouched), and its appointment (helper_id moves to the new
 * provider). The linked two-party conversation moves with it so the new
 * provider sees the thread and the old one loses it.
 *
 * G5-2: the caller must pass the manager gate (isBookingManagerForBooking),
 * the same gate as accept/decline — the current provider, the business
 * owner, a manager, or a member holding bookings.manage. The previous
 * read-level gate (isProviderForBooking) let any active member transfer a
 * confirmed, deposit-backed booking. The new provider must be
 * eligible: for a business booking, an owner/active member of that
 * business; for a helper-owned booking, an activated helper holding
 * helper.offer_services (grant in enforce mode, legacy role otherwise).
 * A transfer to a double-booked provider fails closed on the
 * appointment overlap guard.
 */
exports.transferBookingRequest = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const actorId = req.user.id;
    const { newHelperId, reason } = req.body || {};

    if (typeof newHelperId !== 'string' || !/^[0-9a-f-]{36}$/i.test(newHelperId)) {
      return sendError(res, 400, 'A valid new provider id is required', 'validation_failed');
    }

    const booking = await bookingLifecycle.loadBooking(bookingId);
    if (!booking) {
      return sendError(res, 404, 'Booking request not found');
    }
    if (!(await bookingLifecycle.isBookingManagerForBooking(actorId, booking))) {
      return sendError(res, 403, 'Only the provider or a business manager can transfer this booking', 'forbidden');
    }
    if (booking.status !== 'accepted') {
      return sendError(res, 400, 'Only accepted bookings can be transferred');
    }
    if (String(newHelperId) === String(booking.helper_id)) {
      return sendError(res, 400, 'Booking is already with this provider', 'validation_failed');
    }
    if (String(newHelperId) === String(booking.customer_id)) {
      return sendError(res, 400, 'The customer cannot be the provider', 'validation_failed');
    }

    // ── Target eligibility ──────────────────────────────────────
    const { rows: [target] } = await pool.query(
      `SELECT id, role, is_active, deleted_at, onboarding_completed, onboarding_status
         FROM users WHERE id = $1`,
      [newHelperId]
    );
    if (!target || target.deleted_at || target.is_active === false) {
      return sendError(res, 404, 'New provider not found');
    }
    if (booking.business_id) {
      const { rows: [membership] } = await pool.query(
        `SELECT 1 FROM businesses WHERE id = $1 AND user_id = $2 AND is_active = TRUE
          UNION
         SELECT 1 FROM business_members
          WHERE business_id = $1 AND member_id = $2 AND status = 'active'`,
        [booking.business_id, newHelperId]
      );
      if (!membership) {
        return sendError(res, 400, 'New provider is not a member of this business', 'transfer_target_ineligible');
      }
    } else {
      const access = require('../services/access/accessService');
      const flags = require('../services/access/flags');
      const decision = await access.can(newHelperId, 'helper.offer_services');
      const legacyHelper = ['helper', 'helper_pro', 'broker'].includes(target.role);
      const capabilityOk = decision.allowed || (flags.helperEnforcement() !== 'enforce' && legacyHelper);
      const activated = target.onboarding_completed === true || target.onboarding_status === 'active';
      if (!capabilityOk || !activated) {
        return sendError(res, 400, 'New provider is not an activated helper', 'transfer_target_ineligible');
      }
    }

    const previousHelperId = booking.helper_id;
    const updatedResult = await withTransaction(pool, async (client) => {
      const updated = await client.query(
        `UPDATE booking_requests
            SET helper_id = $2,
                helper_response_reason = COALESCE($3, helper_response_reason),
                -- G5-11 (260): a transfer is not a dispatch; the new
                -- provider was not dispatched and confirms by accepting
                -- as the provider, not via the dispatch flow.
                dispatch_status = NULL,
                dispatched_at = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND status = 'accepted'
          RETURNING *`,
        [bookingId, newHelperId, reason || null]
      );
      if (!updated.rows.length) return updated;
      // The appointment is preserved; only its provider moves. A
      // double-booked target fails closed on the overlap guard.
      if (booking.appointment_id) {
        await client.query(
          `UPDATE appointments SET helper_id = $2, updated_at = NOW()
            WHERE id = $1 AND status <> 'cancelled'`,
          [booking.appointment_id, newHelperId]
        );
      }
      // The two-party thread moves to the new provider.
      if (booking.conversation_id) {
        await client.query(
          'UPDATE conversations SET helper_id = $2, updated_at = NOW() WHERE id = $1',
          [booking.conversation_id, newHelperId]
        );
      }
      await emitDomainEvent(client, 'booking.transferred', serviceEventProps(updated.rows[0]), {
        userId: actorId,
        req,
      });
      return updated;
    }, 'booking_provider_transfer_growth');

    const updated = updatedResult.rows[0];
    if (!updated) {
      return sendError(res, 400, 'Booking cannot be transferred', 'booking_not_transferable');
    }

    await logBookingAudit(bookingId, 'provider_transfer', actorId, 'helper', 'accepted', 'accepted');
    // The customer learns the provider changed; the new provider gets the
    // booking in their inbox. The deposit is untouched by the transfer.
    try {
      await sendNotification({
        userId: booking.customer_id,
        type: 'booking_transferred',
        body: `${booking.service_name}, ${booking.requested_date}${reason ? ` (${reason})` : ''}`,
        data: { bookingId: booking.id, previousHelperId, newHelperId },
        action_url: '/my-bookings',
      });
    } catch (e) {
      logger.warn('Failed to notify customer of booking transfer', { error: e.message });
    }
    await notifyHelperOfBooking(newHelperId, updated);
    if (updated.conversation_id || updated.guest_session_id) {
      try {
        const chatCtrl = require('./chatBookingRequestsController');
        if (typeof chatCtrl.postStatusToThreadForLifecycle === 'function') {
          const actorName = [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || 'Provider';
          await chatCtrl.postStatusToThreadForLifecycle({
            booking: updated,
            event: 'transferred',
            actorId,
            actorName,
          });
        }
      } catch (e) {
        logger.warn('Transfer chat status post skipped', { error: e.message });
      }
    }

    logger.info('Booking transferred', { bookingId, actorId, previousHelperId, newHelperId });
    res.json({
      success: true,
      data: transformBooking(updated),
    });
  } catch (err) {
    logger.error('Error transferring booking', { error: err.message });
    sendError(res, 500, 'Failed to transfer booking');
  }
};

/**
 * G5-11 (260): dispatch a pending business booking to a member.
 * Manager-gated (isBookingManagerForBooking), same as accept/decline.
 * Sets helper_id to the member with dispatch_status='pending'; the member
 * confirms by accepting (any accept path flips it to 'confirmed'), and a
 * member who cannot do the work transfers it on (they pass the manager
 * gate as the current provider). Decline semantics are untouched:
 * declining still declines the booking for the customer. Pending only:
 * a counter-proposed booking already carries a counter proposal from its
 * current provider. Notifies the member (booking_dispatched) and
 * broadcasts booking:updated so their queue refreshes.
 */
exports.dispatchBookingRequest = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const actorId = req.user.id;
    const { memberId } = req.body || {};

    if (typeof memberId !== 'string' || !/^[0-9a-f-]{36}$/i.test(memberId)) {
      return sendError(res, 400, 'A valid member id is required', 'validation_failed');
    }

    const booking = await bookingLifecycle.loadBooking(bookingId);
    if (!booking) {
      return sendError(res, 404, 'Booking request not found');
    }
    if (!(await bookingLifecycle.isBookingManagerForBooking(actorId, booking))) {
      return sendError(res, 403, 'Only the provider or a business manager can dispatch this booking', 'forbidden');
    }
    if (!booking.business_id) {
      return sendError(res, 400, 'Only business bookings can be dispatched', 'dispatch_target_ineligible');
    }
    if (booking.status !== 'pending') {
      return sendError(res, 400, 'Only pending bookings can be dispatched');
    }
    if (String(memberId) === String(booking.helper_id)) {
      return sendError(res, 400, 'Booking is already with this member', 'validation_failed');
    }
    if (String(memberId) === String(booking.customer_id)) {
      return sendError(res, 400, 'The customer cannot be the provider', 'validation_failed');
    }

    const { rows: [membership] } = await pool.query(
      `SELECT 1 FROM businesses WHERE id = $1 AND user_id = $2 AND is_active = TRUE
        UNION
       SELECT 1 FROM business_members
        WHERE business_id = $1 AND member_id = $2 AND status = 'active'`,
      [booking.business_id, memberId]
    );
    if (!membership) {
      return sendError(res, 400, 'Member is not part of this business', 'dispatch_target_ineligible');
    }

    const updatedResult = await withTransaction(pool, async (client) => {
      const updated = await client.query(
        `UPDATE booking_requests
            SET helper_id = $2,
                dispatch_status = 'pending',
                dispatched_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND status = 'pending'
          RETURNING *`,
        [bookingId, memberId]
      );
      if (!updated.rows.length) return updated;
      await emitDomainEvent(client, 'booking.dispatched', serviceEventProps(updated.rows[0]), {
        userId: actorId,
        req,
      });
      return updated;
    }, 'booking_dispatch');

    const updated = updatedResult.rows[0];
    if (!updated) {
      return sendError(res, 400, 'Booking cannot be dispatched', 'booking_not_dispatchable');
    }

    await logBookingAudit(bookingId, 'dispatched', actorId, 'helper', 'pending', 'pending');
    try {
      broadcastToUser(memberId, 'booking:updated', { bookingId: booking.id, status: 'pending' });
      await sendNotification({
        userId: memberId,
        type: 'booking_dispatched',
        body: `${booking.service_name}, ${booking.requested_date} ${booking.requested_start_time}-${booking.requested_end_time}`,
        data: { bookingId: booking.id, dispatchedBy: actorId },
        action_url: '/calendar?tab=bookingRequests',
      });
    } catch (e) {
      logger.warn('Failed to notify member of booking dispatch', { error: e.message });
    }

    logger.info('Booking dispatched', { bookingId, actorId, memberId });
    res.json({
      success: true,
      data: transformBooking(updated),
    });
  } catch (err) {
    logger.error('Error dispatching booking', { error: err.message });
    sendError(res, 500, 'Failed to dispatch booking');
  }
};

/**
 * G5-12 (257): dispatch + transfer candidates for one booking. Manager-gated:
 * only someone who can dispatch or transfer needs the roster with fit flags.
 * Business bookings only; a helper-owned booking has no member roster.
 */
exports.listTransferCandidates = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const actorId = req.user.id;
    const booking = await bookingLifecycle.loadBooking(bookingId);
    if (!booking) {
      return sendError(res, 404, 'Booking request not found');
    }
    if (!(await bookingLifecycle.isBookingManagerForBooking(actorId, booking))) {
      return sendError(res, 403, 'Only the provider or a business manager can view dispatch candidates', 'forbidden');
    }
    const result = await bookingLifecycle.listBookingTransferCandidates(booking);
    if (!result) {
      return sendError(res, 400, 'Only business bookings have dispatch candidates', 'dispatch_target_ineligible');
    }
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('Error listing transfer candidates', { error: err.message });
    sendError(res, 500, 'Failed to list transfer candidates');
  }
};

/**
 * Returns prefill payload for Post Job wizard (does not create a job row).
 */
exports.convertBookingToJob = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const customerId = req.user.id;

    const result = await pool.query(
      'SELECT * FROM booking_requests WHERE id = $1',
      [bookingId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Booking request not found');
    }

    const booking = result.rows[0];

    if (booking.customer_id !== customerId) {
      return sendError(res, 403, 'Only the customer can use this booking for a job post');
    }

    const ok =
      booking.status === 'declined' ||
      booking.status === 'expired' ||
      booking.status === 'cancelled' ||
      booking.status === 'accepted_cancelled';

    if (!ok) {
      return sendError(
        res,
        400,
        'You can open Post Job from this booking after it expires, is declined, or is cancelled.'
      );
    }

    const prefill = buildJobPrefillPayload(booking);

    logger.info('Booking prefill for job wizard', { bookingId, customerId });

    res.json({
      success: true,
      data: {
        bookingId,
        prefill,
        message: 'Complete the job post to reach all helpers.',
      },
    });
  } catch (err) {
    logger.error('Error building booking prefill', { error: err.message });
    sendError(res, 500, 'Failed to prepare job posting');
  }
};

/**
 * Available slots from helper_availability + appointments for one day.
 */
exports.getHelperAvailableSlots = async (req, res, next) => {
  try {
    const { helperId } = req.params;
    const { date } = req.query;

    if (!date) {
      return sendValidationError(res, { date: 'Date is required' });
    }

    const helperCheck = await pool.query(
      `SELECT 1 FROM users u
       LEFT JOIN helper_profiles hp ON hp.user_id = u.id
       WHERE u.id = $1 AND u.deleted_at IS NULL
       AND (hp.is_listed IS NULL OR hp.is_listed = true)`,
      [helperId]
    );
    if (!helperCheck.rows.length) {
      return sendError(res, 404, 'Helper not found');
    }

    // The requested date is a wall-clock date on the helper's schedule.
    // Parse it as a plain calendar date instead of round-tripping through
    // the server's local timezone (which could shift the day near UTC
    // midnight for far-from-UTC servers).
    const dateMatch = typeof date === 'string' ? date.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
    const dateISO = dateMatch ? dateMatch[0] : null;
    const dateValid =
      dateISO &&
      !Number.isNaN(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]))) &&
      new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])))
        .toISOString()
        .startsWith(dateISO);
    if (!dateValid) {
      return sendValidationError(res, { date: 'Invalid date' });
    }
    const dow = new Date(`${dateISO}T00:00:00Z`).getUTCDay();

    // Single-system computation: weekly template − dated blocks − appointments.
    // Anchored in the helper's timezone so "today", past-slot filtering, and
    // block dates all follow the helper's wall clock, not the server's.
    const helperTimeZone = await availabilityService.getHelperTimeZone(pool, helperId);
    const { slots, hasTemplate, dayHasAvailability, dayStatus, bookingBufferMinutes } =
      await availabilityService.getHourSlots(helperId, dateISO, 60, pool, helperTimeZone);

    const pad = (n) => String(n).padStart(2, '0');
    // BookingCalendar expects { startTime, endTime, available }; every slot
    // here survived the busy-range filter in getHourSlots, so all are free.
    const out = slots.map((sl) => ({
      startTime: `${pad(Math.floor(sl.startMin / 60))}:${pad(sl.startMin % 60)}`,
      endTime: `${pad(Math.floor(sl.endMin / 60))}:${pad(sl.endMin % 60)}`,
      available: true,
    }));

    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    res.json({
      success: true,
      data: {
        date: dateISO,
        dayOfWeek: dayNames[dow],
        slots: out,
        scheduleConfigured: hasTemplate,
        dayHasAvailability,
        dayStatus,
        bookingBufferMinutes,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Public business availability. Businesses may publish hours at the business
 * level, independently from the owner's helper profile. An empty schedule is
 * returned as a valid request-only state so the booking UI can offer the
 * request-only fallback instead of showing a server error.
 */
exports.getBusinessAvailableSlots = async (req, res) => {
  try {
    const businessId = Number.parseInt(req.params.businessId, 10);
    // Review P2-3-F08: optional staffId makes the listing staff-aware. When
    // a staff member is chosen, the same availability_blocks predicate the
    // booking gate and the appointment writer use is subtracted here, so the
    // offered slots and the create-time check cannot disagree.
    const { date, serviceId, staffId } = req.query;
    if (!Number.isInteger(businessId) || businessId <= 0) {
      return sendValidationError(res, { businessId: 'Invalid business ID' });
    }
    if (!date) return sendValidationError(res, { date: 'Date is required' });

    const dateObj = new Date(`${date}T12:00:00`);
    if (Number.isNaN(dateObj.getTime())) return sendValidationError(res, { date: 'Invalid date' });

    const businessResult = await pool.query(
      `SELECT b.id, b.is_active, b.is_listed, b.is_hidden_by_admin
         FROM businesses b
         JOIN users owner ON owner.id = b.user_id
        WHERE b.id = $1
          AND b.deleted_at IS NULL
          AND b.is_active = TRUE
          AND b.is_listed = TRUE
          AND COALESCE(b.is_hidden_by_admin, FALSE) = FALSE
          AND b.setup_status = 'active'
          AND b.business_kind = 'service'
          AND owner.deleted_at IS NULL
          AND owner.is_active = TRUE
          AND owner.email_verified = TRUE
          AND owner.onboarding_completed = TRUE`,
      [businessId]
    );
    const business = businessResult.rows[0];
    if (!business) return sendError(res, 404, 'Business not found', 'BUSINESS_NOT_FOUND');

    const scheduleResult = await pool.query(
      `SELECT (
        EXISTS (
          SELECT 1 FROM business_hours
           WHERE business_id = $1
             AND is_closed = FALSE
             AND start_time IS NOT NULL
             AND end_time IS NOT NULL
        ) OR EXISTS (
          SELECT 1
            FROM business_service_availability bsa
            JOIN business_services bs ON bs.id = bsa.service_id
           WHERE bs.business_id = $1
             AND bsa.is_available = TRUE
        )
      ) AS schedule_configured`,
      [businessId]
    );
    const scheduleConfigured = Boolean(scheduleResult.rows[0]?.schedule_configured);
    const dow = dateObj.getDay();

    const hoursResult = await pool.query(
      `SELECT start_time, end_time
         FROM business_hours
        WHERE business_id = $1
          AND day_of_week = $2
          AND is_closed = FALSE
          AND start_time IS NOT NULL
          AND end_time IS NOT NULL
        ORDER BY start_time`,
      [businessId, dow]
    );

    let effectiveHours = hoursResult.rows;
    if (effectiveHours.length === 0 && serviceId) {
      const serviceHours = await pool.query(
        `SELECT start_time, end_time
           FROM business_service_availability
          WHERE service_id = $1
            AND day_of_week = $2
            AND is_available = TRUE
          ORDER BY start_time`,
        [String(serviceId), dow]
      );
      effectiveHours = serviceHours.rows;
    }

    let durationMinutes = 60;
    if (serviceId) {
      const serviceResult = await pool.query(
        `SELECT duration_minutes, duration
           FROM business_services
          WHERE id = $1
            AND business_id = $2
            AND is_active = TRUE
            AND COALESCE(allow_online_booking, TRUE) = TRUE
            AND deleted_at IS NULL`,
        [String(serviceId), businessId]
      );
      if (!serviceResult.rows[0]) {
        return sendError(res, 404, 'Service not found', 'SERVICE_NOT_FOUND');
      }
      if (serviceResult.rows[0]) {
        const service = serviceResult.rows[0];
        const parsed = Number.parseInt(service.duration_minutes || service.duration, 10);
        if (Number.isFinite(parsed) && parsed > 0) durationMinutes = Math.min(480, parsed);
      }
    }

    const appointmentsResult = await pool.query(
      `SELECT start_time::time AS start_time, end_time::time AS end_time
         FROM business_appointments
        WHERE business_id = $1
          AND start_time::date = $2::date
          AND status NOT IN ('cancelled', 'no_show')
        ORDER BY start_time`,
      [businessId, date]
    );
    const busy = appointmentsResult.rows.map((row) => ({ start: row.start_time, end: row.end_time }));

    // Review P2-3-F08: the merchant slot engine subtracts
    // business_service_blocked_times (time off), but this customer-facing
    // computation ignored them, so customers could book into blocked time.
    // Mirror the engine's scoping: service-specific blocks apply to their
    // service, staff-level (service_id NULL) blocks apply business-wide.
    const blockedResult = await pool.query(
      `SELECT to_char(GREATEST(bt.start_time, $2::timestamptz), 'HH24:MI:SS') AS start_time,
              CASE WHEN LEAST(bt.end_time, (($2::date + INTERVAL '1 day')::timestamptz)) >= (($2::date + INTERVAL '1 day')::timestamptz)
                   THEN '23:59:59'
                   ELSE to_char(LEAST(bt.end_time, (($2::date + INTERVAL '1 day')::timestamptz)), 'HH24:MI:SS')
              END AS end_time
         FROM business_service_blocked_times bt
        WHERE bt.business_id = $1
          AND bt.end_time > $2::timestamptz
          AND bt.start_time < (($2::date + INTERVAL '1 day')::timestamptz)
          ${serviceId ? 'AND (bt.service_id = $3 OR bt.service_id IS NULL)' : 'AND bt.service_id IS NULL'}`,
      serviceId ? [businessId, date, String(serviceId)] : [businessId, date]
    );
    for (const row of blockedResult.rows) {
      busy.push({ start: row.start_time, end: row.end_time });
    }
    // Review P2-3-F08: when a staff member is selected, subtract their
    // personal availability blocks with the shared predicate, so this
    // listing agrees with enforceBookingRules and assertAppointmentWindowFree.
    if (staffId) {
      const staffBlocks = await pool.query(
        `SELECT to_char(start_time, 'HH24:MI:SS') AS start_time,
                to_char(end_time, 'HH24:MI:SS') AS end_time
           FROM availability_blocks
          WHERE helper_id = $1 AND type IN ('unavailable', 'busy', 'travel')
            AND end_time > $2::timestamptz
            AND start_time < (($2::date + INTERVAL '1 day')::timestamptz)`,
        [String(staffId), date]
      );
      for (const row of staffBlocks.rows) {
        busy.push({ start: row.start_time, end: row.end_time });
      }
    }
    const slots = [];
    for (const block of effectiveHours) {
      slots.push(...sliceWindowToHourSlots(block.start_time, block.end_time, busy, durationMinutes, 30));
    }

    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return res.json({
      success: true,
      data: {
        date,
        dayOfWeek: dayNames[dow],
        slots,
        scheduleConfigured,
        dayHasAvailability: effectiveHours.length > 0,
        durationMinutes,
      },
    });
  } catch (err) {
    logger.error('Error fetching business available slots', {
      businessId: req.params?.businessId,
      error: err.message,
      stack: err.stack,
    });
    sendError(res, 500, 'Failed to fetch business availability');
  }
};

exports.listRecurringBookings = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT r.*,
              NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS helper_name,
              u.profile_photo_url AS helper_avatar_url
         FROM recurring_booking_subscriptions r
         JOIN users u ON u.id = r.helper_id AND u.deleted_at IS NULL
        WHERE r.customer_id = $1
          AND u.is_active = TRUE
          AND u.deleted_at IS NULL
        ORDER BY
          CASE r.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
          r.next_date NULLS LAST,
          r.created_at DESC`,
      [userId]
    );
    res.json({ subscriptions: result.rows.map(transformRecurringBooking) });
  } catch (err) {
    logger.error('Error listing recurring bookings', { userId: req.user?.id, error: err.message });
    sendError(res, 500, 'Failed to load recurring bookings');
  }
};

exports.createRecurringBooking = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { helper_id, service_name, frequency, preferred_day, preferred_time, notes } = req.body || {};
    const safeFrequency = String(frequency || '').toLowerCase();
    const errors = {};
    if (!helper_id) errors.helper_id = 'Helper is required';
    if (!service_name || !String(service_name).trim()) errors.service_name = 'Service name is required';
    if (!['weekly', 'biweekly', 'monthly'].includes(safeFrequency)) errors.frequency = 'Frequency must be weekly, biweekly, or monthly';
    if (String(customerId) === String(helper_id)) errors.helper_id = 'Cannot subscribe to yourself';
    if (Object.keys(errors).length) return sendValidationError(res, errors);

    const helperResult = await pool.query(
      `SELECT u.id, u.is_active, u.deleted_at, u.role,
              (${publicHelperStandingPredicate('u')}) AS helper_capability_granted
         FROM users u
        WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [helper_id]
    );
    const helper = helperResult.rows[0];
    if (!helper || !helper.is_active || helper.deleted_at) {
      return sendError(res, 404, 'Helper not found', 'HELPER_NOT_FOUND');
    }
    if (!['helper', 'helper_pro', 'broker'].includes(helper.role) && !helper.helper_capability_granted) {
      return sendError(res, 400, 'User is not accepting recurring services', 'INVALID_HELPER');
    }

    // Review P1-6-F03: recurring subscriptions create bookings on an ongoing
    // basis, so the helper's "allow booking" privacy switch applies here too.
    const prefRes = await pool.query(
      'SELECT COALESCE(allow_booking, TRUE) AS allow_booking FROM helper_profiles WHERE user_id = $1',
      [helper_id]
    );
    if (prefRes.rows[0] && prefRes.rows[0].allow_booking === false) {
      return sendError(res, 403, 'This helper is not taking bookings right now', 'BOOKING_DISABLED');
    }

    const nextDate = nextDateForPreferredDay(preferred_day);
    const result = await pool.query(
      `INSERT INTO recurring_booking_subscriptions
         (customer_id, helper_id, service_name, frequency, preferred_day, preferred_time, notes, next_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        customerId,
        helper_id,
        String(service_name).trim(),
        safeFrequency,
        preferred_day || null,
        preferred_time || null,
        notes || null,
        nextDate,
      ]
    );

    const subscription = transformRecurringBooking(result.rows[0]);
    await sendNotification({
      userId: helper_id,
      type: 'recurring_booking_new',
      body: `${subscription.service_name} ${subscription.frequency}`,
      data: { subscriptionId: subscription.id },
      action_url: '/calendar?tab=recurring',
      // Item 26: explicit stable key for the worst keyless site (the
      // recurring-booking path). A retried create must not notify the
      // helper twice; the boundary derivation would also cover it via
      // data.subscriptionId, but the explicit key stays stable even if
      // the payload text changes.
      idempotencyKey: `recurring-booking:${subscription.id}`,
    }).catch((err) => logger.warn('Failed recurring booking notification', { error: err.message }));

    res.status(201).json({ subscription, message: 'Recurring booking created' });
  } catch (err) {
    logger.error('Error creating recurring booking', { userId: req.user?.id, error: err.message });
    sendError(res, 500, 'Failed to create recurring booking');
  }
};

exports.updateRecurringBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const action = String(req.params.action || req.path || '').split('/').filter(Boolean).pop();
    const nextStatus = action === 'cancel' ? 'cancelled' : action === 'pause' ? 'paused' : 'active';
    const result = await pool.query(
      `UPDATE recurring_booking_subscriptions
          SET status = $3, updated_at = now()
        WHERE id = $1 AND customer_id = $2
        RETURNING *`,
      [id, req.user.id, nextStatus]
    );
    if (!result.rows.length) return sendError(res, 404, 'Recurring booking not found');
    res.json({ subscription: transformRecurringBooking(result.rows[0]), message: `Subscription ${nextStatus}` });
  } catch (err) {
    logger.error('Error updating recurring booking', { userId: req.user?.id, error: err.message });
    sendError(res, 500, 'Failed to update recurring booking');
  }
};

exports.counterProposeBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const helperId = req.user.id;
    const body = req.body || {};
    const counter_date = body.counter_date || body.requestedDate || body.date;
    const counter_start_time = body.counter_start_time || body.requestedStartTime || body.start;
    const counter_end_time = body.counter_end_time || body.requestedEndTime || body.end;
    const counter_message = body.counter_message || body.note || body.reason || null;

    const errors = {};
    if (!counter_date) errors.counter_date = 'Date is required';
    if (!counter_start_time) errors.counter_start_time = 'Start time is required';
    if (!counter_end_time) errors.counter_end_time = 'End time is required';
    if (
      counter_start_time &&
      counter_end_time &&
      String(counter_start_time) >= String(counter_end_time)
    ) {
      errors.counter_end_time = 'End time must be after start time';
    }
    if (Object.keys(errors).length) return sendValidationError(res, errors);

    const booking = await bookingLifecycle.loadBooking(bookingId);
    if (!booking) return sendError(res, 404, 'Booking request not found');
    if (!(await bookingLifecycle.isBookingManagerForBooking(helperId, booking))) {
      return sendError(res, 403, 'Only the provider or a business manager can propose a different time', 'forbidden');
    }

    let result;
    try {
      result = await bookingLifecycle.proposeBookingTime({
        booking,
        actorId: helperId,
        actorType: 'helper',
        date: counter_date,
        start: counter_start_time,
        end: counter_end_time,
        note: counter_message,
      });
    } catch (e) {
      const status = e.status || 400;
      return sendError(res, status, e.message || 'Cannot counter-propose', e.code);
    }

    const updated = result.booking;
    if (updated.customer_id) {
      await sendNotification({
        userId: updated.customer_id,
        type: 'booking_counter_proposed',
        body: `${updated.service_name}, ${counter_date} ${counter_start_time}-${counter_end_time}`,
        data: { bookingId },
        action_url: '/my-bookings',
      }).catch((err) => logger.warn('Failed counter-propose notification', { error: err.message }));
    }

    if (updated.conversation_id || updated.guest_session_id) {
      try {
        const chatCtrl = require('./chatBookingRequestsController');
        if (typeof chatCtrl.postStatusToThreadForLifecycle === 'function') {
          const actorName =
            [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || 'Provider';
          await chatCtrl.postStatusToThreadForLifecycle({
            booking: updated,
            event: 'counter_proposed',
            actorId: helperId,
            actorName,
            reason: counter_message || '',
          });
        }
      } catch (e) {
        logger.warn('Calendar counter-propose chat status post skipped', { error: e.message });
      }
    }

    res.json({ booking: transformBooking(updated), message: 'Counter-proposal sent' });
  } catch (err) {
    logger.error('Error counter-proposing booking', { error: err.message });
    sendError(res, 500, 'Failed to send counter-proposal');
  }
};


exports.respondToCounterPropose = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const customerId = req.user.id;
    const action = String(req.body?.action || '').toLowerCase();
    if (!['accept', 'decline'].includes(action)) {
      return sendValidationError(res, { action: 'Use accept or decline' });
    }

    const booking = await bookingLifecycle.loadBooking(bookingId);
    if (!booking) return sendError(res, 404, 'Booking request not found');
    if (String(booking.customer_id) !== String(customerId)) {
      return sendError(res, 403, 'Only the customer can respond to this counter-proposal');
    }

    let result;
    try {
      if (action === 'accept') {
        result = await bookingLifecycle.customerAcceptBookingRequest({
          booking,
          actorId: customerId,
          actorType: 'customer',
          appointmentSource: 'calendar_customer_accept',
        });
      } else {
        result = await bookingLifecycle.customerDeclineBookingRequest({
          booking,
          actorId: customerId,
          actorType: 'customer',
          reason: req.body?.reason || null,
        });
      }
    } catch (e) {
      const status = e.status || 400;
      return sendError(res, status, e.message || 'Cannot respond to counter-proposal', e.code);
    }

    const updated = result.booking;
    await sendNotification({
      userId: booking.helper_id,
      type: action === 'accept' ? 'booking_counter_accepted' : 'booking_counter_declined',
      body: `${booking.service_name}: ${
        action === 'accept' ? 'counter-proposal accepted' : 'counter-proposal declined'
      }`,
      data: { bookingId },
      action_url: '/calendar?tab=bookingRequests',
    }).catch((err) => logger.warn('Failed counter response notification', { error: err.message }));

    if (updated.conversation_id || updated.guest_session_id) {
      try {
        const chatCtrl = require('./chatBookingRequestsController');
        if (typeof chatCtrl.postStatusToThreadForLifecycle === 'function') {
          const actorName =
            [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || 'Customer';
          await chatCtrl.postStatusToThreadForLifecycle({
            booking: updated,
            event: action === 'accept' ? 'accepted' : 'declined',
            actorId: customerId,
            actorName,
            senderType: 'customer',
          });
        }
      } catch (e) {
        logger.warn('Calendar counter-respond chat status post skipped', { error: e.message });
      }
    }

    res.json({
      booking: transformBooking(updated),
      message:
        action === 'accept' ? 'Counter-proposal accepted' : 'Counter-proposal declined',
      appointmentId: result.appointment?.id || updated.appointment_id || null,
    });
  } catch (err) {
    logger.error('Error responding to counter-proposal', { error: err.message });
    sendError(res, 500, 'Failed to respond to counter-proposal');
  }
};

// ─── Group 1, item 14: booking-level reschedule proposals ─────────────
// POST /api/bookings/:bookingId/reschedule
// Either party proposes a new date/time for an ACCEPTED booking. The
// proposal is a request: the booking's window, deposit, price, and
// cancellation rules do not change until the other party accepts.
exports.proposeReschedule = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;
    const body = req.body || {};
    const booking = await bookingLifecycle.loadBooking(bookingId);
    if (!booking) return sendError(res, 404, 'Booking request not found');
    const isCustomer = String(booking.customer_id) === String(userId);
    const isProvider = await bookingLifecycle.isBookingManagerForBooking(userId, booking);
    if (!isCustomer && !isProvider) {
      return sendError(res, 403, 'Only the customer or the provider can propose a reschedule', 'forbidden');
    }
    const actorType = isCustomer ? 'customer' : (booking.helper_id && String(booking.helper_id) === String(userId) ? 'helper' : 'business');
    let result;
    try {
      result = await bookingLifecycle.proposeBookingReschedule({
        booking,
        actorId: userId,
        actorType,
        date: body.proposed_date || body.proposedDate || body.date || body.requestedDate,
        start: body.proposed_start_time || body.proposedStartTime || body.start || body.requestedStartTime,
        end: body.proposed_end_time || body.proposedEndTime || body.end || body.requestedEndTime,
        note: body.message || body.note || body.reason || null,
      });
    } catch (e) {
      const status = e.status || 400;
      return sendError(res, status, e.message || 'Cannot propose reschedule', e.code);
    }
    const proposal = result.proposal;
    const otherUserId = isCustomer
      ? (booking.helper_id || (await businessOwnerId(booking.business_id)))
      : booking.customer_id;
    if (otherUserId) {
      await sendNotification({
        userId: otherUserId,
        type: 'booking_reschedule_proposed',
        body: `${booking.service_name}, ${proposal.proposedDate} ${proposal.proposedStartTime}-${proposal.proposedEndTime}`,
        data: { bookingId, proposalId: proposal.id },
        action_url: '/my-bookings',
      }).catch((err) => logger.warn('Failed reschedule proposal notification', { error: err.message }));
    }
    res.status(201).json({ booking: transformBooking(result.booking), proposal, message: 'Reschedule proposed' });
  } catch (err) {
    logger.error('Error proposing booking reschedule', { error: err.message });
    sendError(res, 500, 'Failed to propose reschedule');
  }
};

// POST /api/bookings/:bookingId/reschedule/:proposalId/respond
// The OTHER party accepts or declines. Accept moves the booking window
// (and the linked appointment) in the same transaction; decline leaves
// the booking exactly as it was.
exports.respondToReschedule = async (req, res) => {
  try {
    const { bookingId, proposalId } = req.params;
    const userId = req.user.id;
    const action = String(req.body?.action || '').toLowerCase();
    if (!['accept', 'decline'].includes(action)) {
      return sendValidationError(res, { action: 'Use accept or decline' });
    }
    const booking = await bookingLifecycle.loadBooking(bookingId);
    if (!booking) return sendError(res, 404, 'Booking request not found');
    const isCustomer = String(booking.customer_id) === String(userId);
    const isProvider = await bookingLifecycle.isBookingManagerForBooking(userId, booking);
    if (!isCustomer && !isProvider) {
      return sendError(res, 403, 'Only the customer or the provider can respond to a reschedule', 'forbidden');
    }
    let result;
    try {
      result = await bookingLifecycle.respondToBookingReschedule({ booking, proposalId, actorId: userId, action });
    } catch (e) {
      const status = e.status || 400;
      return sendError(res, status, e.message || 'Cannot respond to reschedule', e.code);
    }
    const proposerId = result.proposal.proposedBy;
    if (proposerId) {
      await sendNotification({
        userId: proposerId,
        type: action === 'accept' ? 'booking_reschedule_accepted' : 'booking_reschedule_declined',
        body: `${booking.service_name}: reschedule ${action === 'accept' ? 'accepted' : 'declined'}`,
        data: { bookingId, proposalId },
        action_url: '/my-bookings',
      }).catch((err) => logger.warn('Failed reschedule response notification', { error: err.message }));
    }
    res.json({
      booking: transformBooking(result.booking),
      proposal: result.proposal,
      message: action === 'accept' ? 'Reschedule accepted' : 'Reschedule declined',
    });
  } catch (err) {
    logger.error('Error responding to booking reschedule', { error: err.message });
    sendError(res, 500, 'Failed to respond to reschedule');
  }
};

// GET /api/bookings/:bookingId/reschedule
exports.listReschedules = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;
    const booking = await bookingLifecycle.loadBooking(bookingId);
    if (!booking) return sendError(res, 404, 'Booking request not found');
    const isCustomer = String(booking.customer_id) === String(userId);
    const isProvider = await bookingLifecycle.isBookingManagerForBooking(userId, booking);
    if (!isCustomer && !isProvider) {
      return sendError(res, 403, 'Not authorized to view this booking', 'forbidden');
    }
    const proposals = await bookingLifecycle.listBookingRescheduleProposals(bookingId);
    res.json({ proposals });
  } catch (err) {
    logger.error('Error listing booking reschedules', { error: err.message });
    sendError(res, 500, 'Failed to list reschedules');
  }
};

async function businessOwnerId(businessId) {
  if (!businessId) return null;
  try {
    const { rows } = await pool.query('SELECT user_id FROM businesses WHERE id = $1', [businessId]);
    return rows[0]?.user_id || null;
  } catch {
    return null;
  }
}


function timeFromTimestamptz(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}:00`;
}

function timeToMinutes(t) {
  if (!t) return 0;
  if (t instanceof Date) {
    return t.getHours() * 60 + t.getMinutes();
  }
  const s = String(t);
  const parts = s.match(/(\d{1,2}):(\d{2})/);
  if (!parts) return 0;
  return parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
}

function minutesToTime(mins) {
  const safe = Math.max(0, Math.min(1440, mins));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function sliceWindowToHourSlots(windowStart, windowEnd, busyRanges, durationMinutes = 60, incrementMinutes = durationMinutes) {
  const slots = [];
  let cur = timeToMinutes(windowStart);
  const endMin = timeToMinutes(windowEnd);
  const busy = busyRanges
    .map((r) => ({
      a: timeToMinutes(r.start),
      b: timeToMinutes(r.end),
    }))
    .filter((r) => r.b > r.a);

  const duration = Math.max(15, Math.min(480, Number(durationMinutes) || 60));
  const increment = Math.max(15, Math.min(duration, Number(incrementMinutes) || duration));
  while (cur + duration <= endMin) {
    const slotStart = cur;
    const slotEnd = cur + duration;
    const overlaps = busy.some((b) => slotStart < b.b && slotEnd > b.a);
    slots.push({
      startTime: minutesToTime(slotStart),
      endTime: minutesToTime(slotEnd),
      available: !overlaps,
    });
    cur += increment;
  }
  return slots;
}

function transformBooking(booking) {
  // Item 54: the visit ownership label — who the visit is for, and
  // whether a household delegate booked it. Computed here so every read
  // shape (create response, single read, list) carries it. The label
  // carries no payment information.
  const ownershipFields = (shape) => {
    const bookedBy = shape.bookedByUserId || booking.booked_by_user_id || shape.customerId;
    const recipientName = shape.recipientName !== undefined ? shape.recipientName : booking.recipient_name;
    const bookedByDelegate = Boolean(bookedBy && String(bookedBy) !== String(shape.customerId));
    const ownershipLabel = recipientName
      ? `Visit for ${recipientName}${bookedByDelegate ? ' · booked by a household delegate' : ''}`
      : (bookedByDelegate ? 'Booked by a household delegate' : null);
    return { ...shape, ownershipLabel, bookedByDelegate };
  };
  // Prefer shared calendar shape when row already transformed / has snake_case DB fields
  if (booking && booking.customerId != null && booking.conversationId !== undefined) {
    return ownershipFields(booking);
  }
  const base = bookingLifecycle.toCalendarBooking(booking);
  const shaped = base || {
    id: booking.id,
    customerId: booking.customer_id,
    helperId: booking.helper_id,
    serviceName: booking.service_name,
    requestedDate: booking.requested_date,
    requestedStartTime: booking.requested_start_time,
    requestedEndTime: booking.requested_end_time,
    serviceLocation: booking.service_location,
    description: booking.description,
    status: booking.status,
    expiresAt: booking.expires_at,
    confirmationHours: booking.confirmation_hours,
    availabilityMode: booking.availability_mode || 'scheduled',
    autoPostOnExpiry: Boolean(booking.auto_post_on_expiry),
    marketplacePostedAt: booking.marketplace_posted_at || null,
    acceptedAt: booking.accepted_at,
    declinedAt: booking.declined_at,
    helperResponseReason: booking.helper_response_reason,
    convertedToJobId: booking.converted_to_job_id,
    conversationId: booking.conversation_id || null,
    guestSessionId: booking.guest_session_id || null,
    appointmentId: booking.appointment_id != null ? String(booking.appointment_id) : null,
    source: booking.source || 'direct',
    counter_proposed_at: booking.counter_proposed_at,
    counter_date: booking.counter_date,
    counter_start_time: booking.counter_start_time,
    counter_end_time: booking.counter_end_time,
    counter_message: booking.counter_message,
    counter_status: booking.counter_status,
    createdAt: booking.created_at,
    updatedAt: booking.updated_at,
  };
  return ownershipFields(shaped);
}

function transformRecurringBooking(row) {
  return {
    id: row.id,
    helper_id: row.helper_id,
    service_name: row.service_name,
    frequency: row.frequency,
    preferred_day: row.preferred_day,
    preferred_time: row.preferred_time,
    status: row.status,
    next_date: row.next_date,
    created_at: row.created_at,
    helper_name: row.helper_name || null,
    helper_avatar_url: row.helper_avatar_url || null,
  };
}

async function logBookingAudit(bookingId, action, actorId, actorType, oldStatus, newStatus) {
  try {
    await pool.query(
      `INSERT INTO booking_request_audit_log (booking_request_id, action, actor_id, actor_type, old_status, new_status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [bookingId, action, actorId, actorType, oldStatus, newStatus]
    );
  } catch (err) {
    logger.warn('Failed to log booking audit', { error: err.message });
  }
}

async function notifyHelperOfBooking(helperId, booking) {
  try {
    // Real-time: makes the BookingRequestsView in HelperCalendarView refresh immediately
    broadcastToUser(helperId, 'booking:new', { bookingId: booking.id });

    await sendNotification({
      userId: helperId,
      type: 'booking_request_new',
      body: `${booking.service_name}, ${booking.requested_date} ${booking.requested_start_time}-${booking.requested_end_time}`,
      data: { bookingId: booking.id },
      action_url: '/calendar?tab=bookingRequests',
    });
  } catch (err) {
    logger.warn('Failed to notify helper of booking', { error: err.message });
  }
}

async function notifyCustomerOfBookingResponse(customerId, booking, response) {
  try {
    broadcastToUser(customerId, 'booking:updated', {
      bookingId: booking.id,
      status: booking.status,
    });

    const isAccepted = response === 'accepted';
    const isDeclined = response === 'declined';
    const isAcceptedCancelled = response === 'accepted_cancelled';

    let type, body, action_url;

    if (isAccepted) {
      type = 'booking_accepted';
      body = `${booking.service_name}, ${booking.requested_date}`;
      action_url = '/calendar';
    } else if (isDeclined) {
      type = 'booking_declined';
      body = `${booking.service_name}, ${booking.requested_date}${booking.helper_response_reason ? ` (${booking.helper_response_reason})` : ''}`;
      action_url = '/my-bookings';
    } else if (isAcceptedCancelled) {
      type = 'booking_cancelled';
      body = `${booking.service_name}, ${booking.requested_date}`;
      action_url = '/my-bookings';
    } else {
      return;
    }

    await sendNotification({ userId: customerId, type, body, data: { bookingId: booking.id }, action_url });
    // G-6: the recipient the work is for hears the accept/decline too.
    if (booking.recipient_user_id && String(booking.recipient_user_id) !== String(customerId)) {
      try {
        broadcastToUser(booking.recipient_user_id, 'booking:updated', {
          bookingId: booking.id,
          status: booking.status,
        });
        await sendNotification({
          userId: booking.recipient_user_id,
          type,
          body,
          data: { bookingId: booking.id },
          action_url,
        });
      } catch (recipientErr) {
        logger.warn('Failed to notify booking recipient of response', { error: recipientErr.message });
      }
    }
    // G-7: the site contact coordinates arrival, so they hear the
    // accept/decline too (status link, no billing).
    if (booking.site_contact_user_id && String(booking.site_contact_user_id) !== String(customerId)
        && String(booking.site_contact_user_id) !== String(booking.recipient_user_id)) {
      try {
        broadcastToUser(booking.site_contact_user_id, 'booking:updated', {
          bookingId: booking.id,
          status: booking.status,
        });
        await sendNotification({
          userId: booking.site_contact_user_id,
          type,
          body,
          data: { bookingId: booking.id },
          action_url: booking.status_token ? `/bookings/status/${booking.status_token}` : action_url,
        });
      } catch (siteContactErr) {
        logger.warn('Failed to notify site contact of booking response', { error: siteContactErr.message });
      }
    }
  } catch (err) {
    logger.warn('Failed to notify customer of booking response', { error: err.message });
  }
}

async function notifyHelperOfBookingCancellation(helperId, booking) {
  try {
    broadcastToUser(helperId, 'booking:updated', {
      bookingId: booking.id,
      status: booking.status,
    });

    await sendNotification({
      userId: helperId,
      type: 'booking_cancelled',
      body: `${booking.service_name}, ${booking.requested_date}`,
      data: { bookingId: booking.id },
      action_url: '/calendar?tab=bookingRequests',
    });
  } catch (err) {
    logger.warn('Failed to notify helper of booking cancellation', { error: err.message });
  }
}
// G-30: the chat customer-cancel path reuses the same helper notification
// as the signed-in cancel (lazy-required there to avoid a load-time cycle:
// this controller lazily requires the chat controller inside handlers).
exports.notifyHelperOfBookingCancellation = notifyHelperOfBookingCancellation;

/**
 * Marketplace fallback for expired bookings. The DB work lives in
 * bookingLifecycle.autoPostExpiredBooking so read-side expiry (expireIfStale)
 * and this worker share one implementation; this wrapper keeps the
 * socket/push notifications that belong to the worker.
 */
async function autoPostExpiredBooking(bookingId) {
  return bookingLifecycle.autoPostExpiredBooking(bookingId);
}

/** Pending bookings past expires_at → expired. Notifies customer via socket. */
exports.expirePendingBookingRequests = async () => {
  try {
    const autoCandidates = await pool.query(
      `SELECT id
         FROM booking_requests
        WHERE status = 'pending'
          AND expires_at < NOW()
          AND auto_post_on_expiry = TRUE
          AND customer_id IS NOT NULL
        ORDER BY expires_at
        LIMIT 100`
    );
    let postedCount = 0;
    for (const candidate of autoCandidates.rows) {
      try {
        const result = await autoPostExpiredBooking(candidate.id);
        if (!result) continue;
        postedCount += 1;
        const { booking, jobId } = result;
        broadcastToUser(booking.customer_id, 'booking:updated', {
          bookingId: booking.id,
          status: 'expired',
          marketplaceJobId: jobId,
        });
        broadcastToUser(booking.helper_id, 'booking:updated', {
          bookingId: booking.id,
          status: 'expired',
          marketplaceJobId: jobId,
        });
        sendNotification({
          userId: booking.customer_id,
          type: 'booking_auto_posted',
          body: `${booking.service_name} is now open for bids`,
          data: { bookingId: booking.id, jobId },
          action_url: `/jobs/${jobId}`,
        }).catch((err) => logger.warn('Failed marketplace fallback notification', { error: err.message }));
      } catch (err) {
        logger.error('Failed to publish expired booking as job', {
          bookingId: candidate.id,
          error: err.message,
        });
      }
    }

    const r = await pool.query(
      `UPDATE booking_requests
       SET status = 'expired', updated_at = CURRENT_TIMESTAMP
       WHERE status = 'pending' AND expires_at < NOW()
         AND (COALESCE(auto_post_on_expiry, FALSE) = FALSE OR customer_id IS NULL)
       RETURNING id, customer_id, helper_id, service_name, requested_date`
    );
    if (r.rowCount > 0 || postedCount > 0) {
      logger.info('Expired pending booking requests', { count: r.rowCount, autoPosted: postedCount });
      for (const row of r.rows) {
        await logBookingAudit(row.id, 'expired', null, 'system', 'pending', 'expired');
        broadcastToUser(row.customer_id, 'booking:updated', {
          bookingId: row.id,
          status: 'expired',
        });
        // The provider also needs to know the request lapsed.
        broadcastToUser(row.helper_id, 'booking:updated', {
          bookingId: row.id,
          status: 'expired',
        });
        // Fire-and-forget — don't block the cron if one notification fails
        sendNotification({
          userId: row.customer_id,
          type: 'booking_auto_released',
          body: `${row.service_name}, ${row.requested_date}`,
          data: { bookingId: row.id },
          action_url: '/my-bookings',
        }).catch((err) => logger.warn('Failed expiry notification', { error: err.message }));
        sendNotification({
          userId: row.helper_id,
          type: 'booking_expired',
          body: `${row.service_name}, ${row.requested_date}`,
          data: { bookingId: row.id },
          action_url: '/calendar?tab=bookingRequests',
        }).catch((err) => logger.warn('Failed provider expiry notification', { error: err.message }));
      }
    }
    return (r.rowCount || 0) + postedCount;
  } catch (err) {
    logger.warn('expirePendingBookingRequests failed', { error: err.message });
    return 0;
  }
};

/**
 * After scheduled end (date + end time in server TZ), release accepted bookings so customer can post publicly.
 * Also releases request-only bookings that were accepted but never got an agreed time (stranded),
 * and cancels the linked appointment (helper or business) for every released booking.
 * Notifies both parties.
 *
 * P3-8-F11: never release a booking whose service was delivered. A linked
 * appointment in 'completed' status is delivery evidence: the booking moves
 * to 'completed' instead of 'accepted_cancelled', and the linked appointment
 * is left alone. A linked appointment still 'in_progress' is left to the
 * appointment lifecycle (not swept here).
 */
exports.releaseStaleAcceptedBookings = async () => {
  try {
    // Delivery evidence: the linked helper or business appointment reached
    // 'completed'. Those bookings are done, not abandoned.
    const deliveredCondition = `
      (
        (br.appointment_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.id = br.appointment_id AND a.status = 'completed'
        ))
        OR (br.business_appointment_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM business_appointments ba
          WHERE ba.id = br.business_appointment_id AND ba.status = 'completed'
        ))
      )`;
    const inProgressCondition = `
      (
        (br.appointment_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.id = br.appointment_id AND a.status = 'in_progress'
        ))
        OR (br.business_appointment_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM business_appointments ba
          WHERE ba.id = br.business_appointment_id AND ba.status = 'in_progress'
        ))
      )`;
    const staleCondition = `
      status = 'accepted'
      AND (
        (requested_end_time IS NOT NULL
          AND (requested_date::timestamp + requested_end_time::interval) < NOW())
        OR (requested_end_time IS NULL
          AND updated_at < NOW() - INTERVAL '7 days')
      )`;

    // 1) Delivered bookings: accepted -> completed (never cancelled).
    // G3-28 (D-53): each branch has its own try/catch, so a failure in
    // the delivered branch never aborts the stale-release branch.
    try {
      const completed = await pool.query(
        `UPDATE booking_requests br
         SET status = 'completed',
             helper_response_reason = COALESCE(
               helper_response_reason,
               'Service delivered; booking completed automatically'
             ),
             updated_at = CURRENT_TIMESTAMP
         WHERE ${staleCondition} AND ${deliveredCondition}
         RETURNING id, customer_id, helper_id, business_id, service_name, requested_date,
                   appointment_id, business_appointment_id, recipient_user_id, site_contact_user_id`
      );
      if (completed.rowCount > 0) {
        logger.info('Auto-completed delivered bookings past scheduled end', { count: completed.rowCount });
        for (const row of completed.rows) {
          await logBookingAudit(row.id, 'auto_completed', null, 'system', 'accepted', 'completed');
          broadcastToUser(row.customer_id, 'booking:updated', { bookingId: row.id, status: 'completed' });
          broadcastToUser(row.helper_id, 'booking:updated', { bookingId: row.id, status: 'completed' });

          sendNotification({
            userId: row.customer_id,
            type: 'booking_auto_completed',
            body: `${row.service_name}, ${row.requested_date}`,
            data: { bookingId: row.id },
            action_url: '/my-bookings',
          }).catch((err) => logger.warn('Failed auto-complete customer notification', { error: err.message }));

          sendNotification({
            userId: row.helper_id,
            type: 'booking_auto_completed',
            body: `${row.service_name}, ${row.requested_date}`,
            data: { bookingId: row.id },
            action_url: '/calendar',
          }).catch((err) => logger.warn('Failed auto-complete helper notification', { error: err.message }));

          // Group 3 (item 105): the recipient and site contact learn the
          // visit is complete too, unless they muted this booking.
          recipientSvc.notifyVisitCompleted(row).catch((err) => logger.warn('Failed auto-complete visit notification', { error: err.message }));
        }
      }
    } catch (err) {
      logger.warn('Auto-complete delivered bookings failed', { error: err.message });
    }

    // 2) Genuinely stale bookings: accepted -> accepted_cancelled, excluding
    // delivered work (handled above) and appointments still in progress.
    try {
      const r = await pool.query(
        `UPDATE booking_requests br
         SET status = 'accepted_cancelled',
             helper_response_reason = COALESCE(
               helper_response_reason,
               'Automatically released after scheduled time passed'
             ),
             updated_at = CURRENT_TIMESTAMP
         WHERE ${staleCondition}
           AND NOT (${deliveredCondition})
           AND NOT (${inProgressCondition})
         RETURNING id, customer_id, helper_id, business_id, service_name, requested_date,
                   appointment_id, business_appointment_id`
      );
      if (r.rowCount > 0) {
        logger.info('Released accepted bookings past scheduled end', { count: r.rowCount });
        for (const row of r.rows) {
          // The linked appointment must not outlive the released booking.
          try {
            await bookingLifecycle.cancelLinkedAppointment(row, row.helper_id);
          } catch (e) {
            logger.warn('Failed to cancel linked appointment on auto-release', { error: e.message });
          }
          await logBookingAudit(row.id, 'auto_released', null, 'system', 'accepted', 'accepted_cancelled');
          broadcastToUser(row.customer_id, 'booking:updated', { bookingId: row.id, status: 'accepted_cancelled' });
          broadcastToUser(row.helper_id, 'booking:updated', { bookingId: row.id, status: 'accepted_cancelled' });

          sendNotification({
            userId: row.customer_id,
            type: 'booking_auto_released',
            body: `${row.service_name}, ${row.requested_date}`,
            data: { bookingId: row.id },
            action_url: '/my-bookings',
          }).catch((err) => logger.warn('Failed auto-release customer notification', { error: err.message }));

          sendNotification({
            userId: row.helper_id,
            type: 'booking_auto_released',
            body: `${row.service_name}, ${row.requested_date}`,
            data: { bookingId: row.id },
            action_url: '/calendar',
          }).catch((err) => logger.warn('Failed auto-release helper notification', { error: err.message }));
        }
      }
      return r.rowCount || 0;
    } catch (err) {
      logger.warn('Release stale accepted bookings failed', { error: err.message });
      return 0;
    }
  } catch (err) {
    logger.warn('releaseStaleAcceptedBookings failed', { error: err.message });
    return 0;
  }
};
