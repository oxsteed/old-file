'use strict';

// Group 9 Slice F (item 490): the OxSteed-generated delivery receipt.
//
// The detail page linked only the Stripe payment receipt
// (receipt_url on the payment row): a payment receipt, not a
// proof-of-delivery document, and the driver had no receipt surface
// at all. This receipt is generated from the job record itself —
// reference, route, dates, pieces, driver, proof-of-delivery
// reference, amounts paid — and is offered IN ADDITION to the Stripe
// link, never instead of it. PDFKit is already a server dependency
// (credit/settlement statements), so no new renderer was introduced.
// Money never moves here: this is a read-only rendering of rows that
// already exist, and the endpoint fails closed for non-participants.

const PDFDocument = require('pdfkit');

function money(cents, currency = 'USD') {
  const value = Number(cents || 0);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(value / 100);
  } catch {
    return `${(value / 100).toFixed(2)} ${currency || 'USD'}`;
  }
}

function date(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—';
}

function safe(value, max = 200) {
  return String(value ?? '—').replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, max);
}

// The receipt data, assembled from the job record and its money and
// proof rows. Exported for the endpoint and the tests: the PDF is a
// rendering of exactly this object, nothing else.
async function buildDeliveryReceiptData(db, jobId) {
  const { rows: [job] } = await db.query(
    `SELECT j.*,
            COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS driver_name,
            u.email AS driver_email
       FROM delivery_jobs j
       LEFT JOIN users u ON u.id = COALESCE(j.helper_user_id, j.internal_driver_user_id)
      WHERE j.id = $1`,
    [jobId],
  );
  if (!job) return null;
  const [payments, extras, proofs] = await Promise.all([
    db.query(
      `SELECT id, amount_cents, currency, status, receipt_url, refunded_amount_cents, created_at
         FROM delivery_payments WHERE delivery_job_id = $1 ORDER BY created_at ASC`,
      [jobId],
    ),
    db.query(
      `SELECT id, category, amount_cents, approved_amount_cents, status, notes
         FROM delivery_extras WHERE delivery_job_id = $1 AND status = 'approved' ORDER BY created_at ASC`,
      [jobId],
    ),
    db.query(
      `SELECT id, proof_type, verification_status, verified_at, recipient_name
         FROM delivery_proofs WHERE delivery_job_id = $1 AND verification_status = 'verified'
        ORDER BY verified_at DESC, id DESC LIMIT 1`,
      [jobId],
    ),
  ]);
  const paidCents = payments.rows
    .filter((payment) => ['paid', 'captured'].includes(payment.status))
    .reduce((sum, payment) => sum + Number(payment.amount_cents || 0), 0);
  // delivery_jobs carries no currency column (only quotes and payments
  // do); the receipt uses the payment currency, else USD.
  const currency = payments.rows[0]?.currency || 'USD';
  const refundedCents = payments.rows
    .reduce((sum, payment) => sum + Number(payment.refunded_amount_cents || 0), 0);
  const extrasCents = extras.rows
    .reduce((sum, extra) => sum + Number(extra.approved_amount_cents || extra.amount_cents || 0), 0);
  return {
    reference: job.reference,
    status: job.status,
    currency,
    origin: [job.origin_address, job.origin_city, job.origin_state, job.origin_country].filter(Boolean).join(', '),
    destination: [job.destination_address, job.destination_city, job.destination_state, job.destination_country].filter(Boolean).join(', '),
    distanceMiles: job.distance_miles == null ? null : Number(job.distance_miles),
    pieces: job.pieces,
    weightLbs: job.weight_lbs == null ? null : Number(job.weight_lbs),
    packageType: job.package_type,
    createdAt: job.created_at,
    pickedUpAt: job.picked_up_at,
    deliveredAt: job.delivered_at,
    driverName: job.driver_name || null,
    driverEmail: job.driver_email || null,
    proof: proofs.rows[0] ? {
      id: proofs.rows[0].id,
      type: proofs.rows[0].proof_type,
      verifiedAt: proofs.rows[0].verified_at,
      recipientName: proofs.rows[0].recipient_name,
    } : null,
    customerTotalCents: Number(job.customer_total_cents || 0),
    driverPayoutCents: Number(job.driver_payout_cents || 0),
    extrasCents,
    extras: extras.rows.map((extra) => ({
      category: extra.category, amountCents: Number(extra.approved_amount_cents || extra.amount_cents || 0),
      notes: extra.notes,
    })),
    paidCents,
    refundedCents,
    payments: payments.rows.map((payment) => ({
      status: payment.status, amountCents: Number(payment.amount_cents || 0),
      refundedCents: Number(payment.refunded_amount_cents || 0),
      stripeReceiptUrl: payment.receipt_url || null,
    })),
    generatedAt: new Date().toISOString(),
  };
}

function renderDeliveryReceiptPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `OxSteed delivery receipt ${data.reference}` } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text('OxSteed Delivery Receipt', { underline: false });
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Reference: ${safe(data.reference)}`);
    doc.text(`Status: ${safe(data.status)}`);
    doc.text(`Generated: ${date(data.generatedAt)}`);
    doc.moveDown();
    doc.fontSize(13).text('Route');
    doc.fontSize(11).text(`From: ${safe(data.origin)}`);
    doc.text(`To: ${safe(data.destination)}`);
    if (data.distanceMiles != null) doc.text(`Distance: ${data.distanceMiles} miles`);
    doc.text(`Pieces: ${data.pieces}${data.weightLbs != null ? `  ·  Weight: ${data.weightLbs} lb` : ''}`);
    doc.text(`Package: ${safe(data.packageType)}`);
    doc.moveDown();
    doc.fontSize(13).text('Dates');
    doc.fontSize(11).text(`Booked: ${date(data.createdAt)}`);
    doc.text(`Picked up: ${date(data.pickedUpAt)}`);
    doc.text(`Delivered: ${date(data.deliveredAt)}`);
    doc.moveDown();
    doc.fontSize(13).text('Driver');
    doc.fontSize(11).text(data.driverName ? `${safe(data.driverName)}${data.driverEmail ? ` (${safe(data.driverEmail)})` : ''}` : '—');
    doc.moveDown();
    doc.fontSize(13).text('Proof of delivery');
    if (data.proof) {
      doc.fontSize(11).text(`Proof #${data.proof.id} · ${safe(data.proof.type)} · verified ${date(data.proof.verifiedAt)}`);
      if (data.proof.recipientName) doc.text(`Recipient: ${safe(data.proof.recipientName)}`);
    } else {
      doc.fontSize(11).text('No verified proof of delivery on record.');
    }
    doc.moveDown();
    doc.fontSize(13).text('Amounts');
    doc.fontSize(11).text(`Delivery total: ${money(data.customerTotalCents, data.currency)}`);
    for (const extra of data.extras) {
      doc.text(`Extra (${safe(extra.category)}): ${money(extra.amountCents, data.currency)}${extra.notes ? ` — ${safe(extra.notes, 120)}` : ''}`);
    }
    doc.text(`Paid by customer: ${money(data.paidCents, data.currency)}`);
    if (data.refundedCents > 0) doc.text(`Refunded: ${money(data.refundedCents, data.currency)}`);
    doc.text(`Driver payout: ${money(data.driverPayoutCents, data.currency)}`);
    doc.moveDown();
    doc.fontSize(10).fillColor('#536475')
      .text('This receipt is generated from the OxSteed delivery record. The Stripe payment receipt, where one exists, is linked separately on the delivery detail page.');
    doc.end();
  });
}

module.exports = { buildDeliveryReceiptData, renderDeliveryReceiptPdf };
