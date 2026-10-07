// Isolated real-browser checks; no live financial data or external writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');

async function fixture() {
  const mocks = {
    'react-i18next': `export const useTranslation = () => ({ t: (key, options = {}) => {
      const value = key.split('.').reduce((entry, part) => entry?.[part], window.fixtureCatalog);
      return (typeof value === 'string' ? value : options.defaultValue || key).replace(/\\{\\{(\\w+)\\}\\}/g, (_, name) => String(options[name] ?? ''));
      },
      i18n: { resolvedLanguage: document.documentElement.lang, dir: lang => lang === 'ar' ? 'rtl' : 'ltr' } });`,
    '../../components/Navbar': 'export default () => null;',
    '../../components/Footer': 'export default () => null;',
    '../../components/PageMeta': 'export default () => null;',
    '../../api/oxsteedCredit': `export const listOxsteedCreditAccounts = async () => {
      if (window.fixtureAccountMode === 'error') throw Error('Fixture failure');
      return window.fixtureAccountMode === 'empty' ? [] : [{ currencyCode: 'USD' }, { currencyCode: 'JPY' }];
    };`,
    '../../api/food': `export const listMyFoodRestaurantWallets = async () => [{ restaurantId: 42, restaurantName: 'Fixture Restaurant', currencyCode: 'USD' }];`,
    './axios': `export default { get: async (url, options) => {
      window.fixtureRequests.push({ url, params: options.params });
      // Deliberately ignore AbortSignal to exercise the UI's late-result guard.
      await new Promise(resolve => setTimeout(resolve, window.fixtureDelay || 20));
      if (window.fixtureError) throw { response: { status: 400, data: { error: { code: window.fixtureError } } } };
      const params = options.params;
      if (/\\.(pdf|csv)$/.test(url)) {
        const type = url.endsWith('.pdf') ? 'application/pdf' : 'text/csv';
        return { data: new Blob(['Synthetic test statement'], { type }), headers: { 'content-type': type } };
      }
      const count = window.fixtureCount ?? 51;
      const interim = params.to === new Date().toISOString().slice(0, 10);
      const statement = {
        id: 'fixture-' + params.currencyCode, kind: interim ? 'interim' : 'monthly',
        product: url.startsWith('/food') ? 'restaurant' : 'oxsteed', ownerName: 'Fixture Customer',
        accountLabel: url.startsWith('/food') ? 'Fixture Restaurant' : 'OxSteed Credit',
        accountReference: 'OC-••••1234', currencyCode: params.currencyCode,
        period: { from: params.from, to: params.to }, generatedAt: new Date().toISOString(),
        openingBalanceCents: 0, closingBalanceCents: count, totalCreditsCents: count, totalDebitsCents: 0,
        transactionCount: count, transactions: Array.from({ length: count }, (_, index) => ({
          id: String(index), date: params.from + 'T12:00:00Z', type: 'load', description: 'Fixture credit',
          debitCents: 0, creditCents: 1, balanceAfterCents: index + 1,
        })), holds: interim ? [{ id: 'hold', amountCents: 1, expiresAt: new Date().toISOString() }] : [],
        holdsAsOf: interim ? new Date().toISOString() : null, totalHeldCents: interim ? 1 : 0,
        contentHash: 'abc123',
      };
      return { data: { statement } };
    } };`,
  };
  const bundled = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { BrowserRouter, Routes, Route } from 'react-router-dom';
      import CreditStatementsPage from './src/pages/food/CreditStatementsPage.jsx';
      createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><Routes>
        <Route path="/oxsteed-credit/statements" element={<CreditStatementsPage product="oxsteed" />} />
        <Route path="/restaurant-credit/statements" element={<CreditStatementsPage product="restaurant" />} />
      </Routes></BrowserRouter></React.StrictMode>);
    ` }, bundle: true, write: false, jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'statement-fixtures', setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: root }));
    } }],
  });
  const css = fs.readFileSync(path.join(root, 'src/pages/food/CreditStatementsPage.css'), 'utf8');
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundled.outputFiles[0].contents); return; }
    const params = new URL(req.url, 'http://localhost').searchParams;
    const language = ['en', 'es', 'fr', 'ht', 'ar'].includes(params.get('lang')) ? params.get('lang') : 'en';
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/locales', language, 'credit.json'), 'utf8'));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<html lang="${language}" data-theme="${params.get('theme') === 'dark' ? 'dark' : 'light'}"><head><style>body{margin:0;font-family:Arial}*{box-sizing:border-box}${css}</style></head><body><div id="root"></div><script>window.fixtureCatalog=${JSON.stringify(catalog).replace(/</g, '\\u003c')};window.fixtureRequests=[];window.fixtureAccountMode=${JSON.stringify(params.get('accounts') || 'ready')};window.fixtureFailures=[];window.addEventListener('error',e=>window.fixtureFailures.push(e.message));</script><script type="module" src="/app.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
  catch (error) { await new Promise(resolve => server.close(resolve)); throw error; }
  return { browser, base: `http://127.0.0.1:${server.address().port}`, close: async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); } };
}

