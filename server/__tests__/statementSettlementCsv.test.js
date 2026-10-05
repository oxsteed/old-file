'use strict';

const { documentToCsv, csvCell } = require('../routes/settlementStatementArchive').testHooks;
const { decimal, amount } = require('../services/creditStatementPdf');
const labels = require('../locales/statement-copy.json');
const fixture = currencyCode => ({ product: 'business', sourceHistoryVersion: 1, currencyCode,
  accountLabel: 'Synthetic account', accountReference: 'BZ-fixture', period: { from: '2026-09-01', to: '2026-09-30' },
  generatedAt: '2026-10-01T00:00:00Z', contentHash: 'fixture',
  receivables: { openingOutstandingCents: 100, closingOutstandingCents: 0,
    invoices: [{ invoiceNumber: 'INV-1', clientName: 'Client Co', status: 'paid', issueDate: '2026-09-01', totalCents: 100, paidCents: 100, outstandingCents: 0 }] },
  payables: { expenses: [] } });

describe('exact CSV currency formatting (R06)', () => {
  test.each([['USD', 100, '1.00'], ['JPY', 100, '100'], ['BHD', 100, '0.100'], ['USD', -1, '-0.01'], ['JPY', -100, '-100'], ['BHD', -1001, '-1.001'], ['BHD', 0, '0.000'], ['USD', Number.MAX_SAFE_INTEGER, '90071992547409.91']])('%s minor %s agrees with exact PDF decimal %s', (currency, minor, expected) => {
    const document = fixture(currency);
    document.receivables.openingOutstandingCents = minor;
    const csv = documentToCsv(document, labels.en);
    expect(csv).toContain(csvCell(expected));
    expect(decimal(minor, currency)).toBe(expected);
    expect(amount(minor, currency, 'en').replace(/,/g, '')).toBe(expected);
  });
  test.each(['ZZZ', 'usd', 'BAD!', 'BTC'])('unsupported currency %s fails closed', currency => {
    expect(() => documentToCsv(fixture(currency), labels.en)).toThrow(/currency/);
  });
  test.each([Number.MAX_SAFE_INTEGER + 1, 1.2, '9007199254740992', '1e3'])('unsafe/noninteger minor amount %s fails closed', value => {
    const document = fixture('USD'); document.receivables.openingOutstandingCents = value;
    expect(() => documentToCsv(document, labels.en)).toThrow();
  });
});

describe('CSV text safety and localization (R13)', () => {
  test.each(['=1+1', '+1+1', '-1+1', '@SUM(A1:A2)', '  =1+1', '\t=1+1', '\r=1+1', '\n=1+1', '\uFEFF=1+1', '\u200E=1+1', '\u200F+1+1', '\u202A=1+1', '\u202E@SUM(A1)', '\u2066=1+1', '\u2069=1+1'])('neutralizes formula trigger %j', text => {
    expect(csvCell(text)).toBe(`"'${text}"`);
    const document = fixture('USD'); document.receivables.invoices[0].clientName = text;
    expect(documentToCsv(document, labels.en)).toContain(csvCell(text));
  });
  test('quotes newlines and quotes, preserves ordinary text, removes NUL', () => {
    expect(csvCell('Normal name')).toBe('"Normal name"');
    expect(csvCell('A, "B"\nC')).toBe('"A, ""B""\nC"');
    expect(csvCell('A\u0000B')).toBe('"AB"');
  });
  test('neutralizes job titles and expense descriptions through the same cell function', () => {
    const doc = fixture('USD'); doc.payables.expenses = [{ expenseDate: '2026-09-30', category: 'materials', description: '=HYPERLINK("evil")', amountCents: 100 }];
    expect(documentToCsv(doc, labels.en)).toContain(csvCell('=HYPERLINK("evil")'));
    doc.product = 'helper_earnings'; doc.earnings = [{ jobId: 'fixture', title: '\uFEFF=1+1', completedAt: '2026-09-01T00:00:00Z', payoutStatus: 'earned', helperPayoutCents: 100, platformFeeCents: 0 }];
    doc.openingPayableCents = 0; doc.closingPayableCents = 100;
    expect(documentToCsv(doc, labels.en)).toContain(csvCell('\uFEFF=1+1'));
  });
  test.each(['en', 'es', 'fr', 'ht', 'ar'])('uses localized CSV headings in %s', language => {
    const csv = documentToCsv(fixture('USD'), labels[language]);
    for (const key of ['period', 'currency', 'generated', 'invoiceNo', 'billedTo', 'openingOutstanding', 'categoryCol', 'descriptionCol']) expect(csv).toContain(csvCell(labels[language][key]));
    expect(csv).not.toContain(labels[language].businessLimitationNote);
    expect(csv).not.toContain('"Content SHA-256"');
  });
});
