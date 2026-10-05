// Isolated browser regressions for real render and event-handler branches.
// Every external service is stubbed; no production accounts or writes are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');

async function fixture() {
  const mocks = {
    'react-i18next': `export const useTranslation = () => ({ t: (key, options = {}) => {
      const value = key.split('.').reduce((node, part) => node?.[part], window.fixtureCatalog);
      let text = typeof value === 'string' ? value : options.defaultValue || key;
      return text.replace(/\\{\\{(\\w+)\\}\\}/g, (_, name) => String(options[name] ?? ''));
    }, i18n: { resolvedLanguage: window.fixtureLanguage } });`,
    '../context/AuthContext': `export const useAuth = () => ({ user: {
      email: 'audit@example.com', first_name: 'Test', last_name: 'Operator', country: 'US', state: 'OH'
    } });`,
    '../api/axios': `export default {
      get: async () => ({ data: {} }),
      post: () => { throw new Error('Unexpected write in regression fixture'); }
    };`,
    '../api/vortex': `export const getMyBusinesses = async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
      const params = new URLSearchParams(location.search);
      const kind = params.get('portfolio');
      if (kind === 'error') throw new Error('Synthetic unavailable service');
      const make = (id, restaurant) => ({ id, business_name: 'Fixture workspace ' + id,
        status: 'active', role: 'owner', is_owner: true, setup_status: 'active',
        business_kind: restaurant ? 'restaurant' : 'service', restaurant_id: restaurant ? 42 : null,
        restaurant_status: 'active', is_listed: true, restaurant_discovery_status: 'visible' });
      return { items: kind === 'empty' ? [] : kind === 'mixed' ? [make(7, false), make(8, true)]
        : [make(7, kind === 'restaurant')] };
    };`,
    '../utils/launchScope': `export const LAUNCH_VISIBILITY = {
      businessHubGrowthTools: new URLSearchParams(location.search).get('growth') === '1'
    };`,
    '../components/Navbar': `export default () => null;`,
    '../components/Footer': `export default () => null;`,
    '../components/PageMeta': `export default () => null;`,
    '../components/PageShell': `import React from 'react'; export default ({ children }) => <main>{children}</main>;`,
    '../components/DashboardQuickLinks': `export const DASHBOARD_QUICK_LINKS = { businessOwner: [] };
      export default () => null;`,
  };
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { BrowserRouter } from 'react-router-dom';
      import BusinessOwnerDashboard from './src/pages/BusinessOwnerDashboard.jsx';
      import ConsultingIntakePage from './src/pages/ConsultingIntakePage.jsx';
      class Boundary extends React.Component {
        state = { error: null };
        static getDerivedStateFromError(error) { return { error }; }
        componentDidCatch(error) { window.fixtureFailure = error.message; }
        render() { return this.state.error ? <p role="alert">{this.state.error.message}</p> : this.props.children; }
      }
      const Page = location.pathname === '/consulting-intake' ? ConsultingIntakePage : BusinessOwnerDashboard;
      createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><Boundary><Page /></Boundary></BrowserRouter></React.StrictMode>);
    ` },
    bundle: true, write: false, jsx: 'automatic', loader: { '.css': 'empty' },
    define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'isolated-crash-fixtures', setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => mocks[args.path]
        ? { path: args.path, namespace: 'fixture' } : undefined);
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: root }));
    } }],
  });
  const server = http.createServer((request, response) => {
    if (request.url === '/app.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(bundle.outputFiles[0].contents);
      return;
    }
    const language = new URL(request.url, 'http://localhost').searchParams.get('lang') || 'en';
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/locales', `${language}.json`), 'utf8'));
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<html lang="${language}" dir="${language === 'ar' ? 'rtl' : 'ltr'}"><body><div id="root"></div>
      <script>window.fixtureLanguage=${JSON.stringify(language)};window.fixtureCatalog=${JSON.stringify(catalog).replace(/</g, '\\u003c')};</script>
      <script type="module" src="/app.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
  } catch (error) {
    await new Promise(resolve => server.close(resolve));
    throw error;
  }
  return { browser, base: `http://127.0.0.1:${server.address().port}`, async close() {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  } };
}

test('business portfolios render across loaded/empty/error states and both growth gate branches', async () => {
  const env = await fixture();
  try {
    const page = await env.browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const portfolio of ['service', 'restaurant', 'mixed', 'empty', 'error']) {
      for (const growth of [0, 1]) {
        await page.goto(`${env.base}/business-dashboard?portfolio=${portfolio}&growth=${growth}`);
        await page.waitForFunction(() => document.querySelector('h1') || window.fixtureFailure);
        assert.equal(await page.evaluate(() => window.fixtureFailure), undefined, `${portfolio}, growth=${growth}`);
        const expectedCount = portfolio === 'empty' || portfolio === 'error' ? 0 : portfolio === 'mixed' ? 2 : 1;
        assert.equal(await page.locator('article').count(), expectedCount);
        const growthLink = page.locator('a[href="/consulting"]');
        assert.equal(await growthLink.count(), growth && expectedCount > 0 ? 1 : 0);
      }
    }
    assert.deepEqual(errors, []);
  } finally { await env.close(); }
});

test('consulting select-all/deselect-all works in every locale and allows advancing to packages', async () => {
  const env = await fixture();
  try {
    const page = await env.browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const language of ['en', 'es', 'fr', 'ht', 'ar']) {
      await page.goto(`${env.base}/consulting-intake?lang=${language}`);
      await page.locator('input[name="phone"]').fill('2025550123');
      // The final button advances the current step; no intake is submitted.
      await page.locator('main button').last().click();
      await page.locator('select').first().selectOption({ label: 'Cleaning' });
      await page.locator('input[name="target_market"]').fill('Synthetic local business');
      await page.locator('input[name="has_revenue"][value="no"]').check();
      await page.locator('input[name="business_name_decided"][value="no"]').check();
      await page.locator('main button').last().click();
      const checkboxes = page.locator('input[type="checkbox"]');
      await checkboxes.first().waitFor();
      const itemCount = await checkboxes.count() - 1;
      assert.ok(itemCount > 0);
      await checkboxes.first().check();
      assert.equal(await page.locator('input[type="checkbox"]:checked').count(), itemCount + 1, language);
      assert.ok((await checkboxes.first().locator('..').innerText()).includes(`(${itemCount} / ${itemCount} items)`), 'selection IDs must not be duplicated');
      assert.deepEqual(errors, []);
      await checkboxes.first().uncheck();
      assert.equal(await page.locator('input[type="checkbox"]:checked').count(), 0, language);
      await checkboxes.nth(1).check();
      await checkboxes.first().check();
      assert.equal(await page.locator('input[type="checkbox"]:checked').count(), itemCount + 1, language);
      await page.locator('input[name="urgency"][value="exploring"]').check();
      await page.locator('main button').last().click();
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === window.fixtureCatalog.consulting.intake.step4Title);
      assert.equal(await page.evaluate(() => window.fixtureFailure), undefined);
      assert.equal(await page.locator('html').getAttribute('dir'), language === 'ar' ? 'rtl' : 'ltr');
    }
    assert.deepEqual(errors, []);
  } finally { await env.close(); }
});
