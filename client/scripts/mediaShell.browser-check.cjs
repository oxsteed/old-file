// Real React rendering and Chromium keyboard/layout checks, with synthetic
// service responses. This proves interaction behavior, not server authorization.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');

test('reference layouts render on phones and desktops with working location, feeds, joining and search', async () => {
  const app = await fixture(); let browser;
  const screenshots = fs.mkdtempSync('/tmp/oxsteed-media-design-');
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    for (const scenario of [
      { name: 'signed-phone', width: 434, height: 1246 },
      { name: 'guest-phone', width: 390, height: 668, guest: true },
      { name: 'signed-desktop', width: 1312, height: 816 },
      { name: 'guest-desktop', width: 1312, height: 816, guest: true },
    ]) {
      const page = await browser.newPage({ viewport: { width: scenario.width, height: scenario.height } });
      const errors = []; page.on('pageerror', err => errors.push(err.message));
      await page.goto(`${app.url}/media?${scenario.guest ? 'guest&' : ''}lang=en`);
      await page.locator('.media-welcome-card').waitFor();
      if (scenario.name === 'guest-phone') {
        const welcome = await page.locator('.media-mobile-welcome-title').boundingBox();
        const navigation = await page.locator('.media-bottom-nav').boundingBox();
        assert.ok(welcome.y + welcome.height < navigation.y, 'Guest welcome title must be visible above phone navigation');
      }
      await page.screenshot({ path: path.join(screenshots, scenario.name + '.png'), fullPage: false });
      const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => { const rect=el.getBoundingClientRect();return rect.width && (rect.right>innerWidth+1||rect.left< -1); }).map(el=>({tag:el.tagName,cls:el.className,width:el.getBoundingClientRect().width})).slice(0,12));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, JSON.stringify(overflow));
      assert.deepEqual(errors, []);
      if (scenario.width < 701 && !scenario.guest) await page.locator('.media-account-trigger').click();
      const preferences = page.locator(scenario.width > 700 ? '.media-header-tools' : scenario.guest ? '.media-mobile-location-row' : '.media-account-menu');
      await preferences.locator('.ox-theme-toggle').click();
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true);
      await preferences.locator('.ox-theme-toggle').click();
      await preferences.locator('[aria-haspopup="listbox"]').click();
      await page.getByRole('option', { name: /Français/ }).click();
      assert.match(await preferences.locator('[aria-haspopup="listbox"]').textContent(), /fr/i);
      if (scenario.width < 701 && !scenario.guest) await page.keyboard.press('Escape');
      const location = page.locator(scenario.width < 701 ? '.media-mobile-location-row .media-global-location' : scenario.guest ? '.media-how-card button' : '.media-header-location .media-global-location');
      await location.click();
      const dialog = page.getByRole('dialog'); await dialog.getByRole('textbox').fill('outage');
      await dialog.locator('button[type="submit"]').click();
      await dialog.getByRole('alert').waitFor();
      await dialog.getByRole('textbox').fill('45502');
      await dialog.locator('button[type="submit"]').click();
      await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => window.feedCalls.some(call => call.city === 'Springfield' && call.state === 'OH'));
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('oxsteed.media.location')).city), 'Springfield');
      await page.reload();
      await page.waitForFunction(() => window.feedCalls.some(call => call.city === 'Springfield' && call.state === 'OH'));
      const restoredLabel = page.locator(scenario.width < 701 ? '.media-mobile-location-row .media-global-location' : scenario.guest ? '.media-neighborhood-card' : '.media-header-location .media-global-location');
      if (!scenario.guest || scenario.width < 701) assert.match(await restoredLabel.textContent(), /Springfield/);
      await page.locator('.media-support-launcher').click();
      await page.locator('.media-support-panel').waitFor();
      await page.locator('.media-support-panel').getByRole('button', { name: 'Close chat' }).click();
      if (!scenario.guest) {
        if (scenario.width < 701) await page.locator('.media-reference-shortcuts a[href="/media?tab=mine"]').click();
        else {
          await page.locator('.media-account-trigger').click();
          await page.locator('.media-account-menu a[href="/media?tab=mine"]').click();
          await page.locator('.media-account-menu').waitFor({state:'hidden'});
        }
        await page.waitForFunction(() => window.feedCalls.some(call => call.tab === 'mine'));
        await page.locator('.media-reference-tabs').getByRole('button', { name: 'Following', exact: true }).click();
        await page.waitForFunction(() => window.feedCalls.some(call => call.tab === 'following'));
        await page.locator('.media-reference-tabs button').first().click();
        await page.locator('.media-explore-nearby').click();
        await page.waitForFunction(() => window.feedCalls.some(call => call.tab === 'nearby'));
        if (scenario.width > 700) {
          await page.locator('.media-spaces-card').getByRole('button',{name:'Join',exact:true}).first().click();
          await page.locator('.media-spaces-card .media-space-join').first().filter({hasText:'Open'}).waitFor();
          assert.deepEqual(await page.evaluate(() => window.joinCalls), [1]);
        }
      }
      if (scenario.width > 700) {
        const search = page.locator('.media-header-search input'); await search.fill('neighborhood'); await search.press('Enter');
        await page.waitForFunction(() => window.requests.some(request => request.kind === 'search' && request.key === 'neighborhood'));
        assert.equal(await page.locator('.media-search input').inputValue(), 'neighborhood');
      }
      await page.close();
    }
    console.log('Design screenshots: ' + screenshots);
  } finally { if (browser) await browser.close(); await app.close(); }
});

