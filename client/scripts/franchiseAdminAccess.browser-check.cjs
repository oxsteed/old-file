const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('franchise admin controls preserve grants across activation, reassignment, and revoke', { timeout: 30_000 }, async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { BrowserRouter, Route, Routes } from 'react-router-dom';
      import { createInstance } from 'i18next';
      import { I18nextProvider } from 'react-i18next';
      import FranchiseHQPage from './src/admin/pages/super/FranchiseHQPage.jsx';
      import legacy from './src/locales/en.json';
      const i18n = createInstance();
      i18n.init({ lng: 'en', resources: { en: { translation: legacy } }, interpolation: { escapeValue: false } }).then(() => {
        createRoot(document.getElementById('root')).render(<I18nextProvider i18n={i18n}><BrowserRouter><Routes>
          <Route path="/admin/super/franchises" element={<FranchiseHQPage />} />
        </Routes></BrowserRouter></I18nextProvider>);
      });
    ` },
    bundle: true, write: false, jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' },
  });

  const state = {
    application: {
      id: 'franchise-application-1',
      first_name: 'Alex', last_name: 'Owner', email: 'alex@example.test',
      desired_brand_name: 'OxSteed Columbus', current_company_name: '',
      desired_country: 'US', desired_region: 'OH', desired_city: 'Columbus',
      territory_summary: 'Columbus territory', status: 'approved',
      agreement_status: 'signed', training_status: 'completed', launch_readiness_status: 'ready',
      owner_user_id: 'owner-a', owner_email: 'alex@example.test', linked_business_id: null,
      linked_business_name: null, preferred_store_count: 1, checklist_total: 1, checklist_completed: 1,
      available_capital_cents: 100000, liquid_capital_cents: 50000,
    },
    grantOwner: null,
    revokedOwners: [],
    businessCounter: 0,
    activationCalls: [],
    patchCalls: [],
  };

  const listRow = () => ({ ...state.application });
  const bundleData = () => ({
    application: { ...state.application },
    agreement: { agreement_version: 'v1', initial_fee_cents: 0, royalty_bps: 500, marketing_fee_bps: 100, term_years: 10, territory_exclusive: true },
    checklist: [{ id: 'check-1', label: 'Launch readiness', owner_role: 'HQ', status: 'completed', notes: '' }],
    notes: [], activity: [],
  });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    await page.route('http://franchise-admin.test/**', async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
      if (pathname === '/api/franchise/applications' && request.method() === 'GET') {
        return route.fulfill({ json: { data: [listRow()] } });
      }
      if (pathname === '/api/franchise/applications/franchise-application-1' && request.method() === 'GET') {
        return route.fulfill({ json: bundleData() });
      }
      if (pathname === '/api/franchise/applications/franchise-application-1' && request.method() === 'PATCH') {
        const payload = request.postDataJSON() || {};
        state.patchCalls.push(payload);
        const previousOwner = state.application.owner_user_id;
        Object.assign(state.application, payload);
        if (previousOwner && previousOwner !== state.application.owner_user_id && state.grantOwner === previousOwner) {
          state.revokedOwners.push(previousOwner);
        }
        if (state.application.status === 'launched' && state.application.linked_business_id && state.application.owner_user_id) {
          state.grantOwner = state.application.owner_user_id;
        } else {
          if (state.grantOwner) state.revokedOwners.push(state.grantOwner);
          state.grantOwner = null;
        }
        return route.fulfill({ json: bundleData() });
      }
      if (pathname === '/api/franchise/applications/franchise-application-1/activate-store' && request.method() === 'POST') {
        state.activationCalls.push(request.postDataJSON() || {});
        state.businessCounter += 1;
        state.application.linked_business_id = `business-${state.businessCounter}`;
        state.application.linked_business_name = state.application.desired_brand_name;
        state.application.status = 'launched';
        state.application.launch_readiness_status = 'launched';
        state.grantOwner = state.application.owner_user_id;
        return route.fulfill({ status: 201, json: { ...bundleData(), business: { id: state.application.linked_business_id, business_name: state.application.linked_business_name } } });
      }
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script defer src="/fixture.js"></script>' });
    });

    await page.goto('http://franchise-admin.test/admin/super/franchises');
    await page.getByText(/OxSteed Columbus/).first().waitFor();

    const activate = page.getByRole('button', { name: /activate/i });
    await activate.click();
    await page.getByRole('button', { name: /already activated/i }).waitFor();
    assert.equal(state.activationCalls.length, 1);
    assert.equal(state.grantOwner, 'owner-a');

    const ownerInput = page.locator('input[placeholder*="Owner"]');
    await ownerInput.fill('owner-b');
    await page.getByRole('button', { name: /save hq review/i }).click();
    await page.waitForFunction(() => document.querySelector('input[placeholder*="Owner"]')?.value === 'owner-b');
    assert.equal(state.patchCalls.at(-1).owner_user_id, 'owner-b');
    assert.equal(state.grantOwner, 'owner-b');
    assert.ok(state.revokedOwners.includes('owner-a'));

    const reviewStatus = page.locator('select').nth(2);
    await reviewStatus.selectOption('rejected');
    await page.getByRole('button', { name: /save hq review/i }).click();
    await page.waitForFunction(() => document.body.innerText.includes('Rejected'));
    assert.equal(state.patchCalls.at(-1).status, 'rejected');
    assert.equal(state.grantOwner, null);
    assert.ok(state.revokedOwners.includes('owner-b'));
  } finally {
    await browser.close();
  }
});
