'use strict';

// Pure unit tests for the OFX 2.2 generator: structure, required tags,
// debit/credit sign correctness, currency handling, and QFX/QBO variants.
// No database.

const assert = require('node:assert/strict');
const { buildOfx, formatAmount } = require('../services/ofxExportService');


function walletDocument(overrides = {}) {
  return {
    id: 'doc-1',
    product: 'oxsteed',
    accountLabel: 'OxSteed Credit',
    accountReference: 'OC-••••1234',
    currencyCode: 'USD',
    period: { from: '2026-08-01', to: '2026-08-31' },
    generatedAt: '2026-09-01T00:00:00.000Z',
    openingBalanceCents: '10000',
    closingBalanceCents: '8500',
    transactions: [
      { id: 'tx-1', date: '2026-08-05T12:00:00.000Z', description: 'Top up', type: 'load', creditCents: '5000', debitCents: '0' },
      { id: 'tx-2', date: '2026-08-10T12:00:00.000Z', description: 'Lunch', type: 'purchase', creditCents: '0', debitCents: '6500' },
    ],
    ...overrides,
  };
}

test('OFX output carries the required 2.2 SGML structure', () => {
  const result = buildOfx(walletDocument());
  const ofx = result.content;
  assert.match(ofx, /^OFXHEADER:100\r\nDATA:OFXSGML\r\nVERSION:220\r\n/m);
  for (const tag of ['<SIGNONMSGSRSV1>', '<SONRS>', '<BANKMSGSRSV1>', '<STMTTRNRS>',
    '<LEDGERBAL>', '<STMTTRN>', '<TRNTYPE>', '<DTPOSTED>', '<TRNAMT>', '<FITID>', '<MEMO>']) {
    assert.ok(ofx.includes(tag), `missing ${tag}`);
  }
  assert.equal(result.filename.endsWith('.ofx'), true);
  assert.equal(result.mediaType, 'application/x-ofx');
  assert.equal(result.currency, 'USD');
  assert.equal(result.transactionCount, 2);
});

test('credits are positive and debits are negative with matching TRNTYPE', () => {
  const ofx = buildOfx(walletDocument()).content;
  assert.ok(ofx.includes('<TRNTYPE>CREDIT</TRNTYPE>\r\n<DTPOSTED>20260805120000</DTPOSTED>\r\n<TRNAMT>50.00</TRNAMT>'));
  assert.ok(ofx.includes('<TRNTYPE>DEBIT</TRNTYPE>\r\n<DTPOSTED>20260810120000</DTPOSTED>\r\n<TRNAMT>-65.00</TRNAMT>'));
});

test('LEDGERBAL carries the statement closing balance and CURDEF the currency', () => {
  const ofx = buildOfx(walletDocument()).content;
  assert.ok(ofx.includes('<CURDEF>USD</CURDEF>'));
  assert.ok(ofx.includes('<LEDGERBAL>\r\n<BALAMT>85.00</BALAMT>'));
});

test('FITIDs are unique per transaction', () => {
  const ofx = buildOfx(walletDocument()).content;
  const fitids = [...ofx.matchAll(/<FITID>([^<]+)<\/FITID>/g)].map((m) => m[1]);
  assert.equal(fitids.length, 2);
  assert.equal(new Set(fitids).size, 2);
});

test('SGML special characters in memos are escaped', () => {
  const ofx = buildOfx(walletDocument({
    transactions: [{ id: 'tx-9', date: '2026-08-05T12:00:00.000Z', description: 'A&B <lunch>', creditCents: '100', debitCents: '0' }],
  })).content;
  assert.ok(ofx.includes('<MEMO>A&amp;B &lt;lunch&gt;</MEMO>'));
});

test('QFX and QBO map to the OFX generator with their own extensions and MIME types', () => {
  const qfx = buildOfx(walletDocument(), { variant: 'qfx' });
  assert.ok(qfx.filename.endsWith('.qfx'));
  assert.equal(qfx.mediaType, 'application/x-ofx');
  assert.ok(qfx.content.includes('<INTU.BID>'));
  const qbo = buildOfx(walletDocument(), { variant: 'qbo' });
  assert.ok(qbo.filename.endsWith('.qbo'));
  assert.equal(qbo.mediaType, 'application/vnd.intu.qbo');
  assert.ok(qbo.content.includes('<INTU.BID>'));
  const plain = buildOfx(walletDocument(), { variant: 'ofx' });
  assert.ok(!plain.content.includes('<INTU.BID>'));
});

