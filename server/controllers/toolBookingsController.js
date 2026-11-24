const db = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const bookingEmailService = require('../services/bookingEmailService');
const { parseDateOnlyUTC } = require('../utils/dateOnly');
// Group 11 item 571 (D-259): identity is the platform Didit state.
const { rentalIdentityStatus } = require('../utils/rentalIdentity');

const TOOL_RENTAL_AGREEMENT_VERSION = 'peer-rental-v1';

function buildAgreementSnapshot(tool, { startDate, endDate, rentalDays, totalPrice, fulfillment, pickupTime, returnTime }) {
  return {
    version: TOOL_RENTAL_AGREEMENT_VERSION,
    oxsteedRole: 'OxSteed provides tools for neighbors to document and coordinate rentals. OxSteed is not the tool owner, renter, inspector, insurer, or guarantor.',
    renterAcknowledgement: [
      'The renter is responsible for inspecting the tool before use and deciding whether it is appropriate for their task.',
      'The renter assumes the risk of ordinary tool use and property damage or injury caused by their use of the tool.',
      'The renter may be responsible for damage beyond normal wear, loss, theft, late return, missing parts, or failure to return the tool clean and working.',
      'The renter understands OxSteed has limited control over neighbor-owned tools and can receive reports about bad actors.',
    ],
    tool: {
      id: tool.id,
      accessories: tool.accessories || [],
      conditionChecklist: tool.condition_checklist || [],
      name: tool.name,
      category: tool.category,
      brand: tool.brand,
      model: tool.model,
      condition: tool.condition,
      ownerRules: tool.owner_rules || null,
      ownerCustomTerms: tool.owner_custom_terms || null,
      ownerCustomTermsHash: tool.owner_custom_terms_hash || null,
      replacementValue: tool.replacement_value != null ? Number(tool.replacement_value) : null,
      requiresDeposit: !!tool.requires_deposit,
      depositAmount: tool.deposit_amount != null ? Number(tool.deposit_amount) : null,
    },
    rental: {
      startDate,
      endDate,
      rentalDays,
      dailyRate: Number(tool.daily_rate),
      totalPrice,
      fulfillment: fulfillment || 'pickup',
      // Group 11 item 574: the pickup time-of-day, frozen with the rest
      // of the agreement (null when the renter picked no time).
      pickupTime: pickupTime || null,
      // Group 11 item 576: the return time-of-day, frozen the same way.
      returnTime: returnTime || null,
    },
  };
}

