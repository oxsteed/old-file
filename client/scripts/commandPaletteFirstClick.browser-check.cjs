// Browser-level coverage for the navbar palette trigger's first click.
//
// Regression: the trigger dispatches 'oxsteed:open-command-palette', but the
// only listener lived inside the lazily loaded CommandPalette itself, and
// DeferredCommandPalette only loaded that chunk on Cmd/Ctrl+K. The first
// click therefore fired into nothing (and on mobile, where there is no
// hotkey, the button never worked). DeferredCommandPalette must listen for
// the event and load the palette, which then mounts with initialOpen.
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
  return [language, { translation: Object.fromEntries(['nav', 'modes', 'statementCenter', 'modeSwitcher', 'businessHub', 'common', 'commandPalette'].map(key => [key, legacy[key]])),
    common: JSON.parse(fs.readFileSync(path.join(root, `src/i18n/locales/${language}/common.json`))) }];
}));
const businesses = [{ business_id: 1, business_name: 'Springfield Shop', role: 'owner', is_owner: true, status: 'active' }];

const fixtureApi = `export default {get: async path => ({data: path==='/notifications' ? [] : path==='/messages/conversations' ? [{unread_count:window.unreadCount}] : path==='/messages/guest-inquiries' ? [{unread_count:window.unreadCount}] : path==='/me/businesses' ? {data:{items:window.fixtureBusinesses}} : {data:window.fixtureSupport?[{}]:[]}}), put: async () => ({data:{}}), delete: async () => ({data:{}})};`;
// The palette's item catalog pulls the admin layout (~36KB) for the admin nav
// sections; this fixture only exercises open-on-click, so stub the items
// module with the shape PaletteDialog consumes.
const fixtureItems = `export const buildClientItems=()=>({pages:[],actions:[]});
export const buildAdminItems=()=>[];
export const fetchDynamicRecents=async()=>[];
export const readRecentIds=()=>[];
export const orderForEmptyQuery=(items)=>items;
export const searchItems=(items)=>items;
export const pushRecentId=()=>{};`;

test('navbar palette trigger opens the palette on the first click', { timeout: 120_000 }, async () => {
  const mocks = {
    '../context/AuthContext': `import React from 'react'; export const AuthContext=React.createContext({}); export const useAuth=()=>React.useContext(AuthContext);`,
    '../context/LanguageContext': `import React from 'react'; export const LanguageContext=React.createContext({}); export const useLanguage=()=>React.useContext(LanguageContext);`,
    '../context/ThemeContext': `import React from 'react'; export const ThemeContext=React.createContext({}); export const useTheme=()=>React.useContext(ThemeContext);`,
    '../hooks/useSocket': `export const useSocket=()=>({socket:window.fixtureSocket});`,
    './useSocket': `export const useSocket=()=>({socket:window.fixtureSocket});`,
    '../hooks/useAuth': `export const useAuth=()=>({user:{id:1,role:'customer'}});`,
    '../admin/lib/GrantGuard': `export const useMyScopes=()=>({scopes:[]});`,
    './commandPaletteItems': fixtureItems,
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
      import {BrowserRouter} from 'react-router-dom';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {createInstance} from 'i18next'; import {I18nextProvider} from 'react-i18next';
      import Navbar from './src/components/Navbar.jsx';
      import {DeferredCommandPalette} from './src/components/DeferredShellWidgets.jsx';
      import {AuthContext} from '../context/AuthContext'; import {LanguageContext} from '../context/LanguageContext'; import {ThemeContext} from '../context/ThemeContext';
      const queryClient=new QueryClient(); const i18n=createInstance(); await i18n.init({lng:'en',fallbackLng:'en',resources:${JSON.stringify(catalogs)},interpolation:{escapeValue:false}});
      window.fixtureBusinesses=${JSON.stringify(businesses)}; window.unreadCount=1;
      const events=new Map(); window.fixtureSocket={on:(name,fn)=>{if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},off:(name,fn)=>events.get(name)?.delete(fn)};
      function Harness(){
        const user={id:1,role:'customer',default_mode:'customer'};
        return <I18nextProvider i18n={i18n}><AuthContext.Provider value={{user,isHelper:false,logout:()=>{},switchRole:async()=>{}}}>
          <LanguageContext.Provider value={{language:'en',setLanguage:()=>{},availableLanguages:[{code:'en',nativeName:'English',flag:'🇺🇸'}]}}>
          <ThemeContext.Provider value={{isDark:true,toggleTheme:()=>{}}}><Navbar/><DeferredCommandPalette/></ThemeContext.Provider>
          </LanguageContext.Provider></AuthContext.Provider></I18nextProvider>;
      }
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={queryClient}><BrowserRouter><Harness/></BrowserRouter></QueryClientProvider>);`, resolveDir: root, loader: 'jsx' },
    bundle: true, write: false, jsx: 'automatic', format: 'esm', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'palette-fixture-dependencies', setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'palette-fixture' } : undefined);
      plugin.onLoad({ filter: /.*/, namespace: 'palette-fixture' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: root }));
    }}],
  });
  const css = '*{box-sizing:border-box}body{margin:0}button{font:inherit}'+fs.readFileSync(path.join(root, 'src/index.css'), 'utf8').replace(/^@(?:import|config).*$/gm, '') + fs.readFileSync(path.join(root, 'src/styles/BusinessSwitcher.css'), 'utf8') + fs.readFileSync(path.join(root, 'src/components/Navbar.css'), 'utf8') + fs.readFileSync(path.join(root, 'src/components/CommandPalette.css'), 'utf8');
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
    const dialog = page.locator('.cmdk-dialog');
    const waitDialogOpen = async () => { await dialog.waitFor({ state: 'visible', timeout: 10_000 }); assert.equal(await page.locator('.cmdk-input').isVisible(), true); };
    const closeDialog = async () => { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.cmdk-dialog')); };

    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.setViewportSize({ width: 1600, height: 850 });
    await page.locator('.ox-nav-desktop button[aria-label="Command palette"]').waitFor({ state: 'visible' });
    assert.equal(await dialog.count(), 0, 'palette starts closed on desktop');
    // First click: the palette chunk has never loaded, so this is the
    // regression. It must load and open, not just load silently.
    await page.locator('.ox-nav-desktop button[aria-label="Command palette"]').click();
    await waitDialogOpen();
    await closeDialog();
    // Second click: the palette is already loaded; its own open-event
    // listener must still open it.
    await page.locator('.ox-nav-desktop button[aria-label="Command palette"]').click();
    await waitDialogOpen();
    await closeDialog();

    // Mobile: no hotkey exists, so the button is the only way in.
    await page.setViewportSize({ width: 320, height: 850 });
    await page.locator('.ox-nav-mobile-controls button[aria-label="Command palette"]').waitFor({ state: 'visible' });
    assert.equal(await dialog.count(), 0, 'palette starts closed on mobile');
    await page.locator('.ox-nav-mobile-controls button[aria-label="Command palette"]').click();
    await waitDialogOpen();
    await closeDialog();

    // Hotkey path still works from a cold load.
    await page.reload();
    await page.locator('.ox-nav-mobile-controls button[aria-label="Command palette"]').waitFor({ state: 'visible' });
    assert.equal(await dialog.count(), 0, 'palette starts closed after reload');
    await page.keyboard.press('Control+k');
    await waitDialogOpen();
    await closeDialog();

    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});
