// Invoice email templates and sending logic
const { sendEmail } = require('./email');
const logger = require('./logger');
const QRCode = require('qrcode');
const escapeHtml = require('./escapeHtml');
const { renderOxSteedEmail } = require('./emailTemplate');

/**
 * Generate HTML email template for invoice
 * @param {Object} invoice - Invoice record with details
 * @param {string} qrCodeDataUrl - Base64 encoded QR code image
 * @returns {string} HTML email content
 */
function renderInvoiceHTML(invoice, qrCodeDataUrl, paymentLink = '') {
  const ownerName = `${invoice.owner_first || ''} ${invoice.owner_last || ''}`.trim();
  const customerName = `${invoice.customer_first || ''} ${invoice.customer_last || ''}`.trim();
  const paymentMethodDisplay = formatPaymentMethod(invoice.payment_type, invoice.payment_identifier);
  const invoiceNumber = invoice.invoice_number || invoice.id || '';
  const createdDate = new Date(invoice.created_at).toLocaleDateString();
  const startDate = new Date(invoice.start_date).toLocaleDateString();
  const endDate = new Date(invoice.end_date).toLocaleDateString();
  const dailyRate = Number.parseFloat(invoice.daily_rate || 0).toFixed(2);
  const totalAmount = Number.parseFloat(invoice.total_amount || 0).toFixed(2);
  const safeQrCode = escapeHtml(qrCodeDataUrl || '');
  const bodyHtml = `<p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.65;">Invoice <strong>#${escapeHtml(invoiceNumber)}</strong> was issued on ${escapeHtml(createdDate)}.</p><h2 style="margin:24px 0 10px;color:#0f172a;font-size:17px;">Billing information</h2><p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.6;"><strong>${escapeHtml(customerName)}</strong><br><a href="mailto:${escapeHtml(invoice.customer_email || '')}" style="color:#c2410c;">${escapeHtml(invoice.customer_email || '')}</a></p><h2 style="margin:24px 0 10px;color:#0f172a;font-size:17px;">Rental details</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;"><tr><td style="padding:9px 0;color:#64748b;">Tool</td><td style="padding:9px 0;text-align:right;color:#0f172a;font-weight:700;">${escapeHtml(invoice.tool_name || '')}</td></tr><tr><td style="padding:9px 0;color:#64748b;">Rental period</td><td style="padding:9px 0;text-align:right;color:#0f172a;">${escapeHtml(startDate)} – ${escapeHtml(endDate)}</td></tr><tr><td style="padding:9px 0;color:#64748b;">Daily rate</td><td style="padding:9px 0;text-align:right;color:#0f172a;">$${escapeHtml(dailyRate)}/day</td></tr><tr><td style="padding:12px 0;color:#0f172a;font-weight:700;">Total amount</td><td style="padding:12px 0;text-align:right;color:#c2410c;font-size:18px;font-weight:800;">$${escapeHtml(totalAmount)}</td></tr></table><h2 style="margin:24px 0 10px;color:#0f172a;font-size:17px;">Payment instructions</h2><p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.6;"><strong>Payment method:</strong> ${escapeHtml(paymentMethodDisplay.display)}<br><strong>Account:</strong> ${escapeHtml(paymentMethodDisplay.masked)}<br><strong>Amount due:</strong> $${escapeHtml(totalAmount)}</p><p style="margin:20px 0 8px;text-align:center;color:#64748b;font-size:14px;">Scan the QR code to pay:</p><p style="margin:0;text-align:center;"><img src="${safeQrCode}" alt="Payment QR code" width="200" style="display:inline-block;max-width:200px;height:auto;border:1px solid #e2e8f0;border-radius:8px;"></p>`;
  return renderOxSteedEmail({
    language: 'en',
    preheader: `Invoice #${invoiceNumber} from OxSteed`,
    eyebrow: 'OXSTEED INVOICE',
    title: `Invoice #${invoiceNumber}`,
    bodyHtml,
    bodyText: renderInvoiceText(invoice),
    notice: { title: 'Important', body: 'This invoice is issued by the tool owner. OxSteed facilitates the connection but does not control rental disputes.', tone: 'warning' },
    cta: paymentLink ? { label: 'Open secure payment page', url: paymentLink } : null,
    footerText: 'This is an automated message. For questions, contact support@oxsteed.com.',
  }).html;
}

/**
 * Generate plain text version of invoice email
 */
