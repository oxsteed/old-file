const db = require('../db');
const logger = require('../utils/logger');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const { Readable } = require('stream');
const crypto = require('crypto');

const generateInvoiceNumber = async () => {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
  const randomBytes = crypto.randomInt(10000, 99999).toString();
  return `INV-${dateStr}-${randomBytes}`;
};

const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const createInvoice = async (req, res) => {
  const client = await db.connect();
  try {
    const { bookingId, deliveryMethod, recipientEmail } = req.body;
    const idempotencyKey = req.get('Idempotency-Key') || req.body.idempotencyKey;
    const ownerId = req.user.id;

    // Validate idempotency key is present and is valid UUID format
    if (!idempotencyKey) {
      return res.status(400).json({ error: 'Idempotency-Key header required' });
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(idempotencyKey)) {
      return res.status(400).json({ error: 'Invalid Idempotency-Key format (must be UUID)' });
    }

    // Validate delivery method
    if (!['in_platform', 'email'].includes(deliveryMethod)) {
      return res.status(400).json({ error: 'Invalid delivery method' });
    }

    if (deliveryMethod === 'email') {
      if (!recipientEmail) {
        return res.status(400).json({ error: 'Email required for email delivery' });
      }
      if (!validateEmail(recipientEmail)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
    }

    // Check for existing invoice with same idempotency key (for this booking)
    const existingResult = await client.query(
      `SELECT * FROM tool_rental_invoices WHERE booking_id = $1 AND idempotency_key = $2`,
      [bookingId, idempotencyKey]
    );

    if (existingResult.rows[0]) {
      // Idempotent: return existing invoice with 202 Accepted
      client.release();
      const existingInvoice = existingResult.rows[0];
      return res.status(202).json({
        invoiceId: existingInvoice.id,
        invoiceNumber: existingInvoice.invoice_number,
        status: existingInvoice.status,
        deliveryMethod,
        isRetry: true
      });
    }

    // Get booking details + owner email
    const bookingResult = await client.query(
      `SELECT trb.*, tr.name, tr.daily_rate, cu.email as customer_email, cu.first_name,
              ou.email as owner_email
       FROM tool_rentals_bookings trb
       JOIN tool_rentals tr ON trb.tool_id = tr.id
       JOIN users cu ON trb.customer_id = cu.id
       JOIN users ou ON trb.owner_id = ou.id
       WHERE trb.id = $1 AND trb.owner_id = $2`,
      [bookingId, ownerId]
    );

    if (!bookingResult.rows[0]) {
      client.release();
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];

    // Verify booking status is pending (no invoice sent yet)
    if (booking.status !== 'pending') {
      client.release();
      return res.status(400).json({ error: 'Invoice already sent for this booking' });
    }

    // Get owner's payment method
    const paymentResult = await client.query(
      `SELECT payment_type, payment_identifier FROM owner_payment_methods WHERE owner_id = $1`,
      [ownerId]
    );

    if (!paymentResult.rows[0]) {
      client.release();
      return res.status(400).json({ error: 'Payment method not configured' });
    }

    const payment = paymentResult.rows[0];

    // Start transaction
    await client.query('BEGIN');

    // Create invoice record
    const invoiceNumber = await generateInvoiceNumber();
    const invoiceResult = await client.query(
      `INSERT INTO tool_rental_invoices
       (booking_id, invoice_number, customer_id, owner_id, tool_id, start_date, end_date, daily_rate, total_amount, payment_type, payment_identifier, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        bookingId,
        invoiceNumber,
        booking.customer_id,
        ownerId,
        booking.tool_id,
        booking.start_date,
        booking.end_date,
        booking.daily_rate,
        booking.total_price,
        payment.payment_type,
        payment.payment_identifier,
        idempotencyKey
      ]
    );

    const invoice = invoiceResult.rows[0];

    // Log delivery
    await client.query(
      `INSERT INTO invoice_delivery_log (invoice_id, delivery_method, recipient_email, sender_email, delivery_status)
       VALUES ($1, $2, $3, $4, 'sent')`,
      [invoice.id, deliveryMethod, recipientEmail || booking.customer_email, booking.owner_email]
    );

    // Update booking status
    await client.query(
      `UPDATE tool_rentals_bookings SET status = 'invoice_sent', invoice_sent_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [bookingId]
    );

    await client.query('COMMIT');

    client.release();

    res.json({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      status: 'sent',
      deliveryMethod
    });

    logger.info('Invoice created and sent', {
      invoiceId: invoice.id,
      bookingId,
      deliveryMethod
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    logger.error('createInvoice error', { err });
    res.status(500).json({ error: 'Failed to create invoice' });
  }
};

const getInvoice = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const userId = req.user.id;

    const result = await db.query(
      `SELECT tri.*, tr.name, u.first_name, u.last_name
       FROM tool_rental_invoices tri
       JOIN tool_rentals tr ON tri.tool_id = tr.id
       JOIN users u ON tri.owner_id = u.id
       WHERE tri.id = $1 AND (tri.customer_id = $2 OR tri.owner_id = $2)`,
      [invoiceId, userId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = result.rows[0];

    // Mark as viewed if customer
    if (invoice.customer_id === userId && invoice.status === 'sent') {
      await db.query(
        `UPDATE invoice_delivery_log SET read_at = CURRENT_TIMESTAMP WHERE invoice_id = $1 AND delivery_method = 'in_platform'`,
        [invoiceId]
      );
      await db.query(
        `UPDATE tool_rental_invoices SET status = 'viewed' WHERE id = $1`,
        [invoiceId]
      );
      invoice.status = 'viewed';
    }

    res.json(invoice);
  } catch (err) {
    logger.error('getInvoice error', { err });
    res.status(500).json({ error: 'Failed to load invoice' });
  }
};

const generateInvoicePDF = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const userId = req.user.id;

    const result = await db.query(
      `SELECT tri.*, tr.name as tool_name, tr.daily_rate,
              uo.first_name as owner_first, uo.last_name as owner_last, uo.email as owner_email,
              uc.first_name as customer_first, uc.last_name as customer_last, uc.email as customer_email
       FROM tool_rental_invoices tri
       JOIN tool_rentals tr ON tri.tool_id = tr.id
       JOIN users uo ON tri.owner_id = uo.id
       JOIN users uc ON tri.customer_id = uc.id
       WHERE tri.id = $1 AND (tri.customer_id = $2 OR tri.owner_id = $2)`,
      [invoiceId, userId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = result.rows[0];

    // Generate QR code with properly encoded payment link
    const baseUrl = process.env.CLIENT_URL || 'https://oxsteed.com';
    const paymentLink = `${baseUrl}/pay/${encodeURIComponent(invoice.payment_type)}/${encodeURIComponent(invoice.payment_identifier)}`;
    const qrCodeDataUrl = await QRCode.toDataURL(paymentLink);

    // Create PDF
    const doc = new PDFDocument();
    const stream = new Readable();
    doc.pipe(stream);

    // Header
    doc.fontSize(24).font('Helvetica-Bold').text('INVOICE', { align: 'left' });
    doc.fontSize(10).font('Helvetica').text(`Invoice #: ${invoice.invoice_number}`, { align: 'left' });
    doc.text(`Date: ${new Date(invoice.created_at).toLocaleDateString()}`, { align: 'left' });

    doc.moveTo(50, 100).lineTo(550, 100).stroke();

    // OxSteed info
    doc.fontSize(10).text('OxSteed - Tool Rental Marketplace', 50, 110);
    doc.text('Technology Facilitator', { underline: false });

    // Billing info
    doc.fontSize(10).font('Helvetica-Bold').text('BILL TO:', 50, 160);
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(`${invoice.customer_first} ${invoice.customer_last}`, 50, 180)
      .text(invoice.customer_email, { link: `mailto:${invoice.customer_email}` });

    // Owner info
    doc.fontSize(10).font('Helvetica-Bold').text('FROM:', 300, 160);
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(`${invoice.owner_first} ${invoice.owner_last}`, 300, 180)
      .text(invoice.owner_email, { link: `mailto:${invoice.owner_email}` });

    // Invoice details
    doc.moveTo(50, 240).lineTo(550, 240).stroke();
    doc.fontSize(10).font('Helvetica-Bold').text('RENTAL DETAILS', 50, 250);

    const table = {
      x: 50,
      y: 280,
      width: 500,
      rows: [
        {
          cells: [
            { text: 'Tool', width: 200, bold: true },
            { text: 'Start Date', width: 100, bold: true },
            { text: 'End Date', width: 100, bold: true },
            { text: 'Rate', width: 100, bold: true }
          ]
        },
        {
          cells: [
            { text: invoice.tool_name, width: 200 },
            { text: new Date(invoice.start_date).toLocaleDateString(), width: 100 },
            { text: new Date(invoice.end_date).toLocaleDateString(), width: 100 },
            { text: `$${invoice.daily_rate}/day`, width: 100 }
          ]
        }
      ]
    };

    // Simple table rendering
    let y = table.y;
    table.rows.forEach((row, idx) => {
      doc.fontSize(10);
      if (idx === 0) doc.font('Helvetica-Bold');
      else doc.font('Helvetica');

      let x = table.x;
      row.cells.forEach(cell => {
        doc.text(cell.text, x, y, { width: cell.width });
        x += cell.width;
      });
      y += 25;
    });

    // Total
    doc.moveTo(50, y + 10).lineTo(550, y + 10).stroke();
    doc.fontSize(14).font('Helvetica-Bold').text(`TOTAL: $${invoice.total_amount.toFixed(2)}`, 350, y + 20);

    // QR Code section
    doc.fontSize(10).font('Helvetica-Bold').text('PAYMENT INSTRUCTIONS', 50, y + 80);
    doc
      .fontSize(9)
      .font('Helvetica')
      .text(`Payment Method: ${invoice.payment_type.toUpperCase()}`, 50, y + 105)
      .text(`Account: ${invoice.payment_identifier}`, 50, y + 125)
      .text('Scan QR code below to pay:', 50, y + 150);

    // Add QR code image
    const qrSize = 150;
    const qrX = 50;
    const qrY = y + 170;
    doc.image(Buffer.from(qrCodeDataUrl.split(',')[1], 'base64'), qrX, qrY, { width: qrSize });

    // Terms section
    doc.fontSize(8).font('Helvetica').text(
      'This invoice is issued by the tool owner. Both parties agree that OxSteed is a technology facilitator only and does not control user behavior. Disputes should be resolved through your bank\'s chargeback process.',
      50,
      y + 350,
      { width: 500 }
    );

    doc.end();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoice_number}.pdf"`);

    stream.pipe(res);

    stream.on('data', chunk => {
      res.write(chunk);
    });

    stream.on('end', () => {
      res.end();
    });

    logger.info('Invoice PDF generated', { invoiceId, invoiceNumber: invoice.invoice_number });
  } catch (err) {
    logger.error('generateInvoicePDF error', { err });
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
};

const confirmPayment = async (req, res) => {
  const client = await db.connect();
  try {
    const { invoiceId } = req.params;
    const ownerId = req.user.id;

    const invoiceResult = await client.query(
      `SELECT tri.*, trb.status as booking_status
       FROM tool_rental_invoices tri
       JOIN tool_rentals_bookings trb ON tri.booking_id = trb.id
       WHERE tri.id = $1 AND tri.owner_id = $2`,
      [invoiceId, ownerId]
    );

    if (!invoiceResult.rows[0]) {
      client.release();
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invoiceResult.rows[0];

    // Prevent double-confirmation
    if (invoice.status === 'payment_confirmed') {
      client.release();
      return res.status(400).json({ error: 'Payment already confirmed' });
    }

    // Ensure booking is in correct state
    if (invoice.booking_status !== 'invoice_sent') {
      client.release();
      return res.status(400).json({ error: 'Booking is not in correct state for payment confirmation' });
    }

    // Transaction for atomicity
    await client.query('BEGIN');

    // Update invoice status
    await client.query(
      `UPDATE tool_rental_invoices SET status = 'payment_confirmed', payment_confirmed_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [invoiceId]
    );

    // Update booking status (immutable after this)
    await client.query(
      `UPDATE tool_rentals_bookings SET status = 'payment_confirmed', payment_confirmed_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [invoice.booking_id]
    );

    await client.query('COMMIT');
    client.release();

    res.json({ status: 'payment_confirmed', invoiceId });

    logger.info('Payment confirmed', { invoiceId, bookingId: invoice.booking_id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    logger.error('confirmPayment error', { err });
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
};

module.exports = { createInvoice, getInvoice, generateInvoicePDF, confirmPayment };