test('helper_earnings movements map to signed payable deltas', () => {
  const ofx = buildOfx({
    id: 'doc-h', product: 'helper_earnings', currencyCode: 'USD',
    accountLabel: 'Helper earnings', accountReference: 'HE-••••5678',
    period: { from: '2026-08-01', to: '2026-08-31' }, generatedAt: '2026-09-01T00:00:00.000Z',
    openingPayableCents: '20000', closingPayableCents: '23000',
    movements: [
      { sourceHistoryId: 'm1', recordedAt: '2026-08-06T00:00:00.000Z', title: 'Fix sink', jobId: 'job-1',
        postedEarningsCents: '5000', settledPayoutsCents: '0', statusRemovalsCents: '0' },
      { sourceHistoryId: 'm2', recordedAt: '2026-08-20T00:00:00.000Z', title: 'Payout', jobId: 'job-1',
        postedEarningsCents: '0', settledPayoutsCents: '2000', statusRemovalsCents: '0' },
    ],
  }).content;
  assert.ok(ofx.includes('<TRNAMT>50.00</TRNAMT>'));
  assert.ok(ofx.includes('<TRNAMT>-20.00</TRNAMT>'));
  assert.ok(ofx.includes('<BALAMT>230.00</BALAMT>'));
});

test('business receivables movements map to signed outstanding deltas', () => {
  const ofx = buildOfx({
    id: 'doc-b', product: 'business', currencyCode: 'USD',
    accountLabel: 'Business', accountReference: 'BZ-••••9999',
    period: { from: '2026-08-01', to: '2026-08-31' }, generatedAt: '2026-09-01T00:00:00.000Z',
    receivables: {
      openingOutstandingCents: '10000', closingOutstandingCents: '12000',
      movements: [
        { sourceHistoryId: 'r1', recordedAt: '2026-08-07T00:00:00.000Z', sourceId: 'inv-1',
          invoicedCents: '5000', collectedOrAdjustedCents: '0', cancelledCents: '0' },
        { sourceHistoryId: 'r2', recordedAt: '2026-08-21T00:00:00.000Z', sourceId: 'inv-1',
          invoicedCents: '0', collectedOrAdjustedCents: '3000', cancelledCents: '0' },
      ],
    },
  }).content;
  assert.ok(ofx.includes('<TRNAMT>50.00</TRNAMT>'));
  assert.ok(ofx.includes('<TRNAMT>-30.00</TRNAMT>'));
  assert.ok(ofx.includes('<BALAMT>120.00</BALAMT>'));
});

test('zero-amount entries are skipped, never emitted as 0.00', () => {
  const result = buildOfx(walletDocument({
    transactions: [
      { id: 'tx-1', date: '2026-08-05T12:00:00.000Z', description: 'Top up', creditCents: '5000', debitCents: '0' },
      { id: 'tx-2', date: '2026-08-06T12:00:00.000Z', description: 'No-op', creditCents: '0', debitCents: '0' },
    ],
  }));
  assert.equal(result.transactionCount, 1);
  assert.equal(result.skippedZeroAmount, 1);
  assert.ok(!result.content.includes('<TRNAMT>0.00</TRNAMT>'));
});

test('fail closed: invalid currency, missing date, unknown product, bad variant', () => {
  assert.throws(() => buildOfx(walletDocument({ currencyCode: 'US' })), /statement_ofx_invalid_currency/);
  assert.throws(() => buildOfx(walletDocument({
    transactions: [{ id: 'tx-1', description: 'x', creditCents: '1', debitCents: '0' }],
  })), /statement_ofx_invalid_transaction/);
  assert.throws(() => buildOfx(walletDocument({ product: 'nope' })), /statement_ofx_unsupported_product/);
  assert.throws(() => buildOfx(walletDocument(), { variant: 'csv' }), /statement_ofx_invalid_variant/);
});

test('formatAmount renders signed minor units with two decimals', () => {
  assert.equal(formatAmount(1n), '0.01');
  assert.equal(formatAmount(-6500n), '-65.00');
  assert.equal(formatAmount(10000n), '100.00');
  assert.equal(formatAmount(0n), '0.00');
});
