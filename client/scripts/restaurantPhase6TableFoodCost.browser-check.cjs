// Browser-level coverage for the Phase 6 table-service and food-cost
// flows:
//   - RestaurantHostingPanel: the per-table tab (open tickets, covers,
//     totals) and the seating-release guard. An unconfirmed release of a
//     table with open tickets is refused with the structured 409 and the
//     warning names the tickets; "Release anyway" re-posts with
//     confirm: true and the warning clears. Tickets are never closed.
//   - RestaurantMenuManager: the food-cost view. The toggle loads the
//     margin-sorted table (price, plate cost, margin); an unmapped dish
//     shows "No recipe" and a currency-mismatched dish shows "Mixed
//     currencies" instead of a wrong margin. The sort buttons re-request
//     with the new sort.
//
// Both panels are rendered directly with the real i18n catalog; the
// restaurants/food API modules, the axios instance, and the operations
// context are stubbed. The shell must mount without page errors.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const foodApi = fs.readFileSync(path.join(root, 'src/api/food.js'), 'utf8');
const foodExports = [...foodApi.matchAll(/export (?:const|function|async function) (\w+)/g)].map((m) => m[1]);
const restaurantsApi = fs.readFileSync(path.join(root, 'src/api/restaurants.js'), 'utf8');
const restaurantsExports = [...restaurantsApi.matchAll(/export (?:const|function|async function) (\w+)/g)].map((m) => m[1]);

const mockApiModule = (exportsList) => `function reply(name, args) {
  window.calls.push({ name, args });
  const v = window.fx[name];
  if (v && v.error) {
    const err = new Error('synthetic error');
    err.response = { status: v.status || 503, data: v.data || { code: v.error } };
    return Promise.reject(err);
  }
  return Promise.resolve(v ?? null);
}\n` + exportsList.map((name) => {
  if (name === 'formatFoodMoney') {
    return `export const formatFoodMoney = (cents, currency) => (currency === 'USD' ? '$' : (currency || '') + ' ') + (Number(cents || 0) / 100).toFixed(2);`;
  }
  return `export const ${name} = (...args) => reply('${name}', args);`;
}).join('\n');

const mockContext = `export const useOperationStore = () => ({ locationId: 1, brandAccess: true, store: { timezone: 'America/New_York' } });
export const OperationStorePicker = () => null;
export const permits = () => true;
export const requestIdentity = () => 'fixture-key';
export const localDate = () => '2026-11-06';
export const localInput = (iso) => (iso ? String(iso).slice(0, 16) : '');
export const storeInstant = (value) => (value ? new Date(value).toISOString() : null);
`;

// The axios instance: records every post. An unconfirmed release of a
// table with open tickets is refused with the structured 409 the server
// returns; a confirmed release succeeds.
const mockAxios = `export default {
  post: async (url, body) => {
    window.calls.push({ name: 'api:post', args: [url, body] });
    if (String(url).includes('/seating') && body && body.action === 'release' && !body.confirm) {
      const err = new Error('synthetic error');
      err.response = { status: 409, data: { code: 'table_has_open_tickets', fields: { tableId: 11, openTicketIds: [101, 102], openTicketCount: 2, openTotalCents: 3700, currencyCode: 'USD' } } };
      throw err;
    }
    return { data: { seating: null } };
  },
  get: async (url, config) => {
    window.calls.push({ name: 'api:get', args: [url, config] });
    return { data: {} };
  },
};
`;

const catalogs = { en: { translation: JSON.parse(fs.readFileSync(path.join(root, 'src/locales/en.json'), 'utf8')) } };