const createBooking = async (req, res, next) => {
  const client = await db.connect();
  try {
    const { toolId, startDate, endDate, renterAgreementAccepted } = req.body;
    const userId = req.user.id;
    // Group 11 item 554: the renter chooses how they get the tool. Pickup
    // is always available; delivery only when the listing offers it.
    const fulfillment = req.body.fulfillment == null ? 'pickup' : req.body.fulfillment;
    // Group 11 item 574: pickup appointment time (HH:MM, 24-hour).
    // Optional; only meaningful for pickup fulfillment.
    const pickupTime = req.body.pickupTime == null || req.body.pickupTime === ''
      ? null
      : String(req.body.pickupTime).trim();
    // Group 11 item 576: return appointment time (HH:MM, 24-hour).
    // Optional; applies to every fulfillment type, since the tool always
    // comes back for a handoff.
    const returnTime = req.body.returnTime == null || req.body.returnTime === ''
      ? null
      : String(req.body.returnTime).trim();

    const fields = {};
    if (!toolId) fields.toolId = 'toolId is required';
    if (!startDate) fields.startDate = 'startDate is required';
    if (!endDate) fields.endDate = 'endDate is required';
    if (fulfillment !== 'pickup' && fulfillment !== 'delivery') {
      fields.fulfillment = 'fulfillment must be pickup or delivery';
    }
    if (pickupTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(pickupTime)) {
      fields.pickupTime = 'pickupTime must be a time like 09:30';
    }
    if (returnTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(returnTime)) {
      fields.returnTime = 'returnTime must be a time like 09:30';
    }
    if (pickupTime !== null && fulfillment === 'delivery') {
      fields.pickupTime = 'pickupTime only applies to pickup';
    }
    if (!renterAgreementAccepted) {
      fields.renterAgreementAccepted = 'You must accept the peer rental agreement before booking';
    }
    if (Object.keys(fields).length) throw new AppError('Validation failed', 400, 'validation_failed', fields);

    const start = parseDateOnlyUTC(startDate);
    const end = parseDateOnlyUTC(endDate);
    if (!start || !end) {
      throw new AppError('Invalid date', 400, 'validation_failed', { startDate: 'Invalid date', endDate: 'Invalid date' });
    }

    if (start >= end) {
      throw new AppError('End date must be after start date', 400, 'validation_failed', { endDate: 'Must be after startDate' });
    }

    // Get tool and owner info
    const toolResult = await client.query(
      `SELECT tr.id, tr.user_id AS owner_id, tr.name, tr.category, tr.brand, tr.model, tr.condition,
              tr.daily_rate, tr.deposit_amount, tr.requires_deposit, tr.owner_rules,
              tr.owner_custom_terms, tr.owner_custom_terms_hash, tr.replacement_value,
              tr.is_available, tr.moderation_hold, tr.pickup_only, tr.delivery_available,
              tr.accessories, tr.condition_checklist, tr.equipment_version,
              tr.pickup_window_start, tr.pickup_window_end,
              tr.return_window_start, tr.return_window_end, tr.cleaning_instructions
         FROM tool_rentals tr
         JOIN users owner
           ON owner.id = tr.user_id
          AND owner.is_active = TRUE
          AND owner.deleted_at IS NULL
          AND owner.email_verified = TRUE
        WHERE tr.id = $1`,
      [toolId]
    );
    if (toolResult.rows.length === 0) {
      throw new AppError('Tool not found', 404, 'not_found');
    }
    const listedTool = toolResult.rows[0];
    const ownerId = listedTool.owner_id;
    if (ownerId === userId) {
      throw new AppError('You cannot book your own tool', 409, 'state_conflict');
    }
    if (!listedTool.is_available) {
      throw new AppError('Tool is not available', 409, 'state_conflict');
    }
    if (listedTool.moderation_hold) {
      throw new AppError('Tool is under admin review and cannot be booked', 409, 'state_conflict');
    }
    // 554: pickup eligibility. Delivery is refused when the listing is
    // pickup-only or does not offer delivery; pickup is always allowed.
    // (The owner's email_verified flag is re-checked in the join above:
    // the same gate browse/public already apply, so a listing hidden from
    // browse cannot be booked by direct id.)
    if (fulfillment === 'delivery' && (listedTool.pickup_only === true || listedTool.delivery_available !== true)) {
      throw new AppError('Delivery is not available for this tool', 409, 'fulfillment_not_available');
    }
    // 574: when the owner set a pickup window, the renter's pickup time
    // must fall inside it. Times compare lexicographically as HH:MM:SS.
    if (pickupTime !== null && listedTool.pickup_window_start && listedTool.pickup_window_end) {
      const picked = `${pickupTime}:00`;
      const windowStart = String(listedTool.pickup_window_start);
      const windowEnd = String(listedTool.pickup_window_end);
      if (picked < windowStart || picked > windowEnd) {
        throw new AppError('Pickup time is outside the owner pickup window', 400, 'validation_failed', { pickupTime: 'Pick a time inside the owner pickup window' });
      }
    }
    // 576: the same window rule for the return time, against the owner's
    // daily return window when one is set.
    if (returnTime !== null && listedTool.return_window_start && listedTool.return_window_end) {
      const picked = `${returnTime}:00`;
      const windowStart = String(listedTool.return_window_start);
      const windowEnd = String(listedTool.return_window_end);
      if (picked < windowStart || picked > windowEnd) {
        throw new AppError('Return time is outside the owner return window', 400, 'validation_failed', { returnTime: 'Pick a time inside the owner return window' });
      }
    }
    const dailyRate = parseFloat(listedTool.daily_rate);
    if (!Number.isFinite(dailyRate) || dailyRate <= 0) {
      throw new AppError('Tool cannot be booked online because pricing is not configured', 409, 'pricing_unavailable');
    }

    const rentalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const totalPrice = Number((rentalDays * dailyRate).toFixed(2));
    const agreementSnapshot = buildAgreementSnapshot(listedTool, {
      startDate,
      endDate,
      rentalDays,
      totalPrice,
      fulfillment,
      pickupTime,
      returnTime,
    });

    // Serialize bookings per tool before checking availability. The previous
    // check ran before BEGIN, allowing concurrent requests to both pass.
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tool-rental:${toolId}`]);
    const currentTool=await client.query('SELECT equipment_version,is_available,moderation_hold,pickup_only,delivery_available FROM tool_rentals WHERE id=$1 FOR SHARE',[toolId]);
    if(!currentTool.rows[0]||currentTool.rows[0].is_available===false||currentTool.rows[0].moderation_hold)throw new AppError('Tool unavailable',409,'state_conflict');
    // 554: re-check fulfillment under the per-tool lock; the flags may have
    // changed between the first read and the lock.
    if (fulfillment === 'delivery' && (currentTool.rows[0].pickup_only === true || currentTool.rows[0].delivery_available !== true)) throw new AppError('Delivery is not available for this tool',409,'fulfillment_not_available');
    if(Number(currentTool.rows[0].equipment_version)>1 && (req.body.equipmentVersion!==currentTool.rows[0].equipment_version || listedTool.equipment_version!==currentTool.rows[0].equipment_version))throw new AppError('Review the current equipment rules before booking',409,'equipment_changed');

    // Check for calendar conflicts (overlapping confirmed/pending bookings)
    const conflictResult = await client.query(
      `SELECT COUNT(*) as conflict_count FROM tool_rentals_bookings
       WHERE tool_id = $1
         AND status IN ('pending', 'invoice_sent', 'payment_confirmed')
         AND start_date <= $3
         AND end_date >= $2`,
      [toolId, startDate, endDate]
    );

    if (parseInt(conflictResult.rows[0].conflict_count) > 0) {
      throw new AppError('Tool is already booked for these dates', 409, 'conflict');
    }

    const booking = await client.query(
      `INSERT INTO tool_rentals_bookings
         (tool_id, customer_id, owner_id, start_date, end_date, total_price,
          agreement_snapshot, renter_acknowledged_at, renter_agreement_version, pickup_time, return_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10)
       RETURNING *`,
      [toolId, userId, ownerId, startDate, endDate, totalPrice, agreementSnapshot, TOOL_RENTAL_AGREEMENT_VERSION, pickupTime, returnTime]
    );

    // Log analytics
    await client.query(
      `INSERT INTO tool_rentals_analytics (user_id, tool_id, event_type, metadata)
       VALUES ($1, $2, 'book', $3)`,
      [userId, toolId, JSON.stringify({ startDate, endDate, totalPrice })]
    );

    await require('../growth/emit').emitDomainEvent(client, 'tool_rental.booked', require('../growth/emit').commerceEventProps({ id: booking.rows[0].id }), { userId, req });

    await client.query('COMMIT');

    // Fetch customer and owner data for email
    const customerData = await db.query('SELECT email, first_name, preferred_language FROM users WHERE id = $1', [userId]);
    const ownerData = await db.query('SELECT email, first_name, preferred_language FROM users WHERE id = $1', [ownerId]);
    const toolData = await db.query('SELECT name FROM tool_rentals WHERE id = $1', [toolId]);

    const customer = customerData.rows[0];
    const owner = ownerData.rows[0];
    const tool = toolData.rows[0];

    // Send confirmation emails asynchronously (non-blocking)
    if (customer && owner && tool) {
      bookingEmailService.sendBookingConfirmation(booking.rows[0], tool, customer, owner);
    }

    res.status(201).json(booking.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
};

const getMyBookings = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const result = await db.query(
      `SELECT b.*, tr.name, tr.daily_rate,
              cu.didit_status AS renter_didit_status,
              cu.didit_verified_at AS renter_didit_verified_at,
              cu.identity_verified AS renter_identity_verified,
              cu.id_verified AS renter_id_verified,
              ou.didit_status AS owner_didit_status,
              ou.didit_verified_at AS owner_didit_verified_at,
              ou.identity_verified AS owner_identity_verified,
              ou.id_verified AS owner_id_verified
       FROM tool_rentals_bookings b
       JOIN tool_rentals tr ON b.tool_id = tr.id
       JOIN users cu ON b.customer_id = cu.id
       JOIN users ou ON b.owner_id = ou.id
       WHERE b.customer_id = $1
       ORDER BY b.created_at DESC`,
      [userId]
    );
    // Group 11 item 571: identity status for both parties on every
    // booking (Didit state; 'skipped' is not verified).
    res.json(result.rows.map((row) => ({
      ...row,
      renter_identity: rentalIdentityStatus({
        didit_status: row.renter_didit_status,
        didit_verified_at: row.renter_didit_verified_at,
        identity_verified: row.renter_identity_verified,
        id_verified: row.renter_id_verified,
      }),
      owner_identity: rentalIdentityStatus({
        didit_status: row.owner_didit_status,
        didit_verified_at: row.owner_didit_verified_at,
        identity_verified: row.owner_identity_verified,
        id_verified: row.owner_id_verified,
      }),
    })));
  } catch (err) {
    next(err);
  }
};

const getBookingsByOwner = async (req, res, next) => {
  try {
    const ownerId = req.user.id;
    const result = await db.query(
      `SELECT b.*, tr.name, u.first_name, u.last_name,
              cu.didit_status AS renter_didit_status,
              cu.didit_verified_at AS renter_didit_verified_at,
              cu.identity_verified AS renter_identity_verified,
              cu.id_verified AS renter_id_verified,
              ou.didit_status AS owner_didit_status,
              ou.didit_verified_at AS owner_didit_verified_at,
              ou.identity_verified AS owner_identity_verified,
              ou.id_verified AS owner_id_verified
       FROM tool_rentals_bookings b
       JOIN tool_rentals tr ON b.tool_id = tr.id
       JOIN users u ON b.customer_id = u.id
       JOIN users cu ON b.customer_id = cu.id
       JOIN users ou ON b.owner_id = ou.id
       WHERE b.owner_id = $1
       ORDER BY b.created_at DESC`,
      [ownerId]
    );
    res.json(result.rows.map((row) => ({
      ...row,
      renter_identity: rentalIdentityStatus({
        didit_status: row.renter_didit_status,
        didit_verified_at: row.renter_didit_verified_at,
        identity_verified: row.renter_identity_verified,
        id_verified: row.renter_id_verified,
      }),
      owner_identity: rentalIdentityStatus({
        didit_status: row.owner_didit_status,
        didit_verified_at: row.owner_didit_verified_at,
        identity_verified: row.owner_identity_verified,
        id_verified: row.owner_id_verified,
      }),
    })));
  } catch (err) {
    next(err);
  }
};

const updateBookingStatus = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    if (!status) {
      throw new AppError('status is required', 400, 'validation_failed', { status: 'status is required' });
    }

    // Verify owner and get booking details
    const bookingQuery = await db.query(
      'SELECT * FROM tool_rentals_bookings WHERE id = $1',
      [bookingId]
    );
    if (!bookingQuery.rows[0]) {
      throw new AppError('Booking not found', 404, 'not_found');
    }

    const booking = bookingQuery.rows[0];
    const isOwner = booking.owner_id === userId;
    const isCustomer = booking.customer_id === userId;
    if (!isOwner && !isCustomer) {
      throw new AppError('Unauthorized', 403, 'forbidden');
    }

    const validStatuses = ['cancelled', 'completed', 'returned'];
    if (!validStatuses.includes(status)) {
      throw new AppError('Invalid status transition', 400, 'validation_failed', { status: 'Must be cancelled, returned or completed' });
    }
    // P3-12-F07: cancellation stays possible after payment is confirmed.
    // Payments are collected off-platform, so a post-payment cancellation
    // marks the booking cancelled and the parties settle any refund
    // directly; the status history records that money may be owed back.
    if (status === 'cancelled' && !['pending', 'invoice_sent', 'payment_confirmed'].includes(booking.status)) {
      throw new AppError('Booking can no longer be cancelled', 409, 'state_conflict');
    }
    // P3-12-F13: return/handover step. The renter confirms the tool was
    // handed back (optionally noting its condition) or the owner confirms
    // receipt; completion requires the handover first.
    if (status === 'returned') {
      if (booking.status !== 'payment_confirmed') {
        throw new AppError('The tool can only be returned once payment is confirmed', 409, 'state_conflict');
      }
    }
    if (status === 'completed' && (!isOwner || booking.status !== 'returned')) {
      throw new AppError('The booking must be marked returned (tool handed back) before it can be completed', 409, 'state_conflict');
    }

    const returnNote = typeof req.body?.returnNote === 'string' ? req.body.returnNote.trim().slice(0, 2000) : null;
    const result = await db.query(
      `UPDATE tool_rentals_bookings
          SET status = $1,
              returned_at = CASE WHEN $1 = 'returned' THEN NOW() ELSE returned_at END,
              return_condition_note = CASE WHEN $1 = 'returned' THEN $3 ELSE return_condition_note END
        WHERE id = $2 RETURNING *`,
      [status, bookingId, returnNote]
    );

    const updatedBooking = result.rows[0];

    // Send status update emails asynchronously
    if (status === 'payment_confirmed') {
      const customerData = await db.query('SELECT email, first_name, preferred_language FROM users WHERE id = $1', [booking.customer_id]);
      const toolData = await db.query('SELECT name FROM tool_rentals WHERE id = $1', [booking.tool_id]);
      if (customerData.rows[0] && toolData.rows[0]) {
        bookingEmailService.sendBookingApproved(updatedBooking, toolData.rows[0], customerData.rows[0]);
      }
    } else if (status === 'cancelled' && booking.status !== 'cancelled') {
      const customerData = await db.query('SELECT email, first_name, preferred_language FROM users WHERE id = $1', [booking.customer_id]);
      const toolData = await db.query('SELECT name FROM tool_rentals WHERE id = $1', [booking.tool_id]);
      if (customerData.rows[0] && toolData.rows[0]) {
        bookingEmailService.sendBookingDeclined(updatedBooking, toolData.rows[0], customerData.rows[0]);
      }
    }

    res.json(updatedBooking);
  } catch (err) {
    next(err);
  }
};

// Group 11 item 568 (D-258): explicit owner approval, distinct from
// invoicing. The owner accepts the pending request first; only then can
// the first invoice be sent (enforced in invoiceController). Decline
// closes the request with a reason and notifies the renter. Both actions
// are owner-only and server-enforced.
async function loadBookingForOwnerApproval(bookingId, userId) {
  const bookingQuery = await db.query(
    'SELECT * FROM tool_rentals_bookings WHERE id = $1',
    [bookingId]
  );
  const booking = bookingQuery.rows[0];
  if (!booking) throw new AppError('Booking not found', 404, 'not_found');
  if (booking.owner_id !== userId) {
    // A party on the wrong side gets 403; anyone else gets 404 so the
    // booking's existence is not leaked.
    if (booking.customer_id === userId) throw new AppError('Only the tool owner can decide on this request', 403, 'forbidden');
    throw new AppError('Booking not found', 404, 'not_found');
  }
  return booking;
}

const approveBooking = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const booking = await loadBookingForOwnerApproval(bookingId, req.user.id);
    if (booking.status !== 'pending' || booking.owner_approval !== 'pending') {
      throw new AppError('This request can no longer be approved', 409, 'state_conflict');
    }
    const { rows } = await db.query(
      `UPDATE tool_rentals_bookings
          SET owner_approval = 'approved', owner_approval_at = NOW()
        WHERE id = $1 AND owner_approval = 'pending' AND status = 'pending'
        RETURNING *`,
      [bookingId]
    );
    if (!rows[0]) throw new AppError('This request can no longer be approved', 409, 'state_conflict');
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

const declineBooking = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) {
      throw new AppError('A decline reason is required', 400, 'validation_failed', { reason: 'Tell the renter why the request was declined' });
    }
    if (reason.length > 2000) {
      throw new AppError('Decline reason is too long', 400, 'validation_failed', { reason: 'Keep the reason under 2000 characters' });
    }
    const booking = await loadBookingForOwnerApproval(bookingId, req.user.id);
    if (booking.status !== 'pending' || booking.owner_approval !== 'pending') {
      throw new AppError('This request can no longer be declined', 409, 'state_conflict');
    }
    const { rows } = await db.query(
      `UPDATE tool_rentals_bookings
          SET owner_approval = 'declined', owner_approval_at = NOW(),
              owner_decline_reason = $2, status = 'cancelled'
        WHERE id = $1 AND owner_approval = 'pending' AND status = 'pending'
        RETURNING *`,
      [bookingId, reason]
    );
    if (!rows[0]) throw new AppError('This request can no longer be declined', 409, 'state_conflict');
    const updated = rows[0];
    // Notify the renter, same as a cancellation (record-only; D-257).
    const customerData = await db.query('SELECT email, first_name, preferred_language FROM users WHERE id = $1', [booking.customer_id]);
    const toolData = await db.query('SELECT name FROM tool_rentals WHERE id = $1', [booking.tool_id]);
    if (customerData.rows[0] && toolData.rows[0]) {
      bookingEmailService.sendBookingDeclined(updated, toolData.rows[0], customerData.rows[0]);
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

// Group 11 item 570 (D-260): in-app confirmation receipt. What was
// booked, the frozen terms, the approval state and the invoice (if one
// was sent). Party-only: anyone else gets 404. No new email work: the
// confirmation email already sends asynchronously at booking time.
const getBookingReceipt = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;
    const bookingResult = await db.query(
      `SELECT b.*, tr.name AS tool_name, tr.category AS tool_category,
              tr.brand AS tool_brand, tr.model AS tool_model,
              tr.condition AS tool_condition, tr.daily_rate AS tool_daily_rate,
              tr.replacement_value AS tool_replacement_value,
              cu.didit_status AS renter_didit_status,
              cu.didit_verified_at AS renter_didit_verified_at,
              cu.identity_verified AS renter_identity_verified,
              cu.id_verified AS renter_id_verified,
              ou.didit_status AS owner_didit_status,
              ou.didit_verified_at AS owner_didit_verified_at,
              ou.identity_verified AS owner_identity_verified,
              ou.id_verified AS owner_id_verified
         FROM tool_rentals_bookings b
         JOIN tool_rentals tr ON b.tool_id = tr.id
         JOIN users cu ON b.customer_id = cu.id
         JOIN users ou ON b.owner_id = ou.id
        WHERE b.id = $1 AND (b.customer_id = $2 OR b.owner_id = $2)`,
      [bookingId, userId]
    );
    if (!bookingResult.rows[0]) {
      throw new AppError('Booking not found', 404, 'not_found');
    }
    const booking = bookingResult.rows[0];
    const termsResult = await db.query(
      `SELECT user_role, accepted_at FROM tool_rental_terms_acceptance WHERE booking_id = $1`,
      [bookingId]
    );
    const terms = { customerAccepted: false, ownerAccepted: false, bothAccepted: false };
    termsResult.rows.forEach((row) => {
      if (row.user_role === 'customer') terms.customerAccepted = !!row.accepted_at;
      if (row.user_role === 'owner') terms.ownerAccepted = !!row.accepted_at;
    });
    terms.bothAccepted = terms.customerAccepted && terms.ownerAccepted;
    const invoiceResult = await db.query(
      `SELECT id, invoice_number, status, total_amount, rental_amount, deposit_amount, created_at
         FROM tool_rental_invoices WHERE booking_id = $1`,
      [bookingId]
    );
    res.json({
      booking,
      tool: {
        id: booking.tool_id,
        name: booking.tool_name,
        category: booking.tool_category,
        brand: booking.tool_brand,
        model: booking.tool_model,
        condition: booking.tool_condition,
        daily_rate: booking.tool_daily_rate,
        replacement_value: booking.tool_replacement_value,
      },
      terms,
      invoice: invoiceResult.rows[0] || null,
      // Group 11 item 571: identity status for both parties.
      renter_identity: rentalIdentityStatus({
        didit_status: booking.renter_didit_status,
        didit_verified_at: booking.renter_didit_verified_at,
        identity_verified: booking.renter_identity_verified,
        id_verified: booking.renter_id_verified,
      }),
      owner_identity: rentalIdentityStatus({
        didit_status: booking.owner_didit_status,
        didit_verified_at: booking.owner_didit_verified_at,
        identity_verified: booking.owner_identity_verified,
        id_verified: booking.owner_id_verified,
      }),
    });
  } catch (err) {
    next(err);
  }
};

// Group 11 item 575 (D-260): distinct checkout acknowledgment at
// pickup. The renter confirms receipt of the item as described, with
// the pickup-phase condition report attached as evidence. Server
// enforced: renter only, booking must be payment_confirmed, a pickup
// report must exist, and the renter must have verified identity (571).
// Idempotent: acknowledging twice returns the recorded acknowledgment.
const acknowledgeCheckout = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;
    const bookingQuery = await db.query(
      'SELECT * FROM tool_rentals_bookings WHERE id = $1',
      [bookingId]
    );
    const booking = bookingQuery.rows[0];
    if (!booking) throw new AppError('Booking not found', 404, 'not_found');
    if (booking.customer_id !== userId) {
      if (booking.owner_id === userId) throw new AppError('Only the renter confirms pickup', 403, 'forbidden');
      throw new AppError('Booking not found', 404, 'not_found');
    }
    if (booking.checkout_acknowledged_at) {
      return res.json(booking);
    }
    if (booking.status !== 'payment_confirmed') {
      throw new AppError('Pickup can only be confirmed once payment is confirmed', 409, 'state_conflict');
    }
    const identityQuery = await db.query(
      `SELECT didit_status, didit_verified_at, identity_verified, id_verified
         FROM users WHERE id = $1`,
      [userId]
    );
    const identity = rentalIdentityStatus(identityQuery.rows[0]);
    if (!identity.verified) {
      throw new AppError('Complete identity verification before confirming pickup', 403, 'identity_not_verified');
    }
    const reportQuery = await db.query(
      `SELECT id FROM equipment_reports
        WHERE booking_id = $1 AND phase = 'pickup'
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [bookingId]
    );
    if (!reportQuery.rows[0]) {
      throw new AppError('File the pickup condition report before confirming pickup', 409, 'pickup_report_required');
    }
    const { rows } = await db.query(
      `UPDATE tool_rentals_bookings
          SET checkout_acknowledged_at = NOW(),
              checkout_acknowledged_by = $2,
              checkout_report_id = $3
        WHERE id = $1 AND checkout_acknowledged_at IS NULL
        RETURNING *`,
      [bookingId, userId, reportQuery.rows[0].id]
    );
    res.json(rows[0] || booking);
  } catch (err) {
    next(err);
  }
};

