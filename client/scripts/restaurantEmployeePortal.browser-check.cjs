// Browser-level coverage for the Phase 3 employee portal shell
// (Track A).
//
// Member: the portal shows the restaurant's own brand (name, accent),
// the "Powered by OxSteed" footer exactly once, the five tabs, and the
// time clock mounted on the My shift tab. The My tips / My pay /
// Availability / Swaps tabs show the plain "not available yet" empty
// state until Tracks B and C land; the My pay placeholder already
// carries the "Employed by [restaurant]" line.
//
// Non-member: a restaurant the signed-in user is not a member of shows
// the not-a-member state and no clock. Membership comes from
// GET /food/my/restaurants, which only returns the caller's own
// restaurants, so the fixture stubs that call with a member list that
// does not contain the requested restaurant.
//
// The shell must mount without page errors in both cases.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const catalogs = Object.fromEntries(['en'].map(language => {
  const legacy = JSON.parse(fs.readFileSync(path.join(root, `src/locales/${language}.json`)));
  return [language, { translation: Object.fromEntries(['food', 'common'].map(key => [key, legacy[key]])) }];
}));

const fixtureApi = `export default {
  get: async path => {
    if (String(path).includes('/time-entries/mine')) return { data: { entries: window.fixtureEntries, open_entry: null } };
    if (String(path).includes('/time-entry-corrections/mine')) return { data: window.fixtureCorrections };
    if (String(path).includes('/staff/shifts')) return { data: [] };
    if (String(path).includes('/staff/time-off')) return { data: { requests: [] } };
    return { data: [] };
  },
  post: async (path, body) => { window.fixtureCalls.push({ method: 'post', path, body }); return { data: { id: 9, status: 'pending' } }; },
};`;

const fixtureFoodApi = `export const listMyFoodRestaurants = async () => window.fixtureRestaurants;`;

async function buildBundle(memberRestaurants) {
  return build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {MemoryRouter, Routes, Route} from 'react-router-dom';
      import {createInstance} from 'i18next'; import {I18nextProvider} from 'react-i18next';
      import RestaurantEmployeePortalPage from './src/pages/food/RestaurantEmployeePortalPage.jsx';
      const i18n=createInstance(); await i18n.init({lng:'en',fallbackLng:'en',resources:${JSON.stringify(catalogs)},interpolation:{escapeValue:false}});
      window.fixtureCalls=[];
      window.fixtureEntries=[];
      window.fixtureCorrections=[];
      window.fixtureRestaurants=${JSON.stringify(memberRestaurants)};
      createRoot(document.getElementById('root')).render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={['/restaurants/7/portal']}><Routes><Route path="/restaurants/:restaurantId/portal" element={<RestaurantEmployeePortalPage />} /></Routes></MemoryRouter></I18nextProvider>);`, resolveDir: root, loader: 'jsx' },
    bundle: true, write: false, jsx: 'automatic', format: 'esm', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'phase3-portal-fixture', setup(plugin) {
      const mocks = {
        '../../api/axios': fixtureApi,
        '../../api/food': fixtureFoodApi,
        '../../context/AuthContext': `import React from 'react'; export const AuthContext=React.createContext({}); export const useAuth=()=>({user:{id:'emp-1',role:'customer'}});`,
      };
      plugin.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'phase3-portal-fixture' } : undefined);
      plugin.onLoad({ filter: /.*/, namespace: 'phase3-portal-fixture' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: root }));
    }}],
  });
}

async function serve(bundle) {
  const css = '*{box-sizing:border-box}body{margin:0}button{font:inherit}' + fs.readFileSync(path.join(root, 'src/index.css'), 'utf8').replace(/^@(?:import|config).*$/gm, '');
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].contents); }
    else if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
    else res.end('<html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

test('member sees their restaurant brand, the time clock, and the future-tab empty states', { timeout: 120_000 }, async () => {
  const bundle = await buildBundle([
    { id: 7, business_id: 42, display_name: 'Test Bistro', logo_url: '', brand_accent_hex: '#0e7490' },
  ]);
  const server = await serve(bundle);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    // Restaurant brand first: the name heads the page.
    await page.getByRole('heading', { name: 'Test Bistro' }).waitFor({ state: 'visible', timeout: 10_000 });
    // OxSteed appears exactly once, small, in the footer.
    assert.equal(await page.getByText('Powered by OxSteed').count(), 1);
    // All five tabs exist; My shift is the default tab with the clock.
    for (const tab of ['My shift', 'My tips', 'My pay', 'Availability', 'Swaps']) {
      assert.equal(await page.getByRole('tab', { name: tab }).count(), 1);
    }
    await page.getByRole('button', { name: 'Clock in' }).waitFor({ state: 'visible', timeout: 10_000 });
    // Future tabs show the plain empty state, nothing invented.
    await page.getByRole('tab', { name: 'My tips' }).click();
    await page.getByText('Not available yet.').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByRole('tab', { name: 'Availability' }).click();
    await page.getByText('Not available yet.').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByRole('tab', { name: 'Swaps' }).click();
    await page.getByText('Not available yet.').waitFor({ state: 'visible', timeout: 10_000 });
    // The My pay placeholder already says who employs the worker. The
    // empty-state text is already visible from the Swaps tab, so wait on
    // the tab's selected state (not the shared text) before asserting.
    await page.getByRole('tab', { name: 'My pay' }).click();
    await page.getByRole('tab', { name: 'My pay', selected: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByText('Employed by Test Bistro').waitFor({ state: 'visible', timeout: 10_000 });
    assert.equal(await page.getByText('Employed by Test Bistro').count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

test('non-member sees the not-a-member state and no clock', { timeout: 120_000 }, async () => {
  const bundle = await buildBundle([
    { id: 9, business_id: 43, display_name: 'Other Place', logo_url: '', brand_accent_hex: '' },
  ]);
  const server = await serve(bundle);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByText("You are not a member of this restaurant's team.").waitFor({ state: 'visible', timeout: 10_000 });
    assert.equal(await page.getByRole('button', { name: 'Clock in' }).count(), 0);
    assert.equal(await page.getByRole('tab', { name: 'My shift' }).count(), 0);
    assert.equal(await page.getByText('Powered by OxSteed').count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});
