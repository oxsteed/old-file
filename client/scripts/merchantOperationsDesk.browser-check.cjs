const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const catalogs = Object.fromEntries(['en', 'es', 'fr', 'ht', 'ar'].map((language) => [language, {
  translation: JSON.parse(fs.readFileSync(path.join(root, `src/locales/${language}.json`), 'utf8')),
  common: JSON.parse(fs.readFileSync(path.join(root, `src/i18n/locales/${language}/common.json`), 'utf8')),
}]));

const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import i18n from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import Page from './src/pages/food/FoodMerchantPage';

const instance = i18n.createInstance();
instance.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: window.catalogs,
  interpolation: { escapeValue: false },
});
window.i18n = instance;
function LocationProbe() {
  const location = useLocation();
  window.currentSearch = location.search;
  return null;
}
const root = createRoot(document.getElementById('root'));
window.render = (route) => root.render(
  <I18nextProvider i18n={instance}>
    <MemoryRouter key={route + Date.now()} initialEntries={[route]}>
      <LocationProbe />
      <Page />
    </MemoryRouter>
  </I18nextProvider>
);
`;

const mockApi = `const request = (method, url, body) => window.request(method, url, body);
export default {
  get: (url) => request('get', url),
  post: (url, body) => request('post', url, body),
  patch: (url, body) => request('patch', url, body),
  put: (url, body) => request('put', url, body),
  delete: (url) => request('delete', url),
};`;

test('merchant operations desk opens one tool at a time', { timeout: 120000 }, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: fixture },
    bundle: true,
    write: false,
    outdir: 'fixture',
    format: 'esm',
    define: { 'import.meta.env': '{}' },
    loader: { '.css': 'css', '.svg': 'dataurl' },
    plugins: [{
      name: 'ops-desk-mocks',
      setup(build) {
        build.onResolve({ filter: /(^|\/)axios$/ }, (args) => (
          args.path === 'axios' ? null : { path: 'api', namespace: 'mock' }
        ));
        build.onResolve({ filter: /\/context\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'mock' }));
        build.onResolve({ filter: /\/components\/PageShell$/ }, () => ({ path: 'shell', namespace: 'mock' }));
        build.onResolve({ filter: /\/api\/restaurantDisplaySocket$/ }, () => ({ path: 'socket', namespace: 'mock' }));
        build.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
          loader: 'jsx',
          resolveDir: root,
          contents: {
            api: mockApi,
            auth: `export const useAuth = () => ({ user: { id: 'synthetic-owner' } });`,
            shell: `import React from 'react'; export default function PageShell({ children }) { return <div>{children}</div>; }`,
            socket: `export const subscribeRestaurantDisplay = () => () => {};`,
          }[args.path],
        }));
      },
    }],
  });

  const js = bundle.outputFiles.find((file) => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text || '';
  const styles = fs.readFileSync(path.join(root, 'src/styles/FoodPages.css'), 'utf8');
  const server = http.createServer((req, res) => {
    if (req.url === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(js);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><html><head><meta charset="utf-8"><style>
      :root{--primary-color:#9a3412;--app-text:#142036;--muted-text:#475569;--card-bg:#fff;--border-color:#dbe3ef;--soft-bg:#f1f5f9;--app-bg:#f7f9fc}
      html.dark{--primary-color:#fb923c;--app-text:#e2e8f0;--muted-text:#cbd5e1;--card-bg:#162133;--border-color:#475569;--soft-bg:#1e293b;--app-bg:#0b1220}
      body{margin:0;background:var(--app-bg);color:var(--app-text);font-family:Arial,sans-serif}
      *{box-sizing:border-box}
      ${styles}
      ${css}
    </style></head><body><div id="root"></div>
    <script>window.catalogs=${JSON.stringify(catalogs)};</script>
    <script type="module" src="/fixture.js"></script></body></html>`);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  const artifactDir = '/opt/cursor/artifacts';
  fs.mkdirSync(artifactDir, { recursive: true });

  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.render);
    await page.evaluate(() => {
      window.calls = [];
      window.request = async (method, url) => {
        window.calls.push({ method, url });
        if (url.includes('/food/my/restaurants')) {
          return { data: { restaurants: [{
            id: 9,
            business_id: 3,
            display_name: 'Synthetic Kitchen',
            status: 'active',
            address_city: 'Brooklyn',
            address_state: 'NY',
            effective_role: 'owner',
            permissions: ['*'],
            currency_code: 'USD',
            is_accepting_orders_now: true,
            timezone: 'America/New_York',
          }] } };
        }
        if (url.includes('/inventory/items')) {
          return { data: { items: [
            { id: 1, name: 'Tomatoes', category: 'produce', quantity: 1, unit: 'lb', is_low: true },
            { id: 2, name: 'Rice', category: 'dry_goods', quantity: 20, unit: 'lb', is_low: false },
          ] } };
        }
        if (url.includes('/checklist-runs')) return { data: { runs: [{ id: 4, status: 'completed' }] } };
        if (url.includes('/checklists')) {
          return { data: { checklists: [
            { id: 1, name: 'Opening', checklist_type: 'opening', is_active: true, tasks: [{ id: 1, is_active: true }] },
          ] } };
        }
        if (url.includes('/sops')) return { data: { sops: [] } };
        if (url.includes('/screens/control')) return { data: { enabled: true, devices: [], tickets: [], revision: 1 } };
        return { data: {} };
      };
      window.render('/restaurants/merchant?business=3&tab=operations');
    });

    await page.getByRole('heading', { name: 'Operations', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Floor', exact: true }).waitFor();
    await page.getByRole('button', { name: /1 low stock/ }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'In-store screen control center' }).count(), 0);
    assert.equal(await page.getByRole('heading', { name: 'HQ console', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);

    await page.screenshot({ path: path.join(artifactDir, 'operations-desk-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'mobile board overflows');
    await page.screenshot({ path: path.join(artifactDir, 'operations-desk-mobile.png'), fullPage: true });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => { document.documentElement.className = 'dark'; });
    await page.screenshot({ path: path.join(artifactDir, 'operations-desk-dark.png'), fullPage: true });
    await page.evaluate(() => { document.documentElement.className = ''; });

    await page.getByRole('button', { name: /1 low stock/ }).click();
    await page.getByRole('heading', { name: 'Inventory', exact: true }).waitFor();
    await page.getByText('Tomatoes', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'All tools', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Floor', exact: true }).count(), 0);
    await page.screenshot({ path: path.join(artifactDir, 'operations-inventory-open.png'), fullPage: true });

    await page.getByRole('button', { name: 'All tools', exact: true }).click();
    await page.getByRole('heading', { name: 'Floor', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Inventory', exact: true }).count(), 0);

    await page.getByRole('button', { name: /In-store screens/ }).click();
    await page.getByRole('heading', { name: 'In-store screen control center' }).waitFor();
    await page.screenshot({ path: path.join(artifactDir, 'operations-screens-open.png'), fullPage: true });

    await page.evaluate(() => window.render('/restaurants/merchant?business=3&tab=operations&ops=checklists'));
    await page.getByRole('heading', { name: 'Checklists', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Opening', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Floor', exact: true }).count(), 0);

    // A display-only role must not paint a manager tool from the ops query.
    // The board stays hidden, manager panels are not mounted, and screens stay
    // hidden until a later effect — and that effect used to leave ops=inventory
    // in the query, so a refresh repeated the blank frame.
    await page.evaluate(() => {
      const previous = window.request;
      window.request = async (method, url) => {
        if (url.includes('/food/my/restaurants')) {
          return { data: { restaurants: [
            {
              id: 9,
              business_id: 3,
              display_name: 'Synthetic Kitchen',
              status: 'active',
              address_city: 'Brooklyn',
              address_state: 'NY',
              effective_role: 'owner',
              permissions: ['*'],
              currency_code: 'USD',
              is_accepting_orders_now: true,
              timezone: 'America/New_York',
            },
            {
              id: 11,
              business_id: 4,
              display_name: 'Display Counter',
              status: 'active',
              address_city: 'Brooklyn',
              address_state: 'NY',
              effective_role: 'staff',
              permissions: ['display.manage'],
              currency_code: 'USD',
              is_accepting_orders_now: true,
              timezone: 'America/New_York',
            },
          ] } };
        }
        return previous(method, url);
      };
      window.blankOpsFrames = 0;
      window.opsBlankTrace = [];
      const noteBlank = () => {
        const board = document.querySelector('.fd-ops-groups');
        const workspace = document.querySelector('.fd-ops-workspace');
        if (!board || !workspace || !board.hasAttribute('hidden')) return;
        const screens = document.querySelector('.fd-ops-screen-slot');
        const screensShown = Boolean(screens && !screens.hasAttribute('hidden'));
        const cardShown = Boolean(workspace.querySelector('.fd-settings-card:not([hidden])'));
        window.opsBlankTrace.push({ screensShown, cardShown });
        if (!screensShown && !cardShown) window.blankOpsFrames += 1;
      };
      // Sample during commit. Passive effects correct `active` after the first
      // paint, so a mutation observer can miss the empty frame entirely.
      if (!window.opsBlankHooked) {
        window.opsBlankHooked = true;
        for (const method of ['appendChild', 'insertBefore']) {
          const original = Element.prototype[method];
          Element.prototype[method] = function patched(node) {
            const result = original.apply(this, arguments);
            const element = node && node.nodeType === 1 ? node : null;
            if (element && (element.classList?.contains('fd-ops-workspace') || element.querySelector?.('.fd-ops-workspace'))) noteBlank();
            return result;
          };
        }
      }
      window.render('/restaurants/merchant?business=4&tab=operations&ops=inventory');
    });

    await page.getByRole('heading', { name: 'In-store screen control center' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Inventory', exact: true }).count(), 0);
    assert.equal(await page.getByRole('heading', { name: 'Floor', exact: true }).count(), 0);
    const displayOnlyDesk = await page.evaluate(() => ({
      blank: window.blankOpsFrames,
      trace: window.opsBlankTrace,
    }));
    assert.equal(displayOnlyDesk.blank, 0, `display-only ops=inventory painted an empty workspace ${JSON.stringify(displayOnlyDesk.trace)}`);
    await page.waitForFunction(() => window.currentSearch.includes('ops=screens') && !window.currentSearch.includes('inventory'));
    await page.screenshot({ path: path.join(artifactDir, 'operations-display-only-screens.png'), fullPage: true });
    const refreshedSearch = await page.evaluate(() => window.currentSearch);
    await page.evaluate((search) => {
      window.blankOpsFrames = 0;
      window.opsBlankTrace = [];
      window.render(`/restaurants/merchant${search}`);
    }, refreshedSearch);
    await page.getByRole('heading', { name: 'In-store screen control center' }).waitFor();
    assert.equal(await page.evaluate(() => window.blankOpsFrames), 0, 'refresh replayed an empty workspace');
    await page.waitForFunction(() => window.currentSearch.includes('ops=screens') && !window.currentSearch.includes('inventory'));

    await page.evaluate(() => {
      window.blankOpsFrames = 0;
      window.render('/restaurants/merchant?business=3&tab=operations&ops=inventory');
    });
    await page.getByRole('heading', { name: 'Inventory', exact: true }).waitFor();
    await page.evaluate(() => { window.blankOpsFrames = 0; });
    await page.getByLabel('Select restaurant').selectOption('11');
    await page.getByRole('heading', { name: 'Display Counter', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'In-store screen control center' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Inventory', exact: true }).count(), 0);
    await page.waitForFunction(() => window.currentSearch.includes('ops=screens') && !window.currentSearch.includes('inventory'));
    assert.equal(await page.evaluate(() => window.blankOpsFrames), 0, 'switching to a display-only restaurant kept the manager tool');
    await page.screenshot({ path: path.join(artifactDir, 'operations-display-only-switch.png'), fullPage: true });

    await page.evaluate(() => window.render('/restaurants/merchant?business=3&tab=operations&ops=checklists'));
    await page.getByRole('heading', { name: 'Checklists', exact: true }).waitFor();

    await page.evaluate(async () => {
      document.documentElement.dir = 'rtl';
      document.documentElement.lang = 'ar';
      await window.i18n.changeLanguage('ar');
    });
    await page.getByRole('button', { name: 'كل الأدوات', exact: true }).click();
    await page.getByRole('heading', { name: 'الصالة', exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'arabic mobile overflows');
    await page.screenshot({ path: path.join(artifactDir, 'operations-desk-arabic-mobile.png'), fullPage: true });

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
