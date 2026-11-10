// Run with playwright-core and Chrome available:
// node --test scripts/careersMarketplace.browser-check.cjs
// Careers marketplace: advanced filters, sort, numbered paging and "save
// search as alert" on /careers, plus save / follow / report on a job page.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

const shared = {
  'react-i18next': `const t = (key, o) => (o && o.count != null ? key + ':' + o.count : key); export const useTranslation = () => ({t, i18n: {language: 'en'}});`,
  'react-hot-toast': `const toast = {success(m) { window.toasts.push(m); }, error(m) { window.toastErrors.push(String(m)); }}; export default toast;`,
  '../components/PageMeta': 'export default () => null;',
  '../components/PageShell': 'export default ({children}) => children;',
  '../components/JsonLd': 'export default () => null; export const buildItemList = (x) => x;',
  '../components/CountrySelect': 'export default () => null;',
  '../context/AuthContext': `export const useAuth = () => ({user: window.signedIn ? {id: 'u1', role: 'customer'} : null});`,
  '../context/CookieConsentContext': 'export const useCookieConsentContext = () => ({preferences: {analytics: window.analyticsConsent}});',
};
const api = `
  const call = (name, args) => { window.calls.push({name, args}); };
  export async function listPublicCareerOpenings(params) {
    call('list', params);
    const page = params.page || 1;
    const openings = Array.from({length: window.showPromotion ? 3 : 2}, (_, i) => ({id: page * 10 + i, title: 'Line cook ' + (page * 10 + i), employer_type: 'business',
      business_id: 7, employer_name: 'Taco Spot', country_code: 'US', workplace_type: 'onsite', employment_type: 'full_time',
      same_day_hire: i === 0, urgently_hiring: i === 1, pay_min: 18, pay_max: 22, pay_currency: 'USD', pay_period: 'hourly'}));
    return {openings, promoted: window.showPromotion ? [openings[0]] : [], total: 57, pages: 6};
  }
  export async function createCareerAlert(body) { call('alert', body); return {alert: {id: 1}}; }
  export async function saveCareerJob(id) { call('save', id); }
  export async function unsaveCareerJob(id) { call('unsave', id); }
  export async function followCareerEmployer(key) { call('follow', key); }
  export async function unfollowCareerEmployer(key) { call('unfollow', key); }
  export async function reportCareerOpening(id, body) { call('report', {id, ...body}); }
  export async function trackCareerEvent(id, type) { call('track', {id, type}); }
  export async function trackCareerImpressions(ids) { call('impressions', ids); }
`;

async function bundle(entry) {
  const mocks = {...shared, '../api/careers': api, '../../../api/careers': api};
  const result = await build({
    stdin: {contents: entry, resolveDir: path.resolve(__dirname, '..'), loader: 'jsx'},
    bundle: true, write: false, loader: {'.css': 'empty'}, jsx: 'automatic',
    define: {'import.meta.env': '{}'},
    plugins: [{name: 'careers-marketplace-mocks', setup(plugin) {
      plugin.onResolve({filter: /.*/}, (args) => (mocks[args.path] ? {path: args.path, namespace: 'mk-test'} : undefined));
      plugin.onLoad({filter: /.*/, namespace: 'mk-test'}, (args) => ({contents: mocks[args.path], loader: 'js'}));
    }}],
  });
  return result.outputFiles[0].contents;
}