// Group 11 item 576 (D-276): return reschedule. The renter proposes a
// new return date/time; the owner approves or declines. Changing the
// return date never changes charges (D-257, no-charge only): approval
// moves end_date (and return_time) and leaves total_price alone.
// Approval re-checks the calendar so the new return date cannot
// double-book the tool; the proposal is decided owner-only.
function timeWithinWindow(time, windowStart, windowEnd) {
  if (!windowStart || !windowEnd) return true;
  const picked = `${time}:00`;
  return picked >= String(windowStart) && picked <= String(windowEnd);
}

async function loadBookingForReturnReschedule(bookingId, userId, { ownerOnly = false } = {}) {
  const bookingQuery = await db.query(
    'SELECT * FROM tool_rentals_bookings WHERE id = $1',
    [bookingId]
  );
  const booking = bookingQuery.rows[0];
  if (!booking) throw new AppError('Booking not found', 404, 'not_found');
  const isOwner = booking.owner_id === userId;
  const isCustomer = booking.customer_id === userId;
  if (ownerOnly) {
    if (!isOwner) {
      if (isCustomer) throw new AppError('Only the tool owner can decide a return reschedule', 403, 'forbidden');
      throw new AppError('Booking not found', 404, 'not_found');
    }
  } else if (!isCustomer) {
    if (isOwner) throw new AppError('Only the renter can propose a return reschedule', 403, 'forbidden');
    throw new AppError('Booking not found', 404, 'not_found');
  }
  return booking;
}

