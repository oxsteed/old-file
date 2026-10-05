'use strict';

const { renderStatementPdfInWorker } = require('../services/creditStatementExport');
function fixture(ownerName = 'Synthetic Fixture') {
  return { id: 'synthetic-worker-test', product: 'restaurant', kind: 'monthly', ownerName,
    accountLabel: 'Synthetic Restaurant', accountReference: 'RC-0001', currencyCode: 'USD',
    period: { from: '2026-09-01', to: '2026-09-30' }, generatedAt: '2026-10-01T00:00:00Z',
    openingBalanceCents: 0, closingBalanceCents: 200, totalCreditsCents: 200, totalDebitsCents: 0,
    transactionCount: 200, transactions: Array.from({ length: 200 }, (_, index) => ({ id: `synthetic-${index}`,
      date: '2026-09-01T01:00:00Z', type: 'load', description: 'Synthetic activity only',
      debitCents: 0, creditCents: 1, balanceAfterCents: index + 1 })), holds: [], holdsAsOf: null,
    totalHeldCents: 0, contentHash: 'a'.repeat(64) };
}
test('real PDF worker keeps the API event loop responsive during a multipage render', async () => {
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 10);
  try {
    const pdf = await renderStatementPdfInWorker(fixture(), { language: 'ar' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(ticks).toBeGreaterThan(5);
  } finally { clearInterval(timer); }
}, 30000);
test('real worker reports unsupported names safely with CSV recovery available', async () => {
  await expect(renderStatementPdfInWorker(fixture('测试'))).rejects.toMatchObject({ code: 'statement_unsupported_glyph', statusCode: 422 });
}, 15000);
