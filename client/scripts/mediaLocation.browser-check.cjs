// Real provider, synthetic geolocation/API responses, and no production writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('Media location handles errors, URL navigation, and delayed lookups without overwriting newer choices', async () => {
  const root = path.resolve(__dirname, '..');
  const mocks = {
    'react-i18next': `export const useTranslation = () => ({ t: key => key.split('.').reduce((value, part) => value?.[part], window.catalog) || key });`,
    '../../api/geo': `export const suggestLocation = () => new Promise((resolve, reject) => window.suggestions.push({ resolve, reject }));
      export const reverseGeocode = () => new Promise((resolve, reject) => window.reversals.push({ resolve, reject }));`,
    '../../api/media': `export const getMediaVerification = async () => ({ publishers: [] });`,
  };
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { BrowserRouter, useNavigate, useLocation } from 'react-router-dom';
      import { MediaNeighborhoodProvider, useMediaNeighborhood } from './src/pages/media/MediaNeighborhoodContext.jsx';
      function Probe() {
        const value = useMediaNeighborhood(), navigate = useNavigate(), route = useLocation();
        return <><output id="label">{value.label}</output><output id="url">{route.search}</output>
          <button onClick={() => value.openLocation()}>Open location</button>
          <button onClick={() => value.chooseLocation({ location_mode: 'all' })}>Choose all</button>
          <button onClick={() => navigate('/media?city=Dayton&state=OH&tab=nearby')}>Go Dayton</button>
          <button onClick={() => navigate('/media?city=Columbus&state=OH&tab=nearby')}>Go Columbus</button>
        </>;
      }
      createRoot(document.getElementById('root')).render(<BrowserRouter><MediaNeighborhoodProvider><Probe /></MediaNeighborhoodProvider></BrowserRouter>);
    ` },
    bundle: true, write: false, jsx: 'automatic',
    plugins: [{ name: 'synthetic-location-apis', setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: root }));
    } }],
  });
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/locales/en/common.json'), 'utf8'));
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); }
    else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<div id="root"></div><script>window.catalog=${JSON.stringify(catalog).replace(/</g, '\\u003c')};</script><script src="/app.js"></script>`);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.positions = []; window.reversals = []; window.suggestions = [];
      Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: window.permission || 'prompt' }) } });
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (success, failure) => window.positions.push({ success, failure }) } });
    });
    const base = `http://127.0.0.1:${server.address().port}/media`;
    await page.goto(base);
    await page.locator('#label').waitFor();
    await page.getByRole('button', { name: 'Open location', exact: true }).click();
    for (const [code, key] of [[1, 'locationPermissionDenied'], [2, 'locationPositionUnavailable'], [3, 'locationTimeout']]) {
      await page.getByRole('button', { name: 'Use my device location', exact: true }).click();
      await page.evaluate(code => window.positions.at(-1).failure({ code }), code);
      await page.getByRole('alert').waitFor();
      assert.equal(await page.getByRole('alert').textContent(), catalog.media.feed[key]);
    }
    // A reverse-geocode failure after selecting All must not restore device location.
    await page.getByRole('button', { name: 'Use my device location', exact: true }).click();
    await page.evaluate(() => window.positions.at(-1).success({ coords: { latitude: 40, longitude: -84 } }));
    await page.waitForFunction(() => window.reversals.length === 1);
    await page.getByRole('button', { name: 'All locations', exact: true }).click();
    await page.evaluate(() => window.reversals[0].reject(new Error('Synthetic lookup failure')));
    assert.equal(await page.locator('#label').textContent(), 'All locations');

    // URL navigation wins over pending city suggestions and stays shareable.
    await page.getByRole('button', { name: 'Go Dayton' }).click();
    await page.waitForFunction(() => document.querySelector('#label').textContent === 'Dayton, OH');
    await page.getByRole('button', { name: 'Open location', exact: true }).click();
    await page.getByRole('textbox', { name: 'City or ZIP code' }).fill('Springfield');
    await page.getByRole('button', { name: 'Choose a location', exact: true }).click();
    await page.waitForFunction(() => window.suggestions.length === 1);
    await page.getByRole('button', { name: 'Go Columbus' }).click();
    await page.waitForFunction(() => document.querySelector('#label').textContent === 'Columbus, OH');
    await page.evaluate(() => window.suggestions[0].resolve([{ city: 'Springfield', state: 'OH' }]));
    assert.equal(await page.locator('#label').textContent(), 'Columbus, OH');
    await page.getByRole('button', { name: 'All locations', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#url').textContent.includes('location=all'));
    assert.match(await page.locator('#url').textContent(), /tab=nearby/);

    // Already granted startup requests also lose to subsequent choices.
    await page.evaluate(() => localStorage.clear());
    await page.addInitScript(() => { window.permission = 'granted'; });
    await page.goto(base);
    await page.waitForFunction(() => window.positions.length === 1);
    await page.evaluate(() => window.positions[0].success({ coords: { latitude: 40, longitude: -84 } }));
    await page.waitForFunction(() => window.reversals.length === 1);
    await page.getByRole('button', { name: 'Choose all', exact: true }).click();
    await page.evaluate(() => window.reversals[0].resolve({ city: 'Springfield', state: 'OH' }));
    assert.equal(await page.locator('#label').textContent(), 'All locations');
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
