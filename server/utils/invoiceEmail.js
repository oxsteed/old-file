// Invoice email templates and sending logic (localized: en, es, fr, ht, ar)
const { sendEmail } = require('./email');
const logger = require('./logger');
const QRCode = require('qrcode');
const escapeHtml = require('./escapeHtml');
const { renderOxSteedEmail, normalizeEmailLanguage } = require('./emailTemplate');

const EMAIL_LOCALE_TAGS = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  ht: 'ht-HT',
  ar: 'ar',
};

const FALLBACK_CURRENCY = 'USD';

// Per-language copy for every user-visible string in the invoice email.
// Brand/proper names (OxSteed, Cash App, Venmo, support@oxsteed.com) stay as-is.
const INVOICE_COPY = {
  en: {
    subject: (n) => `Invoice #${n} - OxSteed Tool Rental`,
    preheader: (n) => `Invoice #${n} from OxSteed`,
    eyebrow: 'OXSTEED INVOICE',
    title: (n) => `Invoice #${n}`,
    intro: (n, date) => `Invoice #${n} was issued on ${date}.`,
    sectionBilling: 'Billing information',
    sectionRental: 'Rental details',
    sectionPayment: 'Payment instructions',
    labelTool: 'Tool',
    labelRentalPeriod: 'Rental period',
    labelDailyRate: 'Daily rate',
    labelTotal: 'Total amount',
    perDay: '/day',
    labelPaymentMethod: 'Payment method',
    labelAccount: 'Account',
    labelAmountDue: 'Amount due',
    scanQr: 'Scan the QR code to pay:',
    qrAlt: 'Payment QR code',
    noticeTitle: 'Important',
    noticeBody: 'This invoice is issued by the tool owner. OxSteed facilitates the connection but does not control rental disputes.',
    ctaLabel: 'Open secure payment page',
    footer: 'This is an automated message. For questions, contact support@oxsteed.com.',
    textHeader: 'INVOICE',
    textInvoiceNumber: 'Invoice #:',
    textDate: 'Date',
    textBillTo: 'BILL TO:',
    textFrom: 'FROM:',
    textRentalDetails: 'RENTAL DETAILS:',
    textTool: 'Tool',
    textRentalPeriod: 'Rental Period',
    textDailyRate: 'Daily Rate',
    textTotal: 'TOTAL:',
    textPaymentMethod: 'PAYMENT METHOD:',
    textAccount: 'Account',
    textPaymentPage: 'Secure payment page',
    textQuestions: 'For questions',
    textDisclaimer: "This invoice is issued by the tool owner. OxSteed is a technology platform that facilitates rentals but does not control disputes. Contact the owner directly or resolve via your bank's chargeback process.",
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'Bank Transfer' },
  },
  es: {
    subject: (n) => `Factura n.º ${n} - Alquiler de herramientas OxSteed`,
    preheader: (n) => `Factura n.º ${n} de OxSteed`,
    eyebrow: 'FACTURA OXSTEED',
    title: (n) => `Factura n.º ${n}`,
    intro: (n, date) => `La factura n.º ${n} se emitió el ${date}.`,
    sectionBilling: 'Información de facturación',
    sectionRental: 'Detalles del alquiler',
    sectionPayment: 'Instrucciones de pago',
    labelTool: 'Herramienta',
    labelRentalPeriod: 'Período de alquiler',
    labelDailyRate: 'Tarifa diaria',
    labelTotal: 'Importe total',
    perDay: '/día',
    labelPaymentMethod: 'Método de pago',
    labelAccount: 'Cuenta',
    labelAmountDue: 'Importe a pagar',
    scanQr: 'Escanea el código QR para pagar:',
    qrAlt: 'Código QR de pago',
    noticeTitle: 'Importante',
    noticeBody: 'Esta factura la emite el propietario de la herramienta. OxSteed facilita la conexión, pero no interviene en las disputas de alquiler.',
    ctaLabel: 'Abrir la página de pago seguro',
    footer: 'Este es un mensaje automático. Si tienes preguntas, escribe a support@oxsteed.com.',
    textHeader: 'FACTURA',
    textInvoiceNumber: 'Factura n.º:',
    textDate: 'Fecha',
    textBillTo: 'FACTURAR A:',
    textFrom: 'DE:',
    textRentalDetails: 'DETALLES DEL ALQUILER:',
    textTool: 'Herramienta',
    textRentalPeriod: 'Período de alquiler',
    textDailyRate: 'Tarifa diaria',
    textTotal: 'TOTAL:',
    textPaymentMethod: 'MÉTODO DE PAGO:',
    textAccount: 'Cuenta',
    textPaymentPage: 'Página de pago seguro',
    textQuestions: 'Para preguntas',
    textDisclaimer: 'Esta factura la emite el propietario de la herramienta. OxSteed es una plataforma tecnológica que facilita los alquileres, pero no interviene en las disputas. Comunícate directamente con el propietario o resuélvelo mediante el proceso de devolución de tu banco.',
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'Transferencia bancaria' },
  },
  fr: {
    subject: (n) => `Facture n° ${n} - Location d'outils OxSteed`,
    preheader: (n) => `Facture n° ${n} d'OxSteed`,
    eyebrow: 'FACTURE OXSTEED',
    title: (n) => `Facture n° ${n}`,
    intro: (n, date) => `La facture n° ${n} a été émise le ${date}.`,
    sectionBilling: 'Informations de facturation',
    sectionRental: 'Détails de la location',
    sectionPayment: 'Instructions de paiement',
    labelTool: 'Outil',
    labelRentalPeriod: 'Période de location',
    labelDailyRate: 'Tarif journalier',
    labelTotal: 'Montant total',
    perDay: '/jour',
    labelPaymentMethod: 'Mode de paiement',
    labelAccount: 'Compte',
    labelAmountDue: 'Montant dû',
    scanQr: 'Scannez le code QR pour payer :',
    qrAlt: 'Code QR de paiement',
    noticeTitle: 'Important',
    noticeBody: "Cette facture est émise par le propriétaire de l'outil. OxSteed facilite la mise en relation mais ne gère pas les litiges de location.",
    ctaLabel: 'Ouvrir la page de paiement sécurisée',
    footer: 'Ceci est un message automatique. Pour toute question, écrivez à support@oxsteed.com.',
    textHeader: 'FACTURE',
    textInvoiceNumber: 'Facture n° :',
    textDate: 'Date',
    textBillTo: 'FACTURER À :',
    textFrom: 'DE :',
    textRentalDetails: 'DÉTAILS DE LA LOCATION :',
    textTool: 'Outil',
    textRentalPeriod: 'Période de location',
    textDailyRate: 'Tarif journalier',
    textTotal: 'TOTAL :',
    textPaymentMethod: 'MODE DE PAIEMENT :',
    textAccount: 'Compte',
    textPaymentPage: 'Page de paiement sécurisée',
    textQuestions: 'Pour toute question',
    textDisclaimer: "Cette facture est émise par le propriétaire de l'outil. OxSteed est une plateforme technologique qui facilite les locations, mais ne gère pas les litiges. Contactez directement le propriétaire ou passez par la procédure de contestation de votre banque.",
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'Virement bancaire' },
  },
  ht: {
    subject: (n) => `Fakti #${n} - Lokasyon zouti OxSteed`,
    preheader: (n) => `Fakti #${n} soti nan OxSteed`,
    eyebrow: 'FAKTI OXSTEED',
    title: (n) => `Fakti #${n}`,
    intro: (n, date) => `Fakti #${n} la te bay sou ${date}.`,
    sectionBilling: 'Enfòmasyon sou fakti a',
    sectionRental: 'Detay lokasyon an',
    sectionPayment: 'Enstriksyon peman',
    labelTool: 'Zouti',
    labelRentalPeriod: 'Peryòd lokasyon',
    labelDailyRate: 'To pa jou',
    labelTotal: 'Montan total',
    perDay: '/jou',
    labelPaymentMethod: 'Metòd peman',
    labelAccount: 'Kont',
    labelAmountDue: 'Montan pou peye',
    scanQr: 'Eskane kòd QR la pou peye:',
    qrAlt: 'Kòd QR peman',
    noticeTitle: 'Enpòtan',
    noticeBody: 'Se pwopriyetè zouti a ki bay fakti sa a. OxSteed fè koneksyon an posib, men li pa jere diskisyon sou lokasyon yo.',
    ctaLabel: 'Louvri paj peman sekirize a',
    footer: 'Sa a se yon mesaj otomatik. Pou kesyon, ekri support@oxsteed.com.',
    textHeader: 'FAKTI',
    textInvoiceNumber: 'Fakti #:',
    textDate: 'Dat',
    textBillTo: 'VOYE FAKTI A BAY:',
    textFrom: 'SOTI NAN:',
    textRentalDetails: 'DETAY LOKASYON AN:',
    textTool: 'Zouti',
    textRentalPeriod: 'Peryòd lokasyon',
    textDailyRate: 'To pa jou',
    textTotal: 'TOTAL:',
    textPaymentMethod: 'METÒD PEMAN:',
    textAccount: 'Kont',
    textPaymentPage: 'Paj peman sekirize',
    textQuestions: 'Pou kesyon',
    textDisclaimer: 'Se pwopriyetè zouti a ki bay fakti sa a. OxSteed se yon platfòm teknolojik ki fè lokasyon yo posib, men li pa jere diskisyon yo. Kontakte pwopriyetè a dirèkteman oswa rezoud pwoblèm nan atravè pwosesis chajbak bank ou a.',
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'Transfè labank' },
  },
  ar: {
    subject: (n) => `فاتورة رقم ${n} - تأجير أدوات OxSteed`,
    preheader: (n) => `فاتورة رقم ${n} من OxSteed`,
    eyebrow: 'فاتورة OXSTEED',
    title: (n) => `فاتورة رقم ${n}`,
    intro: (n, date) => `تم إصدار الفاتورة رقم ${n} بتاريخ ${date}.`,
    sectionBilling: 'معلومات الفوترة',
    sectionRental: 'تفاصيل التأجير',
    sectionPayment: 'تعليمات الدفع',
    labelTool: 'الأداة',
    labelRentalPeriod: 'فترة التأجير',
    labelDailyRate: 'السعر اليومي',
    labelTotal: 'المبلغ الإجمالي',
    perDay: '/يوم',
    labelPaymentMethod: 'طريقة الدفع',
    labelAccount: 'الحساب',
    labelAmountDue: 'المبلغ المستحق',
    scanQr: 'امسح رمز QR للدفع:',
    qrAlt: 'رمز QR للدفع',
    noticeTitle: 'مهم',
    noticeBody: 'هذه الفاتورة صادرة عن مالك الأداة. تسهل OxSteed التواصل، لكنها لا تتحكم في نزاعات التأجير.',
    ctaLabel: 'فتح صفحة الدفع الآمنة',
    footer: 'هذه رسالة تلقائية. للأسئلة، تواصل مع support@oxsteed.com.',
    textHeader: 'فاتورة',
    textInvoiceNumber: 'رقم الفاتورة:',
    textDate: 'التاريخ',
    textBillTo: 'فوترة إلى:',
    textFrom: 'من:',
    textRentalDetails: 'تفاصيل التأجير:',
    textTool: 'الأداة',
    textRentalPeriod: 'فترة التأجير',
    textDailyRate: 'السعر اليومي',
    textTotal: 'الإجمالي:',
    textPaymentMethod: 'طريقة الدفع:',
    textAccount: 'الحساب',
    textPaymentPage: 'صفحة الدفع الآمنة',
    textQuestions: 'للأسئلة',
    textDisclaimer: 'هذه الفاتورة صادرة عن مالك الأداة. OxSteed منصة تقنية تسهل عمليات التأجير، لكنها لا تتحكم في النزاعات. تواصل مع المالك مباشرة أو تابع عملية الاعتراض عبر مصرفك.',
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'تحويل بنكي' },
  },
};