async function fixture() {
  const mocks = {
    'fixture-auth': `import {useSyncExternalStore} from 'react';
      const subscribe = listener => { window.addEventListener('fixture-auth',listener); return () => window.removeEventListener('fixture-auth',listener); };
      const setUser = user => { window.viewer=user; window.dispatchEvent(new Event('fixture-auth')); };
      export const useAuth = () => ({ user: useSyncExternalStore(subscribe,()=>window.viewer), loading:false, isOnboardingComplete:false, setUser,
        login:async payload=>{window.loginCalls=(window.loginCalls||[]).concat(payload); if(window.rejectLogin)throw new Error('Synthetic rejected login'); const result={user:{id:'viewer',display_name:'Signed in helper',email_verified:true,didit_status:'verified'}};setUser(result.user);return result;},
        logout:async()=>{window.signouts+=1;setUser(null);} });`,
    '../hooks/useAuth': `export {useAuth} from 'fixture-auth'; import {useAuth as ua} from 'fixture-auth'; export default ua;`,
    '../api/auth': `export const persistSessionPayload = () => {}; export default { get: async () => ({ data: {} }), post: async () => ({ data: {} }), put: async () => ({ data: {} }) };`,
    '../components/AuthNavbar': `import React from 'react';import {Link} from 'react-router-dom';export default ({cta}) => <nav><Link to={cta.to}>{cta.label}</Link></nav>;`,
    'react-i18next': `export const useTranslation = () => ({ t: window.translate, i18n: { language: window.language } });`,
    '../../context/AuthContext': `import React from 'react'; export {useAuth} from 'fixture-auth'; export const AuthContext = React.createContext(null);`,
    '../context/AuthContext': `import React from 'react'; export {useAuth} from 'fixture-auth'; export const AuthContext = React.createContext(null);`,
    '../components/PageMeta': `export default () => null;`,
    '../components/Footer': `import React from 'react'; export default () => <footer data-standalone-footer>Standalone footer</footer>;`,
    '../components/registration': `import React from 'react'; export const DiditPanel = ({onVerified,onBack}) => <><button onClick={onVerified}>Complete identity verification</button><button onClick={onBack}>Return to composer</button></>;`,
    '../../context/CookieConsentContext': `export const useCookieConsentContext = () => ({ openSettings: () => { window.cookieSettings += 1; } });`,
    '../../components/PageShell': `import React from 'react'; export default ({children}) => <main>{children}</main>;`,
    '../../components/PageMeta': `export default () => null;`,
    '../context/LanguageContext': `import {useState} from 'react'; export const useLanguage = () => {const [language,setLanguage] = useState(window.language);return {language,setLanguage,availableLanguages:[{code:'en',name:'English',nativeName:'English'},{code:'es',name:'Spanish',nativeName:'Español'},{code:'fr',name:'French',nativeName:'Français'},{code:'ht',name:'Haitian Creole',nativeName:'Kreyòl'},{code:'ar',name:'Arabic',nativeName:'العربية'}]};};`,
    '../context/ThemeContext': `import {useState} from 'react'; export const useTheme = () => {const [isDark,setDark] = useState(false);return {isDark,toggleTheme:()=>{document.documentElement.classList.toggle('dark');setDark(v=>!v);}};};`,
    '../hooks/useCapabilities': `export const useCapabilities = () => ({ isAvailable: () => true, loading: false });`,
    '../api/axios': `export default { get: async()=>({data:{}}), post:async()=>({data:{reply:'Synthetic assistant reply'}}) };`,
    './axios': `export default {get:async()=>({data:[]}),post:async()=>({data:{}})};`,
    './SpeechToTextInput': `import React from 'react'; export default () => null;`,
    '../../api/geo': `export const suggestLocation = async q => { if(q==='outage') throw new Error('Synthetic lookup outage'); return [{city:'Springfield',state:'OH',display:'Springfield, Ohio'}]; }; export const getNearbyPlaces = async () => ({ places: [] }); export const reverseGeocode = async () => ({ city: 'Springfield', state: 'OH', display: 'Springfield, Ohio' });`,
    '../../hooks/useNotifications': `export default () => ({ unreadCount: window.viewer ? 2 : 0 });`,
    '../../hooks/useMediaPostRealtime': `export default () => {};`,
    '../../api/axios': `export default {get: async () => ({data: []})};`,
    '../../api/media': `const pending = (kind, key) => new Promise((resolve, reject) => window.requests.push({kind,key,resolve,reject}));
      const action = (kind, args) => window.financialCalls.push({kind,args});
      export const searchMedia = params => pending('search', params.q);
      export const getActor = handle => pending('actor', handle);
      export const getPost = id => pending('post', id);
      export const getReplies = (id, sort) => pending('replies', id + ':' + sort);
      export const getQuotes = async () => ({quotes:[]});
      export const getModerationStatus = async () => { throw new Error('not owner'); };
      export const createMediaAppeal = async () => ({appeal:{status:'open'}});
      export const recordView = async () => ({});
      export const getMediaVerification = async () => ({publishers:[{key:'user:viewer',actor_type:'user',actor_id:'actor',display_name:'Synthetic local member',location:{city:'Springfield',region:'OH'},eligibility:{text:true,photo:true,video:false}}],helper:{is_verified:false}, businesses:[{id:1,business_name:'Fixture business',is_verified:false}],restaurants:[]});
      export const getDrafts = async () => ({drafts:[]}), getDraft = async()=>({draft:null}), updateDraft = async()=>({post:{}});
      export const linkAsset=async()=>({}), publishPost=async()=>({}), removeMediaAsset=async()=>({}), reorderMediaAssets=async()=>({}), updateMediaAsset=async()=>({}), uploadMediaCaption=async()=>({}), uploadPhoto=async()=>({}), uploadVideo=async()=>({});
      export const submitMediaVerification = async () => ({});
      export const toggleFollow = async () => ({following:true,follower_count:1});
      export const searchMediaEntities = async () => ({entities:[]});
      export const createPost = async () => ({}), deletePost = createPost, replacePostLinks = createPost, updatePost = createPost;
      export const toggleLike = id=>pending('like',id), toggleBookmark = id=>pending('bookmark',id), toggleRepost = id=>pending('repost',id), recordShare = async()=>({share_count:9}), flagPost = createPost;
      export const createCreatorBoost = async (id,data) => { action('boost',[id,data]); if (window.failBoost) { window.failBoost=false; throw {response:{data:{error:'Synthetic lost response'}}}; } return {boost:{id:'boost'}}; };
      export const settleCreatorBoost = async id => action('settleBoost',[id]);
      export const getCreatorGigs = async () => ({gigs:[]}), getMyCreatorGigs=async()=>({gigs:window.marketplace==='owner'?[{id:'owned-gig',title:'My awarded gig',brief:'Ready for creator consent',status:'awarded',owner_user_id:'viewer',budget_cents:10000,currency_code:'USD'}]:[]});
      export const getCreatorSponsorships = async () => ({sponsorships:window.marketplace==='buyer'?[{id:'offer',sponsor_user_id:'viewer',creator_user_id:'other',status:'delivered',brief:'Local campaign',amount_cents:1000,currency_code:'USD'}]:[]});
      export const getCreatorPayments = async () => ({payments:[]}), getCreatorWorkReviews=async()=>({workReviews:[]});
      export const getMyCreatorApplications = async () => ({applications:window.marketplace==='creator'&&!window.workDeclined?[{id:'application',gig_id:'gig',gig_title:'Local creator work',status:'awarded',accepted_at:null,proposed_cents:10000,currency_code:'USD'}]:[]});
      export const getFeed = async params=>{ window.feedCalls.push(params); return {posts:window.marketplace?[{id:'owned-post',body:'Published creator work'}]:[],location:params.city?{city:params.city,state:params.state,latitude:null,longitude:null}:window.viewer?{city:'Springfield',state:'OH',latitude:null,longitude:null}:{city:'',state:'',latitude:null,longitude:null},has_more:false}; };
      export const getCommunities = async()=>({communities:[{id:1,slug:'small-business',title:'Springfield Small Business',geo_scope:'Springfield, OH',joined:false},{id:2,slug:'local-events',title:'Local Events',joined:false},{id:3,slug:'community-help',title:'Community Help',joined:false}]});
      export const joinCommunity = async id=>{window.joinCalls.push(id);return {joined:true};};
      export const getMediaBadges = async () => ({ spaces_unread: 3 });
      export const markMediaCommunitiesSeen = async () => ({ ok: true, spaces_unread: 0 });
      export const acceptCreatorApplication = async id => {action('accept',[id]);return {application:{accepted_at:'2026-10-09T00:00:00Z'}};};
      export const declineCreatorApplication = async id => {action('decline',[id]);window.workDeclined=true;}, cancelCreatorBoost = async id => ({boost:{status:'cancelled'}});
      export const submitCreatorDeliverable = async(id,data)=>{action('deliver',[id,data]);return {deliverable:{id:'deliverable'}};};
      export const requestCreatorSponsorshipChanges = async(id,reason)=>{action('changes',[id,reason]);return {sponsorship:{status:'accepted',review_note:reason}};};
      export const cancelCreatorSponsorship = async id=>{action('cancel',[id]);return {workReview:{id:'review',kind:'sponsorship',reference_id:id,status:'open',reason:'Contested delivery'}};};
      export const getMediaCreatorWorkReviews = async()=>({workReviews:[{id:'admin-review',kind:'gig',reference_id:'gig',reason:'Contested work'}]});
      export const resolveMediaCreatorWorkReview = async(id,data)=>action('resolve',[id,data]);
      export const acceptCreatorSponsorship=createPost, applyToCreatorGig=createPost, awardCreatorApplication=createPost, cancelCreatorGig=createPost, createCreatorGig=createPost, createCreatorSponsorship=createPost, createCreatorTip=createPost, getCreatorApplications=createPost, openCreatorDispute=createPost, reviewCreatorDeliverable=createPost, settleCreatorSponsorship=createPost, settleCreatorTip=createPost, submitCreatorSponsorshipDeliverable=createPost;`,
    'axios': `export default { get: async()=>({data:{flags:[],posts:[],requests:[]}}), post:async()=>({}) };`,
  };
  for (const page of ['terms','privacy','security','cookiepolicy','donotsell','accessibility']) {
    mocks['../' + page] = `import React from 'react'; export default () => <article><p>Fixture legal content</p><a href="#more">More information</a><button>Last legal control</button></article>;`;
  }
  const bundle = await build({
    stdin: {resolveDir:root,loader:'jsx',contents:`
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {BrowserRouter, Routes, Route, useNavigate, useLocation} from 'react-router-dom';
      import Shell from './src/pages/media/MediaShell.jsx'; import Search from './src/pages/media/MediaSearchPage.jsx';
      import Feed from './src/pages/media/MediaFeedPage.jsx'; import Support from './src/components/SupportWidget.jsx';
      import Compose from './src/pages/media/MediaComposePage.jsx';
      import Actor from './src/pages/media/MediaActorPage.jsx'; import Detail from './src/pages/media/MediaPostDetailPage.jsx';
      import Verification from './src/pages/media/MediaVerificationPage.jsx'; import Card from './src/pages/media/MediaPostCard.jsx';
      import Creator from './src/pages/media/MediaCreatorPage.jsx'; import Admin from './src/admin/pages/MediaFlags.jsx';
      import Identity from './src/pages/VerifyIdentityPage.tsx'; import ProtectedRoute from './src/components/ProtectedRoute.jsx';
      const post={id:'fixture',owner_user_id:'viewer',visibility:'public',handle:'fixture',display_name:'Fixture helper',body:'Useful local work',created_at:new Date().toISOString(),like_count:0,bookmark_count:0,repost_count:0,reply_count:0,share_count:0,view_count:0};
      function Harness(){ window.fixtureNavigate=useNavigate(); const location=useLocation(); const [cardPost,setCardPost]=React.useState(post);window.fixtureReplacePost=setCardPost;
        return <><output data-route>{location.pathname}</output><output data-return>{location.state?.from || ''}</output><Shell><Routes>
          <Route path="/media" element={<Feed/>}/><Route path="/media/search" element={<Search/>}/><Route path="/media/:handle" element={<Actor/>}/>
          <Route path="/media/compose" element={<Compose/>}/>
          <Route path="/media/post/:id" element={<Detail/>}/><Route path="/media/verification" element={<Verification/>}/>
          <Route path="/media/verify-identity" element={<ProtectedRoute requireOnboarded={false}><Identity embedded/></ProtectedRoute>}/>
          <Route path="/verify-identity" element={<Identity/>}/>
          <Route path="/media/creator" element={<Creator/>}/><Route path="/media/admin" element={<Admin/>}/>
          <Route path="/media/card" element={<Card post={cardPost} onUpdate={setCardPost}/>}/><Route path="*" element={<h1>Fixture timeline</h1>}/>
        </Routes></Shell><Support/></>; }
      createRoot(document.getElementById('root')).render(<BrowserRouter><Harness/></BrowserRouter>);`},
    bundle:true,write:false,outfile:'app.js',jsx:'automatic',define:{'import.meta.env':'{}'},
    plugins:[{name:'media-shell-fixture',setup(plugin){
      plugin.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);
      plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:root}));
    }}],
  });
  const server=http.createServer((req,res)=>{
    const output=bundle.outputFiles.find(file=>file.path.endsWith(req.url === '/app.css' ? '.css' : '.js'));
    if (req.url === '/app.js' || req.url === '/app.css') {res.setHeader('Content-Type',req.url.endsWith('css')?'text/css':'text/javascript');res.end(output.contents);return;}
    const params=new URL(req.url,'http://fixture').searchParams, lang=params.get('lang') || 'en';
    const catalog=JSON.parse(fs.readFileSync(path.join(root,'src/locales',lang+'.json'),'utf8'));
    const commonCatalog=JSON.parse(fs.readFileSync(path.join(root,'src/i18n/locales',lang,'common.json'),'utf8'));
    res.setHeader('Content-Type','text/html; charset=utf-8');
    // Production blocks same-origin frames. Tests must prove the real form
    // works under that policy, not merely that an iframe URL was assigned.
    res.setHeader('Content-Security-Policy', "frame-src https://js.stripe.com https://hooks.stripe.com https://verify.didit.me; frame-ancestors 'self'");
    res.end(`<html lang="${lang}" dir="${lang==='ar'?'rtl':'ltr'}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><style>
      :root{--color-surface:white;--color-surface-2:#f5f6f8;--color-text:#172033;--color-text-muted:#536176;--color-border:#ddd;--color-primary:#b93d00;--color-primary-bg:#fff0e7;--color-action:#b93d00;--color-on-action:white;}html.dark{--color-surface:#1b2535;--color-surface-2:#111827;--color-text:#f4f5f8;--color-text-muted:#c4cad4;--color-border:#435062;--color-primary:#d8642e;--color-primary-bg:#39271f;}body{margin:0;font-family:Arial,sans-serif}button,input,textarea,select{font:inherit}output{display:none}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0}
      </style></head><body><div id="root"></div><script>window.requests=[];window.financialCalls=[];window.feedCalls=[];window.joinCalls=[];window.marketplace=${JSON.stringify(params.get('marketplace'))};window.failBoost=${params.has('payments')};window.language=${JSON.stringify(lang)};window.catalog=${JSON.stringify(catalog).replace(/</g,'\\u003c')};window.viewer=${params.has('guest')?'null':"{id:'viewer',display_name:'Synthetic local helper'}"};window.signouts=0;window.cookieSettings=0;
      window.commonCatalog=${JSON.stringify(commonCatalog).replace(/</g,'\\u003c')};
      window.translate=(key,options={})=>{const read=catalog=>key.split('.').reduce((node,part)=>node?.[part],catalog);const value=read(window.catalog)??read(window.commonCatalog);return (typeof value==='string'?value:options.defaultValue||key).replace(/\\{\\{(\\w+)\\}\\}/g,(_,name)=>String(options[name]??''));};</script><script type="module" src="/app.js"></script></body></html>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}

test('composer layout fits phones, tablets and desktops in light, dark and Arabic RTL', async () => {
  const app = await fixture(); let browser;
  const screenshots = fs.mkdtempSync('/tmp/oxsteed-composer-design-');
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    // 683 CSS pixels models a 1366px desktop at 200% browser zoom.
    for (const width of [320,390,683,768,1366]) {
      for (const dark of [false,true]) {
        const lang = dark ? 'ar' : 'en';
        const page = await browser.newPage({ viewport: { width, height: width === 683 ? 450 : 900 }, deviceScaleFactor: width === 683 ? 2 : 1, reducedMotion: 'reduce' });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${app.url}/media/compose?lang=${lang}`);
        await page.locator('.media-publisher-row strong').filter({ hasText: 'Synthetic local member' }).waitFor({ state: 'attached' });
        if (dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
        const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].map(el => ({ tag: el.tagName, cls: el.className, right: el.getBoundingClientRect().right, left: el.getBoundingClientRect().left, width: el.getBoundingClientRect().width })).filter(rect => rect.width && (rect.right > innerWidth + 1 || rect.left < -1)).slice(0,12));
        await page.screenshot({ path: path.join(screenshots, `${width}-${lang}-${dark?'dark':'light'}.png`), fullPage: false });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width}/${lang}: ${JSON.stringify(overflow)}; screenshots ${screenshots}`);
        assert.deepEqual(errors, []);
        const identity = await page.locator('.media-publisher-row > div').filter({ has: page.locator('strong') }).boundingBox();
        const selector = await page.locator('.media-publisher-row select').boundingBox();
        assert.ok(identity.width >= 80, `Publisher identity must remain readable at ${width}/${lang}`);
        assert.ok(identity.y + identity.height <= selector.y || identity.y >= selector.y + selector.height || identity.x + identity.width <= selector.x || identity.x >= selector.x + selector.width, 'Publisher selector must not cover the displayed identity');
        assert.equal(await page.locator('.media-destination-options input[type=radio]').count(), 3);
        if (width < 701) {
          const actions = await page.locator('.media-compose-actions').boundingBox();
          const nav = await page.locator('.media-bottom-nav').boundingBox();
          assert.ok(actions.y + actions.height <= nav.y + 1, 'Actions must stay above mobile navigation');
          const support = await page.locator('.media-support-launcher').boundingBox();
          assert.ok(support.y >= actions.y + actions.height || support.y + support.height <= actions.y, 'Support must not cover composer actions');
        }
        await page.screenshot({ path: path.join(screenshots, `${width}-${lang}-${dark?'dark':'light'}.png`), fullPage: false });
        if (width === 320) {
          await page.locator('textarea').focus();
          await page.keyboard.press('Tab');
          assert.equal(await page.locator('.media-emoji-control > button').evaluate(el => el === document.activeElement), true);
          await page.keyboard.press('Enter');
          await page.keyboard.press('Tab');
          await page.keyboard.press('Enter');
          assert.equal(await page.locator('textarea').inputValue(), '😀');
          assert.equal(await page.locator('textarea').evaluate(el => el === document.activeElement), true);
        }
        await page.close();
      }
    }
    console.log('Composer screenshots: ' + screenshots);
  } finally { if (browser) await browser.close(); await app.close(); }
});

async function resolveRequest(page, kind, key, data) {
  await page.waitForFunction(({kind,key})=>window.requests.some(request=>request.kind===kind&&request.key===key),{kind,key});
  await page.evaluate(({kind,key,data})=>window.requests.find(request=>request.kind===kind&&request.key===key).resolve(data),{kind,key,data});
}

test('pending identity verification opens inside Media and returns both completion and back to composer',async()=>{
  const app=await fixture();let browser;
  try{
    browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({viewport:{width:360,height:844}});
    for(const lang of ['en','ar']){
      await page.goto(`${app.url}/media/verification?lang=${lang}&returnTo=%2Fmedia%2Fcompose`);
      await page.evaluate(()=>Object.assign(window.viewer,{email_verified:true,didit_status:'pending',didit_enforcement_required:true}));
      await page.locator('a[href^="/media/verify-identity?"]').click();
      await page.locator('.media-identity-embedded').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('returnTo'),'/media/compose');
      assert.equal(await page.locator('main').count(),1);
      assert.equal(await page.locator('.media-app-header').count(),1);
      assert.equal(await page.locator('.media-footer-card').count(),1);
      assert.equal(await page.locator('.verify-identity-nav,[data-standalone-footer]').count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,lang);
      await page.getByRole('button',{name:'Complete identity verification'}).click();
      await page.waitForFunction(()=>document.querySelector('[data-route]').textContent==='/media/compose');
      await page.evaluate(()=>window.fixtureNavigate('/media/verify-identity?returnTo=%2Fmedia%2Fcompose'));
      await page.getByRole('button',{name:'Return to composer'}).click();
      await page.waitForFunction(()=>document.querySelector('[data-route]').textContent==='/media/compose');
    }
  }finally{if(browser)await browser.close();await app.close();}
});

test('Media shell retains account routes on small screens in all five languages without overflow',async()=>{
  const app=await fixture();let browser;
  try{
    browser=await chromium.launch({headless:true,channel:'chrome'});
    for(const lang of ['en','es','fr','ht','ar']) for(const width of [360,1440]){
      const page=await browser.newPage({viewport:{width,height:900}}), errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`${app.url}/media?lang=${lang}`);
      await page.locator('.media-wordmark').waitFor();
      assert.equal(await page.locator('main').count(),1);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${lang}/${width} document overflow`);
      const shortcuts=page.locator(width===360?'.media-reference-shortcuts':'.media-left-rail');
      for(const route of ['/media/bookmarks','/media/verification'])assert.equal(await shortcuts.locator(`a[href="${route}"]`).count(),1);
      assert.equal(await page.locator('.media-left-rail a[href="/media/creator"]').count(),1);
      const nav=page.locator(width===360?'.media-bottom-nav':'.media-side-nav');
      assert.equal(await nav.locator('a').count(),5);
      for(const route of ['/media/communities','/media/notifications','/media/messages']){
        await nav.locator(`a[href="${route}"]`).click();
        await page.waitForFunction(route=>document.querySelector('[data-route]').textContent===route,route);
        assert.equal(await nav.locator(`a[href="${route}"]`).getAttribute('aria-current'),'page');
      }
      assert.equal(await page.locator('.media-account-name').textContent(),'Synthetic local helper');
      await page.locator('.media-account-trigger').click();await page.locator('.media-account-action').click();assert.equal(await page.evaluate(()=>window.signouts),1);
      assert.deepEqual(errors,[]);await page.close();
    }
  }finally{if(browser)await browser.close();await app.close();}
});

