'use strict';

const email = require('../utils/email');
const {
  sendInvoiceEmail,
  renderInvoiceHTML,
  renderInvoiceText,
  formatPaymentMethod,
  resolveInvoiceCurrency,
  formatInvoiceMoney,
  INVOICE_COPY,
} = require('../utils/invoiceEmail');

const QR_STUB = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function fixtureInvoice(overrides = {}) {
  return {
    id: 42,
    invoice_number: 'INV-2026-0001',
    customer_first: 'Jean',
    customer_last: 'Paul',
    customer_email: 'jean.paul@example.com',
    owner_first: 'Marie',
    owner_last: 'Claude',
    owner_email: 'marie.claude@example.com',
    tool_name: 'Power Drill X200',
    start_date: '2026-09-15',
    end_date: '2026-09-18',
    created_at: '2026-09-10T12:00:00.000Z',
    daily_rate: '25.00',
    total_amount: '75.00',
    payment_type: 'bank_transfer',
    payment_identifier: '123456789012',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  email.sendEmail.mockResolvedValue({ success: true, id: 'email-test' });
});

// Mirrors server/utils/escapeHtml for asserting escaped copy inside rendered HTML.
function htmlEscaped(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// English markers that must not leak into non-English renders.
// (Brand names like OxSteed / Cash App / Venmo and email addresses are intentionally kept.)
const ENGLISH_MARKERS = [
  'Billing information',
  'Rental details',
  'Payment instructions',
  'Scan the QR code to pay',
  'Open secure payment page',
  'This is an automated message',
  'was issued on',
  'OXSTEED INVOICE',
  'Invoice #',
  'Payment QR code',
  'Daily rate',
  'Total amount',
  'Payment method:',
  'Amount due:',
  'Account:',
];

const ENGLISH_TEXT_MARKERS = [
  'BILL TO:',
  'RENTAL DETAILS:',
  'PAYMENT METHOD:',
  'Secure payment page:',
  'For questions:',
  'was issued on',
  'Invoice #:',
];

describe('invoice email localization', () => {
  const languages = ['es', 'fr', 'ht', 'ar'];

  test.each(languages)('HTML render in %s uses translated headings and leaks no English', (lang) => {
    const html = renderInvoiceHTML(fixtureInvoice(), QR_STUB, 'https://oxsteed.com/pay/x', lang);
    const copy = INVOICE_COPY[lang];

    expect(html).toContain(`lang="${lang}"`);
    expect(html).toContain(copy.sectionBilling);
    expect(html).toContain(copy.sectionRental);
    expect(html).toContain(copy.sectionPayment);
    expect(html).toContain(copy.ctaLabel);
    expect(html).toContain(htmlEscaped(copy.noticeTitle));
    expect(html).toContain(htmlEscaped(copy.noticeBody));
    expect(html).toContain(copy.eyebrow);
    expect(html).toContain(copy.title('INV-2026-0001'));

    for (const marker of ENGLISH_MARKERS) {
      expect(html).not.toContain(marker);
    }
    // No em dashes anywhere in user-visible copy
    expect(html).not.toContain('\u2014');
  });

  test.each(languages)('text render in %s uses translated labels and leaks no English', (lang) => {
    const text = renderInvoiceText(fixtureInvoice(), 'https://oxsteed.com/pay/x', lang);
    const copy = INVOICE_COPY[lang];

    expect(text).toContain(copy.textHeader);
    expect(text).toContain(copy.textBillTo);
    expect(text).toContain(copy.textRentalDetails);
    expect(text).toContain(copy.textPaymentMethod);
    expect(text).toContain(copy.textDisclaimer);
    expect(text).not.toContain('/day');

    for (const marker of ENGLISH_TEXT_MARKERS) {
      expect(text).not.toContain(marker);
    }
    expect(text).not.toContain('\u2014');
  });

  test.each(languages)('sendInvoiceEmail in %s sends a localized subject', async (lang) => {
    const result = await sendInvoiceEmail(fixtureInvoice(), 'jean.paul@example.com', 1, lang);
    expect(result.success).toBe(true);
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    const subject = email.sendEmail.mock.calls[0][0].subject;
    expect(subject).toBe(INVOICE_COPY[lang].subject('INV-2026-0001'));
  });

  test('defaults to English when language is missing or unsupported', () => {
    const htmlDefault = renderInvoiceHTML(fixtureInvoice(), QR_STUB);
    expect(htmlDefault).toContain('Billing information');
    expect(htmlDefault).toContain('Invoice #INV-2026-0001 - OxSteed Tool Rental'.slice(0, 20));

    const htmlUnsupported = renderInvoiceHTML(fixtureInvoice(), QR_STUB, '', 'xx');
    expect(htmlUnsupported).toContain('Billing information');

    const textDefault = renderInvoiceText(fixtureInvoice());
    expect(textDefault).toContain('BILL TO:');
    expect(textDefault).toContain('PAYMENT METHOD:');
  });

  test('dates are locale-aware', () => {
    const esText = renderInvoiceText(fixtureInvoice(), '', 'es');
    expect(esText).toContain('15/9/2026');

    const frText = renderInvoiceText(fixtureInvoice(), '', 'fr');
    expect(frText).toContain('15/09/2026');

    const enText = renderInvoiceText(fixtureInvoice(), '', 'en');
    expect(enText).toContain('9/15/2026');
  });

  test('currency uses the invoice currency code, not a hardcoded $', () => {
    const eurHtml = renderInvoiceHTML(
      fixtureInvoice({ customer_currency: 'EUR' }),
      QR_STUB,
      '',
      'es'
    );
    expect(eurHtml).toContain('\u20AC');
    expect(eurHtml).not.toMatch(/\$\d/);

    // invoice-level currency_code wins over the customer preference
    expect(resolveInvoiceCurrency({ currency_code: 'GHS', customer_currency: 'EUR' })).toBe('GHS');
    expect(resolveInvoiceCurrency({ customer_currency: 'eur' })).toBe('EUR');
    expect(resolveInvoiceCurrency({})).toBe('USD');
    // garbage can never reach Intl
    expect(resolveInvoiceCurrency({ customer_currency: 'bogus!' })).toBe('USD');
    expect(resolveInvoiceCurrency({ customer_currency: 'US' })).toBe('USD');
  });

  test('formatInvoiceMoney falls back to $ formatting when Intl rejects the currency', () => {
    // 'XXX' passes the regex but some runtimes render it oddly; an outright
    // invalid-for-Intl path is exercised via a monkey-patched NumberFormat.
    const original = Intl.NumberFormat;
    Intl.NumberFormat = function () { throw new RangeError('bad currency'); };
    try {
      expect(formatInvoiceMoney('25.5', 'en', 'USD')).toBe('$25.50');
    } finally {
      Intl.NumberFormat = original;
    }
    expect(formatInvoiceMoney('25', 'en', 'USD')).toContain('$25.00');
  });

  test('payment method names are localized, brand names stay intact', () => {
    expect(formatPaymentMethod('bank_transfer', '123456789012', 'fr').display).toBe('Virement bancaire');
    expect(formatPaymentMethod('bank_transfer', '123456789012', 'es').display).toBe('Transferencia bancaria');
    expect(formatPaymentMethod('bank_transfer', '123456789012', 'ht').display).toBe('Transfè labank');
    expect(formatPaymentMethod('bank_transfer', '123456789012', 'ar').display).toBe('تحويل بنكي');
    expect(formatPaymentMethod('cash_app', '$owner123', 'ar').display).toBe('Cash App');
    expect(formatPaymentMethod('venmo', '@owner', 'es').display).toBe('Venmo');
    // null-safe, unknown types pass through untouched
    expect(formatPaymentMethod(null, null, 'en')).toEqual({ display: '', masked: '' });
    expect(formatPaymentMethod('zelle', 'owner@x.com', 'fr').display).toBe('zelle');
  });

  test('sendInvoiceEmail retries once then succeeds', async () => {
    email.sendEmail
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ success: true, id: 'email-test' });

    const result = await sendInvoiceEmail(fixtureInvoice(), 'jean.paul@example.com', 2, 'ht');
    expect(result).toEqual({ success: true, attempt: 2 });
    expect(email.sendEmail).toHaveBeenCalledTimes(2);
    const subject = email.sendEmail.mock.calls[0][0].subject;
    expect(subject).toContain('Fakti #INV-2026-0001');
  });

  test('sendInvoiceEmail reports failure after exhausting retries', async () => {
    email.sendEmail.mockResolvedValue({ success: false, error: 'smtp down' });
    const result = await sendInvoiceEmail(fixtureInvoice(), 'jean.paul@example.com', 1, 'en');
    expect(result.success).toBe(false);
    expect(result.error).toBe('smtp down');
  });

  test('HTML and text stay consistent for every language (per-day suffix, totals)', () => {
    for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
      const copy = INVOICE_COPY[lang];
      const html = renderInvoiceHTML(fixtureInvoice(), QR_STUB, 'https://oxsteed.com/pay/x', lang);
      const text = renderInvoiceText(fixtureInvoice(), 'https://oxsteed.com/pay/x', lang);
      expect(html).toContain(copy.perDay);
      expect(text).toContain(copy.perDay);
      expect(html).toContain(copy.labelTotal);
      expect(text).toContain(copy.textTotal);
    }
  });
});
