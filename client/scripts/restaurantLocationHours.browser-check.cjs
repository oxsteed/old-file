const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('location hours editor preserves split shifts and submits multiple ranges', async () => {
  const root = path.resolve(__dirname, '..');
  const resources = JSON.parse(fs.readFileSync(path.join(root, 'src/locales/en.json'))).food;
  const mocks = {
    '../../api/food': `export const listFoodLocations = async () => [{id:7,name:'Downtown',address_country:'US',timezone:'America/New_York',status:'active',is_primary:true,operating_hours:{weekly:{mon:[{open:'09:00',close:'14:00'},{open:'17:00',close:'22:00'}]},special_dates:{'2026-12-25':'closed'}}}];
      export const listRestaurantHQRegions = async () => []; export const createFoodLocation = async () => ({}); export const updateFoodLocation = async (_restaurantId, id, payload) => { window.locationWrite = { id, payload }; return {}; };`,
    '../../api/geo': `export const suggestLocation = async () => [];`,
    '../../api/restaurants': `export const getRestaurantLocationAccess = async () => { const error = new Error('settings unavailable'); error.response = { status: 403 }; throw error; }; export const replaceRestaurantLocationAccess = async () => ({}); export const clearRestaurantLocationAccess = async () => ({});`,
    '../../components/AddressAutocomplete': `import React from 'react'; export default function AddressAutocomplete({id,value,onChange,ariaLabel}) { return React.createElement('input',{id,'aria-label':ariaLabel,value,onChange:event=>onChange(event.target.value)}); }`,
    './TimezoneSelect.jsx': `import React from 'react'; export const DETECTED_TIMEZONE = 'UTC'; export default function TimezoneSelect({id,value,onChange}) { return React.createElement('select',{id,value,onChange:event=>onChange(event.target.value)},React.createElement('option',{value:'UTC'},'UTC'),React.createElement('option',{value:'America/New_York'},'America/New_York')); }`,
    './StoreMenuPanel.jsx': `export default function StoreMenuPanel() { return null; }`,
    'react-hot-toast': `export default { success:()=>{}, error:()=>{} };`,
  };
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `import React from 'react';import{createRoot}from'react-dom/client';
      import LocationsPanel from './src/pages/food/FoodLocationsPanel';
      const t=(key,args={})=>Object.entries(args).reduce((text,[name,value])=>text.replaceAll('{{'+name+'}}',String(value)),key.split('.').reduce((node,part)=>node?.[part],${JSON.stringify({ food: { merchant: resources.merchant, common: resources.common } })})||key);
      const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<LocationsPanel restaurant={{id:3,timezone:'UTC'}} t={t}/>);window.render();` },
    bundle: true, write: false, jsx: 'automatic', plugins: [{ name: 'location-hours-fixtures', setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path: target }) => Object.hasOwn(mocks, target) ? { path: target, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: target }) => ({ contents: mocks[target], loader: 'js', resolveDir: root }));
    } }],
  });
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/app.js"></script>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', (error) => console.error(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button', { name: resources.merchant.locationEdit }).click();
    assert.equal(await page.locator('input[type="time"]').count(), 16);
    await page.getByRole('button', { name: resources.merchant.addHoursRange }).first().click();
    assert.equal(await page.locator('input[type="time"]').count(), 18);
    await page.locator('input[type="time"]').nth(4).fill('15:00');
    await page.locator('input[type="time"]').nth(5).fill('16:00');
    assert.equal(await page.locator('input[type="date"]').count(), 1);
    await page.getByRole('button', { name: resources.merchant.specialDateAdd }).click();
    await page.locator('input[type="date"]').nth(1).fill('2026-12-31');
    assert.equal(await page.locator('input[type="time"]').count(), 20);
    await page.locator('input[type="time"]').nth(18).fill('10:00');
    await page.locator('input[type="time"]').nth(19).fill('14:00');
    await page.getByRole('button', { name: resources.merchant.locationSaveChanges }).click();
    await page.waitForFunction(() => window.locationWrite, null, { timeout: 5000 });
    assert.deepEqual(await page.evaluate(() => window.locationWrite.payload.operatingHours.weekly.mon), [
      { open: '09:00', close: '14:00' },
      { open: '17:00', close: '22:00' },
      { open: '15:00', close: '16:00' },
    ]);
    assert.deepEqual(await page.evaluate(() => window.locationWrite.payload.operatingHours.special_dates), {
      '2026-12-25': { closed: true, ranges: [{ open: '11:00', close: '22:00' }] },
      '2026-12-31': { open: '10:00', close: '14:00' },
    });
    assert.equal(await page.locator('input[type="time"]').count(), 14);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