test('real auth forms work under production frame policy and share the Media session',async()=>{
  const app=await fixture();let browser;
  try{
    browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({viewport:{width:360,height:844}});
    const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
    await page.goto(`${app.url}/media?guest&lang=en`);
    assert.equal(await page.locator('.media-auth-links a[href="/join"]').count(),1);
    await page.locator('.media-auth-links a[href="/join"]').click();
    await page.locator('.media-link-dialog').waitFor();
    await page.locator('.media-auth-content input[type="email"]').waitFor();
    assert.equal(await page.locator('.media-link-iframe').count(),0);
    await page.locator('.media-legal-close').click();
    // The shell stays mounted during Media navigation; the return destination
    // must reflect the new page rather than the page where it first mounted.
    await page.evaluate(()=>window.fixtureNavigate('/media/search?guest&lang=en#results'));
    await page.locator('.media-auth-links a[href="/login"]').click();
    await page.locator('.media-link-dialog').waitFor();
    assert.equal(await page.evaluate(()=>document.querySelector('[data-route]').textContent),'/media/search');
    const dialog=page.locator('.media-link-dialog');
    await dialog.locator('#email').fill('synthetic@example.test');
    assert.equal(await dialog.locator('iframe').count(),0);
    assert.equal(await dialog.locator('.media-legal-expand').getAttribute('href'), '/login?next=%2Fmedia%2Fsearch%3Fguest%26lang%3Den%23results');
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('href')), '/login');
    await page.locator('.media-auth-links a[href="/login"]').click();
    await dialog.locator('a[href="/forgot-password"]').click();
    await dialog.locator('a[href="/login"]').click();
    await dialog.locator('#password').waitFor();
    await dialog.locator('#email').fill('synthetic@example.test');
    await dialog.locator('#password').fill('synthetic-test-only');
    await dialog.locator('#terms-agree').check();
    await dialog.locator('#signature-name').fill('Synthetic Helper');
    await page.evaluate(()=>{window.rejectLogin=true;});
    await dialog.locator('button[type="submit"]').click();
    await page.waitForFunction(()=>window.loginCalls?.length===1);
    await dialog.locator('button[type="submit"]:enabled').waitFor();
    assert.equal(await dialog.count(),1);
    await page.evaluate(()=>{window.rejectLogin=false;});
    await dialog.locator('button[type="submit"]').click();
    await dialog.waitFor({state:'hidden'});
    assert.match(await page.locator('.media-account-name').textContent(), /Signed in helper/);
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash,'/media/search?guest&lang=en#results');
    assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
    assert.deepEqual(errors,[]);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }finally{if(browser)await browser.close();await app.close();}
});

