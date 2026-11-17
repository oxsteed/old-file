// Arabic + long-subject settings acceptance for progressive access.
// Uses an in-memory API fixture; no account or server is contacted.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('Applications keeps long business subjects bounded and restores focus in Arabic', { timeout: 90_000 }, async () => {
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
        window.__fixture = { r1Status: 'draft', version: 1 };
        const request = () => ({ id: 'r1', capability: 'business.own', status: window.__fixture.r1Status, version: window.__fixture.version,
          subjectDisplay: { kind: 'new_business', name: 'شركة ضيافة ومطاعم واستشارات غذائية طويلة للغاية للاختبار' },
          availableActions: window.__fixture.r1Status === 'draft' ? ['withdraw'] : [], answers: {},
          ...(window.__fixture.version > 1 ? { informationRequest: 'Please add your city' } : {}) });
        // The server rejects writes carrying a stale expectedVersion; the
        // fixture enforces the same rule so the conflict path is exercised.
        const checkVersion = (body) => { const current = request(); if (body && body.expectedVersion !== undefined && body.expectedVersion !== current.version) { const err = new Error('request_version_conflict'); err.response = { data: { code: 'request_version_conflict' } }; throw err; } return current; };
        const approved = { id: 'r2', capability: 'restaurant.own', status: 'approved', version: 2,
          subjectDisplay: { kind: 'new_business', name: 'Approved Bistro' }, availableActions: [], answers: {},
          submittedAt: '2026-11-01T10:00:00.000Z', publicReasonCode: 'review_complete' };
        const history = [
          { action: 'submit', at: '2026-11-01T10:00:00.000Z', publicReasonCode: null },
          { action: 'approve', at: '2026-11-05T15:30:00.000Z', publicReasonCode: 'review_complete' },
        ];
        const policy = { capability: 'business.own', applicantMayRequest: true, subjectTypes: ['business_proposal'], form: { fields: [{ name: 'business_name', type: 'text', required: true, maxLength: 200 }] } };
        const resuming = new URLSearchParams(window.location.search).has('resume');
        let recovered = false;
        export const accessAPI = {
          getAccess: async () => ({ access: { personal: ['customer'], organizations: [],
            ...(resuming ? { signupResume: { capability: 'business.own', requestId: null, returnTo: '/jobs/42' } } : {}) } }),
          listRequests: async () => ({ requests: resuming ? (recovered ? [request()] : []) : [request(), approved] }),
          listPolicies: async () => ({ policies: [policy] }),
          getRequest: async (id) => (id === 'r2' ? { request: approved, history } : { request: request(), history }),
          updateRequest: async (id, body) => ({ request: checkVersion(body) }),
          transition: async (id, action, body) => { if (action === 'withdraw') window.__fixture.r1Status = 'withdrawn'; return { request: checkVersion(body) }; },
          createRequest: async (body, key) => { recovered = true; window.applicationRecovery = { body, key }; window.__fixture.r1Status = 'draft'; return { request: request() }; },
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
    const workspace = page.getByRole('link', { name: 'افتح مساحة عملك التجارية' });
    assert.equal(await workspace.getAttribute('href'), '/business-hub');

    // AC-010: the approved row shows its decision timeline and dates.
    const approvedRow = page.locator('li', { hasText: 'Approved Bistro' });
    await approvedRow.getByRole('button', { name: 'عرض الحالة' }).click();
    await approvedRow.getByText('تمت الموافقة').waitFor();
    assert.equal(await approvedRow.locator('ol li time').count(), 2);
    assert.ok(await approvedRow.getByText(/أُرسلت في/).count() >= 1);
    await approvedRow.getByRole('button', { name: 'إغلاق' }).click();
    assert.equal(await approvedRow.locator('ol li time').count(), 0);

    // AC-022: the approval status timeline is reachable by keyboard alone.
    const statusToggle = approvedRow.getByRole('button', { name: 'عرض الحالة' });
    await statusToggle.focus();
    await page.keyboard.press('Enter');
    await approvedRow.getByText('تمت الموافقة').waitFor();
    await approvedRow.getByRole('button', { name: 'إغلاق' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-track') === 'ui.access.applications.view_status');

    const continueButton = page.locator('[data-track="ui.access.applications.continue"]');
    await continueButton.click();
    await page.getByRole('button', { name: /إغلاق|Close/ }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-track') === 'ui.access.applications.continue');
    assert.equal(await page.locator('[role="status"][aria-live="polite"]').count(), 1);

    await page.goto('http://progressive-settings.test/settings/applications?resume=1');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForURL('**/settings/applications?resume=1&request=r1');
    assert.deepEqual(await page.evaluate(() => window.applicationRecovery), {
      body: { capability: 'business.own', subject: { type: 'business_proposal' }, source: 'signup', answers: {}, returnTo: '/jobs/42' },
      key: 'signup-applicant',
    });
    // Fresh load: English again, no signup resume in play.
    await page.goto('http://progressive-settings.test/settings/applications');
    await page.getByRole('heading', { level: 1 }).waitFor();

    // AC-021: a reviewer decision that lands while editing keeps the answers.
    await page.locator('[data-track="ui.access.applications.continue"]').click();
    const editorSection = page.locator('section[aria-labelledby^="req-r1-title"]');
    await editorSection.waitFor();
    const businessName = page.locator('section[aria-labelledby^="req-r1-title"] textarea').first();
    await businessName.fill('Corner bistro with a patio');
    // Race: the decision lands after the last reload, so the submit goes out
    // with the old version and conflicts. The answers must survive the
    // conflict and the retry must submit against the new version.
    await page.evaluate(() => { window.__fixture.version = 2; });
    await page.locator('[data-track="ui.access.applications.submit"]').click();
    await page.getByText(/changed while you were editing/i).waitFor();
    assert.equal(await businessName.inputValue(), 'Corner bistro with a patio');
    assert.ok(await page.getByText('Please add your city').count() >= 1);
    await page.locator('[data-track="ui.access.applications.submit"]').click();
    await page.waitForFunction(() => !document.querySelector('section[aria-labelledby^="req-r1-title"]'));
    // Happy path: a second decision arrives via silent reload before submit.
    await page.locator('[data-track="ui.access.applications.continue"]').click();
    await editorSection.waitFor();
    await businessName.fill('Corner bistro with a patio');
    await page.evaluate(() => { window.__fixture.version = 3; });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByText(/changed while you were editing/i).waitFor();
    assert.equal(await businessName.inputValue(), 'Corner bistro with a patio');
    assert.ok(await page.getByText('Please add your city').count() >= 1);
    await page.locator('[data-track="ui.access.applications.submit"]').click();
    await page.waitForFunction(() => !document.querySelector('section[aria-labelledby^="req-r1-title"]'));

    // AC-009: withdraw then apply again from the same row.
    await page.locator('[data-track="ui.access.applications.withdraw"]').first().click();
    await page.locator('[data-track="ui.access.applications.withdraw_confirm"]').click();
    await page.getByRole('button', { name: 'Apply again' }).waitFor();
    assert.ok(await page.getByText('Withdrawn').count() >= 1);
    await page.getByRole('button', { name: 'Apply again' }).click();
    await editorSection.waitFor();
    assert.deepEqual(await page.evaluate(() => window.applicationRecovery), {
      body: { capability: 'business.own', subject: { type: 'business_proposal' }, source: 'settings', answers: {} },
      key: undefined,
    });
  } finally {
    await browser.close();
  }
});