function getInvoiceCopy(language) {
  const lang = normalizeEmailLanguage(language);
  return { lang, copy: INVOICE_COPY[lang] || INVOICE_COPY.en };
}

/**
 * Locale-aware date formatting for the invoice email.
 * Date-only strings (YYYY-MM-DD) are parsed as local calendar dates, not UTC
 * midnight, so the rendered day never shifts with the server timezone.
 */
function formatInvoiceDate(value, lang) {
  let date;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (m) {
    date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } else {
    date = new Date(value);
  }
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(EMAIL_LOCALE_TAGS[lang] || EMAIL_LOCALE_TAGS.en);
}

/**
 * Resolve the ISO 4217 currency code for an invoice row.
 * tool_rental_invoices has no currency column, so we use the recipient's
 * preferred_currency (users.preferred_currency, defaults to USD) when the
 * invoice row itself carries no currency_code.
 */
function resolveInvoiceCurrency(invoice) {
  const raw = String(invoice.currency_code || invoice.customer_currency || FALLBACK_CURRENCY).toUpperCase();
  return /^[A-Z]{3}$/.test(raw) ? raw : FALLBACK_CURRENCY;
}

/**
 * Format a money amount with the right locale and currency.
 * Falls back to the legacy "$X.XX" formatting if Intl cannot handle the code.
 */
