const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('real customer layouts render in an inert sandbox without public-page effects', async () => {
  const root = path.resolve(__dirname, '..');
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/locales/en.json'), 'utf8'));
  const arabic = JSON.parse(fs.readFileSync(path.join(root, 'src/locales/ar.json'), 'utf8'));
  // CI runs browser tests before the production build. A local built stylesheet
  // is optional visual-QA evidence, never a prerequisite for these regressions.
  const assets = path.join(root, 'dist/assets');
  const stylesheet = fs.existsSync(assets) && fs.readdirSync(assets).find(name => /^serviceWorkerRegistration-.*\.css$/.test(name));
  const baseStyles = stylesheet ? fs.readFileSync(path.join(assets, stylesheet), 'utf8') : '';
  const mocks = {
    api: `const fail = () => { window.sideEffects.push('api'); throw new Error('Snapshot made an API request'); };
      export default { get: fail, post: fail, put: fail, patch: fail, delete: fail, interceptors: { response: { use(){} } } };`,
    i18n: `import engine from 'i18next'; export const LANGUAGES = [{code:'en',name:'English',native:'English',flag:'🇺🇸'},{code:'ar',name:'Arabic',native:'العربية',flag:'🇸🇦'}];
      export const detectInitialLanguage=()=> 'en'; export const ensureLanguageLoaded=async()=>{};
      const instance=engine.createInstance(); instance.init({initImmediate:false,lng:'en',fallbackLng:'en',resources:{en:{translation:window.catalog},ar:{translation:window.arabic}},interpolation:{escapeValue:false}});
      export default instance;`,
    stripe: `export function loadStripe(){window.sideEffects.push('stripe'); return Promise.resolve(null);}`,
  };
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {I18nextProvider} from 'react-i18next';
      import i18n, {LANGUAGES} from './src/i18n';
      import {LanguageContext} from './src/context/LanguageContext'; import {ThemeContext} from './src/context/ThemeContext';
      import Preview from './src/admin/pages/ProfileCustomerPreview';
      import {buildCustomerProfileDocument,sanitizeCustomerProfileMarkup} from './src/admin/pages/customerProfileSnapshot';
      import {normalizeBusinessPublicProfile} from './src/pages/BusinessPublicProfilePage';
      window.sanitize=sanitizeCustomerProfileMarkup; window.normalizeBusiness=normalizeBusinessPublicProfile;
      const root=createRoot(document.getElementById('root'));
      window.show=async(type,id,content,language='en')=>{
        await i18n.changeLanguage(language);
        const copy=key=>i18n.t('adminProfileVisibility.'+key);
        root.render(<I18nextProvider i18n={i18n}><LanguageContext.Provider value={{language,availableLanguages:LANGUAGES}}>
          <ThemeContext.Provider value={{isDark:true}}><Preview key={type+id+language} content={content} profileType={type} profileId={id} copy={copy}/></ThemeContext.Provider>
        </LanguageContext.Provider></I18nextProvider>);
      };
      window.buildSnapshot=(type,id,content)=>buildCustomerProfileDocument({type,id,content,i18n,language:'en',availableLanguages:LANGUAGES,theme:'dark',tab:'menu'});
    ` },
    bundle: true, write: false, outdir: 'fixture', jsx: 'automatic', loader: { '.css': 'css', '.woff2': 'dataurl', '.woff': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' },
    define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'snapshot-fixtures', setup(plugin) {
      plugin.onResolve({ filter: /api\/axios$/ }, () => ({path:'api',namespace:'fixture'}));
      plugin.onResolve({ filter: /(?:^|\/)i18n$/ }, () => ({path:'i18n',namespace:'fixture'}));
      plugin.onResolve({ filter: /^@stripe\/stripe-js(?:\/pure)?$/ }, () => ({path:'stripe',namespace:'fixture'}));
      plugin.onLoad({filter:/.*/,namespace:'fixture'}, args=>({contents:mocks[args.path],loader:'js',resolveDir:root}));
    } }],
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js'));
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'));
  const requests = [];
  const server = http.createServer((req,res) => {
    requests.push(req.url);
    if(req.url === '/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js.contents);return;}
    if(req.url === '/app.css'){res.setHeader('Content-Type','text/css');res.end(css?.contents || '');return;}
    if(req.url === '/base.css'){res.setHeader('Content-Type','text/css');res.end(baseStyles);return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-src https://js.stripe.com; img-src 'self' data: https:");
    res.end(`<link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/app.css"><div id="root"></div><script>window.catalog=${JSON.stringify(catalog).replace(/</g,'\\u003c')};window.arabic=${JSON.stringify(arabic).replace(/</g,'\\u003c')};window.sideEffects=[];</script><script src="/app.js"></script>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({headless:true,channel:'chrome'});
    const page=await browser.newPage(); const errors=[];
    page.setDefaultTimeout(10000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(()=>typeof window.show==='function');
    await page.evaluate(()=>{
      window.fetch=()=>{window.sideEffects.push('fetch');throw Error('Unexpected fetch');};
      window.WebSocket=class {constructor(){window.sideEffects.push('socket');throw Error('Unexpected socket');}};
      localStorage.setItem('authToken','DO_NOT_LEAK_OPERATOR_SESSION');
      localStorage.setItem('oxsteed.food.cart','DO_NOT_LEAK_PRIVATE_CART');
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(...args){window.sideEffects.push('storage-write');return setItem.apply(this,args);};
    });
    const business={business:{id:17,business_name:'Customer Business',description:'Safe <script>window.compromised=true</script>',logo_url:'javascript:alert(1)',address_city:'dayton'},
      services:[{id:1,name:'Repair service',description:'Detailed repairs',price:45,price_unit:'hour'}],
      hours:[{day_of_week:1,start_time:'09:00',end_time:'17:00',is_closed:false}],
      reviews:[{id:1,first_name:'Customer',last_name:'Reviewer',rating:5,comment:'Excellent service',created_at:'2026-10-01'}],gallery:[]};
    const helper={helper:{id:'00000000-0000-4000-8000-000000000123',businessName:'Customer Helper',ownerName:'Helper Owner',bio:'Repair specialist',rating:5,reviewCount:1,badges:[],categories:[],jobsCompleted:5},
      services:[{id:'1',name:'Helper repairs',description:'House repairs',price:25,priceUnit:'hour',category:'Repairs'}],gallery:[],hours:[],reviews:[],faqs:[],policies:[],location:{city:'Dayton',state:'OH'},visibility:{services:true,hours:true,about:true,gallery:true,location:true,reviews:true,faqs:true,policies:true}};
    const restaurant={restaurant:{id:29,display_name:'Customer Restaurant',description:'Fresh lunch',address_street:'123 Preview Street',currency_code:'USD',fulfillment_modes:['pickup'],settings:{},operating_hours:{weekly:{mon:{open:'09:00',close:'17:00'}}}},
      menu:[{id:1,name:'Lunch menu',items:[{id:2,name:'Soup',description:'Fresh soup',price_cents:1200,is_available:true}]},
        {id:3,name:'Desserts',items:[{id:4,name:'Cake',price_cents:500,is_available:true}]}],uncategorizedItems:[]};
    for(const [type,id,content,name] of [['business',17,business,'Customer Business'],['helper',helper.helper.id,helper,'Customer Helper'],['restaurant',29,restaurant,'Customer Restaurant']]){
      const direct = await page.evaluate(([type,id,content])=>window.buildSnapshot(type,id,content),[type,id,content]);
      assert.ok(direct.includes(name), type + ' server renderer preserves profile identity');
      await page.evaluate(([type,id,content])=>window.show(type,id,content),[type,id,content]);
      const iframe=page.getByTestId('pv-customer-frame'); await iframe.waitFor();
      const frame=page.frameLocator('[data-testid="pv-customer-frame"]');
      await frame.getByText(name,{exact:true}).first().waitFor();
      assert.equal(await iframe.getAttribute('sandbox'),'');
      assert.equal(await iframe.evaluate(node=>node.contentDocument),null,'opaque sandbox denies parent DOM access');
      assert.equal(await frame.locator('script,iframe,form,a[href],button:not([disabled]),input:not([disabled]),[onerror]').count(),0);
      assert.equal(await iframe.evaluate(node=>node.srcdoc.includes('DO_NOT_LEAK')),false);
      assert.equal(await iframe.evaluate(node=>node.getBoundingClientRect().width),1280);
      await page.getByLabel('Viewport').selectOption('mobile');
      assert.equal(await iframe.evaluate(node=>node.getBoundingClientRect().width),390);
      await page.getByLabel('Theme',{exact:true}).selectOption('light');
      await frame.locator('html[data-theme="light"]').waitFor({state:'attached'});
      await frame.locator('body').evaluate(()=>Promise.race([
        new Promise(resolve=>{if(document.readyState==='complete') resolve(); else window.addEventListener('load',resolve,{once:true});}),
        new Promise(resolve=>setTimeout(resolve,1500)),
      ]));
      await frame.getByText(name,{exact:true}).first().waitFor();
      await frame.locator('body').evaluate(()=>window.scrollTo(0,0));
      if (process.env.PROFILE_PREVIEW_SCREENSHOTS) await page.screenshot({path:`/tmp/oxsteed-customer-${type}.png`,fullPage:true});
      if(type==='business'){
        await frame.getByText('Repair service',{exact:true}).waitFor(); await frame.getByText('Excellent service',{exact:true}).waitFor();
        await frame.getByText('09:00 - 17:00',{exact:true}).waitFor();
        assert.equal(await frame.locator('img[src^="javascript:"]').count(),0);
      }
      if(type==='restaurant'){
        await frame.getByText('Soup',{exact:true}).first().waitFor();
        await page.getByLabel('Menu category',{exact:true}).selectOption('3');
        await frame.getByText('Cake',{exact:true}).first().waitFor();
        await page.getByLabel('Section',{exact:true}).selectOption('info');
        await frame.getByText('123 Preview Street',{exact:true}).last().waitFor();
      }
    }
    await page.evaluate(content=>window.show('business',17,content,'ar'),business);
    await page.frameLocator('[data-testid="pv-customer-frame"]').locator('html[dir="rtl"][lang="ar"]').waitFor({state:'attached'});
    const clean=await page.evaluate(()=>window.sanitize('<script>bad()</script><form action="/api/pay"><input><button onclick="bad()">Pay</button></form><a href="javascript:bad()">Go</a><img src="/api/private"><img src="javascript:bad()"><div style="background-image:url(javascript:bad())">x</div>'));
    assert.doesNotMatch(clean,/<script|<form|onclick=|href=|src=|javascript:/);
    assert.match(clean,/disabled/);
    const cover=await page.evaluate(()=>window.sanitize('<div style="background:center/cover url(https://example.com/dish.jpg)">Dish</div>'));
    assert.match(cover,/example\.com\/dish\.jpg/,'safe cover images retain their customer styling');
    await assert.rejects(page.evaluate(()=>window.buildSnapshot('helper','../admin',{helper:{}})),/Invalid snapshot profile/);
    await page.evaluate(()=>window.show('unknown',17,{business:{}}));
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByTestId('pv-customer-frame').count(),0,'failed snapshots do not retain the previous profile');
    assert.deepEqual(await page.evaluate(()=>window.sideEffects),[],'no API, fetch, sockets, or Stripe initiation');
    assert.equal(requests.some(url=>url.startsWith('/api')),false);
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
