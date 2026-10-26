const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const catalogs = Object.fromEntries(['en', 'fr', 'ar'].map(language => {
  const legacy = JSON.parse(fs.readFileSync(path.join(root, `src/locales/${language}.json`)));
  return [language, { translation: Object.fromEntries(['nav', 'modes', 'statementCenter', 'modeSwitcher', 'businessHub', 'common'].map(key => [key, legacy[key]])),
    common: JSON.parse(fs.readFileSync(path.join(root, `src/i18n/locales/${language}/common.json`))) }];
}));
const longName = 'Springfield Neighborhood Restaurant and Home Service Company With a Very Long Name';
const businesses = [{ business_id: 1, business_name: longName, role: 'owner', is_owner: true, status: 'active' },
  { business_id: 2, business_name: 'Second Business', role: 'owner', is_owner: true, status: 'active' }];

const fixtureApi = `export default {get: async path => ({data: path==='/notifications' ? [] : path==='/messages/conversations' ? [{unread_count:window.unreadCount}] : path==='/messages/guest-inquiries' ? [{unread_count:window.unreadCount}] : path==='/me/businesses' ? {data:{items:window.fixtureBusinesses}} : {data:window.fixtureSupport?[{}]:[]}}), put: async () => ({data:{}}), delete: async () => ({data:{}})};`;

