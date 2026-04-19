// Invoice email templates and sending logic
const { sendEmail } = require('./email');
const logger = require('./logger');
const QRCode = require('qrcode');

/**
 * Generate HTML email template for invoice
 * @param {Object} invoice - Invoice record with details
 * @param {string} qrCodeDataUrl - Base64 encoded QR code image
 * @returns {string} HTML email content
 */
function renderInvoiceHTML(invoice, qrCodeDataUrl) {
  const ownerName = `${invoice.owner_first} ${invoice.owner_last}`;
  const customerName = `${invoice.customer_first} ${invoice.customer_last}`;
  const paymentMethodDisplay = formatPaymentMethod(invoice.payment_type, invoice.payment_identifier);

  return `
    <!DOCTYPE html>
    <html style="font-family: Arial, sans-serif;">
      <head>
        <style>
          body { margin: 0; padding: 20px; background-color: #f5f5f5; }
          .invoice-container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
          .invoice-header { border-bottom: 2px solid #2563eb; padding-bottom: 20px; margin-bottom: 30px; }
          .invoice-title { font-size: 28px; font-weight: bold; color: #1e40af; margin: 0 0 10px 0; }
          .invoice-number { color: #666; font-size: 14px; }
          .invoice-section { margin-bottom: 30px; }
          .invoice-section-title { font-size: 14px; font-weight: bold; color: #1e40af; text-transform: uppercase; margin-bottom: 12px; }
          .invoice-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
          .invoice-row.total { border-bottom: 2px solid #2563eb; font-weight: bold; font-size: 16px; padding: 16px 0; }
          .invoice-label { color: #666; }
          .invoice-value { text-align: right; }
          .payment-info { background-color: #f0f4ff; padding: 16px; border-radius: 6px; margin: 20px 0; }
          .qr-code-section { text-align: center; margin: 30px 0; }
          .qr-code-section img { max-width: 200px; }
          .footer-text { font-size: 12px; color: #999; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          .warning-box { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; font-size: 13px; color: #856404; }
        </style>
      </head>
      <body>
        <div class="invoice-container">
          <div class="invoice-header">
            <div class="invoice-title">INVOICE</div>
            <div class="invoice-number">Invoice #${invoice.invoice_number}</div>
            <div class="invoice-number" style="margin-top: 4px;">Date: ${new Date(invoice.created_at).toLocaleDateString()}</div>
          </div>

          <div class="invoice-section">
            <div class="invoice-section-title">Billing Information</div>
            <div style="padding: 12px 0;">
              <strong>${customerName}</strong><br/>
              <a href="mailto:${invoice.customer_email}" style="color: #2563eb; text-decoration: none;">${invoice.customer_email}</a>
            </div>
          </div>

          <div class="invoice-section">
            <div class="invoice-section-title">Tool Owner</div>
            <div style="padding: 12px 0;">
              <strong>${ownerName}</strong><br/>
              <a href="mailto:${invoice.owner_email}" style="color: #2563eb; text-decoration: none;">${invoice.owner_email}</a>
            </div>
          </div>

          <div class="invoice-section">
            <div class="invoice-section-title">Rental Details</div>
            <div class="invoice-row">
              <span class="invoice-label">Tool:</span>
              <span class="invoice-value"><strong>${invoice.tool_name}</strong></span>
            </div>
            <div class="invoice-row">
              <span class="invoice-label">Rental Period:</span>
              <span class="invoice-value">${new Date(invoice.start_date).toLocaleDateString()} — ${new Date(invoice.end_date).toLocaleDateString()}</span>
            </div>
            <div class="invoice-row">
              <span class="invoice-label">Daily Rate:</span>
              <span class="invoice-value">$${parseFloat(invoice.daily_rate).toFixed(2)}/day</span>
            </div>
            <div class="invoice-row total">
              <span class="invoice-label">Total Amount:</span>
              <span class="invoice-value">$${parseFloat(invoice.total_amount).toFixed(2)}</span>
            </div>
          </div>

          <div class="invoice-section">
            <div class="invoice-section-title">Payment Instructions</div>
            <div class="payment-info">
              <strong>Payment Method:</strong> ${paymentMethodDisplay.display}<br/>
              <strong>Account:</strong> ${paymentMethodDisplay.masked}<br/>
              <strong>Amount Due:</strong> $${parseFloat(invoice.total_amount).toFixed(2)}
            </div>

            <div class="qr-code-section">
              <p style="margin: 0 0 12px 0; color: #666; font-size: 14px;">Scan QR code to pay:</p>
              <img src="${qrCodeDataUrl}" alt="Payment QR Code" />
            </div>

            <p style="text-align: center; color: #666; font-size: 13px;">
              Or make payment directly to the account details above.
            </p>
          </div>

          <div class="warning-box">
            <strong style="display: block; margin-bottom: 8px;">Important:</strong>
            This invoice is issued by the tool owner. OxSteed is a technology platform that facilitates the connection but does not control rental disputes. If you have issues with the rental, please contact the owner directly or resolve via your bank's chargeback process.
          </div>

          <div class="footer-text">
            <p style="margin: 0;">This is an automated message. Please do not reply to this email.</p>
            <p style="margin: 8px 0 0 0;">For questions, contact <a href="mailto:support@oxsteed.com" style="color: #2563eb; text-decoration: none;">support@oxsteed.com</a></p>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Generate plain text version of invoice email
 */
function renderInvoiceText(invoice) {
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
Rental Period: ${new Date(invoice.start_date).toLocaleDateString()} — ${new Date(invoice.end_date).toLocaleDateString()}
Daily Rate: $${parseFloat(invoice.daily_rate).toFixed(2)}/day

TOTAL: $${parseFloat(invoice.total_amount).toFixed(2)}

PAYMENT METHOD:
Account: ${invoice.payment_identifier}

This invoice is issued by the tool owner. OxSteed is a technology platform that facilitates rentals but does not control disputes. Contact the owner directly or resolve via your bank's chargeback process.

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
      const html = renderInvoiceHTML(invoice, qrCodeDataUrl);
      const text = renderInvoiceText(invoice);

      // Send email
      const result = await sendEmail({
        to: recipientEmail,
        subject: `Invoice #${invoice.invoice_number} - OxSteed Tool Rental`,
        text,
        html,
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
