const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('Settings Applications captures an investor audience and requested datasets', { timeout: 30_000 }, async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { BrowserRouter, Routes, Route } from 'react-router-dom';
      import { createInstance } from 'i18next';
      import { I18nextProvider } from 'react-i18next';
      import ApplicationsPage from './src/pages/Settings/ApplicationsPage.jsx';
      import legacy from './src/locales/en.json';
      import common from './src/i18n/locales/en/common.json';
      const i18n = createInstance();
      i18n.init({ lng: 'en', resources: { en: { translation: legacy, common } }, interpolation: { escapeValue: false } }).then(() => {
        createRoot(document.getElementById('root')).render(<I18nextProvider i18n={i18n}><BrowserRouter><Routes>
          <Route path="/settings/applications" element={<ApplicationsPage />} />
        </Routes></BrowserRouter></I18nextProvider>);
      });
    ` },
    bundle: true, write: false, jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'investor-access-shell', setup(plugin) {
      const fixtures = {
        AuthContext: `export const useAuth = () => ({ user: { id: 'applicant', role: 'customer', email: 'applicant@example.invalid' } });`,
        Navbar: `export default () => null;`,
        Footer: `export default () => null;`,
      };
      plugin.onResolve({ filter: /\/(AuthContext|Navbar|Footer)$/ }, ({ path }) => ({ path, namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: fixtures[path.basename(args.path)] || 'export default () => null;' }));
    } }],
  });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    await page.addInitScript(() => {
      if (!crypto.randomUUID) crypto.randomUUID = () => 'fixture-idempotency-key-0001';
    });
    const submissions = [];
    let requestState = null;
    const policy = {
      capability: 'investor.reporting', applicantMayRequest: true, subjectTypes: ['self'],
      form: { fields: [
        { name: 'audience', type: 'string', required: true, maxLength: 160 },
        { name: 'requestedReports', type: 'string_list', required: true, maxItems: 6, maxLength: 80 },
        { name: 'about', type: 'text', maxLength: 2000 },
      ] },
    };
    await page.route('http://investor-access.test/**', async (route) => {
      const { pathname } = new URL(route.request().url());
      const method = route.request().method();
      if (pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
      if (pathname === '/api/me/access') return route.fulfill({ json: { accountId: 'applicant', access: { personal: ['customer'], organizations: [] } } });
      if (pathname === '/api/me/access-policies') return route.fulfill({ json: { policies: [policy] } });
      if (pathname === '/api/me/access-requests') {
        if (method === 'POST') {
          const body = route.request().postDataJSON();
          requestState = { id: '42', capability: 'investor.reporting', status: 'draft', version: 1, answers: body.answers || {}, availableActions: ['edit', 'submit', 'withdraw'], subjectDisplay: { kind: 'self' } };
          submissions.push(body);
          return route.fulfill({ status: 201, json: { request: requestState } });
        }
        return route.fulfill({ json: { requests: requestState ? [requestState] : [] } });
      }
      if (pathname === '/api/me/access-requests/42') return route.fulfill({ json: { request: requestState } });
      if (pathname === '/api/me/access-requests/42/submit') {
        const body = route.request().postDataJSON();
        requestState = { ...requestState, status: 'submitted', version: 2, answers: body.answers, availableActions: [] };
        submissions.push(body);
        return route.fulfill({ json: { request: requestState } });
      }
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script defer src="/fixture.js"></script>' });
    });

    await page.goto('http://investor-access.test/settings/applications');
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.getByLabel('Reporting audience').fill('Quarterly board');
    await page.getByLabel('Reports you need').fill('Overview, Revenue');
    await page.locator('[data-track="ui.access.applications.submit"]').click();
    await page.waitForTimeout(500);
    await page.getByText('Submitted', { exact: true }).waitFor();
    assert.deepEqual(submissions[0].capability, 'investor.reporting');
    assert.deepEqual(submissions.at(-1).answers, { audience: 'Quarterly board', requestedReports: ['Overview', 'Revenue'] });
  } finally {
    await browser.close();
  }
});
