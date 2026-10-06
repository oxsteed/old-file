// Exercise the actual page and dialog lifecycle without production writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('visibility dialogs stay closed until selected and retain the selected profile', async () => {
  const root = path.resolve(__dirname, '..');
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/locales/en.json'), 'utf8'));
  const mocks = {
    'react-i18next': `export const useTranslation = () => ({ t: (key, options = {}) => {
      const value = key.split('.').reduce((node, part) => node?.[part], window.catalog);
      return String(typeof value === 'string' ? value : options.defaultValue || key)
        .replace(/\\{\\{(\\w+)\\}\\}/g, (_, name) => String(options[name] ?? ''));
    } });`,
    '../../hooks/useAuth': `export const useAuth = () => ({ user: { id: 'operator', role: 'super_admin' } });`,
    '../../utils/logger': `export default { error() {}, warn() {} };`,
    '../../api/axios': `export default {
      get: async (url) => {
        window.requests.push(url);
        await new Promise(resolve => setTimeout(resolve, 30));
        if (url.endsWith('/search')) return { data: { results: [
          { profile_type: 'business', profile_id: '17', display_name: 'Managed business',
            owner_visible: true, is_active: true, is_hidden_by_admin: false, is_visible: true },
          { profile_type: 'restaurant', profile_id: '29', display_name: 'Managed restaurant',
            owner_visible: true, is_active: true, is_hidden_by_admin: true, is_visible: false }
        ], total: 2, page: 1, limit: 25, hasMore: false } };
        if (url.endsWith('/timeline')) return { data: { timeline: [
          { id: 'event-1', action: 'hidden', actor_name: 'Review operator',
            description: 'Selected profile hold', created_at: '2026-10-06T12:00:00Z' }
        ] } };
        if (url.endsWith('/active-work')) return { data: { has_active_work: false } };
        if (url.endsWith('/impact')) return { data: { views_30d: 5 } };
        if (url.endsWith('/restore-checklist')) return { data: { items: [], all_clear: true } };
        if (url.endsWith('/preview')) return { data: {
          display_name: 'Managed business', canonical_url: '/public-fixture', is_visible: true
        } };
        return { data: {} };
      },
      put: async () => { window.writes += 1; throw new Error('Unexpected write'); },
      post: async () => { window.writes += 1; throw new Error('Unexpected write'); }
    };`,
  };
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import Page from './src/admin/pages/ProfileVisibilityPage.jsx';
      createRoot(document.getElementById('root')).render(<React.StrictMode><Page /></React.StrictMode>);
    ` },
    bundle: true, write: false, jsx: 'automatic', loader: { '.css': 'empty' },
    define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'visibility-fixtures', setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => mocks[args.path]
        ? { path: args.path, namespace: 'fixture' } : undefined);
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
        contents: mocks[args.path], loader: 'js', resolveDir: root,
      }));
    } }],
  });
  const server = http.createServer((request, response) => {
    if (request.url === '/app.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(bundle.outputFiles[0].contents);
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url === '/public-fixture') { response.end('<p>Public preview</p>'); return; }
    response.end(`<div id="root"></div><script>
      window.catalog=${JSON.stringify(catalog).replace(/</g, '\\u003c')};
      window.requests=[]; window.writes=0;
      </script><script type="module" src="/app.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByText('Managed business', { exact: true }).waitFor({ state: 'attached' });
    assert.equal(await page.getByRole('dialog').count(), 0, 'initial page must have no blocking overlays');

    const timeline = page.getByTestId('pv-timeline').first();
    await timeline.click();
    await page.getByRole('heading', { name: 'Visibility timeline: Managed business' }).waitFor();
    await page.getByText('Selected profile hold').waitFor();
    assert.equal(await page.getByRole('dialog').count(), 1);
    assert.ok(await page.evaluate(() => window.requests.includes('/admin/profile-visibility/business/17/timeline')));
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await timeline.evaluate(node => node === document.activeElement), true, 'closing restores focus to the row');

    await page.getByTestId('pv-restore').click();
    await page.getByRole('heading', { name: 'Restore checklist' }).waitFor();
    await page.getByText('What was missing when "Managed restaurant" was hidden, and is it fixed now?').waitFor();
    assert.equal(await page.getByRole('dialog').count(), 1);
    await page.getByTestId('pv-checklist-continue').click();
    await page.getByRole('heading', { name: 'Restore public visibility?' }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 1, 'checklist closes before confirmation');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });

    await page.getByTestId('pv-hide').click();
    await page.getByTestId('pv-confirm-hide').click();
    await page.getByRole('heading', { name: 'Impact preview' }).waitFor();
    await page.getByText('Hiding "Managed business" will have this impact:').waitFor();
    assert.equal(await page.getByRole('dialog').count(), 1);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });

    // Preview and schedule callers mount the modal conditionally and omit open.
    for (const [button, heading] of [['pv-preview', 'Preview: Managed business'], ['pv-schedule', catalog.adminProfileVisibility.scheduleTitle]]) {
      await page.getByTestId(button).first().click();
      await page.getByRole('heading', { name: heading, exact: true }).waitFor();
      assert.equal(await page.getByRole('dialog').count(), 1);
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
    }
    assert.equal(await page.evaluate(() => window.writes), 0);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