function formatInvoiceMoney(amount, lang, currency) {
  const value = Number.parseFloat(amount || 0);
  const safeValue = Number.isFinite(value) ? value : 0;
  const tag = EMAIL_LOCALE_TAGS[lang] || EMAIL_LOCALE_TAGS.en;
  try {
    return new Intl.NumberFormat(tag, { style: 'currency', currency }).format(safeValue);
  } catch (err) {
    return `$${safeValue.toFixed(2)}`;
  }
}

/**
 * Generate HTML email template for invoice
 * @param {Object} invoice - Invoice record with details
 * @param {string} qrCodeDataUrl - Base64 encoded QR code image
 * @param {string} paymentLink - Secure payment page URL
 * @param {string} language - Recipient language code (en/es/fr/ht/ar), defaults to 'en'
 * @returns {string} HTML email content
 */
function renderInvoiceHTML(invoice, qrCodeDataUrl, paymentLink = '', language = 'en') {
  const { lang, copy } = getInvoiceCopy(language);
  const currency = resolveInvoiceCurrency(invoice);
  const ownerName = `${invoice.owner_first || ''} ${invoice.owner_last || ''}`.trim();
  const customerName = `${invoice.customer_first || ''} ${invoice.customer_last || ''}`.trim();
  const paymentMethodDisplay = formatPaymentMethod(invoice.payment_type, invoice.payment_identifier, lang);
  const invoiceNumber = invoice.invoice_number || invoice.id || '';
  const createdDate = formatInvoiceDate(invoice.created_at, lang);
  const startDate = formatInvoiceDate(invoice.start_date, lang);
  const endDate = formatInvoiceDate(invoice.end_date, lang);
  const dailyRate = formatInvoiceMoney(invoice.daily_rate, lang, currency);
  const totalAmount = formatInvoiceMoney(invoice.total_amount, lang, currency);
  const safeQrCode = escapeHtml(qrCodeDataUrl || '');
  const bodyHtml = `<p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.65;">${escapeHtml(copy.intro(invoiceNumber, createdDate))}</p><h2 style="margin:24px 0 10px;color:#0f172a;font-size:17px;">${escapeHtml(copy.sectionBilling)}</h2><p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.6;"><strong>${escapeHtml(customerName)}</strong><br><a href="mailto:${escapeHtml(invoice.customer_email || '')}" style="color:#c2410c;">${escapeHtml(invoice.customer_email || '')}</a></p><h2 style="margin:24px 0 10px;color:#0f172a;font-size:17px;">${escapeHtml(copy.sectionRental)}</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;"><tr><td style="padding:9px 0;color:#64748b;">${escapeHtml(copy.labelTool)}</td><td style="padding:9px 0;text-align:right;color:#0f172a;font-weight:700;">${escapeHtml(invoice.tool_name || '')}</td></tr><tr><td style="padding:9px 0;color:#64748b;">${escapeHtml(copy.labelRentalPeriod)}</td><td style="padding:9px 0;text-align:right;color:#0f172a;">${escapeHtml(startDate)} – ${escapeHtml(endDate)}</td></tr><tr><td style="padding:9px 0;color:#64748b;">${escapeHtml(copy.labelDailyRate)}</td><td style="padding:9px 0;text-align:right;color:#0f172a;">${escapeHtml(dailyRate)}${escapeHtml(copy.perDay)}</td></tr><tr><td style="padding:12px 0;color:#0f172a;font-weight:700;">${escapeHtml(copy.labelTotal)}</td><td style="padding:12px 0;text-align:right;color:#c2410c;font-size:18px;font-weight:800;">${escapeHtml(totalAmount)}</td></tr></table><h2 style="margin:24px 0 10px;color:#0f172a;font-size:17px;">${escapeHtml(copy.sectionPayment)}</h2><p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.6;"><strong>${escapeHtml(copy.labelPaymentMethod)}:</strong> ${escapeHtml(paymentMethodDisplay.display)}<br><strong>${escapeHtml(copy.labelAccount)}:</strong> ${escapeHtml(paymentMethodDisplay.masked)}<br><strong>${escapeHtml(copy.labelAmountDue)}:</strong> ${escapeHtml(totalAmount)}</p><p style="margin:20px 0 8px;text-align:center;color:#64748b;font-size:14px;">${escapeHtml(copy.scanQr)}</p><p style="margin:0;text-align:center;"><img src="${safeQrCode}" alt="${escapeHtml(copy.qrAlt)}" width="200" style="display:inline-block;max-width:200px;height:auto;border:1px solid #e2e8f0;border-radius:8px;"></p>`;
  return renderOxSteedEmail({
    language: lang,
    preheader: copy.preheader(invoiceNumber),
    eyebrow: copy.eyebrow,
    title: copy.title(invoiceNumber),
    bodyHtml,
    bodyText: renderInvoiceText(invoice, paymentLink, lang),
    notice: { title: copy.noticeTitle, body: copy.noticeBody, tone: 'warning' },
    cta: paymentLink ? { label: copy.ctaLabel, url: paymentLink } : null,
    footerText: copy.footer,
  }).html;
}

