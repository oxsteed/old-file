const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('store menu edits preserve store scope, clear overrides and fit English/French/Arabic layouts', async () => {
  const root = path.resolve(__dirname, '..');
  const resources = Object.fromEntries(['en', 'fr', 'ar'].map((locale) => {
    const { food } = JSON.parse(fs.readFileSync(path.join(root, `src/locales/${locale}.json`)));
    return [locale, { food: { storeMenu: food.storeMenu, common: food.common, merchant: { locationSaveChanges: food.merchant.locationSaveChanges } } }];
  }));
  const mocks = {
    '../../api/axios': `export default { get: async url => ({data:{items:[{id:11,name:'Synthetic soup',currency_code:'USD',brand_price_cents:1000,store_override:window.override||{}}]}}),
      patch: async (url,body) => { window.writes.push({url,body});window.override={price_cents:body.priceCents,is_available:body.isAvailable,available_again_at:body.availableAgainAt};return {data:{}};} };`,
    '../../api/food': `export const formatFoodMoney = (amount,currency) => new Intl.NumberFormat('en',{style:'currency',currency}).format(amount/100);`,
    './foodShared': `export const apiErrorMessage=(_error,fallback)=>fallback;`,
    'react-hot-toast': `export default { success:()=>{},error:message=>window.errors.push(message) };`,
  };
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `import React from 'react';import{createRoot}from'react-dom/client';
      import StoreMenuPanel from './src/pages/food/StoreMenuPanel';
      const resources=${JSON.stringify(resources)};const root=createRoot(document.getElementById('root'));
      window.errors=[];window.writes=[];window.render=locale=>{const t=(key,args={})=>Object.entries(args).reduce((text,[name,value])=>text.replaceAll('{{'+name+'}}',String(value)),key.split('.').reduce((node,part)=>node?.[part],resources[locale])||key);root.render(<StoreMenuPanel key={locale} restaurant={{id:3}} locationId={7} t={t}/>);};window.render('en');` },
    bundle: true, write: false, jsx: 'automatic', plugins: [{ name: 'store-fixtures', setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path: target }) => Object.hasOwn(mocks, target) ? { path: target, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: target }) => ({ contents: mocks[target], loader: 'js' }));
    } }],
  });
  const css = fs.readFileSync(path.join(root, 'src/styles/FoodPages.css'), 'utf8');
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); }
    else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:8px}*{box-sizing:border-box}input,select{max-width:100%}${css}</style><div id="root"></div><script type="module" src="/app.js"></script>`); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    const pageErrors = []; page.on('pageerror', (error) => { pageErrors.push(error.message); console.error(error.message); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#store-menu-item option[value="11"]').waitFor({ state: 'attached', timeout: 5000 }).catch(async (error) => { console.error(await page.locator('body').innerText()); throw error; });
    await page.locator('#store-menu-item').selectOption('11');
    await page.locator('#store-menu-price').fill('12.50');
    await page.locator('#store-menu-availability').selectOption('soldOut');
    await page.locator('button[type="submit"]').click();
    await page.waitForFunction(() => window.writes.length === 1);
    assert.deepEqual(await page.evaluate(() => window.writes[0]), { url: '/restaurants/3/locations/7/menu-items/11', body: { priceCents: 1250, isAvailable: false, availableAgainAt: null } });
    await page.locator('#store-menu-item').selectOption('11');
    await page.locator('#store-menu-price').fill('');
    await page.locator('#store-menu-availability').selectOption('inherit');
    await page.locator('button[type="submit"]').click();
    await page.waitForFunction(() => window.writes.length === 2);
    assert.deepEqual(await page.evaluate(() => window.writes[1].body), { priceCents: null, isAvailable: null, availableAgainAt: null });
    for (const locale of ['en', 'fr', 'ar']) {
      await page.evaluate((locale) => { document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'; window.render(locale); }, locale);
      await page.locator('#store-menu-item option[value="11"]').waitFor({ state: 'attached', timeout: 5000 }).catch(async (error) => { console.error(await page.locator('body').innerText()); throw error; });
      await page.locator('#store-menu-item').selectOption('11');
      for (const width of [320, 390, 1360]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${locale} fits ${width}px`);
      }
      assert.equal(await page.locator('form').evaluate((form) => [...form.querySelectorAll('input,select')].every((input) => input.labels?.length > 0)), true);
    }
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(await page.evaluate(() => window.errors), []);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