async function serveBundle(entryContents) {
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'jsx',
      contents: entryContents,
    },
    bundle: true,
    write: false,
    outdir: 'fixture',
    format: 'esm',
    loader: { '.css': 'css' },
    define: { 'import.meta.env': '{}' },
    plugins: [{
      name: 'phase6-fixture',
      setup(b) {
        b.onResolve({ filter: /api\/food$/ }, () => ({ path: 'food', namespace: 'fixture' }));
        b.onResolve({ filter: /api\/restaurants$/ }, () => ({ path: 'restaurants', namespace: 'fixture' }));
        b.onResolve({ filter: /api\/axios$/ }, () => ({ path: 'axios', namespace: 'fixture' }));
        b.onResolve({ filter: /restaurantOperationsContext$/ }, () => ({ path: 'operations-context', namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents:
            args.path === 'food' ? mockApiModule(foodExports)
            : args.path === 'restaurants' ? mockApiModule(restaurantsExports)
            : args.path === 'axios' ? mockAxios
            : mockContext,
          loader: 'js',
        }));
      },
    }],
  });
  const js = bundle.outputFiles.find((f) => f.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find((f) => f.path.endsWith('.css'))?.text || '';
  const baseCss = fs.readFileSync(path.join(root, 'src/styles/FoodPages.css'), 'utf8');
  const server = http.createServer((req, res) => {
    if (req.url === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(js); }
    else {
      res.end(`<html><head><meta charset="utf-8"><style>:root{--primary-color:#9a3412;--app-text:#142036;--muted-text:#475569;--card-bg:#fff;--border-color:#dbe3ef;--soft-bg:#f1f5f9}html{font-family:Arial;background:#f7f9fc}body{margin:0}#root{max-width:1200px;margin:auto;padding:16px}*{box-sizing:border-box}${baseCss}\n${css}</style></head><body><div id="root"></div><script>window.catalogs=${JSON.stringify(catalogs)};window.fx={};window.calls=[];</script><script type="module" src="/fixture.js"></script></body></html>`);
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.render);
  return { browser, page, pageErrors, server };
}

const restaurant = { id: 3, business_id: 42, currency_code: 'USD', display_name: 'Ox Burger Lab', timezone: 'America/New_York' };

test('phase 6 hosting: table tab shows open tickets; release guard warns then confirms', { timeout: 180000 }, async () => {
  const { browser, page, pageErrors, server } = await serveBundle(`import React from 'react'; import { createRoot } from 'react-dom/client';
    import { BrowserRouter } from 'react-router-dom';
    import i18n from 'i18next'; import { initReactI18next } from 'react-i18next';
    import HostingPanel from './src/pages/food/RestaurantHostingPanel.jsx';
    i18n.use(initReactI18next).init({ lng: 'en', resources: window.catalogs, interpolation: { escapeValue: false } });
    const root = createRoot(document.getElementById('root'));
    window.render = (props) => root.render(<BrowserRouter><HostingPanel t={i18n.t.bind(i18n)} {...props} /></BrowserRouter>);`);
  try {
    const fx = {
      listRestaurantTables: {
        tables: [{ id: 11, restaurant_id: 3, location_id: 1, name: 'Table 4', capacity: 4, status: 'active' }],
        seatings: [{ id: 21, table_id: 11, restaurant_id: 3, location_id: 1, party_size: 3, order_id: null, waitlist_id: null, reservation_id: null, queue_number: 5 }],
        tickets: [{ id: 101, queue_number: 5, table_label: 'Table 4', table_id: 11, covers: 2, total_cents: 2500, currency_code: 'USD', pos_ticket_state: 'open', created_at: '2026-11-06T12:00:00.000Z' }],
      },
      listRestaurantReservations: { reservations: [], hasMore: false },
      listRestaurantWaitlist: { entries: [], hasMore: false },
      getRestaurantTableDetail: {
        table: { id: 11, restaurant_id: 3, location_id: 1, name: 'Table 4', capacity: 4, status: 'active' },
        seating: { id: 21, table_id: 11, party_size: 3, reservation_guest_name: 'Ada', waitlist_guest_name: null },
        seatings: [{ id: 21, table_id: 11, party_size: 3, reservation_guest_name: 'Ada', waitlist_guest_name: null }],
        tickets: [
          { id: 101, queue_number: 5, guest_name: 'Ada', table_label: 'Table 4', item_count: 3, covers: 2, total_cents: 2500, currency_code: 'USD', pos_ticket_state: 'open', status: 'accepted' },
          { id: 102, queue_number: 6, guest_name: 'Ada', table_label: 'Table 4', item_count: 1, covers: 1, total_cents: 1200, currency_code: 'USD', pos_ticket_state: 'open', status: 'ready' },
        ],
        totals: { open_ticket_count: 2, total_cents: 3700, covers: 3 },
      },
    };
    await page.evaluate(({ fx: fixtureFx, props }) => {
      window.fx = fixtureFx;
      window.calls = [];
      window.render(props);
    }, { fx, props: { restaurant } });

    await page.getByRole('button', { name: 'Table tab', exact: true }).first().waitFor();

    // Open the table tab: tickets, covers, and totals render.
    await page.getByRole('button', { name: 'Table tab', exact: true }).click();
    await page.waitForFunction(() => window.calls.some((c) => c.name === 'getRestaurantTableDetail'));
    await page.locator('[data-testid="restaurant-table-detail"]').waitFor();
    await page.getByText('Open tickets: 2').waitFor();
    await page.getByText('Covers: 3').waitFor();
    await page.getByText('Total: $37.00').waitFor();
    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('; ')}`);

    // Release without confirm: the server refuses with the structured
    // 409 and the warning names the open tickets.
    await page.getByRole('button', { name: 'Release table', exact: true }).click();
    await page.locator('[data-testid="restaurant-release-warning"]').waitFor();
    await page.getByText('This table still has open tickets. Releasing it will not close them.').waitFor();
    let calls = await page.evaluate(() => window.calls);
    const firstRelease = calls.find((c) => c.name === 'api:post' && String(c.args[0]).includes('/tables/11/seating'));
    assert.deepEqual(firstRelease.args[1], { action: 'release' });
    assert.equal(calls.filter((c) => c.name === 'api:post' && c.args[1]?.confirm === true).length, 0);
    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('; ')}`);

    // Release anyway: the confirm posts and the warning clears.
    await page.getByRole('button', { name: 'Release anyway', exact: true }).click();
    await page.waitForFunction(() => window.calls.some((c) => c.name === 'api:post' && c.args[1]?.confirm === true));
    await page.locator('[data-testid="restaurant-release-warning"]').waitFor({ state: 'detached' });
    calls = await page.evaluate(() => window.calls);
    const confirmed = calls.find((c) => c.name === 'api:post' && c.args[1]?.confirm === true);
    assert.deepEqual(confirmed.args[1], { action: 'release', confirm: true });
    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('; ')}`);
  } finally {
    await browser.close();
    server.close();
  }
});

test('phase 6 menu: food-cost view shows margins, no recipe, and mixed currencies', { timeout: 180000 }, async () => {
  const { browser, page, pageErrors, server } = await serveBundle(`import React from 'react'; import { createRoot } from 'react-dom/client';
    import { BrowserRouter } from 'react-router-dom';
    import i18n from 'i18next'; import { initReactI18next } from 'react-i18next';
    import MenuManager from './src/pages/food/RestaurantMenuManager.jsx';
    i18n.use(initReactI18next).init({ lng: 'en', resources: window.catalogs, interpolation: { escapeValue: false } });
    const root = createRoot(document.getElementById('root'));
    window.render = (props) => root.render(<BrowserRouter><MenuManager t={i18n.t.bind(i18n)} {...props} /></BrowserRouter>);`);
  try {
    const fx = {
      getManagedFoodMenu: {
        menu: [{
          id: 1, name: 'Mains',
          items: [
            { id: 41, name: 'Jerk Chicken Plate', price_cents: 1500, currency_code: 'USD', is_available: true, publication_status: 'published', archived_at: null, description: '', modifierGroups: [] },
            { id: 42, name: 'House Salad', price_cents: 800, currency_code: 'USD', is_available: true, publication_status: 'published', archived_at: null, description: '', modifierGroups: [] },
          ],
        }],
        uncategorizedItems: [],
      },
      listMenuFoodCosts: {
        food_costs: [
          { menu_item_id: 41, name: 'Jerk Chicken Plate', price_cents: 1500, currency_code: 'USD', cost_cents: 310, cost_currency_code: 'USD', margin_cents: 1190, margin_percent: 79.33, currency_mismatch: false, has_mappings: true },
          { menu_item_id: 42, name: 'House Salad', price_cents: 800, currency_code: 'USD', cost_cents: 0, cost_currency_code: 'USD', margin_cents: null, margin_percent: null, currency_mismatch: false, has_mappings: false },
          { menu_item_id: 43, name: 'Daily Special', price_cents: 2000, currency_code: 'EUR', cost_cents: 500, cost_currency_code: 'USD', margin_cents: null, margin_percent: null, currency_mismatch: true, has_mappings: true },
        ],
        sort: 'margin_asc',
      },
    };
    await page.evaluate(({ fx: fixtureFx, props }) => {
      window.fx = fixtureFx;
      window.calls = [];
      window.render(props);
    }, { fx, props: { restaurant } });

    await page.getByText('Jerk Chicken Plate', { exact: true }).first().waitFor();

    // Open the food-cost view: the margin-sorted table renders.
    await page.getByRole('button', { name: 'Food cost', exact: true }).click();
    await page.waitForFunction(() => window.calls.some((c) => c.name === 'listMenuFoodCosts'));
    await page.locator('[data-testid="menu-food-cost"]').waitFor();
    await page.getByText('Plate cost and margin').waitFor();
    await page.getByText('Cost $3.10 · Margin 79.33%').waitFor();
    await page.getByRole('cell', { name: '$3.10' }).waitFor();
    await page.getByRole('cell', { name: '79.33%' }).waitFor();
    await page.getByRole('cell', { name: 'No recipe' }).waitFor();
    await page.getByRole('cell', { name: 'Mixed currencies' }).waitFor();
    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('; ')}`);

    // Re-sorting re-requests with the new sort.
    await page.getByRole('button', { name: 'Highest margin', exact: true }).click();
    await page.waitForFunction(() => window.calls.filter((c) => c.name === 'listMenuFoodCosts').length >= 2);
    const calls = await page.evaluate(() => window.calls);
    const sorts = calls.filter((c) => c.name === 'listMenuFoodCosts').map((c) => c.args[1]?.sort);
    assert.deepEqual(sorts, ['margin_asc', 'margin_desc']);
    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('; ')}`);
  } finally {
    await browser.close();
    server.close();
  }
});
