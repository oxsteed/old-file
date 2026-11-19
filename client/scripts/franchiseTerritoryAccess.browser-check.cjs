const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('franchise territory data follows the projected grant', { timeout: 30_000 }, async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { BrowserRouter, Routes, Route } from 'react-router-dom';
      import { createInstance } from 'i18next';
      import { I18nextProvider } from 'react-i18next';
      import FranchiseTerritoryOpsPage from './src/pages/FranchiseTerritoryOpsPage.jsx';
      import legacy from './src/locales/en.json';
      const i18n = createInstance();
      i18n.init({ lng: 'en', resources: { en: { translation: legacy } }, interpolation: { escapeValue: false } }).then(() => {
        createRoot(document.getElementById('root')).render(<I18nextProvider i18n={i18n}><BrowserRouter><Routes>
          <Route path="/franchise/territory" element={<FranchiseTerritoryOpsPage />} />
          <Route path="/franchise/status" element={<p>application-status</p>} />
        </Routes></BrowserRouter></I18nextProvider>);
      });
    ` },
    bundle: true, write: false, jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'franchise-territory-shell', setup(plugin) {
      const fixtures = {
        useAuth: `export const useAuth = () => ({ user: { id: 'franchise-user', role: 'customer', default_mode: 'customer' } });`,
        useAccessProjection: `import { useState } from 'react'; export const ACCESS_CHANGED_EVENT = 'oxsteed:access-changed'; export default () => { const [granted, setGranted] = useState(false); window.grantFranchise = () => setGranted(true); window.revokeFranchise = () => setGranted(false); return { access: { personal: granted ? ['customer', 'franchise.operate'] : ['customer'], organizations: [] }, flags: { accessProjection: true } }; };`,
        PageShell: `export default ({ children }) => children;`,
      };
      plugin.onResolve({ filter: /\/(useAuth|useAccessProjection|PageShell)$/ }, ({ path }) => ({ path, namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ resolveDir: root, contents: fixtures[path.basename(args.path)] || 'export default () => null;' }));
    } }],
  });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    const calls = [];
    await page.route('http://franchise-territory.test/**', async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
      if (pathname.startsWith('/api/franchise/')) {
        calls.push(pathname);
        if (pathname.startsWith('/api/franchise/territory-stats')) {
          return route.fulfill({ json: {
            has_territory: true,
            application: { city: 'Columbus', region: 'OH', country: 'US', training_status: 'completed', agreement_status: 'signed', launch_readiness_status: 'launched', compliance_pct: 100 },
            territory_kpis: { helpers_total: 1, helpers_verified: 1, avg_rating: 5, jobs_posted_30d: 1, jobs_active: 0, jobs_completed: 1, completion_rate: 100, revenue_30d_cents: 1000, revenue_total_cents: 1000, revenue_currency_code: 'USD', available_revenue_currencies: ['USD'] },
          } });
        }
        return route.fulfill({ json: { helpers: [] } });
      }
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script defer src="/fixture.js"></script>' });
    });

    await page.goto('http://franchise-territory.test/franchise/territory');
    await page.getByText(/No active|No.*territory/i).first().waitFor();
    assert.deepEqual(calls, []);

    await page.evaluate(() => window.grantFranchise());
    await page.getByText(/Columbus, OH/).waitFor();
    assert.equal(calls.length, 3);
    assert.ok(calls.includes('/api/franchise/my-applications'));
    assert.ok(calls.some((call) => call.startsWith('/api/franchise/territory-stats')));
    assert.ok(calls.includes('/api/franchise/territory-helpers'));

    await page.evaluate(() => window.revokeFranchise());
    await page.getByText(/No active|No.*territory/i).first().waitFor();
    assert.equal(await page.getByText(/Columbus, OH/).count(), 0);
  } finally {
    await browser.close();
  }
});
