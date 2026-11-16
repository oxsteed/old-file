const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('Business Launch status modal keeps shared and applicant-only attachment controls in request scope', { timeout: 30_000 }, async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { BrowserRouter, Routes, Route } from 'react-router-dom';
      import { createInstance } from 'i18next';
      import { I18nextProvider } from 'react-i18next';
      import BusinessLaunchStatusPage from './src/pages/BusinessLaunchStatusPage.jsx';
      import legacy from './src/locales/en.json';
      import common from './src/i18n/locales/en/common.json';

      const i18n = createInstance();
      i18n.init({ lng: 'en', resources: { en: { translation: legacy, common } }, interpolation: { escapeValue: false } }).then(() => {
        createRoot(document.getElementById('root')).render(<I18nextProvider i18n={i18n}><BrowserRouter><Routes>
          <Route path="/business-launch-status" element={<BusinessLaunchStatusPage />} />
        </Routes></BrowserRouter></I18nextProvider>);
      });
    ` },
    bundle: true, write: false, jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'business-launch-attachments-shell', setup(plugin) {
      const fixtures = {
        AuthContext: `export const useAuth = () => ({ user: { id: 'applicant', role: 'customer', email: 'applicant@example.invalid' } });`,
        PageShell: `export default ({ children }) => children;`,
        PageMeta: `export default () => null;`,
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
    page.setDefaultTimeout(5_000);
    const request = {
      id: 'request-1', user_id: 'applicant', status: 'pending', package_selected: 'launch',
      first_name: 'Kay', last_name: 'Fixture', email: 'applicant@example.invalid',
      setup_items_selected: [], select_all_chosen: false, current_phase: 1,
      skill_description: 'Baking', target_market: 'Local', business_name: 'Fixture Bakery',
      operating_country: 'US', operating_state: 'OH', urgency: 'exploring',
    };
    let uploaded = false;
    await page.route('http://business-launch-attachments.test/**', async (route) => {
      const { pathname } = new URL(route.request().url());
      const method = route.request().method();
      if (pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
      if (pathname === '/api/consulting/business-launch/my-requests') return route.fulfill({ json: [request] });
      if (pathname === '/api/consulting/business-launch/requests/request-1/attachments') {
        if (method === 'POST') {
          uploaded = true;
          return route.fulfill({ status: 201, json: { attachment: { id: 'attachment-2' } } });
        }
        return route.fulfill({ json: { attachments: [
          { id: 'attachment-1', originalName: 'shared-plan.pdf', visibility: 'shared', uploadedBy: 'applicant' },
          { id: 'attachment-private', originalName: 'private-notes.pdf', visibility: 'applicant_only', uploadedBy: 'applicant' },
          ...(uploaded ? [{ id: 'attachment-2', originalName: 'new-proof.pdf', visibility: 'shared', uploadedBy: 'applicant' }] : []),
        ] } });
      }
      if (pathname.startsWith('/api/consulting/business-launch/attachments/')) return route.fulfill({ json: { url: 'https://download.invalid/private-file' } });
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script defer src="/fixture.js"></script>' });
    });

    await page.goto('http://business-launch-attachments.test/business-launch-status');
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'View details for Fixture Bakery' }).click();
    await page.getByText('shared-plan.pdf', { exact: true }).waitFor();
    await page.getByText('private-notes.pdf', { exact: true }).waitFor();
    const visibility = page.locator('select').filter({ has: page.locator('option[value="applicant_only"]') });
    assert.equal(await visibility.locator('option').count(), 2);
    await visibility.selectOption('applicant_only');
    await page.locator('input[type="file"]').setInputFiles({ name: 'new-proof.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fixture') });
    await page.getByText('new-proof.pdf', { exact: true }).waitFor();
    assert.equal(uploaded, true);
  } finally {
    await browser.close();
  }
});