/**
 * Generate plain text version of invoice email
 * @param {Object} invoice - Invoice record with details
 * @param {string} paymentLink - Secure payment page URL
 * @param {string} language - Recipient language code (en/es/fr/ht/ar), defaults to 'en'
 */
function renderInvoiceText(invoice, paymentLink = '', language = 'en') {
  const { lang, copy } = getInvoiceCopy(language);
  const currency = resolveInvoiceCurrency(invoice);
  const ownerName = `${invoice.owner_first || ''} ${invoice.owner_last || ''}`.trim();
  const customerName = `${invoice.customer_first || ''} ${invoice.customer_last || ''}`.trim();
  const invoiceNumber = invoice.invoice_number || invoice.id || '';
  const paymentMethodDisplay = formatPaymentMethod(invoice.payment_type, invoice.payment_identifier, lang);
  const dailyRate = formatInvoiceMoney(invoice.daily_rate, lang, currency);
  const totalAmount = formatInvoiceMoney(invoice.total_amount, lang, currency);

  return `${copy.textHeader}
${copy.textInvoiceNumber} ${invoiceNumber}
${copy.textDate}: ${formatInvoiceDate(invoice.created_at, lang)}

${copy.textBillTo}
${customerName}
${invoice.customer_email || ''}

${copy.textFrom}
${ownerName}
${invoice.owner_email || ''}

${copy.textRentalDetails}
${copy.textTool}: ${invoice.tool_name || ''}
${copy.textRentalPeriod}: ${formatInvoiceDate(invoice.start_date, lang)} - ${formatInvoiceDate(invoice.end_date, lang)}
${copy.textDailyRate}: ${dailyRate}${copy.perDay}

${copy.textTotal} ${totalAmount}

${copy.textPaymentMethod}
${copy.labelPaymentMethod}: ${paymentMethodDisplay.display}
${copy.textAccount}: ${invoice.payment_identifier || ''}

${copy.textDisclaimer}

${paymentLink ? `\n${copy.textPaymentPage}: ${paymentLink}\n` : ''}
${copy.textQuestions}: support@oxsteed.com`;
}