const proposeReturnReschedule = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const booking = await loadBookingForReturnReschedule(bookingId, req.user.id);
    if (booking.status !== 'payment_confirmed') {
      throw new AppError('The return can only be rescheduled once payment is confirmed', 409, 'state_conflict');
    }
    if (booking.return_reschedule_status === 'proposed') {
      throw new AppError('A return reschedule is already waiting for the owner', 409, 'return_reschedule_pending');
    }
    const proposedEndDate = typeof req.body?.proposedEndDate === 'string' ? req.body.proposedEndDate.trim() : '';
    const proposedTime = req.body?.proposedTime == null || req.body.proposedTime === ''
      ? null
      : String(req.body.proposedTime).trim();
    const fields = {};
    const end = parseDateOnlyUTC(proposedEndDate);
    if (!end) fields.proposedEndDate = 'Proposed return date is required and must be a valid date';
    else {
      // booking.start_date comes back from pg as a Date, not a string.
      const startRaw = booking.start_date instanceof Date
        ? booking.start_date.toISOString().slice(0, 10)
        : String(booking.start_date).slice(0, 10);
      const start = parseDateOnlyUTC(startRaw);
      if (start && end <= start) fields.proposedEndDate = 'The new return date must be after the pickup date';
    }
    if (proposedTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(proposedTime)) {
      fields.proposedTime = 'proposedTime must be a time like 09:30';
    }
    if (Object.keys(fields).length) throw new AppError('Validation failed', 400, 'validation_failed', fields);
    const toolQuery = await db.query(
      'SELECT return_window_start, return_window_end FROM tool_rentals WHERE id = $1',
      [booking.tool_id]
    );
    const tool = toolQuery.rows[0];
    if (proposedTime !== null && tool && !timeWithinWindow(proposedTime, tool.return_window_start, tool.return_window_end)) {
      throw new AppError('Return time is outside the owner return window', 400, 'validation_failed', { proposedTime: 'Pick a time inside the owner return window' });
    }
    const { rows } = await db.query(
      `UPDATE tool_rentals_bookings
          SET return_reschedule_status = 'proposed',
              return_reschedule_proposed_end_date = $2,
              return_reschedule_proposed_time = $3,
              return_reschedule_proposed_by = $4,
              return_reschedule_proposed_at = NOW(),
              return_reschedule_decided_at = NULL,
              return_reschedule_reason = NULL
        WHERE id = $1
        RETURNING *`,
      [bookingId, proposedEndDate, proposedTime, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

const approveReturnReschedule = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const booking = await loadBookingForReturnReschedule(bookingId, req.user.id, { ownerOnly: true });
    if (booking.return_reschedule_status !== 'proposed' || !booking.return_reschedule_proposed_end_date) {
      throw new AppError('There is no return reschedule waiting for a decision', 409, 'state_conflict');
    }
    const proposedEnd = booking.return_reschedule_proposed_end_date;
    // The new return date must not double-book the tool: any other live
    // booking overlapping the extended range blocks approval.
    const overlap = await db.query(
      `SELECT COUNT(*) AS overlap_count FROM tool_rentals_bookings
        WHERE tool_id = $1 AND id <> $2
          AND status IN ('pending', 'invoice_sent', 'payment_confirmed')
          AND start_date <= $3
          AND end_date >= $4`,
      [booking.tool_id, bookingId, proposedEnd, booking.start_date]
    );
    if (parseInt(overlap.rows[0].overlap_count, 10) > 0) {
      throw new AppError('The new return date overlaps another booking for this tool', 409, 'conflict');
    }
    const { rows } = await db.query(
      `UPDATE tool_rentals_bookings
          SET end_date = $2,
              return_time = COALESCE($3, return_time),
              return_reschedule_status = 'approved',
              return_reschedule_decided_at = NOW()
        WHERE id = $1 AND return_reschedule_status = 'proposed'
        RETURNING *`,
      [bookingId, proposedEnd, booking.return_reschedule_proposed_time]
    );
    if (!rows[0]) throw new AppError('There is no return reschedule waiting for a decision', 409, 'state_conflict');
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

const declineReturnReschedule = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) {
      throw new AppError('A decline reason is required', 400, 'validation_failed', { reason: 'Tell the renter why the new return date does not work' });
    }
    if (reason.length > 2000) {
      throw new AppError('Decline reason is too long', 400, 'validation_failed', { reason: 'Keep the reason under 2000 characters' });
    }
    const booking = await loadBookingForReturnReschedule(bookingId, req.user.id, { ownerOnly: true });
    if (booking.return_reschedule_status !== 'proposed') {
      throw new AppError('There is no return reschedule waiting for a decision', 409, 'state_conflict');
    }
    const { rows } = await db.query(
      `UPDATE tool_rentals_bookings
          SET return_reschedule_status = 'declined',
              return_reschedule_decided_at = NOW(),
              return_reschedule_reason = $2
        WHERE id = $1 AND return_reschedule_status = 'proposed'
        RETURNING *`,
      [bookingId, reason]
    );
    if (!rows[0]) throw new AppError('There is no return reschedule waiting for a decision', 409, 'state_conflict');
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

const checkAvailability = async (req, res, next) => {
  try {
    const { toolId } = req.params;
    if (!toolId) {
      throw new AppError('toolId is required', 400, 'validation_failed', { toolId: 'toolId is required' });
    }
    const result = await db.query(
      `SELECT start_date, end_date, status
       FROM tool_rentals_bookings
       WHERE tool_id = $1 AND status IN ('pending', 'invoice_sent', 'payment_confirmed')
       ORDER BY start_date ASC`,
      [toolId]
    );
    res.json({ booked_dates: result.rows });
  } catch (err) {
    next(err);
  }
};

module.exports = { createBooking, getMyBookings, getBookingsByOwner, updateBookingStatus, checkAvailability, approveBooking, declineBooking, getBookingReceipt, acknowledgeCheckout };
