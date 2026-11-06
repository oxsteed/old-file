// Browser-level coverage for the Phase 7 compliance flows:
//   - TemperatureLogsPanel: the daily log renders breach rows with
//     their configured range, a new reading posts with the chosen
//     area, and a breach links to an open corrective action from the
//     audits flow (the action stays the workflow, the log is the
//     evidence).
//   - RestaurantTimeClockCard: clocking out of a long shift opens the
//     meal-break attestation prompt instead of clocking out
//     immediately; the waiver path requires a reason and posts the
//     attestation inside the clock-out call. Skipping is allowed:
//     the server never blocks clock-out on a missing attestation.
//
// Both panels are rendered directly with the real i18n catalog; the
// restaurants API module, the axios instance, the operations context
// and the auth context are stubbed. The shell must mount without
// page errors.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
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
}\n` + exportsList.map((name) => `export const ${name} = (...args) => reply('${name}', args);`).join('\n');

const mockContext = `export const useOperationStore = () => ({ locationId: 1, brandAccess: true, store: { timezone: 'America/New_York' } });
export const OperationStorePicker = () => null;
export const permits = () => true;
export const requestIdentity = () => 'fixture-key';
export const localDate = () => '2026-11-06';
export const localInput = (iso) => (iso ? String(iso).slice(0, 16) : '');
export const storeInstant = (value) => (value ? new Date(value).toISOString() : null);
`;

const mockAuthContext = `export const useAuth = () => ({ user: { id: 9, email: 'phase7-staff@example.com' } });
export const AuthContext = null;
export const AuthProvider = ({ children }) => children;
`;

// The axios instance: the time-clock card loads its own punches
// through it. The open punch comes from window.fx.openEntry so the
// test controls the shift length; clock-out returns a meal premium
// so the card's premium toast path runs.
const mockAxios = `export default {
  post: async (url, body) => {
    window.calls.push({ name: 'api:post', args: [url, body] });
    if (String(url).includes('/clock-out/')) {
      return { data: { break_attestation_required: true, meal_break_premium_hours: 1, break_attestation_disputed: false } };
    }
    return { data: {} };
  },
  get: async (url, config) => {
    window.calls.push({ name: 'api:get', args: [url, config] });
    if (String(url).includes('/time-entries/mine')) {
      return { data: { entries: [], open_entry: window.fx.openEntry || null } };
    }
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
      name: 'phase7-fixture',
      setup(b) {
        b.onResolve({ filter: /api\/restaurants$/ }, () => ({ path: 'restaurants', namespace: 'fixture' }));
        b.onResolve({ filter: /api\/axios$/ }, () => ({ path: 'axios', namespace: 'fixture' }));
        b.onResolve({ filter: /restaurantOperationsContext$/ }, () => ({ path: 'operations-context', namespace: 'fixture' }));
        b.onResolve({ filter: /context\/AuthContext$/ }, () => ({ path: 'auth-context', namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents:
            args.path === 'restaurants' ? mockApiModule(restaurantsExports)
            : args.path === 'axios' ? mockAxios
            : args.path === 'auth-context' ? mockAuthContext
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

test('phase 7 temperature logs: breach row, new reading posts, breach links to a corrective action', { timeout: 180000 }, async () => {
  const { browser, page, pageErrors, server } = await serveBundle(`import React from 'react'; import { createRoot } from 'react-dom/client';
    import { BrowserRouter } from 'react-router-dom';
    import i18n from 'i18next'; import { initReactI18next } from 'react-i18next';
    import { TemperatureLogsPanel } from './src/pages/food/RestaurantOpsPanels.jsx';
    i18n.use(initReactI18next).init({ lng: 'en', resources: window.catalogs, interpolation: { escapeValue: false } });
    const root = createRoot(document.getElementById('root'));
    window.render = (props) => root.render(<BrowserRouter><TemperatureLogsPanel t={i18n.t.bind(i18n)} {...props} /></BrowserRouter>);`);
  try {
    const fx = {
      listStorageAreas: [
        { id: 5, name: 'Walk-in fridge', temperature_min_c: 2, temperature_max_c: 4, temperature_range: '2-4C' },
        { id: 6, name: 'Freezer', temperature_min_c: -20, temperature_max_c: -15, temperature_range: '-20 to -15' },
      ],
      listTemperatureLogs: {
        logs: [
          { id: 21, area_id: 5, area_name: 'Walk-in fridge', station_label: 'Dairy shelf', reading_celsius: 8.5, threshold_min_c: 2, threshold_max_c: 4, breach: true, corrective_action_id: null, recorded_at: '2026-11-06T09:00:00.000Z', business_date: '2026-11-06' },
          { id: 20, area_id: 6, area_name: 'Freezer', station_label: null, reading_celsius: -18, threshold_min_c: -20, threshold_max_c: -15, breach: false, corrective_action_id: null, recorded_at: '2026-11-06T08:00:00.000Z', business_date: '2026-11-06' },
        ],
        summary: { business_date: '2026-11-06', readings: 2, breaches: 1, areas_logged: 2, breaches_with_action: 0 },
      },
      listCorrectiveActions: [
        { id: 77, title: 'Move dairy to backup fridge', status: 'open' },
        { id: 78, title: 'Calibrate the walk-in sensor', status: 'open' },
      ],
      recordTemperatureLog: { log: { id: 22, area_id: 5, area_name: 'Walk-in fridge', reading_celsius: 3.5, threshold_min_c: 2, threshold_max_c: 4, breach: false }, thresholds: { min: 2, max: 4 }, breach: false },
      linkTemperatureCorrectiveAction: { id: 21, corrective_action_id: 77 },
    };
    await page.evaluate(({ fx: fixtureFx, props }) => {
      window.fx = fixtureFx;
      window.calls = [];
      window.render(props);
    }, { fx, props: { restaurant } });

    await page.getByText('Temperature logs', { exact: true }).waitFor();
    await page.getByText('Walk-in fridge').first().waitFor();

    // The breach row shows the flag and the configured range; the
    // in-range row shows its reading without a flag.
    await page.getByText('Breach', { exact: true }).waitFor();
    await page.getByText('8.5°C').waitFor();
    await page.getByText('(2–4°C)', { exact: true }).waitFor();
    await page.getByText(/1 breaches/).waitFor();
    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('; ')}`);

    // Recording a reading posts the chosen area and reading.
    await page.locator('#tl-area').selectOption('5');
    await page.locator('#tl-reading').fill('3.5');
    await page.getByRole('button', { name: 'Record reading', exact: true }).click();
    await page.waitForFunction(() => window.calls.some((c) => c.name === 'recordTemperatureLog'));
    let calls = await page.evaluate(() => window.calls);
    const recorded = calls.find((c) => c.name === 'recordTemperatureLog');
    assert.equal(recorded.args[0], 3);
    assert.equal(recorded.args[1].areaId, 5);
    assert.equal(recorded.args[1].readingCelsius, 3.5);
    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('; ')}`);

    // The breach links to an open corrective action from the audits
    // flow; the link posts the action id for that log.
    await page.getByRole('button', { name: 'Link action', exact: true }).click();
    await page.locator('select[aria-label="Choose corrective action"]').selectOption('77');
    await page.getByRole('button', { name: 'Link action', exact: true }).click();
    await page.waitForFunction(() => window.calls.some((c) => c.name === 'linkTemperatureCorrectiveAction'));
    calls = await page.evaluate(() => window.calls);
    const linked = calls.find((c) => c.name === 'linkTemperatureCorrectiveAction');
    assert.deepEqual(linked.args, [3, 21, { correctiveActionId: 77 }]);
    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('; ')}`);
  } finally {
    await browser.close();
    server.close();
  }
});

test('phase 7 time clock: long shift prompts for a meal-break attestation; waiver needs a reason', { timeout: 180000 }, async () => {
  const { browser, page, pageErrors, server } = await serveBundle(`import React from 'react'; import { createRoot } from 'react-dom/client';
    import { BrowserRouter } from 'react-router-dom';
    import i18n from 'i18next'; import { initReactI18next } from 'react-i18next';
    import RestaurantTimeClockCard from './src/pages/food/RestaurantTimeClockCard.jsx';
    i18n.use(initReactI18next).init({ lng: 'en', resources: window.catalogs, interpolation: { escapeValue: false } });
    const root = createRoot(document.getElementById('root'));
    window.render = (props) => root.render(<BrowserRouter><RestaurantTimeClockCard {...props} /></BrowserRouter>);`);
  try {
    const clockInAt = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
    const fx = {
      openEntry: { id: 7, user_id: 9, clock_in_at: clockInAt, breaks: [], entry_date: '2026-11-06' },
    };
    await page.evaluate(({ fx: fixtureFx, props }) => {
      window.fx = fixtureFx;
      window.calls = [];
      window.render(props);
    }, { fx, props: { restaurant } });

    await page.getByRole('button', { name: 'Clock out', exact: true }).waitFor();

    // Clocking out of a 5-hour shift opens the attestation prompt
    // instead of clocking out immediately.
    await page.getByRole('button', { name: 'Clock out', exact: true }).click();
    await page.getByText('Did you take your meal break?', { exact: true }).waitFor();
    let calls = await page.evaluate(() => window.calls);
    assert.equal(calls.filter((c) => c.name === 'api:post' && String(c.args[0]).includes('/clock-out/')).length, 0);
    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('; ')}`);

    // The waiver path asks for a reason and posts the attestation
    // inside the clock-out call.
    await page.getByRole('button', { name: 'No, I waived it', exact: true }).click();
    await page.locator('#tc-waiver-reason').waitFor();
    await page.locator('#tc-waiver-reason').fill('Lunch rush, no cover');
    await page.getByRole('button', { name: 'Confirm waiver', exact: true }).click();
    await page.waitForFunction(() => window.calls.some((c) => c.name === 'api:post' && String(c.args[0]).includes('/clock-out/')));
    calls = await page.evaluate(() => window.calls);
    const clockOut = calls.find((c) => c.name === 'api:post' && String(c.args[0]).includes('/clock-out/'));
    assert.equal(clockOut.args[0], '/businesses/42/staff/clock-out/7');
    assert.deepEqual(clockOut.args[1], { breakAttestation: { mealBreakTaken: false, waived: true, waiverReason: 'Lunch rush, no cover' } });
    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('; ')}`);
  } finally {
    await browser.close();
    server.close();
  }
});