/**
 * Format payment method for display (with masking)
 */
function formatPaymentMethod(type, identifier, language = 'en') {
  const { copy } = getInvoiceCopy(language);
  const safeType = String(type || '');
  const safeIdentifier = String(identifier || '');
  const names = copy.paymentMethodNames;
  let display = '';
  let masked = '';

  switch (safeType.toLowerCase()) {
    case 'cash_app':
      display = names.cash_app;
      masked = safeIdentifier.length > 4 ? '*'.repeat(safeIdentifier.length - 4) + safeIdentifier.slice(-4) : safeIdentifier;
      break;
    case 'venmo':
      display = names.venmo;
      masked = safeIdentifier.length > 4 ? '*'.repeat(safeIdentifier.length - 4) + safeIdentifier.slice(-4) : safeIdentifier;
      break;
    case 'bank_transfer':
      display = names.bank_transfer;
      masked = safeIdentifier.length > 4 ? safeIdentifier.slice(0, 4) + '*'.repeat(safeIdentifier.length - 8) + safeIdentifier.slice(-4) : safeIdentifier;
      break;
    default:
      display = safeType;
      masked = safeIdentifier;
  }

  return { display, masked };
}

/**
 * Send invoice email with retry logic
 * @param {Object} invoice - Invoice record
 * @param {string} recipientEmail - Recipient email address
 * @param {number} maxRetries - Maximum retry attempts (default: 3)
 * @param {string} language - Recipient language code (en/es/fr/ht/ar), defaults to 'en'
 * @returns {Promise<{success: boolean, error?: string, attempt: number}>}
 */
