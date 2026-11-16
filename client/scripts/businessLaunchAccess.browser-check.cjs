const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('an Owner application can open linked Business Launch intake and show its independent status', { timeout: 30_000 }, async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { BrowserRouter, Routes, Route } from 'react-router-dom';
      import { createInstance } from 'i18next';
      import { I18nextProvider } from 'react-i18next';
      import ApplicationsPage from './src/pages/Settings/ApplicationsPage.jsx';
      import ConsultingIntakePage from './src/pages/ConsultingIntakePage.jsx';
      import legacy from './src/locales/en.json';
      import common from './src/i18n/locales/en/common.json';

      const i18n = createInstance();
      i18n.init({ lng: 'en', resources: { en: { translation: legacy, common } }, interpolation: { escapeValue: false } }).then(() => {
        createRoot(document.getElementById('root')).render(<I18nextProvider i18n={i18n}><BrowserRouter><Routes>
          <Route path="/settings/applications" element={<ApplicationsPage />} />
          <Route path="/consulting-intake" element={<ConsultingIntakePage />} />
        </Routes></BrowserRouter></I18nextProvider>);
      });
    ` },
    bundle: true, write: false, jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'business-launch-shell', setup(plugin) {
      const fixtures = {
        'AuthContext': `export const useAuth = () => ({ user: { id: 'applicant', role: 'customer', email: 'applicant@example.invalid' } });`,
        'PageShell': `export default ({ children }) => children;`,
      };
      plugin.onResolve({ filter: /\/(AuthContext|Navbar|Footer|PageShell|PageMeta)$/ }, ({ path }) => ({ path, namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
        contents: fixtures[path.basename(args.path)] || 'export default () => null;',
      }));
    } }],
  });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const submissions = [];
    const application = {
      id: '321', capability: 'business.own', status: 'draft', version: 1,
      subjectDisplay: { kind: 'new_business', name: null }, availableActions: [], answers: {},
    };
    let hasApplication = false;
    await page.route('http://business-launch.test/**', async (route) => {
      const { pathname } = new URL(route.request().url());
      const method = route.request().method();
      if (pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
      if (pathname === '/api/me/access') return route.fulfill({ json: { accountId: 'applicant', access: { personal: ['customer'] } } });
      if (pathname === '/api/me/access-policies') return route.fulfill({ json: { policies: [{
        capability: 'business.own', applicantMayRequest: true, subjectTypes: ['business_proposal', 'business'], form: { fields: [] },
      }] } });
      if (pathname === '/api/me/access-requests') {
        if (method === 'POST') {
          submissions.push(route.request().postDataJSON());
          hasApplication = true;
          return route.fulfill({ status: 201, json: { request: application } });
        }
        return route.fulfill({ json: { requests: hasApplication ? [application] : [] } });
      }
      if (pathname === `/api/me/access-requests/${application.id}`) return route.fulfill({ json: { request: application } });
      if (pathname === '/api/consulting/business-launch/submit') {
        submissions.push(route.request().postDataJSON());
        application.businessLaunch = { status: 'pending' };
        return route.fulfill({ status: 201, json: { requestId: 'fixture-launch' } });
      }
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script defer src="/fixture.js"></script>' });
    });

    await page.goto('http://business-launch.test/settings/applications');
    await page.locator('[data-track="ui.access.applications.apply"]').click();
    await page.getByRole('link', { name: 'OxSteed Business Launch' }).click();
    await page.waitForURL('**/consulting-intake');
    assert.deepEqual(submissions[0].subject, { type: 'business_proposal' });

    for (const [field, value] of Object.entries({ email: 'applicant@example.invalid', first_name: 'Kay', last_name: 'Fixture', phone: '5550000000' })) {
      await page.locator(`[name="${field}"]`).fill(value);
    }
    const next = page.getByRole('button', { name: 'Next', exact: true });
    await next.click();
    await page.locator('select').filter({ has: page.locator('option[value="__other__"]') }).selectOption('__other__');
    await page.locator('[name="skill_description"]').fill('Baking');
    await page.locator('[name="target_market"]').fill('Local');
    await page.locator('[name="has_revenue"][value="no"]').check();
    await page.locator('[name="business_name_decided"][value="no"]').check();
    await page.locator('[name="operating_country"]').selectOption('US');
    await page.locator('[name="operating_state"]').selectOption('OH');
    await next.click();
    await page.locator('input[type="checkbox"]').first().check();
    await page.locator('[name="urgency"][value="exploring"]').check();
    await next.click();
    const packages = require('../src/locales/en.json').consulting.intake.packageDetails;
    await page.getByRole('heading', { name: packages.launch.name }).click();
    await next.click();
    const submit = require('../src/locales/en.json').consulting.intake.buttons.submit;
    await page.getByRole('button', { name: submit, exact: true }).click();
    await page.waitForURL('**/settings/applications');
    await page.getByText('Business launch request · Pending', { exact: true }).waitFor();
    await page.getByText('Draft', { exact: true }).waitFor();
    assert.equal(submissions[1].access_request_id, application.id);
    assert.equal(await page.getByRole('link', { name: 'OxSteed Business Launch' }).count(), 0);
  } finally {
    await browser.close();
  }
});
