// Browser-level coverage for the Phase 2 employee correction flow on
// the time clock card.
//
// A closed punch shows a "Request correction" button; opening it shows
// the correction form (corrected clock-in/out + reason), and submitting
// posts the correction endpoint with the reason. A system-closed punch
// carries the visible flag, and the optional staff PIN field is
// present for stores that require one. The card must mount without
// page errors.
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

test('employee can request a punch correction from the time clock card', { timeout: 120_000 }, async () => {
  const mocks = {
    '../../api/axios': fixtureApi,
    '../../context/AuthContext': `import React from 'react'; export const AuthContext=React.createContext({}); export const useAuth=()=>({user:{id:'emp-1',role:'customer'}});`,
  };
  const bundle = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {createInstance} from 'i18next'; import {I18nextProvider} from 'react-i18next';
      import RestaurantTimeClockCard from './src/pages/food/RestaurantTimeClockCard.jsx';
      const i18n=createInstance(); await i18n.init({lng:'en',fallbackLng:'en',resources:${JSON.stringify(catalogs)},interpolation:{escapeValue:false}});
      window.fixtureCalls=[];
      window.fixtureEntries=[
        {id:11,user_id:'emp-1',entry_date:'2026-11-04',clock_in_at:'2026-11-04T09:00:00.000Z',clock_out_at:'2026-11-04T17:00:00.000Z',hours:8,system_closed:false,system_closed_reason:null,breaks:[]},
        {id:12,user_id:'emp-1',entry_date:'2026-11-03',clock_in_at:'2026-11-03T09:00:00.000Z',clock_out_at:'2026-11-03T21:00:00.000Z',hours:12,system_closed:true,system_closed_reason:'auto_close_12h_cap',breaks:[]},
      ];
      window.fixtureCorrections=[];
      createRoot(document.getElementById('root')).render(<I18nextProvider i18n={i18n}><RestaurantTimeClockCard restaurant={{business_id:1,id:1}} /></I18nextProvider>);`, resolveDir: root, loader: 'jsx' },
    bundle: true, write: false, jsx: 'automatic', format: 'esm', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'phase2-timeclock-fixture', setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'phase2-timeclock-fixture' } : undefined);
      plugin.onLoad({ filter: /.*/, namespace: 'phase2-timeclock-fixture' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: root }));
    }}],
  });
  const css = '*{box-sizing:border-box}body{margin:0}button{font:inherit}' + fs.readFileSync(path.join(root, 'src/index.css'), 'utf8').replace(/^@(?:import|config).*$/gm, '');
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].contents); }
    else if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
    else res.end('<html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByText('My recent punches').waitFor({ state: 'visible', timeout: 10_000 });
    // The system-closed punch is flagged where its hours are shown.
    assert.equal(await page.getByText('System-closed').count(), 1);
    // The optional staff PIN field is present for stores that require one.
    assert.equal(await page.locator('#tc-staff-pin').count(), 1);
    // Request a correction on the first (closed, not system-closed) punch.
    await page.getByRole('button', { name: 'Request correction' }).first().click();
    await page.locator('#tc-corr-reason-11').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('#tc-corr-reason-11').fill('Forgot to clock out at close');
    await page.getByRole('button', { name: 'Send request' }).click();
    await page.waitForFunction(() => window.fixtureCalls.some(c => String(c.path).includes('/time-entries/11/corrections')));
    const call = await page.evaluate(() => window.fixtureCalls.find(c => String(c.path).includes('/corrections')));
    assert.equal(call.body.reason, 'Forgot to clock out at close');
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});
