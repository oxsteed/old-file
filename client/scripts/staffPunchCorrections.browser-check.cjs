// Browser-level coverage for the Phase 2 punch-correction review UI.
//
// The manager time tab must show pending punch corrections with
// approve/reject, the close-of-day check button, and the system-closed
// badge on entries the sweep closed. Approving must POST the decide
// endpoint (the server applies the change through the audit trail);
// the close-of-day button must POST close-stale.
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
  return [language, { translation: Object.fromEntries(['businessHub', 'common'].map(key => [key, legacy[key]])) }];
}));

const fixtureApi = `export default {
  get: async path => {
    if (String(path).includes('/staff/time-entry-corrections')) return { data: window.fixtureCorrections };
    if (String(path).includes('/staff/time-entries')) return { data: window.fixtureEntries };
    if (String(path).includes('/members')) return { data: { members: [] } };
    return { data: [] };
  },
  post: async (path, body) => { window.fixtureCalls.push({ method: 'post', path, body }); return { data: { closed: [] } }; },
};`;

test('manager time tab reviews punch corrections and runs close-of-day', { timeout: 120_000 }, async () => {
  const mocks = {
    '../../api/axios': fixtureApi,
    '../../admin/lib/ConfirmDialog': `export default () => null;`,
    './StaffLaborRulesPanel': `export default () => null;`,
  };
  const bundle = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {createInstance} from 'i18next'; import {I18nextProvider} from 'react-i18next';
      import {StaffScheduler} from './src/components/businessHub/StaffScheduler.jsx';
      const i18n=createInstance(); await i18n.init({lng:'en',fallbackLng:'en',resources:${JSON.stringify(catalogs)},interpolation:{escapeValue:false}});
      window.fixtureCalls=[];
      window.fixtureEntries=[{id:11,user_id:'emp-1',user_name:'Ana Alvarez',clock_in:'2026-11-04T09:00:00.000Z',clock_out:'2026-11-04T17:00:00.000Z',clock_in_at:'2026-11-04T09:00:00.000Z',clock_out_at:'2026-11-04T17:00:00.000Z',hours:8,system_closed:true,system_closed_reason:'auto_close_shift_end',entry_date:'2026-11-04'}];
      window.fixtureCorrections=[{id:7,entry_id:11,business_id:1,requester_user_id:'emp-1',requester_name:'Ana Alvarez',user_name:'Ana Alvarez',entry_date:'2026-11-04',current_clock_in_at:'2026-11-04T09:00:00.000Z',current_clock_out_at:'2026-11-04T17:00:00.000Z',requested_clock_in_at:null,requested_clock_out_at:'2026-11-04T18:00:00.000Z',requested_description:null,reason:'Forgot to clock out at close',status:'pending',decided_by:null,decided_at:null,decision_reason:null,created_at:'2026-11-04T18:30:00.000Z',updated_at:'2026-11-04T18:30:00.000Z'}];
      createRoot(document.getElementById('root')).render(<I18nextProvider i18n={i18n}><StaffScheduler businessId={1} isManager={true} /></I18nextProvider>);`, resolveDir: root, loader: 'jsx' },
    bundle: true, write: false, jsx: 'automatic', format: 'esm', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'phase2-corrections-fixture', setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'phase2-corrections-fixture' } : undefined);
      plugin.onLoad({ filter: /.*/, namespace: 'phase2-corrections-fixture' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: root }));
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
    await page.getByRole('tab', { name: 'Time Entries' }).click();
    await page.getByText('Punch corrections').waitFor({ state: 'visible', timeout: 10_000 });
    // The pending correction and the system-closed badge are both visible.
    assert.equal(await page.getByText('Ana Alvarez').count() >= 1, true);
    assert.equal(await page.getByText('System-closed').count(), 1);
    assert.equal(await page.getByText('Forgot to clock out at close').count(), 1);
    // Approve posts the decide endpoint; nothing else changes the entry.
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.waitForFunction(() => window.fixtureCalls.some(c => String(c.path).includes('/time-entry-corrections/7/decide')));
    const decide = await page.evaluate(() => window.fixtureCalls.find(c => String(c.path).includes('/decide')));
    assert.equal(decide.body.decision, 'approved');
    // The close-of-day button posts close-stale.
    await page.getByRole('button', { name: 'Run close-of-day check' }).click();
    await page.waitForFunction(() => window.fixtureCalls.some(c => String(c.path).includes('/time-entries/close-stale')));
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});
