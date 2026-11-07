// Browser-level coverage for the Phase 3 employee portal shell
// (Track A), the My tips / My pay panels (Track B), and the
// Availability / Swaps panels (Track C).
//
// Member: the portal shows the restaurant's own brand (name, accent),
// the "Powered by OxSteed" footer exactly once, the five tabs, and the
// time clock mounted on the My shift tab. The My tips tab shows the
// employee's own tip summary, their pending cash-tip declaration, and
// the declare form (submitting posts a pending declaration); the My pay
// tab shows the period pay summary, the finalized pay stubs, and the
// stub detail from a finalized run. The Availability tab shows the
// weekly editor (adding hours and saving round-trips through the
// mocked replace/list calls); the Swaps tab shows the request form
// (my shift plus a staff target), the target inbox with accept, and
// the outgoing request list. Both pay tabs carry the "Employed by
// [restaurant]" line.
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
    if (String(path).includes('/staff/availability')) return { data: { windows: window.fixtureAvailability } };
    if (String(path).includes('/staff/shift-swaps')) return { data: { requests: window.fixtureSwaps } };
    if (String(path).includes('/staff/shifts')) return { data: window.fixtureShifts };
    if (String(path).includes('/staff/time-off')) return { data: { requests: [] } };
    return { data: [] };
  },
  post: async (path, body) => { window.fixtureCalls.push({ method: 'post', path, body }); return { data: { id: 9, status: 'pending' } }; },
  put: async (path, body) => {
    window.fixtureCalls.push({ method: 'put', path, body });
    if (String(path).includes('/staff/availability')) window.fixtureAvailability = (body.windows || []).map(w => ({ ...w, start_time: w.start_time, end_time: w.end_time }));
    return { data: { windows: window.fixtureAvailability } };
  },
};`;

const fixtureFoodApi = `export const listMyFoodRestaurants = async () => window.fixtureRestaurants;`;

const fixtureRestaurantsApi = `export const getMyTips = async () => window.fixtureTips;
export const getMyPay = async () => window.fixturePay;
export const listMyPayStubs = async () => window.fixtureStubs;
export const getMyPayStub = async () => window.fixtureStub;
export const listMyCashTips = async () => [];
export const declareMyCashTip = async (restaurantId, payload) => { window.fixtureCalls.push({ method: 'post', path: 'cash-declarations/mine', body: payload }); return { declaration: { id: 5, status: 'pending', amount_cents: payload.amountCents, business_date: payload.date }, replayed: false }; };
export const confirmCashTipDeclaration = async () => null;
export const rejectCashTipDeclaration = async () => null;`;

const fixtureBusinessesApi = `export const listMembers = async () => window.fixtureMembers;`;

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
      window.fixtureAvailability=[];
      window.fixtureShifts=[{id:11,user_id:'emp-1',shift_date:'2026-11-07',start_time:'09:00:00',end_time:'17:00:00',role_label:'Server',published:true}];
      window.fixtureMembers=[{user_id:'emp-2',first_name:'Bob',last_name:'Target',status:'active',member_email:'bob@example.invalid'}];
      window.fixtureSwaps=[{id:21,business_id:42,shift_id:12,requester_user_id:'emp-2',target_user_id:'emp-1',status:'requested',note:null,shift_date:'2026-11-08',start_time:'09:00:00',end_time:'17:00:00',role_label:'Cook'}];
      window.fixtureRestaurants=${JSON.stringify(memberRestaurants)};
      window.fixtureTips={from_date:'2026-10-05',to_date:'2026-11-03',timezone:'America/New_York',currencies:[{currency:'USD',pooling_enabled:false,gross_tips_cents:2000,tip_out_cents:0,tip_in_cents:0,net_tips_cents:2000}],cash_tips:[{id:5,business_date:'2026-10-06',amount_cents:3000,status:'pending',note:null}]};
      window.fixturePay={from_date:'2026-10-05',to_date:'2026-11-03',timezone:'America/New_York',currency:'USD',currency_minor_unit_decimals:2,employee:{user_id:'emp-1',hours:10,regular_hours:10,overtime_hours:0,doubletime_hours:0,hourly_wage_cents:1500,regular_wages_cents:15000,overtime_wages_cents:0,doubletime_wages_cents:0,wages_cents:15000,meal_break_premium_cents:0,predictability_premium_cents:0,gross_tips_cents:2000,net_tips_cents:2000,total_pay_cents:17000}};
      window.fixtureStubs=[{pay_run_id:12,period_from:'2026-10-05',period_to:'2026-10-11',status:'finalized',finalized_at:'2026-10-12T12:00:00Z',staff_label:'Test Worker',total_pay_cents:17000}];
      window.fixtureStub={pay_run:{id:12,period_from:'2026-10-05',period_to:'2026-10-11',status:'finalized',finalized_at:'2026-10-12T12:00:00Z',totals:{}},line:{staff_label:'Test Worker',regular_hours:10,overtime_hours:0,doubletime_hours:0,hourly_wage_cents:1500,regular_wages_cents:15000,overtime_wages_cents:0,doubletime_wages_cents:0,wages_cents:15000,meal_break_premium_cents:0,predictability_premium_cents:0,gross_tips_cents:2000,net_tips_cents:2000,total_pay_cents:17000}};
      createRoot(document.getElementById('root')).render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={['/restaurants/7/portal']}><Routes><Route path="/restaurants/:restaurantId/portal" element={<RestaurantEmployeePortalPage />} /></Routes></MemoryRouter></I18nextProvider>);`, resolveDir: root, loader: 'jsx' },
    bundle: true, write: false, jsx: 'automatic', format: 'esm', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'phase3-portal-fixture', setup(plugin) {
      const mocks = {
        '../../api/axios': fixtureApi,
        '../../api/food': fixtureFoodApi,
        '../../api/restaurants': fixtureRestaurantsApi,
        '../../api/businesses': fixtureBusinessesApi,
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

test('member sees their restaurant brand, the time clock, and the availability and swap panels', { timeout: 120_000 }, async () => {
  const bundle = await buildBundle([
    { id: 7, business_id: 42, display_name: 'Test Bistro', logo_url: '', brand_accent_hex: '#0e7490', currency_code: 'USD' },
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
    // My tips (Track B): the employee's own tip summary, the pending
    // cash-tip declaration, and the Employed by line.
    await page.getByRole('tab', { name: 'My tips' }).click();
    await page.getByText('Net tips').waitFor({ state: 'visible', timeout: 10_000 });
    assert.equal(await page.getByText('$20.00').count(), 2);
    assert.equal(await page.getByText('Pending', { exact: true }).count(), 1);
    assert.equal(await page.getByText('Employed by Test Bistro').count(), 1);
    // Declaring a cash tip posts a pending declaration.
    await page.getByLabel('Amount (USD)').fill('25');
    await page.getByRole('button', { name: 'Declare cash tip' }).click();
    await page.getByText('Cash tip declared. It counts toward your pay after a manager confirms it.').waitFor({ state: 'visible', timeout: 10_000 });
    const calls = await page.evaluate(() => window.fixtureCalls);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, 'cash-declarations/mine');
    assert.equal(calls[0].body.amountCents, 2500);
    // My pay (Track B): the period pay summary, the finalized stubs,
    // and the stub detail from the finalized run.
    await page.getByRole('tab', { name: 'My pay' }).click();
    await page.getByText('Total pay').waitFor({ state: 'visible', timeout: 10_000 });
    assert.equal(await page.getByText('$170.00').count(), 2);
    await page.getByText('Pay stubs').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByRole('button', { name: 'View stub' }).click();
    await page.getByRole('heading', { name: 'Pay stub', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByText('Finalized', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByText(/Finalized on/).waitFor({ state: 'visible', timeout: 10_000 });
    // The stub detail carries its own Employed by line on top of the
    // panel's, so the open stub shows it twice.
    assert.equal(await page.getByText('Employed by Test Bistro').count(), 2);
    // Availability (Track C): the weekly editor. Adding Monday hours
    // and saving PUTs the windows and re-reads them, so the saved
    // values shown are the read-back, not optimistic state.
    await page.getByRole('tab', { name: 'Availability' }).click();
    await page.getByText('Tell the restaurant when you can usually work.').waitFor({ state: 'visible', timeout: 10_000 });
    const monday = page.locator('section[aria-label="Monday"]');
    await monday.getByRole('button', { name: 'Add hours' }).click();
    await monday.getByLabel('Start').fill('09:00');
    await monday.getByLabel('End').fill('17:00');
    await page.getByRole('button', { name: 'Save availability' }).click();
    await page.getByText('Availability saved.').waitFor({ state: 'visible', timeout: 10_000 });
    assert.equal(await monday.getByLabel('Start').inputValue(), '09:00');
    assert.equal(await monday.getByLabel('End').inputValue(), '17:00');
    const putCalls = await page.evaluate(() => window.fixtureCalls.filter((c) => c.method === 'put'));
    assert.equal(putCalls.length, 1);
    assert.deepEqual(putCalls[0].body.windows, [{ day_of_week: 1, start_time: '09:00', end_time: '17:00' }]);
    // Swaps (Track C): request a swap for my shift with Bob, then
    // accept the swap Bob asked me to take.
    await page.getByRole('tab', { name: 'Swaps' }).click();
    await page.getByText('Request a swap').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByLabel('My shift').selectOption('11');
    await page.getByLabel('Swap with').selectOption('emp-2');
    await page.getByRole('button', { name: 'Request swap' }).click();
    await page.getByText('Swap request sent. Bob Target needs to accept before a manager can approve it.').waitFor({ state: 'visible', timeout: 10_000 });
    const swapPosts = await page.evaluate(() => window.fixtureCalls.filter((c) => c.method === 'post' && String(c.path).includes('swap-requests')));
    assert.equal(swapPosts.length, 1);
    assert.equal(swapPosts[0].body.target_user_id, 'emp-2');
    await page.getByText('Swaps for me').waitFor({ state: 'visible', timeout: 10_000 });
    assert.equal(await page.getByText('From Bob Target').count(), 1);
    await page.getByRole('button', { name: 'Accept' }).click();
    await page.waitForFunction(() => window.fixtureCalls.some((c) => String(c.path).includes('/respond') && c.body?.action === 'accept'), null, { timeout: 10_000 });
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