test('mode navbar renders responsive priorities, accessible disclosures and workspace selection', { timeout: 120_000 }, async () => {
  const mocks = {
    '../context/AuthContext': `import React from 'react'; export const AuthContext=React.createContext({}); export const useAuth=()=>React.useContext(AuthContext);`,
    '../context/LanguageContext': `import React from 'react'; export const LanguageContext=React.createContext({}); export const useLanguage=()=>React.useContext(LanguageContext);`,
    '../context/ThemeContext': `import React from 'react'; export const ThemeContext=React.createContext({}); export const useTheme=()=>React.useContext(ThemeContext);`,
    '../hooks/useSocket': `export const useSocket=()=>({socket:window.fixtureSocket});`,
    // Navbar now reads notifications through hooks/useNotifications and
    // api/accountSnapshot, which import './useSocket' and './axios'
    // relative to their own folders; mock those specifiers too so the
    // fixture never reaches the real axios client.
    './useSocket': `export const useSocket=()=>({socket:window.fixtureSocket});`,
    '../api/axios': fixtureApi,
    './axios': fixtureApi,
    '../api/accountSnapshot': `import api from '../api/axios'; export function getAccountSnapshot(userId, path, params) { return api.get(path, params ? { params } : undefined); } export function invalidateAccountSnapshots() {};`,
    '../api/businesses': `export const listBusinesses=async()=>[]; export const listManagedBusinesses=async()=>[];`,
    '../api/vortex': `export const getMyBusinesses=async()=>({items:window.fixtureBusinesses}); export const setWorkspaceContext=async id=>{window.fixtureWorkspace=id;};`,
    './PrefetchLink': `export {Link as default} from 'react-router-dom';`,
    './OxSteedNetworkSwitcher': `export default ()=>null;`,
  };
  const bundle = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {BrowserRouter,useNavigate} from 'react-router-dom';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {createInstance} from 'i18next'; import {I18nextProvider} from 'react-i18next';
      import Navbar from './src/components/Navbar.jsx';
      import {AuthContext} from '../context/AuthContext'; import {LanguageContext} from '../context/LanguageContext'; import {ThemeContext} from '../context/ThemeContext';
      const queryClient=new QueryClient(); const i18n=createInstance(); await i18n.init({lng:'en',fallbackLng:'en',resources:${JSON.stringify(catalogs)},interpolation:{escapeValue:false}});
      window.fixtureBusinesses=${JSON.stringify(businesses)}; window.unreadCount=1;
      const events=new Map(); window.fixtureSocket={on:(name,fn)=>{if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},off:(name,fn)=>events.get(name)?.delete(fn)};
      window.emitUnread=()=>events.get('messages:read')?.forEach(fn=>fn());
      function Harness(){
        const navigate=useNavigate(); const [config,setConfig]=React.useState({mode:sessionStorage.getItem('fixtureMode')||'customer',language:'en',theme:'dark'});
        window.configure=async options=>{window.fixtureBusinesses=options.businesses||${JSON.stringify(businesses)};window.fixtureSupport=!!options.support;await i18n.changeLanguage(options.language||'en');document.documentElement.dir=options.language==='ar'?'rtl':'ltr';document.documentElement.dataset.theme=options.theme||'dark';document.documentElement.classList.toggle('dark',options.theme!=='light');setConfig(options);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);};
        window.fixtureNavigate=navigate;
        const user=config.anonymous?null:{id:config.userId||1,role:config.role||(config.mode==='customer'?'customer':'helper'),...(config.legacy?{}:{default_mode:config.mode})};
        return <I18nextProvider i18n={i18n}><AuthContext.Provider value={{user,isHelper:user?.role!=='customer',logout:()=>{window.fixtureLoggedOut=true;setConfig({...config,anonymous:true});},switchRole:async mode=>{sessionStorage.setItem('fixtureMode',mode);setConfig({...config,mode});}}}>
          <LanguageContext.Provider value={{language:config.language||'en',setLanguage:()=>{},availableLanguages:[{code:'en',nativeName:'English',flag:'🇺🇸'},{code:'fr',nativeName:'Français',flag:'🇫🇷'},{code:'ar',nativeName:'العربية',flag:'🇸🇦'}]}}>
          <ThemeContext.Provider value={{isDark:config.theme!=='light',toggleTheme:()=>{}}}><Navbar key={config.userId||1}/><main><button id="outside">Outside navigation</button></main></ThemeContext.Provider>
          </LanguageContext.Provider></AuthContext.Provider></I18nextProvider>;
      }
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={queryClient}><BrowserRouter><Harness/></BrowserRouter></QueryClientProvider>);`, resolveDir: root, loader: 'jsx' },
    bundle: true, write: false, jsx: 'automatic', format: 'esm', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'navbar-fixture-dependencies', setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'navbar-fixture' } : undefined);
      plugin.onLoad({ filter: /.*/, namespace: 'navbar-fixture' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: root }));
    }}],
  });
  const css = '*{box-sizing:border-box}body{margin:0}button{font:inherit}'+fs.readFileSync(path.join(root, 'src/index.css'), 'utf8').replace(/^@(?:import|config).*$/gm, '') + fs.readFileSync(path.join(root, 'src/styles/BusinessSwitcher.css'), 'utf8');
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
    const waitExpanded = async (toggle, value) => page.waitForFunction(([node, expected]) => node.getAttribute('aria-expanded') === expected, [await toggle.elementHandle(), value]);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.configure);
    const expected = {customer:['/helpers','/my-jobs','/restaurants','/messages','/post-job'], helper:['/jobs','/helper-dashboard','/helper/messages'],business_owner:['/dashboard','/business-hub','/helper/messages']};
    for (const language of ['en', 'fr', 'ar']) for (const theme of ['dark', 'light']) for (const mode of Object.keys(expected)) {
      await page.evaluate(options => window.configure(options), {mode,language,theme});
      for (const width of [320,390,768,1360,1600]) {
        await page.setViewportSize({width,height:850});
        const mobile = width <= 1360;
        const menu = page.locator('.ox-nav-mobile-controls > button[aria-expanded]');
        if (mobile) { await menu.click(); await waitExpanded(menu, 'true'); }
        const container = page.locator(mobile ? '.ox-nav-mobile-menu' : '.ox-nav-desktop');
        const primary = container.locator(':scope > a');
        assert.deepEqual(await primary.evaluateAll(nodes => nodes.map(node => node.getAttribute('href'))), expected[mode], `${mode} ${language} ${theme} ${width}`);
        assert.equal(await container.locator(':scope > a.ox-nav-primary').count(), 1);
        assert.equal(await container.locator('.ox-nav-unread').textContent(), '2');
        assert.equal(await container.locator('.ox-biz-switcher').count(), mode === 'business_owner' ? 1 : 0);
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim()), theme==='dark' ? '#0a0f1a' : '#f8fafc');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no overflow: ${mode} ${language} ${theme} ${width}`);
        const sizes = await primary.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
        assert.ok(sizes.every(height => height >= 44), 'navigation targets are at least 44px');
        const duplicateIds = await page.evaluate(() => {const ids=[...document.querySelectorAll('[id]')].map(node=>node.id);return ids.filter((id,index)=>ids.indexOf(id)!==index);});
        assert.deepEqual(duplicateIds, []);
        if (mode === 'business_owner') {
          const businessToggle = container.locator('.ox-biz-switcher__btn');
          await businessToggle.click();
          await container.locator('.ox-biz-switcher__menu').waitFor();
          const bounds = await container.locator('.ox-biz-switcher__menu').boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `business menu fits ${language} ${width}`);
          await page.keyboard.press('Escape');
          await waitExpanded(businessToggle, 'false');
          assert.equal(await businessToggle.getAttribute('aria-expanded'), 'false');
          if (mobile) assert.equal(await menu.getAttribute('aria-expanded'), 'true');
        }
        if (process.env.NAVBAR_SCREENSHOT_DIR && language==='en' && theme==='dark' && [390,1600].includes(width)) {
          fs.mkdirSync(process.env.NAVBAR_SCREENSHOT_DIR, {recursive:true});
          await page.locator('nav').screenshot({path:path.join(process.env.NAVBAR_SCREENSHOT_DIR, `${mode}-${width}.png`)});
        }
        if (mobile) await menu.click();
      }
    }
    await page.setViewportSize({width:1600,height:850});
    await page.evaluate(()=>window.configure({mode:'customer',language:'en',theme:'dark'}));
    const account = page.getByRole('button',{name:'Account',exact:true});
    await account.focus(); await page.keyboard.press('Enter'); await page.locator('.ox-nav-account-panel').waitFor(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('href')), '/dashboard');
    await page.keyboard.press('Escape'); await waitExpanded(account, 'false'); assert.equal(await account.getAttribute('aria-expanded'), 'false');
    assert.equal(await account.evaluate(node=>node===document.activeElement), true);
    await account.click(); await page.locator('#outside').click(); await waitExpanded(account, 'false'); assert.equal(await account.getAttribute('aria-expanded'), 'false');
    await account.click(); await page.locator('.ox-nav-account-panel a[href="/settings"]').click();
    await waitExpanded(account, 'false');
    assert.equal(await account.getAttribute('aria-expanded'), 'false');
    await account.click(); assert.equal(await page.locator('.ox-nav-account-panel a[href="/settings"]').getAttribute('aria-current'), 'page');
    await page.keyboard.press('Escape');
    await page.evaluate(()=>{window.unreadCount=0;window.emitUnread();});
    await page.waitForFunction(()=>!document.querySelector('.ox-nav-unread'));
    await page.evaluate(()=>window.fixtureNavigate('/messages/guest/123'));
    await page.locator('.ox-nav-desktop > a[href="/messages"][aria-current="page"]').waitFor();
    assert.equal(await page.locator('.ox-nav-desktop > a[href="/messages"]').getAttribute('aria-current'), 'page');
    await page.evaluate(()=>window.fixtureNavigate('/'));
    await page.evaluate(()=>window.configure({mode:'business_owner',language:'en',theme:'light',userId:2}));
    const businessButton = page.locator('.ox-nav-desktop .ox-biz-switcher__btn');
    assert.ok((await businessButton.getAttribute('aria-label')).includes(longName));
    await businessButton.click(); await page.keyboard.press('Tab'); await page.keyboard.press('Escape');
    assert.equal(await businessButton.evaluate(node=>node===document.activeElement), true);
    await businessButton.click(); await page.locator('.ox-biz-switcher__menu button').nth(1).click();
    await page.waitForURL('**/business/2/workspace');
    await page.locator('.ox-nav-desktop > a.ox-nav-primary[href="/business/2/workspace"]').waitFor();
    assert.equal(await page.locator('.ox-nav-desktop > a.ox-nav-primary').getAttribute('href'), '/business/2/workspace');
    await page.evaluate(()=>window.fixtureNavigate('/business/1/workspace/calendar'));
    await page.locator('.ox-nav-desktop > a.ox-nav-primary[href="/business/1/workspace"]').waitFor();
    assert.equal(await page.locator('.ox-nav-desktop > a.ox-nav-primary').getAttribute('href'), '/business/1/workspace');
    assert.equal(await page.locator('.ox-nav-desktop > a.ox-nav-primary').getAttribute('aria-current'), 'page');
    assert.ok((await businessButton.getAttribute('aria-label')).includes(longName), 'workspace URL controls the business selector too');
    await page.evaluate(()=>{localStorage.removeItem('oxs:bh:lastBusinessId');window.fixtureNavigate('/');});
    await page.evaluate(()=>window.configure({mode:'business_owner',language:'en',theme:'dark',userId:3,businesses:[]}));
    await page.waitForFunction(()=>!document.querySelector('.ox-biz-switcher'));
    assert.equal(await page.locator('.ox-nav-desktop > a.ox-nav-primary').getAttribute('href'), '/business-hub');
    await page.evaluate(options=>window.configure(options),{mode:'business_owner',language:'en',theme:'dark',userId:4,businesses:[businesses[0]]});
    const single = page.locator('.ox-nav-desktop .ox-biz-switcher--single'); await single.waitFor();
    assert.equal(await single.getAttribute('aria-label'), longName);
    await page.setViewportSize({width:390,height:850});
    const mobileToggle = page.locator('.ox-nav-mobile-controls > button[aria-expanded]'); await mobileToggle.click();
    const modeToggle = page.locator('.ox-nav-mobile-preferences [data-nav-disclosure] > button').first();
    await modeToggle.click(); await page.keyboard.press('Tab'); await page.keyboard.press('Escape');
    await waitExpanded(modeToggle, 'false');
    assert.equal(await modeToggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await mobileToggle.getAttribute('aria-expanded'), 'true', 'Escape closes only the nested disclosure');
    assert.equal(await modeToggle.evaluate(node=>node===document.activeElement), true);
    await modeToggle.click();
    await page.locator('.ox-nav-mobile-preferences [role="group"] button').filter({hasText:'Customer'}).click();
    await page.waitForFunction(()=>sessionStorage.getItem('fixtureMode')==='customer' && document.querySelector('.ox-nav-mobile-mode')?.textContent==='Customer');
    await waitExpanded(mobileToggle, 'false');
    assert.equal(await mobileToggle.getAttribute('aria-expanded'), 'false');
    await mobileToggle.click(); await page.getByRole('button',{name:'Sign Out',exact:true}).click();
    await page.locator('.ox-nav-mobile-mode').waitFor({state:'detached'});
    assert.equal(await page.locator('.ox-nav-mobile-mode').count(), 0);
    await waitExpanded(mobileToggle, 'false');
    assert.equal(await mobileToggle.getAttribute('aria-expanded'), 'false');
    assert.deepEqual(errors, []);
    console.log('Verified 90 layout combinations plus menu, unread, mode-switch, workspace, and sign-out behavior.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
