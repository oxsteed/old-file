// Synthetic accounts only. Exercise the real center and embedded statements.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const userId = '22222222-2222-4222-8222-222222222222';
const product = scopes => ({ hasAccount: true, scopes });
const scope = (key, extra) => ({ scopeKey: key, label: 'Fixture', currency: 'USD', ...extra });
const allProducts = {
  oxsteedCredit: product([scope('ox:USD', { accountId: '17' }), scope('ox:EUR', { accountId: '18', currency: 'EUR' })]),
  restaurantCredit: product([scope('wallet:9', { accountId: '19', restaurantId: '9', label: 'My Bistro wallet' })]),
  helperEarnings: product([scope('helper:USD')]),
  restaurantSettlement: product([scope('settlement:9', { restaurantId: '9', businessId: '42', label: 'Bistro location' })]),
  business: product([scope('business:42', { businessId: '42', label: 'Bistro company' + ' Long business name'.repeat(6) })]),
};

async function fixture() {
  const apiMock = `export default { get: async (url, options = {}) => {
    const params = options.params || {}; window.requests.push({ url, params });
    if (url === '/statements/center') {
      const data = window.products;
      await new Promise(resolve => setTimeout(resolve, window.centerDelay || 0));
      if (window.failCenter) throw Error('Synthetic failure');
      return { data: { products: data } };
    }
    if (url === '/oxsteed-credit/accounts') return { data: { accounts: [{ accountId: '17', currencyCode: 'USD' }, { accountId: '18', currencyCode: 'EUR' }] } };
    if (url === '/food/customer/wallets') return { data: { wallets: [{ accountId: '19', restaurantId: '9', restaurantName: 'My Bistro wallet', currencyCode: 'USD' }] } };
    if (url === '/statement-archive/scopes') return { data: { accounts: [{ accountId: params.product === 'business' ? '42' : params.product === 'helper_earnings' ? '${userId}' : '9', currencyCode: 'USD', name: 'Bistro company' }] } };
    if (url === '/statement-archive/archive') return { data: { items: [], total: 0, page: 1, totalPages: 1 } };
    if (/\\.(csv|pdf)$/.test(url)) return { data: new Blob(['Synthetic statement'], { type: url.endsWith('.pdf') ? 'application/pdf' : 'text/csv' }), headers: { 'content-type': url.endsWith('.pdf') ? 'application/pdf' : 'text/csv' } };
    if (url === '/oxsteed-credit/documents' || /\\/wallets\\/9\\/statements$/.test(url)) return { data: { statement: {
      id: 'synthetic', kind: 'monthly', product: url.startsWith('/food') ? 'restaurant' : 'oxsteed',
      currencyCode: params.currencyCode, period: { from: params.from, to: params.to },
      generatedAt: params.to + 'T12:00:00Z', accountLabel: 'Synthetic account',
      openingBalanceCents: 100, totalCreditsCents: 0, totalDebitsCents: 0, closingBalanceCents: 100,
      totalHeldCents: 0, transactionCount: 0, transactions: [], holds: []
    } } };
    return { data: { accounts: [], items: [], jobs: [], months: [], views: [] } };
  } };`;
  const mocks = {
    '../../api/axios': apiMock, './axios': apiMock,
    '../../context/AuthContext': `import { useState } from 'react'; export function useAuth() {
      const [user, setUser] = useState({ id: '${userId}' }); window.switchUser = setUser; return { user };
    }`,
    '../../components/Navbar': 'export default () => <nav>Fixture navigation</nav>;',
    '../../components/Footer': 'export default () => <footer>Fixture footer</footer>;',
    '../../components/PageMeta': 'export default () => null;',
    'react-i18next': `export const useTranslation = () => ({ t: (key, options = {}) => {
      const value = key.split('.').reduce((entry, part) => entry?.[part], window.catalog);
      return (typeof value === 'string' ? value : options.defaultValue || key).replace(/\\{\\{(\\w+)\\}\\}/g, (_, name) => String(options[name] ?? ''));
    }, i18n: { resolvedLanguage: document.documentElement.lang, dir: () => document.documentElement.lang === 'ar' ? 'rtl' : 'ltr' } });`,
  };
  const bundled = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { BrowserRouter } from 'react-router-dom'; import StatementCenterPage from './src/pages/food/StatementCenterPage'; createRoot(document.getElementById('root')).render(<BrowserRouter><StatementCenterPage /></BrowserRouter>);` },
    bundle: true, write: false, jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'fixtures', setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: root }));
    } }],
  });
  const css = ['pages/food/StatementCenterPage.css', 'pages/food/CreditStatementsPage.css', 'pages/food/StatementArchivePage.css']
    .map(file => fs.readFileSync(path.join(root, 'src', file), 'utf8')).join('\n');
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundled.outputFiles[0].contents); return; }
    const params = new URL(req.url, 'http://localhost').searchParams;
    const lang = params.get('lang') || 'en';
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/locales', lang, 'credit.json'), 'utf8'));
    const products = params.get('customer') ? { oxsteedCredit: allProducts.oxsteedCredit } : allProducts;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<html lang="${lang}" data-theme="${params.get('theme') || 'light'}"><head><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}${css}</style></head><body><div id="root"></div><script>window.catalog=${JSON.stringify(catalog).replace(/</g, '\\u003c')};window.products=${JSON.stringify(products)};window.requests=[];</script><script src="/app.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  return { browser, base: `http://127.0.0.1:${server.address().port}`, close: async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); } };
}