function renderInvoiceText(invoice, paymentLink = '') {
  const ownerName = `${invoice.owner_first} ${invoice.owner_last}`;
  const customerName = `${invoice.customer_first} ${invoice.customer_last}`;

  return `INVOICE
Invoice #: ${invoice.invoice_number}
Date: ${new Date(invoice.created_at).toLocaleDateString()}

BILL TO:
${customerName}
${invoice.customer_email}

FROM:
${ownerName}
${invoice.owner_email}

RENTAL DETAILS:
Tool: ${invoice.tool_name}
Rental Period: ${new Date(invoice.start_date).toLocaleDateString()} - ${new Date(invoice.end_date).toLocaleDateString()}
Daily Rate: $${parseFloat(invoice.daily_rate).toFixed(2)}/day

TOTAL: $${parseFloat(invoice.total_amount).toFixed(2)}

PAYMENT METHOD:
Account: ${invoice.payment_identifier}

This invoice is issued by the tool owner. OxSteed is a technology platform that facilitates rentals but does not control disputes. Contact the owner directly or resolve via your bank's chargeback process.

${paymentLink ? `\nSecure payment page: ${paymentLink}\n` : ''}
For questions: support@oxsteed.com`;
}

/**
 * Format payment method for display (with masking)
 */
function formatPaymentMethod(type, identifier) {
  let display = '';
  let masked = '';

  switch (type.toLowerCase()) {
    case 'cash_app':
      display = 'Cash App';
      masked = identifier.length > 4 ? '*'.repeat(identifier.length - 4) + identifier.slice(-4) : identifier;
      break;
    case 'venmo':
      display = 'Venmo';
      masked = identifier.length > 4 ? '*'.repeat(identifier.length - 4) + identifier.slice(-4) : identifier;
      break;
    case 'bank_transfer':
      display = 'Bank Transfer';
      masked = identifier.length > 4 ? identifier.slice(0, 4) + '*'.repeat(identifier.length - 8) + identifier.slice(-4) : identifier;
      break;
    default:
      display = type;
      masked = identifier;
  }

  return { display, masked };
}

/**
 * Send invoice email with retry logic
 * @param {Object} invoice - Invoice record
 * @param {string} recipientEmail - Recipient email address
 * @param {number} maxRetries - Maximum retry attempts (default: 3)
 * @returns {Promise<{success: boolean, error?: string, attempt: number}>}
 */
async function sendInvoiceEmail(invoice, recipientEmail, maxRetries = 3) {
  const CLIENT_URL = process.env.CLIENT_URL || 'https://oxsteed.com';
  const paymentLink = `${CLIENT_URL}/pay/${encodeURIComponent(invoice.payment_type)}/${encodeURIComponent(invoice.payment_identifier)}`;

  let lastError = null;
  let attempt = 0;

  for (attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Generate QR code (synchronously for simple retries)
      const qrCodeDataUrl = await QRCode.toDataURL(paymentLink);

      // Render email
      const html = renderInvoiceHTML(invoice, qrCodeDataUrl, paymentLink);
      const text = renderInvoiceText(invoice, paymentLink);

      // Send email
      const result = await sendEmail({
        to: recipientEmail,
        subject: `Invoice #${invoice.invoice_number} - OxSteed Tool Rental`,
        text,
        html,
        idempotencyKey: `invoice:${invoice.id || invoice.invoice_number}:${recipientEmail}`,
      });

      if (result.success) {
        logger.info('Invoice email sent successfully', {
          invoiceId: invoice.id,
          recipientEmail,
          attempt,
        });
        return { success: true, attempt };
      } else {
        lastError = result.error;
        logger.warn('Invoice email send failed, will retry', {
          invoiceId: invoice.id,
          recipientEmail,
          attempt,
          error: lastError,
        });

        // Exponential backoff: 1s, 2s, 4s
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt - 1) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    } catch (err) {
      lastError = err.message;
      logger.error('Invoice email send exception', {
        invoiceId: invoice.id,
        recipientEmail,
        attempt,
        error: err.message,
      });

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  logger.error('Invoice email send failed after retries', {
    invoiceId: invoice.id,
    recipientEmail,
    maxRetries,
    lastError,
  });

  return { success: false, error: lastError || 'Email send failed', attempt: maxRetries };
}

module.exports = {
  sendInvoiceEmail,
  renderInvoiceHTML,
  renderInvoiceText,
  formatPaymentMethod,
};