async function withPage(js, fn, {signedIn = true, analyticsConsent = false, showPromotion = false} = {}) {
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); }
    else res.end(`<div id="root"></div><script>window.calls=[];window.toasts=[];window.toastErrors=[];window.signedIn=${signedIn};window.analyticsConsent=${analyticsConsent};window.showPromotion=${showPromotion};</script><script src="/app.js"></script>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless: true, channel: 'chrome'});
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await fn(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.close();
  }
}

const calls = (page, name) => page.evaluate((n) => window.calls.filter((c) => c.name === n).map((c) => c.args), name);

test('job search sends filters, sort and page, and saves the search as an alert', async () => {
  const js = await bundle(`import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
    import Page from './src/pages/CareersPage.jsx';
    createRoot(document.getElementById('root')).render(<MemoryRouter><Page /></MemoryRouter>);`);
  await withPage(js, async (page) => {
    await page.getByText('Line cook 10').waitFor();
    const first = (await calls(page, 'list'))[0];
    assert.equal(first.page, 1, 'paged mode is always requested');
    assert.ok(await page.getByText('careers.mk.badges.sameDay').first().isVisible());
    assert.ok(await page.getByText('careers.mk.badges.urgent').first().isVisible());

    await page.getByRole('button', {name: 'careers.mk.search.more'}).click();
    await page.getByLabel('careers.mk.search.industry').selectOption('food_service');
    await page.getByLabel('careers.mk.search.experience').selectOption('entry');
    await page.getByLabel('careers.mk.search.payMin').fill('17');
    await page.getByText('careers.mk.search.flags.same_day').click();
    await page.getByRole('button', {name: 'careers.filters.search'}).click();
    await page.waitForFunction(() => window.calls.filter((c) => c.name === 'list').length >= 2);
    const filtered = (await calls(page, 'list')).at(-1);
    assert.equal(filtered.industry, 'food_service');
    assert.equal(filtered.experience, 'entry');
    assert.equal(filtered.pay_min, 17);
    assert.equal(filtered.pay_period, 'hourly');
    assert.equal(filtered.same_day, 'true');
    assert.equal(filtered.page, 1);

    await page.getByLabel('careers.mk.search.sort').selectOption('pay_high');
    await page.waitForFunction(() => window.calls.filter((c) => c.name === 'list').at(-1).args.sort === 'pay_high');

    const pager = page.getByRole('navigation', {name: 'careers.mk.search.pages'});
    await pager.getByRole('button', {name: '6', exact: true}).click();
    await page.getByText('Line cook 60').waitFor();
    assert.equal((await calls(page, 'list')).at(-1).page, 6);
    assert.equal(await pager.getByRole('button', {name: '6', exact: true}).getAttribute('aria-current'), 'page');
    assert.equal(await pager.getByRole('button', {name: 'careers.mk.search.next'}).isDisabled(), true);
    await pager.getByRole('button', {name: 'careers.mk.search.prev'}).click();
    await page.getByText('Line cook 50').waitFor();

    await page.getByRole('button', {name: 'careers.mk.alerts.saveSearch'}).click();
    await page.waitForFunction(() => window.calls.some((c) => c.name === 'alert'));
    const [alert] = await calls(page, 'alert');
    assert.equal(alert.criteria.industry, 'food_service');
    assert.equal(alert.criteria.same_day, 'true');
    assert.equal(alert.frequency, 'daily');
    assert.ok(await page.evaluate(() => window.toasts.includes('careers.mk.alerts.created')));
    assert.deepEqual(await calls(page, 'impressions'), []);
  });
});

test('search batches visible cards and counts a duplicate promoted card once', async () => {
  const js = await bundle(`import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
    import Page from './src/pages/CareersPage.jsx';
    createRoot(document.getElementById('root')).render(<MemoryRouter><style>{
      '.ox-careers-card { position: absolute; top: 250px; width: 300px; height: 140px; overflow: hidden; }'
      + '.ox-careers-section .ox-careers-card { top: 50px; }'
      + '[data-career-opening-id="11"] { left: 350px; }'
      + '[data-career-opening-id="12"] { top: 1200px; }'
    }</style><Page /></MemoryRouter>);`);
  await withPage(js, async (page) => {
    await page.waitForFunction(() => window.calls.some((c) => c.name === 'impressions'));
    assert.deepEqual((await calls(page, 'impressions')).map((ids) => ids.sort()), [['10', '11']]);
    await page.locator('[data-career-opening-id="12"]').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => window.calls.some((c) => c.name === 'impressions' && c.args.includes('12')));
    assert.deepEqual((await calls(page, 'impressions')).map((ids) => ids.sort()), [['10', '11'], ['12']]);
  }, {analyticsConsent: true, showPromotion: true, signedIn: false});
});

test('signed-out visitors get a login link instead of saving an alert', async () => {
  const js = await bundle(`import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
    import Page from './src/pages/CareersPage.jsx';
    createRoot(document.getElementById('root')).render(<MemoryRouter><Page /></MemoryRouter>);`);
  await withPage(js, async (page) => {
    await page.getByText('Line cook 10').waitFor();
    await page.getByLabel('careers.searchPlaceholder').fill('cook');
    await page.getByRole('button', {name: 'careers.filters.search'}).click();
    const link = page.getByRole('link', {name: 'careers.mk.alerts.saveSearch'});
    await link.waitFor();
    assert.match(await link.getAttribute('href'), /^\/login\?next=/);
  }, {signedIn: false});
});

test('job page actions save, follow the employer and file a report', async () => {
  const js = await bundle(`import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
    import OpeningActions from './src/components/careers/marketplace/OpeningActions.jsx';
    const opening = {id: 42, title: 'Barista', employer_type: 'business', business_id: 7, employer_slug: 'taco-spot', employer_name: 'Taco Spot',
      same_day_hire: true, industry: 'food_service', response_speed: {days: 2}, viewer: {saved: false, following: false}};
    createRoot(document.getElementById('root')).render(<MemoryRouter><OpeningActions opening={opening} user={{id: 'u1'}} /></MemoryRouter>);`);
  await withPage(js, async (page) => {
    await page.getByText('careers.mk.badges.responds:2').waitFor();
    assert.deepEqual((await calls(page, 'track'))[0], {id: 42, type: 'view'});
    assert.equal(await page.getByRole('link', {name: 'careers.mk.actions.companyPage'}).getAttribute('href'), '/careers/employers/taco-spot');

    await page.getByRole('button', {name: 'careers.mk.actions.save'}).click();
    await page.getByRole('button', {name: 'careers.mk.actions.unsave'}).waitFor();
    assert.deepEqual(await calls(page, 'save'), [42]);

    await page.getByRole('button', {name: 'careers.mk.actions.follow'}).click();
    await page.getByRole('button', {name: 'careers.mk.actions.unfollow'}).waitFor();
    assert.deepEqual(await calls(page, 'follow'), [{business_id: 7}]);

    await page.getByRole('button', {name: 'careers.mk.actions.report'}).click();
    const send = page.getByRole('button', {name: 'careers.mk.report.send'});
    assert.equal(await send.isDisabled(), true, 'a reason is required');
    await page.getByLabel('careers.mk.report.reason').selectOption('asks_for_payment');
    await page.getByLabel('careers.mk.report.details').fill('Asked for a $50 uniform fee');
    await send.click();
    await page.waitForFunction(() => window.calls.some((c) => c.name === 'report'));
    assert.deepEqual(await calls(page, 'report'), [{id: 42, reason: 'asks_for_payment', details: 'Asked for a $50 uniform fee'}]);
    assert.ok(await page.evaluate(() => window.toasts.includes('careers.mk.report.thanks')));
  });
});
