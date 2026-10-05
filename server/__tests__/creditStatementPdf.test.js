'use strict';

const { renderStatementPdf, renderStatementCsv } = require('../services/creditStatementPdf');
const copy = require('../locales/statement-copy.json');

function fixture(overrides = {}) {
  return {
    id: 'STMT-2026-09-TEST', kind: 'monthly', product: 'oxsteed', ownerName: 'Emile Jean Philippe',
    accountLabel: 'OxSteed Credit', accountReference: 'OC-****-1042', currencyCode: 'USD',
    period: { from: '2026-09-01', to: '2026-09-30' }, generatedAt: '2026-10-01T12:00:00Z',
    openingBalanceCents: 10000, closingBalanceCents: 10800, totalCreditsCents: 1500, totalDebitsCents: 700,
    transactionCount: 3,
    transactions: [
      { id: 'TX-LOAD-1', date: '2026-09-01T00:00:00Z', type: 'load', description: 'Credit added', debitCents: 0, creditCents: 1000, balanceAfterCents: 11000 },
      { id: 'TX-ORDER-2', date: '2026-09-12T15:45:00Z', type: 'purchase', description: 'Lunch at Café Délice', debitCents: 700, creditCents: 0, balanceAfterCents: 10300 },
      { id: 'TX-REFUND-3', date: '2026-09-30T23:59:59Z', type: 'refund', description: 'Order refund', debitCents: 0, creditCents: 500, balanceAfterCents: 10800 },
    ],
    holds: [], holdsAsOf: null, totalHeldCents: 0, contentHash: 'a'.repeat(64),
    ...overrides,
  };
}