test('legal, verification and boost dialogs contain Tab, close on Escape and restore focus',async()=>{
  const app=await fixture();let browser;
  try{
    browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({viewport:{width:390,height:844}});
    for(const scenario of [{path:'/media',trigger:'.media-footer-links a[href="/terms"]'},{path:'/media/verification',trigger:'.media-verification-card button'},{path:'/media/card',trigger:'button[aria-label="Boost post"]'}]){
      await page.goto(app.url+scenario.path);const trigger=page.locator(scenario.trigger);await trigger.click();
      const dialog=page.getByRole('dialog');await dialog.waitFor();
      await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement));
      const controls=dialog.locator('a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)');
      await controls.first().focus();await page.keyboard.press('Shift+Tab');
      assert.equal(await controls.last().evaluate(el=>el===document.activeElement),true,scenario.path+' backward focus trap');
      await page.keyboard.press('Tab');assert.equal(await controls.first().evaluate(el=>el===document.activeElement),true);
      assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
      await page.waitForFunction(selector=>document.querySelector(selector)===document.activeElement,scenario.trigger);
      assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
    }
  }finally{if(browser)await browser.close();await app.close();}
});

test('search errors stay recoverable and older search results never replace the new query',async()=>{
  const app=await fixture();let browser;
  try{
    browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url+'/media/search');
    const search=page.locator('.media-search').getByRole('searchbox');await search.fill('old');await search.press('Enter');
    await page.waitForFunction(()=>window.requests.some(r=>r.kind==='search'&&r.key==='old'));
    await search.fill('new');await search.press('Enter');
    await resolveRequest(page,'search','new',{posts:[],actors:[{id:2,handle:'new',display_name:'New account'}]});
    await page.getByRole('link',{name:/New account/}).waitFor();
    await resolveRequest(page,'search','old',{posts:[],actors:[{id:1,handle:'old',display_name:'Old account'}]});
    assert.equal(await page.getByRole('link',{name:/Old account/}).count(),0);
    await search.fill('outage');await search.press('Enter');
    await page.waitForFunction(()=>window.requests.some(r=>r.key==='outage'));
    await page.evaluate(()=>window.requests.find(r=>r.key==='outage').reject(new Error('Synthetic service outage')));
    await page.getByRole('alert').waitFor();await search.fill('recovered');await search.press('Enter');
    await resolveRequest(page,'search','recovered',{posts:[],actors:[]});
    await page.getByText('No results found.',{exact:true}).waitFor();assert.deepEqual(errors,[]);
  }finally{if(browser)await browser.close();await app.close();}
});

