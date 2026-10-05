import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/api/creditStatements.js', import.meta.url), 'utf8');
const requests = [];
globalThis.__statementTestApi = { get: async (url, options) => { requests.push({ url, options }); return { data: { statement: { id: 'fixture' } } }; } };
const module = await import(`data:text/javascript;base64,${Buffer.from(source.replace("import api from './axios';", 'const api = globalThis.__statementTestApi;')).toString('base64')}`);
delete globalThis.__statementTestApi;
const params = { from: '2026-09-01', to: '2026-09-30', currencyCode: 'USD', language: 'en' };
const report = {
  id: 'fixture', kind: 'monthly', currencyCode: 'USD', period: { from: params.from, to: params.to },
  openingBalanceCents: 20, closingBalanceCents: 25, totalCreditsCents: 5, totalDebitsCents: 0, totalHeldCents: 0,
  transactionCount: 1, transactions: [{ id: 'entry', date: '2026-09-02', debitCents: 0, creditCents: 5, balanceAfterCents: 25 }], holds: [],
};
const formats = await import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync(new URL('../src/lib/creditStatementFormat.js', import.meta.url), 'utf8')).toString('base64')}`);
const status = await import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync(new URL('../src/lib/creditStatus.js', import.meta.url), 'utf8')).toString('base64')}`);

test('statement money preserves every minor unit and follows the selected language', () => {
  assert.equal(formats.formatStatementMoney(Number.MAX_SAFE_INTEGER, 'USD', 'en'), 'USD 90,071,992,547,409.91');
  assert.equal(formats.formatStatementMoney(-1, 'USD', 'en'), '-USD 0.01');
  assert.equal(formats.formatStatementMoney(12345, 'JPY', 'en'), 'JPY 12,345');
  assert.equal(formats.formatStatementMoney(1005, 'KWD', 'en'), 'KWD 1.005');
  assert.match(formats.formatStatementMoney(12345, 'USD', 'fr'), /123,45/);
  assert.equal(formats.formatStatementMoney(12345, 'USD', 'ar'), new Intl.NumberFormat('ar', { style: 'currency', currency: 'USD', currencyDisplay: 'code' }).format(123.45));
});

test('all ledger transaction kinds have translated UI and export labels in five locales', () => {
  const copy = JSON.parse(fs.readFileSync(new URL('../../server/locales/statement-copy.json', import.meta.url), 'utf8'));
  const migrations = new URL('../../server/migrations/', import.meta.url);
  const allowed = fs.readdirSync(migrations).filter(name => name.endsWith('.sql'))
    .sort((a, b) => parseInt(b, 10) - parseInt(a, 10))
    .map(name => fs.readFileSync(new URL(name, migrations), 'utf8').match(/CHECK\s*\(transaction_type IN\s*\(([\s\S]*?)\)\)/)?.[1])
    .find(Boolean);
  const canonical = [...allowed.matchAll(/'([a-z_]+)'/g)].map(match => match[1]);
  assert.ok(canonical.includes('transfer_fee'));
  for (const language of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(fs.readFileSync(new URL(`../src/i18n/locales/${language}/credit.json`, import.meta.url), 'utf8'));
    for (const type of canonical) {
      const key = status.creditTransactionTypeTranslationKey(type);
      assert.notEqual(key, 'transactionUnknown', type);
      assert.ok(catalog[key], `${language} ${key}`);
      assert.ok(copy[language][type], `${language} ${type}`);
    }
  }
});

test('statement endpoints isolate products and encode restaurant references', () => {
  assert.equal(module.creditStatementEndpoint('oxsteed'), '/oxsteed-credit/documents');
  assert.equal(module.creditStatementEndpoint('restaurant', 42), '/food/customer/wallets/42/statements');
  assert.equal(module.creditStatementEndpoint('restaurant', '../x'), '/food/customer/wallets/..%2Fx/statements');
  assert.throws(() => module.creditStatementEndpoint('restaurant', null));
  assert.throws(() => module.creditStatementEndpoint('other', 42));
});