describe('credit statement CSV renderer', () => {
  test.each(['en', 'es', 'fr', 'ht', 'ar'])('exports distinct financial activity types in %s', language => {
    for (const type of ['transfer_fee', 'withdrawal_fee', 'cash_out', 'funding', 'reserve_release', 'settlement_reversal',
      'conversion_debit', 'conversion_fee', 'conversion_credit', 'sub_bank_load', 'sub_bank_redemption', 'sub_bank_refund', 'sub_bank_opening_balance', 'sub_bank_conversion']) {
      const report = fixture({ transactions: fixture().transactions.map(entry => ({ ...entry, type })) });
      expect(renderStatementCsv(report, { language })).toContain(copy[language][type]);
    }
  });
  test.each(['en', 'es', 'fr', 'ht', 'ar'])('localized metadata and itemized activity in %s with UTF-8 BOM', (language) => {
    const csv = renderStatementCsv(fixture(), { language });
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    expect(csv).toContain(copy[language].title);
    expect(csv).toContain('"100.00"');
    expect(csv).toContain('"108.00"');
    expect(csv).toContain('"2026-09-12T15:45:00.000Z"');
    expect(csv).toContain('TX-ORDER-2');
    expect(csv).toContain('Café Délice');
    expect(csv).toContain(copy[language].disclaimer);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  test('escapes user-controlled formulas, quotes, commas, and line breaks', () => {
    const statement = fixture({
      ownerName: ' =HYPERLINK("https://example.test")', accountLabel: '@SUM(1,2)',
      accountReference: '+123', id: '-1+1',
      transactions: fixture().transactions.map((entry) => ({ ...entry, id: '=1+1', description: 'Comma, "quote"\nnewline' })),
    });
    const csv = renderStatementCsv(statement);
    expect(csv).toContain('"\' =HYPERLINK(""https://example.test"")"');
    expect(csv).toContain('"\'@SUM(1,2)"');
    expect(csv).toContain('"\'+123"');
    expect(csv).toContain('"\'-1+1"');
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('Comma, ""quote""\nnewline');
  });

  test.each([['JPY', '10000', '10800'], ['KWD', '10.000', '10.800']])('respects %s minor-unit precision', (currencyCode, opening, closing) => {
    const csv = renderStatementCsv(fixture({ currencyCode }));
    expect(csv).toContain(`"${copy.en.opening}","${opening}"`);
    expect(csv).toContain(`"${copy.en.closing}","${closing}"`);
  });

  test('exactly preserves MAX_SAFE_INTEGER balances without floating point rounding', () => {
    const balance = Number.MAX_SAFE_INTEGER;
    const csv = renderStatementCsv(fixture({ openingBalanceCents: balance, closingBalanceCents: balance, totalCreditsCents: 0, totalDebitsCents: 0, transactions: [], transactionCount: 0 }));
    expect(csv).toContain('"90071992547409.91"');
  });

  test('zero-activity periods retain their opening and closing balances', () => {
    const csv = renderStatementCsv(fixture({ openingBalanceCents: 999, closingBalanceCents: 999, totalCreditsCents: 0, totalDebitsCents: 0, transactions: [], transactionCount: 0 }));
    expect(csv).toContain('"9.99"');
    expect(csv).toContain(copy.en.noActivity);
  });

  test('current holds appear only in an interim report and cannot change posted balances', () => {
    const holds = [{ id: 'HOLD-1', amountCents: 1200, description: 'Reserved for an order' }];
    const interim = renderStatementCsv(fixture({ kind: 'interim', holds, totalHeldCents: 1200, holdsAsOf: '2026-10-01T12:00:00Z' }));
    expect(interim).toContain(copy.en.holdsNote);
    expect(interim).toContain('HOLD-1');
    expect(interim).toContain('"108.00"');
    const monthly = renderStatementCsv(fixture({ holds, totalHeldCents: 1200, holdsAsOf: '2026-10-01T12:00:00Z' }));
    expect(monthly).not.toContain('HOLD-1');
    expect(monthly).not.toContain(copy.en.holdsNote);
  });

  test('does not leak extra object properties or internal hold metadata', () => {
    const csv = renderStatementCsv(fixture({ privateNotes: 'DO-NOT-EXPORT', pin: 'SECRET-PIN', transactions: fixture().transactions.map((entry) => ({ ...entry, internalActor: 'SECRET-ACTOR' })) }));
    expect(csv).not.toMatch(/DO-NOT-EXPORT|SECRET-PIN|SECRET-ACTOR/);
  });

  test.each([
    [{ closingBalanceCents: 0 }, 'statement_balance_mismatch'],
    [{ totalDebitsCents: 1 }, 'statement_balance_mismatch'],
    [{ totalCreditsCents: Number.MAX_SAFE_INTEGER + 1 }, 'statement_invalid_amount'],
    [{ openingBalanceCents: NaN }, 'statement_invalid_amount'],
    [{ transactionCount: 4 }, 'statement_incomplete_export'],
    [{ transactions: new Array(5001).fill({}) }, 'statement_export_too_large'],
    [{ generatedAt: '2026-10-01T12:00:00' }, 'statement_invalid_date'],
    [{ period: { from: '2026-02-30', to: '2026-09-30' } }, 'statement_invalid_date'],
    [{ currencyCode: 'not-currency' }, 'statement_invalid_currency'],
    [{ ownerName: 'x'.repeat(257) }, 'statement_export_too_large'],
    [{ kind: 'interim', holds: [{ id: 'H', amountCents: 1 }], totalHeldCents: 1, holdsAsOf: null }, 'statement_invalid_date'],
    [{ kind: 'interim', holds: [{ id: 'H', amountCents: 1 }], totalHeldCents: 2, holdsAsOf: '2026-10-01T12:00:00Z' }, 'statement_balance_mismatch'],
    [{ transactions: fixture().transactions.map((entry) => ({ ...entry, balanceAfterCents: 1 })) }, 'statement_balance_mismatch'],
  ])('rejects misleading/unsafe reports: %s', (overrides, code) => {
    expect(() => renderStatementCsv(fixture(overrides))).toThrow(expect.objectContaining({ code }));
  });

  test('unknown type and unsupported language fall back to safe English labels', () => {
    const statement = fixture({ transactions: fixture().transactions.map((entry) => ({ ...entry, type: 'private-internal-operation' })) });
    expect(renderStatementCsv(statement, { language: 'xx' })).toContain(copy.en.other);
  });

  test('negative sub-unit balances retain the minus sign', () => {
    const csv = renderStatementCsv(fixture({ openingBalanceCents: -1, closingBalanceCents: -1, totalCreditsCents: 0, totalDebitsCents: 0, transactions: [], transactionCount: 0 }));
    expect(csv).toContain('"\'-0.01"');
  });
});

describe('credit statement PDF renderer', () => {
  test('Arabic parentheses surround LTR UTC references in the correct visual order', async () => {
    const PDFDocument = require('pdfkit');
    const spy = jest.spyOn(PDFDocument.prototype, 'text');
    try {
      await renderStatementPdf(fixture(), { language: 'ar' });
      const renderedRuns = spy.mock.calls.map((args) => args[0]);
      const index = renderedRuns.findIndex((run, i) => run === 'UTC' && renderedRuns[i - 1] === '(');
      expect(index).toBeGreaterThan(0);
      expect(renderedRuns[index + 1].trim()).toBe(')');
    } finally { spy.mockRestore(); }
  });

  test.each(['en', 'es', 'fr', 'ht', 'ar'])('renders %s as a valid PDF using embedded fonts', async (language) => {
    const statement = fixture(language === 'ar' ? { ownerName: 'إميل جان فيليب', accountLabel: 'ائتمان OxSteed', transactions: fixture().transactions.map((entry) => ({ ...entry, description: 'شراء وجبة في مطعم Café Délice رقم 123' })) } : {});
    const pdf = await renderStatementPdf(statement, { language });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('/FontFile2');
    expect(pdf.toString('latin1')).toContain('%%EOF');
  });

  test('repeated rows produce multiple pages without truncating exports', async () => {
    let balance = 10000;
    const transactions = Array.from({ length: 100 }, (_, i) => ({ id: `TX-${i}`, date: '2026-09-15T12:00:00Z', type: 'purchase', description: 'Lunch and drinks - Café Délice', debitCents: 1, creditCents: 0, balanceAfterCents: --balance }));
    const pdf = await renderStatementPdf(fixture({ transactions, transactionCount: 100, totalCreditsCents: 0, totalDebitsCents: 100, closingBalanceCents: balance }));
    const pages = pdf.toString('latin1').match(/\/Type \/Page\b/g);
    expect(pages.length).toBeGreaterThan(3);
    expect(pages.length).toBeLessThan(20);
  });

  test('long descriptions continue across pages without repeating amounts', async () => {
    const statement = fixture({ transactions: fixture().transactions.map((entry) => ({ ...entry, description: 'Long item description '.repeat(150) })) });
    const pdf = await renderStatementPdf(statement);
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g).length).toBeGreaterThan(3);
  });

  test('rejects unsupported glyphs rather than emitting blank squares in names', async () => {
    await expect(renderStatementPdf(fixture({ ownerName: '测试' }))).rejects.toMatchObject({ code: 'statement_unsupported_glyph' });
  });

  test('bad balances reject before PDF creation', async () => {
    await expect(renderStatementPdf(fixture({ closingBalanceCents: 1 }))).rejects.toMatchObject({ code: 'statement_balance_mismatch' });
  });
});

module.exports = { fixture };