async function sendInvoiceEmail(invoice, recipientEmail, maxRetries = 3, language = 'en') {
  const { lang, copy } = getInvoiceCopy(language);
  const CLIENT_URL = process.env.CLIENT_URL || 'https://oxsteed.com';
  const paymentLink = `${CLIENT_URL}/pay/${encodeURIComponent(invoice.payment_type)}/${encodeURIComponent(invoice.payment_identifier)}`;

  let lastError = null;
  let attempt = 0;

  for (attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Generate QR code (synchronously for simple retries)
      const qrCodeDataUrl = await QRCode.toDataURL(paymentLink);

      // Render email
      const html = renderInvoiceHTML(invoice, qrCodeDataUrl, paymentLink, lang);
      const text = renderInvoiceText(invoice, paymentLink, lang);

      // Send email
      const result = await sendEmail({
        to: recipientEmail,
        subject: copy.subject(invoice.invoice_number || invoice.id || ''),
        text,
        html,
        idempotencyKey: `invoice:${invoice.id || invoice.invoice_number}:${recipientEmail}`,
      });

      if (result.success) {
        logger.info('Invoice email sent successfully', {
          invoiceId: invoice.id,
          recipientEmail,
          attempt,
          language: lang,
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
  getInvoiceCopy,
  formatInvoiceMoney,
  resolveInvoiceCurrency,
  INVOICE_COPY,
  EMAIL_LOCALE_TAGS,
};