test('Apply-driven statements paginate, download applied dates, and isolate pending holds', async () => {
  const env = await fixture();
  try {
    const page = await env.browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${env.base}/oxsteed-credit/statements`);
    await page.waitForFunction(() => document.querySelector('#statement-account') || window.fixtureFailures.length);
    assert.deepEqual(await page.evaluate(() => window.fixtureFailures), []);
    await page.locator('#statement-account').waitFor();
    assert.equal(await page.evaluate(() => window.fixtureRequests.length), 0);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.locator('tbody tr').first().waitFor();
    assert.equal(await page.locator('tbody tr').count(), 50);
    assert.equal(await page.getByRole('heading', { name: 'Current pending holds' }).count(), 0);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal(await page.locator('tbody tr').count(), 1);
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    const applied = await page.evaluate(() => window.fixtureRequests[0].params);
    await page.getByLabel('From', { exact: true }).fill(applied.to);
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download PDF' }).click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), `oxsteed-statement-${applied.from}-${applied.to}-USD.pdf`);
    assert.deepEqual(await page.evaluate(() => window.fixtureRequests.at(-1).params), applied);
    const csvEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV' }).click();
    assert.equal((await csvEvent).suggestedFilename(), `oxsteed-statement-${applied.from}-${applied.to}-USD.csv`);
    await page.getByRole('button', { name: 'Use current month' }).click();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.getByRole('heading', { name: 'Current pending holds' }).waitFor();
    assert.match(await page.locator('.cs-holds').innerText(), /not historical holds/);
    assert.deepEqual(errors, []);
  } finally { await env.close(); }
});

test('late account results never overwrite the current selection', async () => {
  const env = await fixture();
  try {
    const page = await env.browser.newPage();
    await page.goto(`${env.base}/oxsteed-credit/statements`);
    await page.getByLabel('Account', { exact: true }).waitFor();
    await page.evaluate(() => { window.fixtureDelay = 200; });
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.getByLabel('Account', { exact: true }).selectOption('JPY');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.cs-document').count(), 0);
    await page.evaluate(() => { window.fixtureDelay = 20; });
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.locator('.cs-document').waitFor();
    assert.match(await page.locator('.cs-identifiers').innerText(), /fixture-JPY/);
    // Switch accounts again while a slow request is in flight: the late
    // result for the previous account must not overwrite the new selection.
    // (Cross-product tabs were removed; the guard is now exercised via the
    // account selector instead of the Restaurant Credit tab.)
    await page.evaluate(() => { window.fixtureDelay = 200; });
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.getByLabel('Account', { exact: true }).selectOption('USD');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.cs-document').count(), 0);
    await page.evaluate(() => { window.fixtureDelay = 20; });
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.locator('.cs-document').waitFor();
    assert.match(await page.locator('.cs-identifiers').innerText(), /fixture-USD/);
  } finally { await env.close(); }
});

test('empty/error accounts, backend recovery, and oversized documents have safe states', async () => {
  const env = await fixture();
  try {
    const page = await env.browser.newPage();
    await page.goto(`${env.base}/oxsteed-credit/statements?accounts=empty`);
    await page.getByRole('heading', { name: 'No credit accounts available' }).waitFor();
    await page.goto(`${env.base}/oxsteed-credit/statements?accounts=error`);
    await page.getByRole('alert').waitFor();
    await page.evaluate(() => { window.fixtureAccountMode = 'ready'; });
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByLabel('Account', { exact: true }).waitFor();
    for (const [code, expected] of [['statement_before_account', 'before your account was opened'], ['statement_integrity_failed', 'could not be verified'], ['statement_export_too_large', 'incomplete or too large']]) {
      await page.evaluate(value => { window.fixtureError = value; }, code);
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
      await page.waitForFunction(text => document.querySelector('.cs-error')?.textContent.includes(text), expected);
      assert.equal(await page.locator('.cs-document').count(), 0);
      if (code === 'statement_before_account') {
        await page.getByRole('button', { name: 'Use current month' }).click();
        await page.evaluate(() => { window.fixtureError = null; });
        await page.getByRole('button', { name: 'Apply', exact: true }).click();
        await page.getByRole('heading', { name: 'Current pending holds' }).waitFor();
        assert.equal(await page.locator('.cs-error').count(), 0);
      }
    }
    await page.evaluate(() => { window.fixtureError = null; window.fixtureCount = 5001; });
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.cs-error')?.textContent.includes('incomplete or too large'));
    assert.equal(await page.locator('tbody tr').count(), 0);
  } finally { await env.close(); }
});

test('all five locales, both themes, desktop/mobile, RTL, keyboard and reduced motion render correctly', async () => {
  const env = await fixture();
  try {
    const page = await env.browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const language of ['en', 'es', 'fr', 'ht', 'ar']) for (const theme of ['light', 'dark']) for (const mobile of [false, true]) {
      const strings = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/locales', language, 'credit.json'), 'utf8')).statements;
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
      await page.goto(`${env.base}/oxsteed-credit/statements?lang=${language}&theme=${theme}`);
      await page.getByLabel(strings.account, { exact: true }).waitFor();
      await page.getByRole('button', { name: strings.apply, exact: true }).click();
      await page.locator('tbody tr').first().waitFor();
      assert.equal(await page.locator('.credit-statements-shell').getAttribute('dir'), language === 'ar' ? 'rtl' : 'ltr');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.getByRole('heading', { name: strings.title, exact: true }).count(), 1);
      assert.ok(!/\bstatements\.[A-Za-z]/.test(await page.locator('main').innerText()));
      await page.getByLabel(strings.account, { exact: true }).focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.getByLabel(strings.from, { exact: true }).evaluate(element => element === document.activeElement), true);
      assert.equal(await page.locator('.cs-table-scroll').getAttribute('tabindex'), '0');
      if (language === 'ar' && theme === 'dark' && mobile) await page.screenshot({ path: '/tmp/oxsteed-statement-center-rtl.png' });
    }
    assert.deepEqual(errors, []);
  } finally { await env.close(); }
});