test('slow actor and post requests cannot reveal the previous route after navigation',async()=>{
  const app=await fixture();let browser;
  try{
    browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage();
    await page.goto(app.url+'/media/@first');
    await page.waitForFunction(()=>window.requests.some(r=>r.kind==='actor'&&r.key==='first'));
    await page.evaluate(()=>window.fixtureNavigate('/media/@second'));
    await resolveRequest(page,'actor','second',{actor:{id:'second',display_name:'Current account',handle:'second',actor_type:'helper'},posts:[]});
    await page.getByRole('heading',{name:/Current account/}).waitFor();
    await resolveRequest(page,'actor','first',{actor:{id:'first',display_name:'Stale account',handle:'first'},posts:[]});
    assert.equal(await page.getByText('Stale account',{exact:true}).count(),0);
    await page.evaluate(()=>window.fixtureNavigate('/media/post/first'));
    await page.waitForFunction(()=>window.requests.some(r=>r.kind==='post'&&r.key==='first'));
    await page.evaluate(()=>window.fixtureNavigate('/media/post/second'));
    const makePost=body=>({id:body,body,handle:'helper',display_name:'Helper',created_at:new Date().toISOString(),reply_count:0});
    await resolveRequest(page,'post','second',{post:makePost('Current post')});
    await resolveRequest(page,'replies','second:latest',{replies:[]});
    await page.getByText('Current post',{exact:true}).waitFor();
    await resolveRequest(page,'post','first',{post:makePost('Stale post')});
    await resolveRequest(page,'replies','first:latest',{replies:[]});
    assert.equal(await page.getByText('Stale post',{exact:true}).count(),0);
  }finally{if(browser)await browser.close();await app.close();}
});

