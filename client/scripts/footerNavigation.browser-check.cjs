const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const catalogs = Object.fromEntries(['en','fr','ar'].map(language => {
  const legacy = JSON.parse(fs.readFileSync(path.join(root, `src/locales/${language}.json`)));
  return [language, {translation: Object.fromEntries(['footer','nav','common','modes','statementCenter','cookieConsent'].map(key=>[key,legacy[key]]))}];
}));

test('footer layouts, shared support access, cookie settings and preserved invitation flow', {timeout:120_000}, async () => {
  const mocks = {
    '../context/AuthContext': `import React from 'react'; export const AuthContext=React.createContext({}); export const useAuth=()=>React.useContext(AuthContext);`,
    '../api/axios': `export default {get: async (path) => {
      if(path!=='/support/agent/me') return {data:[]};
      const {support,delay=0,userId}=window.fixtureConfig; window.supportRequests.push(userId);
      await new Promise(resolve=>setTimeout(resolve,delay));
      if(support==='error') throw new Error('Synthetic unavailable membership');
      return {data:{data:support==='malformed'?{}:support===true?[{id:1}]:[]}};
    }};`,
    '../api/businesses': `export const redeemVortexToken=async value=>{window.redeemedInvite=value;return {business_name:'Synthetic Team',role:'employee'};};`,
    '../api/vortex': `export const previewVortexCode=async()=>({business_name:'Synthetic Team',role:'employee'}); export const redeemVortexCode=async()=>({business_name:'Synthetic Team',status:'active'});`,
    '../hooks/useSocket': `export const useSocket=()=>({socket:null});`,
    '../utils/consentScripts': `export const bootConsentedScripts=()=>{};export const initAnalytics=()=>{};export const disableAnalytics=()=>{};export const initMarketing=()=>{};export const initFunctional=()=>{};export const disableMarketing=()=>{};export const hasGlobalPrivacyControl=()=>false;`,
    './PrefetchLink': `export {Link as default} from 'react-router-dom';`,
    './ModeSwitcher': `export default ()=>null;`,
    './BusinessSwitcher': `export default ()=>null;`,
    './LanguageSelector': `export default ()=>null;`,
    './ThemeToggle': `export default ()=>null;`,
    './OxSteedNetworkSwitcher': `export default ()=>null;`,
  };
  const bundle = await build({stdin:{contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {BrowserRouter} from 'react-router-dom';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {createInstance} from 'i18next';import {I18nextProvider} from 'react-i18next';
    import Navbar from './src/components/Navbar.jsx';import Footer from './src/components/Footer.jsx';
    import CookieConsent from './src/components/CookieConsent.tsx';import {CookieConsentProvider} from './src/context/CookieConsentContext.tsx';
    import {AuthContext} from '../context/AuthContext';
    const i18n=createInstance();await i18n.init({lng:'en',fallbackLng:'en',resources:${JSON.stringify(catalogs)},interpolation:{escapeValue:false}});
    const queryClient=new QueryClient();window.supportRequests=[];window.fixtureConfig={mode:'guest'};
    localStorage.setItem('oxsteed_cookie_consent',JSON.stringify({version:'2025-06-01',essential:true,analytics:false,marketing:false,functional:false}));
    function Harness(){const [config,setConfig]=React.useState(window.fixtureConfig);
      window.configure=async options=>{window.fixtureConfig=options;await i18n.changeLanguage(options.language||'en');document.documentElement.dir=options.language==='ar'?'rtl':'ltr';document.documentElement.dataset.theme=options.theme||'dark';document.documentElement.classList.toggle('dark',options.theme!=='light');setConfig(options);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);};
      const user=config.mode==='guest'?null:{id:config.userId||1,role:config.pro?'helper_pro':config.mode==='customer'?'customer':'helper',default_mode:config.mode};
      return <AuthContext.Provider value={{user,isHelper:!!user&&user.role!=='customer',logout:()=>{}}}>
      <Navbar/><main style={{height:150}}>Fixture content</main><Footer/><CookieConsent/><button className="qa-assistant" aria-label="Assistant geometry fixture">Ask AI</button>
      </AuthContext.Provider>;
    }
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={queryClient}><BrowserRouter><I18nextProvider i18n={i18n}><CookieConsentProvider><Harness/></CookieConsentProvider></I18nextProvider></BrowserRouter></QueryClientProvider>);
  `, resolveDir:root, loader:'jsx'},bundle:true,write:false,jsx:'automatic',format:'esm',loader:{'.css':'empty'},define:{'import.meta.env':'{}'},
    plugins:[{name:'footer-fixture',setup(plugin){plugin.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:root}));}}]});
  const css='*{box-sizing:border-box}body{margin:0}button{font:inherit}'+fs.readFileSync(path.join(root,'src/index.css'),'utf8').replace(/^@(?:import|config).*$/gm,'')+fs.readFileSync(path.join(root,'src/components/Footer.css'),'utf8')+fs.readFileSync(path.join(root,'src/styles/CookieConsent.css'),'utf8')+
    '.qa-assistant{position:fixed;bottom:80px;inset-inline-end:16px;z-index:40;min-height:44px;padding:10px 14px;border:0;border-radius:999px;background:var(--color-action);color:var(--color-on-action)}@media(min-width:640px){.qa-assistant{bottom:24px;inset-inline-end:24px}}';
  const server=http.createServer((req,res)=>{
    if(req.url==='/app.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].contents);}
    else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);}
    else res.end('<html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.configure);
    const expected=[['/restaurants','/direct','/delivery','/media'],['/how-it-works','/about','/careers','/consulting-intake'],['/support','/learn','/vortex']];
    for(const language of ['en','fr','ar'])for(const theme of ['dark','light'])for(const mode of ['guest','customer','helper','business_owner']){
      await page.evaluate(options=>window.configure(options),{mode,language,theme});
      for(const width of [320,390,768,1360,1600]){
        await page.setViewportSize({width,height:850});await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
        assert.deepEqual(await page.locator('.site-footer__group').evaluateAll(groups=>groups.map(group=>[...group.querySelectorAll('a')].map(a=>a.getAttribute('href')))),expected,`${mode} ${language} ${theme} ${width}`);
        assert.equal(await page.locator('.site-footer__legal-links a').count(),6);
        assert.equal(await page.locator('.site-footer__legal-links button').count(),1);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`no overflow ${language} ${width}`);
        const report=await page.locator('.site-footer').evaluate(footer=>{
          const nodes=[...footer.querySelectorAll('a,button')];const launcher=document.querySelector('.qa-assistant').getBoundingClientRect();
          return {short:nodes.filter(node=>node.getBoundingClientRect().height<44).map(node=>node.textContent),
            covered:nodes.filter(node=>{const r=node.getBoundingClientRect();return r.left<launcher.right&&r.right>launcher.left&&r.top<launcher.bottom&&r.bottom>launcher.top;}).map(node=>node.textContent),
            unlabeled:[...footer.querySelectorAll('nav')].filter(node=>!node.getAttribute('aria-label')&&!document.getElementById(node.getAttribute('aria-labelledby'))).length};
        });
        assert.deepEqual(report.short,[],'44px footer targets');assert.deepEqual(report.covered,[],`assistant clearance ${language} ${width}`);assert.equal(report.unlabeled,0);
        if(width>900){const brand=await page.locator('.site-footer__brand').boundingBox();const grid=await page.locator('.site-footer__link-grid').boundingBox();assert.ok(Math.abs(brand.y-grid.y)<10);assert.ok(brand.height<300,'brand card fits content');}
        if(process.env.FOOTER_SCREENSHOT_DIR&&mode==='business_owner'&&theme==='dark'&&[390,1600].includes(width)){
          fs.mkdirSync(process.env.FOOTER_SCREENSHOT_DIR,{recursive:true});
          await page.locator('.ox-navbar').evaluate(node=>node.style.visibility='hidden');
          await page.locator('.site-footer').screenshot({path:path.join(process.env.FOOTER_SCREENSHOT_DIR,`${language}-${width}.png`)});
          await page.locator('.ox-navbar').evaluate(node=>node.style.visibility='');
        }
      }
    }
    await page.setViewportSize({width:1600,height:850});await page.evaluate(()=>window.configure({mode:'customer',userId:10}));
    const footerTargets=page.locator('.site-footer a,.site-footer button');
    await footerTargets.first().focus();
    for(let index=0;index<await footerTargets.count();index++){
      assert.equal(await footerTargets.nth(index).evaluate(node=>node===document.activeElement),true,'natural footer tab order');
      assert.ok(await footerTargets.nth(index).evaluate(node=>getComputedStyle(node).outlineStyle!=='none'),'visible keyboard focus');
      await page.keyboard.press('Tab');
    }
    await page.locator('.site-footer__cookie-button').focus();await page.keyboard.press('Enter');await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByRole('dialog').count(),1);await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
    await page.locator('.site-footer__group a[href="/vortex"]').focus();await page.keyboard.press('Enter');await page.waitForURL('**/vortex');
    const account=page.getByRole('button',{name:'Account',exact:true});
    await page.evaluate(()=>window.configure({mode:'helper',userId:20,support:true,delay:150}));
    assert.equal(await page.locator('.site-footer a[href="/support/agent"]').count(),0,'pending is hidden');
    await page.locator('.site-footer a[href="/support/agent"]').waitFor();await account.click();
    assert.equal(await page.locator('.ox-nav-account-panel a[href="/support/agent"]').count(),1);
    assert.equal(await page.evaluate(()=>window.supportRequests.filter(id=>id===20).length),1,'navbar/footer deduplicate requests');
    await page.keyboard.press('Escape');
    await page.evaluate(()=>window.configure({mode:'customer',userId:21,support:false}));
    assert.equal(await page.locator('.site-footer a[href="/support/agent"]').count(),0,'old account access removed immediately');
    await account.click();assert.equal(await page.locator('.ox-nav-account-panel a[href="/support/agent"]').count(),0);await page.keyboard.press('Escape');
    await page.evaluate(()=>window.configure({mode:'helper',userId:22,support:'error'}));
    await page.waitForFunction(()=>window.supportRequests.includes(22));assert.equal(await page.locator('.site-footer a[href="/support/agent"]').count(),0);
    await page.evaluate(()=>window.configure({mode:'helper',userId:25,support:'malformed'}));
    await page.waitForFunction(()=>window.supportRequests.includes(25));assert.equal(await page.locator('.site-footer a[href="/support/agent"]').count(),0,'malformed membership is hidden');
    await page.evaluate(()=>window.configure({mode:'helper',userId:23,support:true,delay:250}));
    await page.evaluate(()=>window.configure({mode:'customer',userId:24,support:false,delay:350}));
    await page.waitForTimeout(400);assert.equal(await page.locator('.site-footer a[href="/support/agent"]').count(),0,'late previous-account success is ignored');
    await page.evaluate(()=>window.configure({mode:'guest'}));const guestRequests=await page.evaluate(()=>window.supportRequests.length);await page.waitForTimeout(60);
    assert.equal(await page.evaluate(()=>window.supportRequests.length),guestRequests,'guests never request memberships');
    await page.evaluate(()=>{sessionStorage.setItem('oxs:vortexToken','a'.repeat(64));return window.configure({mode:'helper',userId:30});});
    const token=page.locator('input[maxlength="64"]');await token.waitFor();assert.equal(await token.inputValue(),'a'.repeat(64));
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('oxs:vortexToken')),null,'pending invitation consumed after login');
    await page.getByRole('button',{name:'Join Business',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.redeemedInvite),'a'.repeat(64));await page.getByRole('button',{name:'Continue',exact:true}).click();await token.waitFor({state:'detached'});
    assert.deepEqual(errors,[]);console.log('Verified 120 footer layouts, shared account-scoped access, cookie settings and synthetic invitation restoration/redemption.');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
