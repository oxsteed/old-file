const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('an approved customer-class investor can open only the projected reporting workspace', { timeout: 30_000 }, async () => {
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
          <Route path="/dashboard" element={<p>home</p>} />
        </Routes></BrowserRouter></I18nextProvider>);
      });
    ` },
    bundle: true, write: false, jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'investor-dashboard-shell', setup(plugin) {
      const fixtures = {
        useAuth: `export const useAuth = () => ({ user: { id: 'applicant', role: 'customer', default_mode: 'customer' } });`,
        useAccessProjection: `export default () => ({ personal: ['customer', 'investor.reporting'], organizations: [] });`,
        PageShell: `export default ({ children }) => children;`,
        Navbar: `export default () => null;`,
        Footer: `export default () => null;`,
      };
      plugin.onResolve({ filter: /\/(useAuth|useAccessProjection|Navbar|Footer|PageShell)$/ }, ({ path }) => ({ path, namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: fixtures[path.basename(args.path)] || 'export default () => null;' }));
    } }],
  });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    const calls = [];
    await page.route('http://investor-dashboard.test/**', async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
      if (pathname === '/api/me/access') return route.fulfill({ json: { accountId: 'applicant', access: { personal: ['customer', 'investor.reporting'], organizations: [] }, flags: { accessProjection: true } } });
      if (pathname.startsWith('/api/investor/')) {
        calls.push(pathname);
        if (pathname === '/api/investor/kpis') return route.fulfill({ json: { period: '30d', kpis: { revenue_cur_cents: 1200, revenue_prev_cents: 1000, revenue_mtd_cents: 1200, total_users: 2, new_users_cur: 1, new_users_prev: 1, open_jobs: 1, completed_jobs: 1, completion_rate: 100, completion_rate_all_time: 100, active_subscriptions: 0, sub_revenue_cur_cents: 0, verified_helpers: 0, avg_helper_rating: null, refunds_cur_cents: 0, pending_payouts_cents: 0, gmv_cents: 1200, take_rate_pct: 10 } } });
        if (pathname === '/api/investor/revenue-chart') return route.fulfill({ json: { chart: [], totals: {} } });
        if (pathname === '/api/investor/franchise') return route.fulfill({ json: { total: 0, stages: [] } });
        if (pathname === '/api/investor/supply-demand') return route.fulfill({ json: { weekly: [], top_categories: [] } });
        return route.fulfill({ json: { buckets: [], min_cell: 5, period_sensitive: true } });
      }
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script defer src="/fixture.js"></script>' });
    });

    await page.goto('http://investor-dashboard.test/investor/dashboard');
    await page.getByRole('heading', { name: /Investor/i }).waitFor();
    await page.getByText('$12').first().waitFor();
    assert.equal(await page.getByText('home', { exact: true }).count(), 0);
    assert.ok(calls.includes('/api/investor/kpis'));
    assert.ok(calls.includes('/api/investor/revenue-chart'));
  } finally {
    await browser.close();
  }
});
