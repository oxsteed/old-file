'use strict';

/**
 * Group 1 (Customer), item 23 — receipt vault (G1-A2, checkpoint 3).
 *
 * Read-only surface over money that already moved. Every read is scoped
 * to the requesting customer (req.user.id); a stranger gets 404 and never
 * sees another customer's amounts. No money moves here and no rail or
 * clearance gate applies: these are receipts for payments already made.
 *
 * Two receipt kinds, both paid-only. Unpaid and cancelled items are
 * excluded, not listed as receipts: a vault row is proof of payment, and
 * an unpaid row in the list would mislabel it.
 *
 *   - tool_rental: a tool_rentals_bookings row in payment_confirmed,
 *     returned or completed, amount = total_price, paid at
 *     payment_confirmed_at. Tool rentals carry no currency column; the
 *     platform prices them in USD (the existing receipt panel renders
 *     `$`), so the row reports 'usd'.
 *   - helper_job: a payments row in captured or released whose payer is
 *     the requester, joined to its job for the title. A helper booking
 *     has no payment row of its own: the payment lives on the job the
 *     booking converted into (booking_requests.converted_to_job_id ->
 *     payments.job_id). A booking that never converted, or whose job was
 *     never paid, has no receipt.
 *
 * The authorized-visit receipt (bookingRecipientController.getReceipt)
 * is NOT reused here: it deliberately carries no amounts (D-49), so it
 * cannot render a paid amount. The tool-rental receipt
 * (toolBookingsController.getBookingReceipt) is likewise not reused: it
 * returns the full booking + invoice + identity bundle for one rental,
 * not a vault list, and it knows nothing about job payments.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { sendError } = require('../utils/apiError');

// Statuses that mean the customer paid. Anything else (pending,
// invoice_sent, cancelled) is not a receipt.
const PAID_RENTAL_STATUSES = ['payment_confirmed', 'returned', 'completed'];
const PAID_JOB_PAYMENT_STATUSES = ['captured', 'released'];

function rentalReceipt(row) {
  return {
    kind: 'tool_rental',
    id: `rental-${row.id}`,
    bookingId: String(row.id),
    title: row.tool_name,
    amount: Number(row.total_price || 0),
    currency: 'usd',
    status: row.status,
    paidAt: row.payment_confirmed_at || row.created_at,
    startDate: row.start_date,
    endDate: row.end_date,
    invoiceNumber: row.invoice_number || null,
    invoiceStatus: row.invoice_status || null,
  };
}

function jobPaymentReceipt(row) {
  return {
    kind: 'helper_job',
    id: `job-payment-${row.id}`,
    jobId: String(row.job_id),
    bookingId: row.booking_id ? String(row.booking_id) : null,
    title: row.job_title,
    amount: Number(row.amount || 0),
    currency: row.currency || 'usd',
    status: row.status,
    paidAt: row.released_at || row.captured_at,
    paymentId: String(row.id),
  };
}

exports.listReceipts = async (req, res) => {
  try {
    const userId = req.user.id;
    const [rentals, jobPayments] = await Promise.all([
      pool.query(
        `SELECT b.id, b.total_price, b.status, b.start_date, b.end_date,
                b.payment_confirmed_at, b.created_at,
                tr.name AS tool_name,
                inv.invoice_number, inv.status AS invoice_status
           FROM tool_rentals_bookings b
           JOIN tool_rentals tr ON tr.id = b.tool_id
           LEFT JOIN tool_rental_invoices inv ON inv.booking_id = b.id
          WHERE b.customer_id = $1
            AND b.status = ANY($2::text[])`,
        [userId, PAID_RENTAL_STATUSES],
      ),
      pool.query(
        `SELECT p.id, p.job_id, p.amount, p.currency, p.status,
                p.captured_at, p.released_at,
                j.title AS job_title,
                br.id AS booking_id
           FROM payments p
           JOIN jobs j ON j.id = p.job_id
           LEFT JOIN booking_requests br ON br.converted_to_job_id = j.id
          WHERE p.payer_id = $1
            AND p.status = ANY($2::text[])`,
        [userId, PAID_JOB_PAYMENT_STATUSES],
      ),
    ]);
    const receipts = [
      ...rentals.rows.map(rentalReceipt),
      ...jobPayments.rows.map(jobPaymentReceipt),
    ].sort((a, b) => new Date(b.paidAt || 0) - new Date(a.paidAt || 0));
    return res.json({ success: true, data: receipts });
  } catch (err) {
    logger.error('Error listing receipts', { error: err.message });
    return sendError(res, 500, 'Failed to load receipts');
  }
};

exports.getHelperBookingReceipt = async (req, res) => {
  try {
    const userId = req.user.id;
    const { bookingId } = req.params;
    const { rows } = await pool.query(
      `SELECT br.id, br.service_name, br.requested_date,
              br.customer_id, br.converted_to_job_id,
              u.first_name AS helper_first_name, u.last_name AS helper_last_name
         FROM booking_requests br
         JOIN users u ON u.id = br.helper_id
        WHERE br.id = $1`,
      [bookingId],
    );
    const booking = rows[0];
    // A stranger gets the same 404 as a missing booking: the existence
    // of another customer's booking (and whether it has a receipt) is
    // not something a non-booker may learn.
    if (!booking || String(booking.customer_id) !== String(userId)) {
      return sendError(res, 404, 'Booking not found', 'not_found');
    }
    if (!booking.converted_to_job_id) {
      return sendError(res, 404, 'No receipt is available for this booking yet', 'receipt_not_available');
    }
    const { rows: paymentRows } = await pool.query(
      `SELECT p.id, p.job_id, p.amount, p.currency, p.status,
              p.captured_at, p.released_at,
              j.title AS job_title
         FROM payments p
         JOIN jobs j ON j.id = p.job_id
        WHERE p.job_id = $1
          AND p.payer_id = $2
          AND p.status = ANY($3::text[])
        ORDER BY p.captured_at DESC NULLS LAST
        LIMIT 1`,
      [booking.converted_to_job_id, userId, PAID_JOB_PAYMENT_STATUSES],
    );
    const payment = paymentRows[0];
    if (!payment) {
      return sendError(res, 404, 'No receipt is available for this booking yet', 'receipt_not_available');
    }
    return res.json({
      success: true,
      data: {
        kind: 'helper_job',
        id: `job-payment-${payment.id}`,
        bookingId: String(booking.id),
        jobId: String(payment.job_id),
        serviceName: booking.service_name,
        requestedDate: booking.requested_date,
        helperName: [booking.helper_first_name, booking.helper_last_name].filter(Boolean).join(' ') || null,
        title: payment.job_title,
        amount: Number(payment.amount || 0),
        currency: payment.currency || 'usd',
        status: payment.status,
        paidAt: payment.released_at || payment.captured_at,
        paymentId: String(payment.id),
      },
    });
  } catch (err) {
    logger.error('Error fetching helper booking receipt', { error: err.message });
    return sendError(res, 500, 'Failed to fetch receipt');
  }
};
