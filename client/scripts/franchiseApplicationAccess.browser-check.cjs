const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('franchise application links follow the projected territory grant', { timeout: 30_000 }, async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { BrowserRouter, Routes, Route } from 'react-router-dom';
      import { createInstance } from 'i18next';
      import { I18nextProvider } from 'react-i18next';
      import FranchiseApplicantDashboard from './src/pages/FranchiseApplicantDashboard.jsx';
      import legacy from './src/locales/en.json';
      const i18n = createInstance();
      i18n.init({ lng: 'en', resources: { en: { translation: legacy } }, interpolation: { escapeValue: false } }).then(() => {
        createRoot(document.getElementById('root')).render(<I18nextProvider i18n={i18n}><BrowserRouter><Routes>
          <Route path="/franchise/status" element={<FranchiseApplicantDashboard />} />
        </Routes></BrowserRouter></I18nextProvider>);
      });
    ` },
    bundle: true, write: false, jsx: 'automatic', loader: { '.css': 'empty', '.js': 'jsx' }, define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'franchise-application-shell', setup(plugin) {
      const fixtures = {
        useAuth: `export const useAuth = () => ({ user: { id: 'franchise-user', role: 'customer', default_mode: 'customer' } });`,
        useAccessProjection: `import { useState } from 'react'; export default () => { const [granted, setGranted] = useState(false); window.grantFranchise = () => setGranted(true); window.revokeFranchise = () => setGranted(false); return { access: { personal: granted ? ['customer', 'franchise.operate'] : ['customer'], organizations: [] }, flags: { accessProjection: true } }; };`,
        Navbar: `import React from 'react'; export default () => React.createElement('nav', { 'data-testid': 'navbar' });`,
        Footer: `import React from 'react'; export default () => React.createElement('footer', { 'data-testid': 'footer' });`,
        DashboardQuickLinks: `import React from 'react'; export const DASHBOARD_QUICK_LINKS = { franchise: [{ to: '/franchise/status' }, { to: '/franchise/territory' }] }; export default ({ items = [] }) => React.createElement('nav', { 'data-testid': 'quick-links' }, items.map((item) => React.createElement('a', { key: item.to, href: item.to }, item.to)));`,
      };
      plugin.onResolve({ filter: /\/(useAuth|useAccessProjection|Navbar|Footer|DashboardQuickLinks)$/ }, ({ path }) => ({ path, namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ resolveDir: root, contents: fixtures[path.basename(args.path)] || 'export default () => null;' }));
    } }],
  });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    await page.route('http://franchise-application.test/**', async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
      if (pathname === '/api/franchise/my-applications') {
        return route.fulfill({ json: {
          applications: [{ id: 11, status: 'approved', desired_brand_name: 'OxSteed Columbus', desired_city: 'Columbus', desired_region: 'OH', desired_country: 'US', submitted_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z' }],
        } });
      }
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script defer src="/fixture.js"></script>' });
    });

    await page.goto('http://franchise-application.test/franchise/status');
    await page.getByText(/OxSteed Columbus/).waitFor();
    assert.equal(await page.locator('a[href="/franchise/territory"]').count(), 0);

    await page.evaluate(() => window.grantFranchise());
    await page.locator('a[href="/franchise/territory"]').first().waitFor();
    assert.equal(await page.locator('a[href="/franchise/territory"]').count(), 2);

    await page.evaluate(() => window.revokeFranchise());
    await page.waitForTimeout(50);
    assert.equal(await page.locator('a[href="/franchise/territory"]').count(), 0);
  } finally {
    await browser.close();
  }
});
