import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const repoRoot = new URL('../../', import.meta.url);
const read = (rel) => readFile(new URL(rel, root), 'utf8');
const readRepo = (rel) => readFile(new URL(rel, repoRoot), 'utf8');
const locales = ['en', 'es', 'fr', 'ht', 'ar'];
const readLocale = async (lang) => JSON.parse(await read(`src/locales/${lang}.json`));

// Group 14 Slice 5j (749, D-792): currency-aware formatting. The shared
// formatMoney used to force 2 fraction digits on every currency, so JPY
// printed '¥500.00' and 3-decimal currencies lost a digit. It now follows
// the currency's own digits unless the caller overrides them.
test('749: formatMoney follows the currency fraction digits', async () => {
  const { formatMoney, formatCents } = await import('../src/lib/format.js');
  assert.equal(formatMoney(500, { currency: 'JPY', locale: 'en-US' }), '¥500');
  assert.equal(formatMoney(1234.5, { currency: 'USD', locale: 'en-US' }), '$1,234.50');
  assert.equal(formatMoney(1234.5, { currency: 'EUR', locale: 'fr-FR' }), '1\u202f234,50\u00a0€');
  assert.equal(formatMoney(1.234, { currency: 'BHD', locale: 'en-US' }), 'BHD\u00a01.234');
  assert.equal(formatCents(1800, { currency: 'USD', locale: 'en-US' }), '$18.00');
  // An explicit override still wins, on either side.
  assert.equal(formatMoney(1234.4, { currency: 'USD', locale: 'en-US', maximumFractionDigits: 0 }), '$1,234');
  assert.equal(formatMoney(1234.5, { currency: 'USD', locale: 'en-US', minimumFractionDigits: 0, maximumFractionDigits: 0 }), '$1,235');
  assert.equal(formatMoney(null), '-');
});

test('749: ops payout amounts use deliveryMoney, not a hardcoded $', async () => {
  const src = await read('src/pages/logistics/OperationsWorkspacePage.jsx');
  assert.doesNotMatch(src, /toFixed\(2\)/, 'no toFixed(2) money in the ops payouts section');
  assert.match(src, /const payoutMoney = \(cents\) => deliveryMoney\(cents, i18n\.language, 'USD'\)/);
  assert.match(src, /const amount = payoutMoney\(payout\.payout_cents\)/);
  assert.match(src, /amount: payoutMoney\(payout\.payout_cents\)/);
  for (const lang of locales) {
    const ops = (await readLocale(lang)).logistics.operations.driverPayouts;
    assert.equal(ops.amount, '{{amount}}');
    assert.doesNotMatch(ops.confirmApprove, /\$/);
    assert.doesNotMatch(ops.confirmMarkPaid, /\$/);
  }
});

test('749: finance refund line uses the currency-aware formatter', async () => {
  const src = await read('src/pages/logistics/LogisticsFinancePage.jsx');
  assert.doesNotMatch(src, /\$\{parseFloat\(refund\.requested_amount_usd/);
  assert.match(src, /refundMoney\(refund\.requested_amount_usd\)/);
});

// Group 14 Slice 5j (746, D-789): receipt archive filters and paging.
test('746: ReceiptsPage is an archive, not a bare list', async () => {
  const src = await read('src/pages/ReceiptsPage.tsx');
  assert.match(src, /receipts-filters/);
  assert.match(src, /setYear|setMonth|setKind/);
  assert.match(src, /receipts-pagination/);
  assert.match(src, /listReceipts\(\{ year, month, kind, q, limit, offset \}\)/);
  const api = await read('src/api/receipts.js');
  assert.match(api, /listReceipts: async \(params = \{\}\)/);
  for (const lang of locales) {
    const receipts = (await readLocale(lang)).receipts;
    for (const key of ['filterYear', 'filterMonth', 'filterKind', 'filterSearch', 'filterApply', 'filterClear', 'count', 'prevPage', 'nextPage', 'pageOf', 'noMatchesTitle', 'noMatchesBody']) {
      assert.ok(receipts[key], `${lang}.receipts.${key} is present`);
    }
  }
});

// Group 14 Slice 5j (747, D-790): payout detail view is routed and linked.
test('747: payout detail page is registered and linked from both lists', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /path="\/delivery\/payouts\/:payoutId"/);
  assert.match(app, /DriverPayoutDetailPage/);
  const detail = await read('src/pages/DriverPayoutDetailPage.jsx');
  assert.match(detail, /getMyDriverPayout\(payoutId\)/);
  assert.match(detail, /getInternalDriverPayout\(payoutId\)/);
  assert.match(detail, /canAccessOperationsWorkspace\(user\)/);
  const history = await read('src/pages/DriverPayoutHistoryPage.jsx');
  assert.match(history, /to=\{\`\/delivery\/payouts\/\$\{payout\.id\}\`\}/);
  const ops = await read('src/pages/logistics/OperationsWorkspacePage.jsx');
  assert.match(ops, /to=\{\`\/delivery\/payouts\/\$\{payout\.id\}\`\}/);
});

// Group 14 Slice 5j (748, D-791): refund history disclosure on receipts.
test('748: receipt rows disclose the payment refund history', async () => {
  const api = await read('src/api/receipts.js');
  assert.match(api, /getPaymentRefundHistory: async \(paymentId\)/);
  assert.match(api, /`\/payments\/\$\{paymentId\}\/refund-history`/);
  const src = await read('src/pages/ReceiptsPage.tsx');
  assert.match(src, /toggleRefundHistory/);
  assert.match(src, /refundHistoryShow/);
  for (const lang of locales) {
    const receipts = (await readLocale(lang)).receipts;
    for (const key of ['refundHistory', 'refundHistoryShow', 'refundHistoryHide', 'refundHistoryEmpty', 'refundHistoryLoadFailed', 'refundHistoryRefunded', 'refundStatusPending', 'refundStatusSucceeded', 'refundStatusFailed', 'refundStatusCanceled']) {
      assert.ok(receipts[key], `${lang}.receipts.${key} is present`);
    }
  }
});

// Group 14 Slice 5j (750, D-793): the snapshot-approval call is held, not built.
test('750: the decisions record holds item 750 with the exact question', async () => {
  const decisions = await readRepo('persona-roadmap-decisions.md');
  assert.match(decisions, /D-793\. Item 750.*HELD/);
  assert.match(decisions, /approved.*snapshot/i);
});