test('statement API keeps only permitted params, propagates cancellation, and uses blob downloads', async () => {
  const controller = new AbortController();
  assert.deepEqual(await module.getCreditStatement('oxsteed', null, { ...params, customerId: 'not-permitted' }, { signal: controller.signal }), { id: 'fixture' });
  assert.deepEqual(requests.at(-1).options.params, params);
  assert.equal(requests.at(-1).options.signal, controller.signal);
  for (const format of ['pdf', 'csv']) {
    await module.downloadCreditStatement('restaurant', 42, format, params, { signal: controller.signal });
    assert.equal(requests.at(-1).url, `/food/customer/wallets/42/statements.${format}`);
    assert.equal(requests.at(-1).options.responseType, 'blob');
    assert.equal(requests.at(-1).options.signal, controller.signal);
  }
  assert.throws(() => module.downloadCreditStatement('oxsteed', null, 'html', params));
});

test('UTC previous-month defaults cover January rollover and leap years', () => {
  assert.deepEqual(module.previousStatementMonth(new Date('2026-01-01T00:01:00Z')), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(module.previousStatementMonth(new Date('2024-03-01T00:00:00Z')), { from: '2024-02-01', to: '2024-02-29' });
});

test('period validation rejects invalid calendar dates, future dates, and oversized periods', () => {
  assert.equal(module.validStatementPeriod(params.from, params.to, '2026-10-01'), true);
  for (const [from, to] of [['2026-02-30', '2026-03-01'], ['2026-10-02', '2026-10-03'], ['2026-09-30', '2026-09-01'], ['', '2026-09-01'], ['2020-01-01', '2026-09-01'], ['1999-12-01', '1999-12-30']]) {
    assert.equal(module.validStatementPeriod(from, to, '2026-10-01'), false);
  }
});

test('complete statements must match the applied currency/period and contain all bounded activity', () => {
  assert.equal(module.isCompleteCreditStatement({ ...report, product: 'restaurant' }, params, 'oxsteed'), false);
  assert.equal(module.isCompleteCreditStatement(report, params), true);
  assert.equal(module.isCompleteCreditStatement({ ...report, transactions: [], transactionCount: 0, closingBalanceCents: 20, totalCreditsCents: 0 }, params), true);
  for (const invalid of [
    { ...report, transactionCount: 2 }, { ...report, currencyCode: 'EUR' },
    { ...report, period: { from: params.from, to: '2026-09-29' } },
    { ...report, kind: 'unknown' }, { ...report, totalCreditsCents: true },
    { ...report, closingBalanceCents: Number.MAX_SAFE_INTEGER + 1 },
    { ...report, accountLabel: { malformed: true } },
    { ...report, transactions: [{ ...report.transactions[0], description: {} }] },
    { ...report, transactions: [{ ...report.transactions[0], date: 'bad date' }] },
    { ...report, transactions: [{ ...report.transactions[0], balanceAfterCents: 999 }] },
    { ...report, totalCreditsCents: 999 },
    { ...report, holds: [{ id: 'hold', amountCents: 1 }], totalHeldCents: 1 },
    { ...report, transactions: Array.from({ length: 5001 }, () => report.transactions[0]), transactionCount: 5001 },
  ]) assert.equal(module.isCompleteCreditStatement(invalid, params), false);
});

test('both statement routes preserve existing route guards and explicit product props', () => {
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  for (const [route, product] of [['oxsteed-credit', 'oxsteed'], ['restaurant-credit', 'restaurant']]) {
    assert.ok(app.includes(`path="/${route}/statements" element={<Guarded><ProtectedRoute><RouteErrorBoundary><CreditStatementsPage product="${product}" /></RouteErrorBoundary></ProtectedRoute></Guarded>}`));
  }
});
