// Arabic + long-subject settings acceptance for progressive access.
// Uses an in-memory API fixture; no account or server is contacted.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('Applications keeps long business subjects bounded and restores focus in Arabic', { timeout: 30_000 }, async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { BrowserRouter, Routes, Route } from 'react-router-dom';
      import { createInstance } from 'i18next';
      import { I18nextProvider } from 'react-i18next';
      import ApplicationsPage from './src/pages/Settings/ApplicationsPage.jsx';
      import en from './src/i18n/locales/en/common.json';
      import ar from './src/i18n/locales/ar/common.json';
      const i18n = createInstance();
      i18n.init({ lng: 'en', ns: ['common'], defaultNS: 'common', resources: { en: { common: en }, ar: { common: ar } } }).then(() => {
        window.setLanguage = async language => { await i18n.changeLanguage(language); document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'; };
        createRoot(document.getElementById('root')).render(<I18nextProvider i18n={i18n}><BrowserRouter><Routes><Route path="/settings/applications" element={<ApplicationsPage />} /></Routes></BrowserRouter></I18nextProvider>);
      });
    ` },
    bundle: true, write: false, jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'progressive-settings-fixtures', setup(plugin) {
      const fixtures = {
        AuthContext: `export const useAuth = () => ({ user: { id: 'applicant', role: 'customer' } });`,
        Navbar: `export default () => null;`, Footer: `export default () => null;`,
      };
      plugin.onResolve({ filter: /\/(AuthContext|Navbar|Footer)$/ }, ({ path: request }) => ({ path: request, namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: request }) => ({ contents: fixtures[request.split('/').pop()] || 'export default () => null;', loader: 'jsx' }));
      plugin.onResolve({ filter: /\/api\/access$/ }, ({ path: request }) => ({ path: request, namespace: 'access-fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'access-fixture' }, () => ({ contents: `
        const request = { id: 'r1', capability: 'business.own', status: 'draft', version: 1,
          subjectDisplay: { kind: 'new_business', name: 'شركة ضيافة ومطاعم واستشارات غذائية طويلة للغاية للاختبار' },
          availableActions: ['withdraw'], answers: {} };
        const policy = { capability: 'business.own', applicantMayRequest: true, subjectTypes: ['business_proposal'], form: { fields: [{ name: 'business_name', type: 'text', required: true, maxLength: 200 }] } };
        export const accessAPI = {
          getAccess: async () => ({ access: { personal: ['customer'], organizations: [] } }),
          listRequests: async () => ({ requests: [request] }), listPolicies: async () => ({ policies: [policy] }),
          getRequest: async () => ({ request }), updateRequest: async () => ({ request }), transition: async () => ({ request }),
          createRequest: async () => ({ request }),
        };
      `, loader: 'jsx' }));
    } }],
  });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 760 } });
    await page.route('http://progressive-settings.test/**', async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script defer src="/fixture.js"></script>' });
    });
    await page.goto('http://progressive-settings.test/settings/applications');
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.evaluate(() => window.setLanguage('ar'));
    await page.getByText('شركة ضيافة ومطاعم واستشارات غذائية طويلة للغاية للاختبار', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

    const continueButton = page.locator('[data-track="ui.access.applications.continue"]');
    await continueButton.click();
    await page.getByRole('button', { name: /إغلاق|Close/ }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-track') === 'ui.access.applications.continue');
    assert.equal(await page.locator('[role="status"][aria-live="polite"]').count(), 1);
  } finally {
    await browser.close();
  }
});
