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

test('multi-location HQ: converted rollup, FX policy, pay-run approval, labor borrowing', { timeout: 120000 }, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: fixture },
    bundle: true,
    write: false,
    outdir: 'fixture',
    format: 'esm',
    define: { 'import.meta.env': '{}' },
    loader: { '.css': 'css', '.svg': 'dataurl' },
    plugins: [{
      name: 'phase8-mocks',
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
  // A failed third-party script (Stripe.js) is an environment limit,
  // not a page defect: the sandbox cannot reach js.stripe.com, while
  // CI can. First-party resource failures still fail the test.
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith('http://127.0.0.1')) errors.push(`first-party request failed: ${request.url()}`);
  });
  const artifactDir = process.env.ARTIFACT_DIR || path.join(require('node:os').tmpdir(), 'oxsteed-multi-location-hq');
  fs.mkdirSync(artifactDir, { recursive: true });

  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.render);
    await page.evaluate(() => {
      window.calls = [];
      window.approved = false;
      window.borrowed = false;
      window.fxPolicy = { reportingCurrency: 'USD', rateSource: 'stored', rateDateMode: 'period_end', rateDate: null, isDefault: true, updatedAt: null };
      window.request = async (method, url, body) => {
        window.calls.push({ method, url, body });
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
        if (url.includes('/hq/rollup')) {
          return { data: {
            stores: [{
              id: 1, name: 'Downtown',
              health: { latestAuditScorePercent: 92, openFindings: 1 },
              compliance: { checklistCompletionPercent: 88, trainingCompletionPercent: 95 },
              sales: [
                { currencyCode: 'HTG', netCollectedCents: 100000, orderCount: 12 },
                { currencyCode: 'USD', netCollectedCents: 10000, orderCount: 5 },
              ],
            }],
            converted: {
              reportingCurrency: 'USD', rateDate: '2026-11-05', rateSource: 'stored',
              isDefaultPolicy: true, convertedTotalCents: 10760, missingCurrencies: [],
              lines: [
                { currencyCode: 'HTG', amountCents: 100000, convertedCents: 760, rate: 0.0076, rateDate: '2026-11-05', missingRate: false },
                { currencyCode: 'USD', amountCents: 10000, convertedCents: 10000, rate: 1, rateDate: '2026-11-05', missingRate: false },
              ],
            },
          } };
        }
        if (url.includes('/hq/labor-rollup')) {
          return { data: {
            stores: [{
              location_id: 1, display_name: 'Downtown', total_hours: 120, scheduled_hours: 120,
              overtime_hours: 8, labor_cost_cents: 50000, currency: 'HTG', labor_percent: 22.5,
              employee_count: 4, missing_wage_count: 0,
              labor_cost_converted_cents: 380, revenue_converted_cents: 760,
            }],
            totals: {
              total_hours: 120, overtime_hours: 8, labor_cost_cents: null, currency: null, labor_percent: null,
              // Finding 21: the server sends reportingCurrency on the
              // converted object, never a currency key.
              converted: { reportingCurrency: 'USD', laborCostCents: 380, revenueCents: 760, laborPercent: 50, missingCurrencies: [] },
            },
          } };
        }
        if (url.includes('/hq/pay-runs/1/approve')) {
          window.approved = true;
          return { data: { payRun: { id: 1, status: 'finalized', approved_by: 3 } } };
        }
        if (url.includes('/pay-runs')) {
          return { data: { payRuns: [{
            id: 1, restaurant_id: 9, period_from: '2026-10-26', period_to: '2026-11-01',
            status: 'finalized', totals: {}, location_ids: [1], locationIds: [1],
            scope: 'single_store', currency_code: 'HTG', currencyCode: 'HTG',
            created_by: 2, finalized_by: 2, finalized_at: '2026-11-02T00:00:00Z',
            approved_by: window.approved ? 3 : null, approved_at: null,
            created_at: '2026-10-26T00:00:00Z', updated_at: '2026-11-02T00:00:00Z',
            payoutLinks: [],
          }], total: 1, limit: 50, offset: 0 } };
        }
        if (url.includes('/hq/fx-policy')) {
          if (method === 'put') {
            window.fxPolicy = { ...window.fxPolicy, ...body, isDefault: false };
            return { data: { policy: window.fxPolicy } };
          }
          return { data: { policy: window.fxPolicy } };
        }
        if (url.includes('/hq/fx-rates')) {
          return { data: { rates: [{
            id: 1, baseCurrency: 'HTG', quoteCurrency: 'USD', rate: 0.0076,
            rateDate: '2026-11-05', source: 'admin_entered', createdBy: 3, createdAt: '2026-11-05T00:00:00Z',
          }] } };
        }
        if (url.includes('/hq/labor-policies')) {
          return { data: { policies: [{
            locationId: 1, displayName: 'Downtown', currencyCode: 'HTG',
            countryCode: 'HT', regionCode: null, timezone: 'America/Port-au-Prince',
            source: 'restaurant_fallback',
            policy: {
              restaurant_id: 9, location_id: null, country_code: null, region_code: null,
              overtime_threshold_hours: 40, overtime_multiplier_bps: 150,
              break_after_minutes: 300, break_duration_minutes: 30,
              updated_by: null, updated_at: null,
            },
          }] } };
        }
        if (url.includes('/labor-borrows')) {
          if (method === 'post') {
            window.borrowed = true;
            return { data: { borrow: {
              id: 5, restaurantId: 9, staffUserId: 7, staffName: 'Ana',
              homeLocationId: 1, homeLocationName: 'Downtown',
              borrowLocationId: 2, borrowLocationName: 'Uptown',
              shiftDate: '2026-11-07', startTime: '09:00', endTime: '13:00',
              roleLabel: null, status: 'requested', requestedBy: 3,
              reviewedBy: null, reviewedAt: null,
              createdAt: '2026-11-06T00:00:00Z', updatedAt: '2026-11-06T00:00:00Z',
            } } };
          }
          return { data: { borrows: window.borrowed ? [{
            id: 5, restaurantId: 9, staffUserId: 7, staffName: 'Ana',
            homeLocationId: 1, homeLocationName: 'Downtown',
            borrowLocationId: 2, borrowLocationName: 'Uptown',
            shiftDate: '2026-11-07', startTime: '09:00', endTime: '13:00',
            roleLabel: null, status: 'requested', requestedBy: 3,
            reviewedBy: null, reviewedAt: null,
            createdAt: '2026-11-06T00:00:00Z', updatedAt: '2026-11-06T00:00:00Z',
          }] : [] } };
        }
        if (url.includes('/shared-roster')) {
          return { data: {
            from: '2026-10-07', to: '2026-11-06',
            staff: [{
              userId: 7, name: 'Ana', homeLocationId: 1, homeLocationName: 'Downtown',
              shifts: [], approvedBorrows: [],
            }],
          } };
        }
        if (url.includes('/hq/regions')) return { data: { regions: [] } };
        return { data: {} };
      };
      window.render('/restaurants/merchant?business=3&tab=operations&ops=hq');
    });

    await page.getByRole('heading', { name: 'HQ console', exact: true }).nth(1).waitFor();

    // Converted rollup: native detail stays, converted total sits
    // alongside it with its rate and rate date, never silently.
    await page.getByRole('heading', { name: 'Converted totals', exact: true }).waitFor();
    await page.getByText('$107.60', { exact: true }).waitFor();
    await page.getByText('1 HTG = 0.0076 USD').waitFor();
    await page.getByText('Reporting currency: USD').waitFor();
    await page.waitForFunction(() => window.calls.some(({ url }) => url.includes('/hq/labor-rollup')));
    await page.getByText('Converted total (USD)', { exact: true }).waitFor();

    // FX policy form: the stored default is shown, saving stores a
    // new policy (the mock records the PUT).
    const fxForm = page.locator('form[data-track="ui.ec032c849d.8"]');
    await fxForm.locator('input').first().fill('EUR');
    await fxForm.locator('button[type="submit"]').click();
    await page.waitForFunction(() => window.calls.some(({ method, url }) => method === 'put' && url.includes('/hq/fx-policy')));
    assert.equal(await page.evaluate(() => window.fxPolicy.reportingCurrency), 'EUR');

    // Per-store labor policy: the fallback source is named, and the
    // stored weekly threshold is editable in place.
    await page.getByRole('heading', { name: 'Per-store labor policies', exact: true }).waitFor();
    await page.getByText('Downtown', { exact: true }).first().waitFor();
    await page.getByText('restaurant_fallback', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Weekly overtime threshold (hours)').inputValue(), '40');

    // HQ pay-run approval: the finalized run waits here, and
    // approving it posts to the HQ endpoint (maker-checker lives
    // server-side; the UI just routes the second approval).
    await page.getByRole('heading', { name: 'Pay runs awaiting HQ approval', exact: true }).waitFor();
    await page.getByText('2026-10-26 → 2026-11-01').waitFor();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.waitForFunction(() => window.calls.some(({ method, url }) => method === 'post' && url.includes('/hq/pay-runs/1/approve')));
    await page.waitForFunction(() => window.approved === true);
    await page.getByText('No finalized pay runs are waiting for approval.').waitFor();

    // Labor borrowing: request a worker from the shared roster and
    // the request appears in the pending list.
    await page.getByRole('heading', { name: 'Inter-store labor borrowing', exact: true }).waitFor();
    const borrowForm = page.locator('form[data-track="ui.ec032c849d.14"]');
    await borrowForm.locator('select').nth(0).selectOption('7');
    await borrowForm.locator('select').nth(1).selectOption('1');
    await borrowForm.locator('select').nth(2).selectOption('1');
    await borrowForm.locator('input[type="date"]').fill('2026-11-07');
    await borrowForm.locator('button[type="submit"]').click();
    await page.waitForFunction(() => window.calls.some(({ method, url }) => method === 'post' && url.includes('/labor-borrows')));
    await page.getByText('2026-11-07 09:00–13:00').waitFor();

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: path.join(artifactDir, 'multi-location-hq-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'mobile HQ overflows');
    await page.screenshot({ path: path.join(artifactDir, 'multi-location-hq-mobile.png'), fullPage: true });

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
