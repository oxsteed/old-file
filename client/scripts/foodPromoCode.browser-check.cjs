const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const langs = ['en', 'es', 'fr', 'ht', 'ar'];
const catalogs = Object.fromEntries(langs.map(l => [l, JSON.parse(fs.readFileSync(path.join(root, `src/locales/${l}.json`)))]));
const ERRORS = ['promo_user_limit_reached', 'promo_expired', 'promo_min_order_not_met', 'promo_sign_in_required', 'promo_something_new'];

// Decision 2: the food checkout promo field shows the server-quoted discount
// and every server promo_* rejection in 5 locales, at 320px, light, and RTL.
test('food checkout promo field renders discount and errors in 5 locales at 320px/RTL', async () => {
  const mocks = {
    'react-i18next': String.raw`export const useTranslation=()=>({i18n:{language:window.lang},t:(key,o={})=>{const value=key.split('.').reduce((a,k)=>a?.[k],window.catalogs[window.lang]);return String(value??o.defaultValue??key).replace(/\{\{(\w+)\}\}/g,(_,k)=>o[k]??'');}});`,
  };
  const bundle = await build({ stdin: {
    contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import Field from './src/components/food/PromoCodeField.jsx';
      window.catalogs=${JSON.stringify(catalogs)};window.lang='en';window.state={error:null,discount:0};
      function App(){const[v,setV]=useState('save20');window.typed=v;return <div style={{maxWidth:320}}><Field value={v} onChange={setV} error={window.state.error} discountCents={window.state.discount}
        formatMoney={(c)=>new Intl.NumberFormat(window.lang,{style:'currency',currency:'USD'}).format(c/100)} inputStyle={{width:'100%',height:44,border:'1px solid #cbd5e1',borderRadius:10,padding:'0 12px'}}/></div>;}
      const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<App key={window.lang+JSON.stringify(window.state)}/>);window.render();`,
    resolveDir: root, loader: 'jsx',
  }, bundle: true, write: false, format: 'esm', plugins: [{ name: 'mocks', setup(p) {
    p.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
    p.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'jsx' }));
  } }] });
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(bundle.outputFiles[0].contents); }
    res.end('<style>*{box-sizing:border-box}body{font-family:Arial;margin:0;padding:0 8px;background:#fff;color:#0f172a}</style><div id="root"></div><script type="module" src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ colorScheme: 'light' }), pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const shots = path.join(os.tmpdir(), 'oxsteed-food-promo'); fs.mkdirSync(shots, { recursive: true });
    for (const lang of langs) {
      const f = catalogs[lang].food.restaurant;
      const set = (state) => page.evaluate(([l, s]) => { window.lang = l; window.state = s; document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr'; document.documentElement.lang = l; window.render(); }, [lang, state]);
      await set({ error: null, discount: 519 });
      const input = page.getByLabel(new RegExp(f.promoCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      await input.waitFor();
      const applied = page.getByTestId('food-promo-applied');
      await applied.waitFor();
      const amount = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD' }).format(5.19);
      assert.equal(await applied.textContent(), f.promoApplied.replace('{{amount}}', amount));
      assert.equal(await input.getAttribute('aria-describedby'), 'food-promo-applied');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `applied ${lang}`);
      if (lang === 'fr' || lang === 'ar') await page.screenshot({ path: path.join(shots, `promo-applied-${lang}-light-320.png`), fullPage: true });
      for (const code of ERRORS) {
        await set({ error: code, discount: 519 });
        const alert = page.getByRole('alert');
        await alert.waitFor();
        const expected = f.promoErrors[code] || f.promoErrors.generic;
        assert.ok(expected && expected !== code, `${lang} ${code} translated`);
        assert.equal(await alert.textContent(), expected);
        assert.equal(await page.getByTestId('food-promo-applied').count(), 0);
        assert.equal(await input.getAttribute('aria-invalid'), 'true');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${code} ${lang}`);
      }
      if (lang === 'fr' || lang === 'ar') await page.screenshot({ path: path.join(shots, `promo-error-${lang}-light-320.png`), fullPage: true });
      if (lang === 'ar') {
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.food-promo-field')).direction), 'rtl');
        assert.equal(await input.evaluate(el => getComputedStyle(el).direction), 'ltr');
      }
      await set({ error: null, discount: 519 });
      await input.fill('abc');
      assert.equal(await page.evaluate(() => window.typed), 'ABC');
    }
    for (const lang of langs) {
      for (const key of Object.keys(catalogs.en.food.restaurant.promoErrors)) {
        assert.ok(catalogs[lang].food.restaurant.promoErrors[key], `${lang} promoErrors.${key}`);
      }
    }
    assert.deepEqual(pageErrors, []);
    console.log(`Food promo captures: ${shots}`);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