test('creator must accept awarded work before publishing a deliverable',async()=>{
  const app=await fixture();let browser;
  try{
    browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({viewport:{width:390,height:844}});
    await page.goto(app.url+'/media/creator?marketplace=creator');
    await page.getByRole('button',{name:'Accept work',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Submit deliverable',exact:true}).count(),0);
    assert.equal(await page.getByText('$100.00',{exact:true}).count(),1);
    await page.getByRole('button',{name:'Accept work',exact:true}).click();
    await page.getByRole('button',{name:'Submit deliverable',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.waitFor();
    await dialog.getByRole('combobox').selectOption('owned-post');
    await dialog.getByRole('button',{name:'Submit application',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    assert.deepEqual(await page.evaluate(()=>window.financialCalls),[{kind:'accept',args:['application']},{kind:'deliver',args:['application',{postId:'owned-post',note:''}]}]);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.goto(app.url+'/media/creator?marketplace=creator');
    await page.getByRole('button',{name:'Decline work',exact:true}).click();
    await page.getByRole('button',{name:'Accept work',exact:true}).waitFor({state:'hidden'});
    assert.deepEqual(await page.evaluate(()=>window.financialCalls),[{kind:'decline',args:['application']}]);
  }finally{if(browser)await browser.close();await app.close();}
});

test('buyers can still manage their awarded gigs after they leave public opportunities',async()=>{
  const app=await fixture();let browser;
  try{
    browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage();
    await page.goto(app.url+'/media/creator?marketplace=owner');
    await page.getByRole('heading',{name:'My creator gigs',exact:true}).waitFor();
    await page.getByRole('heading',{name:'My awarded gig',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Apply to this gig',exact:true}).count(),0);
    await page.getByRole('button',{name:'Review applications',exact:true}).click();
    await page.getByRole('dialog').waitFor();await page.getByText('No applications yet.',{exact:true}).waitFor();
  }finally{if(browser)await browser.close();await app.close();}
});

test('sponsorship revision and contested cancellation keep funds reserved and show the review',async()=>{
  const app=await fixture();let browser;
  try{
    browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage();
    await page.goto(app.url+'/media/creator?marketplace=buyer');
    await page.getByRole('button',{name:'Request changes',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.getByRole('textbox').fill('Please show the finished work.');
    await dialog.getByRole('button',{name:'Request changes',exact:true}).click();await dialog.waitFor({state:'hidden'});
    await page.getByText('Please show the finished work.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.getByRole('heading',{name:'Awaiting administrator review',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Cancel',exact:true}).isDisabled(),true);
    assert.equal(await page.getByText('Cancelled',{exact:true}).count(),0);
    assert.deepEqual(await page.evaluate(()=>window.financialCalls),[{kind:'changes',args:['offer','Please show the finished work.']},{kind:'cancel',args:['offer']}]);
  }finally{if(browser)await browser.close();await app.close();}
});

test('boost shows its currency and 24-hour cost, preserves the retry key, and settles once',async()=>{
  const app=await fixture();let browser;
  try{
    browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({viewport:{width:360,height:640}});
    await page.goto(app.url+'/media/card?payments');await page.getByRole('button',{name:'Boost post',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.getByLabel('Currency',{exact:true}).selectOption('KWD');
    await dialog.getByLabel('Amount (KWD)',{exact:true}).fill('1.005');
    await dialog.getByText(/Confirm.*24 hours of sponsored placement/).waitFor();
    await dialog.getByRole('button',{name:'Boost post',exact:true}).click();
    await dialog.getByText('Synthetic lost response',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Boost post',exact:true}).click();
    await dialog.getByText('Boost scheduled successfully.',{exact:true}).waitFor();
    const calls=await page.evaluate(()=>window.financialCalls),boosts=calls.filter(call=>call.kind==='boost');
    assert.equal(boosts.length,2);assert.deepEqual(boosts[0].args,boosts[1].args);
    assert.equal(boosts[0].args[1].amountCents,1005);assert.equal(boosts[0].args[1].currencyCode,'KWD');
    assert.equal(calls.filter(call=>call.kind==='settleBoost').length,1);
    assert.equal(await dialog.getByRole('button',{name:'Boost post',exact:true}).isDisabled(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }finally{if(browser)await browser.close();await app.close();}
});

test('administrator work review requires an audit reason and submits the selected release or resume decision',async()=>{
  const app=await fixture();let browser;
  try{
    browser=await chromium.launch({headless:true,channel:'chrome'});
    for(const decision of ['resume','release']){
      const page=await browser.newPage();await page.goto(app.url+'/media/admin');
      const name=decision==='resume'?'Resume work':'Cancel and release reservation',button=page.getByRole('button',{name,exact:true});
      await button.waitFor();assert.equal(await button.isDisabled(),true);
      await page.getByLabel('Reason for this decision',{exact:true}).fill('Reviewed the submitted work and agreement.');
      await button.click();await button.waitFor({state:'hidden'});
      assert.deepEqual(await page.evaluate(()=>window.financialCalls),[{kind:'resolve',args:['admin-review',{decision,reason:'Reviewed the submitted work and agreement.'}]}]);
      await page.close();
    }
  }finally{if(browser)await browser.close();await app.close();}
});

test('personal action controls reconcile authoritative counts, prevent duplicate requests and reset when the payload changes',async()=>{
  const app=await fixture();let browser;
  try{
    browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage();await page.goto(app.url+'/media/card');
    for(const [kind,name,state,countKey] of [['like','Like','liked','like_count'],['bookmark','Bookmark','bookmarked','bookmark_count'],['repost','Repost','reposted','repost_count']]){
      const button=page.getByRole('button',{name,exact:true});await button.click();
      assert.equal(await button.isDisabled(),true);
      assert.equal(await page.evaluate(kind=>window.requests.filter(request=>request.kind===kind).length,kind),1);
      await resolveRequest(page,kind,'fixture',{[state]:true,[countKey]:7});
      await page.waitForFunction(name=>document.querySelector(`button[aria-label="${name}"]`).getAttribute('aria-pressed')==='true',name);
      assert.match(await button.textContent(),/7/);
    }
    await page.evaluate(()=>window.fixtureReplacePost(current=>({...current,liked:false,bookmarked:false,reposted:false,like_count:2,bookmark_count:1,repost_count:3})));
    await page.waitForFunction(()=>document.querySelector('button[aria-label="Like"]').getAttribute('aria-pressed')==='false');
    assert.match(await page.getByRole('button',{name:'Like',exact:true}).textContent(),/2/);
    for(const name of ['Bookmark','Repost'])assert.equal(await page.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'false');
  }finally{if(browser)await browser.close();await app.close();}
});
