const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('revoked investor projection clears the dashboard before stale data renders', { timeout: 30_000 }, async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { BrowserRouter, Routes, Route } from 'react-router-dom';
      import { createInstance } from 'i18next';
      import { I18nextProvider } from 'react-i18next';
      import InvestorDashboardPage from './src/pages/InvestorDashboardPage.jsx';
      import legacy from './src/locales/en.json';
      import common from './src/i18n/locales/en/common.json';
      const i18n = createInstance();
      i18n.init({ lng: 'en', resources: { en: { translation: legacy, common } }, interpolation: { escapeValue: false } }).then(() => {
        createRoot(document.getElementById('root')).render(<I18nextProvider i18n={i18n}><BrowserRouter><Routes>
          <Route path="/investor/dashboard" element={<InvestorDashboardPage />} />
          <Route path="/dashboard" element={<p>customer-home</p>} />
        </Routes></BrowserRouter></I18nextProvider>);
      });
    ` },
    bundle: true, write: false, jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'investor-revocation-shell', setup(plugin) {
      const fixtures = {
        useAuth: `export const useAuth = () => ({ user: { id: 'applicant', role: 'customer', default_mode: 'customer' } });`,
        PageShell: `export default ({ children }) => children;`,
        Navbar: `export default () => null;`,
        Footer: `export default () => null;`,
      };
      plugin.onResolve({ filter: /\/(useAuth|Navbar|Footer|PageShell)$/ }, ({ path }) => ({ path, namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: fixtures[path.basename(args.path)] || 'export default () => null;' }));
    } }],
  });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    let accessReads = 0;
    const investorCalls = [];
    const historyCalls = [];
    const pendingInvestor = [];
    await page.route('http://investor-revocation.test/**', async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
      if (pathname === '/api/me/access') {
        accessReads += 1;
        const access = accessReads === 1
          ? { personal: ['customer', 'investor.reporting'], organizations: [], investorAudience: { audienceKey: 'quarterly board', datasets: ['overview', 'revenue'] } }
          : { personal: ['customer'], organizations: [] };
        return route.fulfill({ json: { accountId: 'applicant', access, flags: { accessProjection: true } } });
      }
      // Slice 5h (739, D-782): the reporting section loads the holder's
      // access history on mount; it is fulfilled immediately, unlike the
      // held investor calls below.
      if (pathname === '/api/me/access-history') { historyCalls.push(pathname); return route.fulfill({ json: { events: [] } }); }
      if (pathname.startsWith('/api/investor/')) {
        investorCalls.push(pathname);
        await new Promise(resolve => pendingInvestor.push({ route, resolve }));
        return undefined;
      }
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script defer src="/fixture.js"></script>' });
    });

    await page.goto('http://investor-revocation.test/investor/dashboard');
    await page.getByRole('heading', { name: /Investor/i }).waitFor();
    await page.waitForFunction(() => window.location.pathname === '/investor/dashboard');
    await page.getByText('Reporting access history').waitFor();
    // Slice 5f (726-728, D-769..D-771): the dashboard also loads the
    // entity reporting section on mount (entities, datasets, documents).
    assert.deepEqual(investorCalls.sort(), ['/api/investor/kpis', '/api/investor/reporting/datasets', '/api/investor/reporting/documents', '/api/investor/reporting/entities', '/api/investor/revenue-chart'].sort());
    assert.ok(historyCalls.includes('/api/me/access-history'));

    await page.evaluate(() => window.dispatchEvent(new Event('oxsteed:access-changed')));
    await page.getByText('customer-home', { exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: /Investor/i }).count(), 0);

    for (const pending of pendingInvestor) {
      const pathname = new URL(pending.route.request().url()).pathname;
      const json = pathname.endsWith('/kpis')
        ? { kpis: { revenue_cur_cents: 99900, total_users: 999 } }
        : { chart: [{ job_fee_cents: 99900, subscription_cents: 0 }] };
      await pending.route.fulfill({ json });
      pending.resolve();
    }
    await page.waitForTimeout(100);
    assert.equal(await page.getByText('$999').count(), 0);
    assert.equal(await page.getByText('customer-home', { exact: true }).count(), 1);
  } finally {
    await browser.close();
  }
});