test('customer chooses account, currency and period then downloads without leaving Statements', async () => {
  const env = await fixture();
  try {
    const page = await env.browser.newPage();
    await page.goto(`${env.base}/statements?customer=1`);
    await page.getByRole('button', { name: /OxSteed Credit/ }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Work & business', exact: true }).count(), 0);
    await page.getByRole('button', { name: /OxSteed Credit/ }).click();
    await page.locator('#statement-from').waitFor();
    assert.equal(await page.locator('main').count(), 1);
    assert.equal(await page.locator('nav').filter({ hasText: 'Fixture navigation' }).count(), 1);
    assert.equal(await page.locator('footer').count(), 1);
    await page.getByLabel('Account and currency').selectOption('ox:EUR');
    await page.locator('#statement-from').fill('2026-09-01');
    await page.locator('#statement-to').fill('2026-09-30');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.getByRole('button', { name: 'Download PDF' }).waitFor();
    assert.match(page.url(), /\/statements\?/);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download PDF' }).click();
    assert.match((await download).suggestedFilename(), /2026-09-01-2026-09-30-EUR/);
    assert.match(await page.getByRole('link', { name: 'Open full page' }).getAttribute('href'), /currencyCode=EUR&from=2026-09-01&to=2026-09-30/);
    await page.getByRole('button', { name: 'View statement archive', exact: true }).click();
    await page.locator('#archive-year').waitFor();
    assert.deepEqual(await page.evaluate(() => window.requests.filter(item => item.url === '/statement-archive/archive').at(-1).params), { product: 'oxsteed', accountId: '18', currency: 'EUR', page: 1, per_page: 20, year: undefined, month: undefined });
    await page.getByRole('button', { name: 'Change account', exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.classList.contains('statement-center-account'));
    assert.match(await page.evaluate(() => document.activeElement.textContent), /OxSteed Credit/);
  } finally { await env.close(); }
});

test('restaurant owner opens one business with distinct settlement and business records; wallet stays personal', async () => {
  const env = await fixture();
  try {
    const page = await env.browser.newPage();
    await page.goto(`${env.base}/statements`);
    await page.getByRole('button', { name: /Bistro company/ }).waitFor();
    assert.equal(await page.locator('.statement-center-account').count(), 4);
    await page.getByRole('button', { name: /Bistro company/ }).click();
    await page.locator('#archive-year').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Restaurant credit activity & settlements', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.locator('#archive-year').selectOption('2026');
    await page.locator('#archive-month').selectOption('9');
    await page.waitForFunction(() => window.requests.some(item => item.url === '/statement-archive/archive' && item.params.month === '9'));
    const request = await page.evaluate(() => window.requests.filter(item => item.url === '/statement-archive/archive').at(-1).params);
    assert.equal(request.accountId, '9'); assert.equal(request.currency, 'USD'); assert.equal(request.product, 'restaurant_settlement');
    assert.match(await page.getByRole('link', { name: 'Open full page' }).getAttribute('href'), /accountId=9&currency=USD&year=2026&month=9/);
    await page.getByRole('button', { name: 'Business records', exact: true }).click();
    await page.waitForFunction(() => window.requests.some(item => item.url === '/statement-archive/archive' && item.params.product === 'business'));
    assert.equal(await page.evaluate(() => window.requests.filter(item => item.url === '/statement-archive/archive').at(-1).params.accountId), '42');
    assert.equal(await page.locator('#archive-month').inputValue(), '9');
    assert.equal(await page.locator('#archive-account').count(), 0);
    await page.goBack(); await page.getByRole('button', { name: 'Restaurant credit activity & settlements', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Restaurant credit activity & settlements', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Change account', exact: true }).click();
    await page.getByRole('button', { name: /My helper earnings/ }).click();
    await page.locator('#archive-year').waitFor();
    assert.equal(await page.evaluate(() => window.requests.filter(item => item.url === '/statement-archive/archive').at(-1).params.accountId), userId);
    await page.getByRole('button', { name: 'Change account', exact: true }).click();
    await page.getByRole('button', { name: /My Bistro wallet/ }).click();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.getByRole('button', { name: 'Download PDF' }).waitFor();
    assert.ok(await page.evaluate(() => window.requests.some(item => item.url === '/food/customer/wallets/9/statements')));
  } finally { await env.close(); }
});

test('account failures retry; sign-in changes suppress stale financial accounts and late responses', async () => {
  const env = await fixture();
  try {
    const page = await env.browser.newPage();
    await page.goto(`${env.base}/statements`);
    await page.getByRole('button', { name: /Bistro company/ }).waitFor();
    await page.evaluate(() => { window.products = { business: { loadError: true, hasAccount: false, scopes: [] } }; window.switchUser({ id: 'other' }); });
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('.statement-center-account').count(), 0);
    await page.evaluate(() => { window.products = {}; });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByText('No statement accounts are available yet.', { exact: false }).waitFor();
    await page.evaluate(() => { window.centerDelay = 250; window.products = { business: { hasAccount: true, scopes: [{ scopeKey: 'private', businessId: '99', label: 'Old private business' }] } }; window.switchUser({ id: 'old-account' }); });
    await page.waitForFunction(() => window.requests.filter(item => item.url === '/statements/center').length >= 4);
    await page.evaluate(() => { window.centerDelay = 0; window.products = {}; window.switchUser({ id: 'new-account' }); });
    await page.getByText('No statement accounts are available yet.', { exact: false }).waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.getByText('Old private business').count(), 0);
  } finally { await env.close(); }
});

test('five locales, light/dark, requested widths and RTL wrap in both account list and selected record', async () => {
  const env = await fixture();
  try {
    const page = await env.browser.newPage(); const errors = [];
    const screenshots = fs.mkdtempSync('/tmp/oxsteed-statement-layout-');
    page.on('pageerror', error => errors.push(error.message));
    for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) for (const theme of ['light', 'dark']) {
      for (const width of [320, 390, 768, 1360, 1600]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${env.base}/statements?lang=${lang}&theme=${theme}`);
        await page.locator('.statement-center-account').first().waitFor();
        await page.evaluate(() => { document.querySelectorAll('.statement-center-account strong').forEach(node => { node.textContent += ' Long business name '.repeat(6); }); });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${lang}/${theme}/${width}: list`);
        await page.locator('.statement-center-account').first().click();
        await page.locator('#statement-from').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${lang}/${theme}/${width}: selected`);
        assert.equal(await page.locator('.statement-center-shell').getAttribute('dir'), lang === 'ar' ? 'rtl' : 'ltr');
        assert.equal(await page.getByText(/statements\.center\./).count(), 0);
        if (['fr', 'ar'].includes(lang)) {
          await page.goBack();
          await page.getByRole('button', { name: /Bistro company/ }).click();
          await page.locator('#archive-year').waitFor();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${lang}/${theme}/${width}: business`);
          if (theme === 'dark' && ((lang === 'fr' && width === 1360) || (lang === 'ar' && width === 390))) {
            await page.screenshot({ path: path.join(screenshots, `${lang}-${width}.png`), fullPage: true });
          }
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log('Statement layout screenshots:', screenshots);
  } finally { await env.close(); }
});
