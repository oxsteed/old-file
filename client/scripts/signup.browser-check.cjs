// Synthetic services only. Real JoinPage, input components and Media dialog.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const screenshots = fs.mkdtempSync('/tmp/oxsteed-signup-design-');
async function fixture() {
  const mocks = {
    'react-i18next': `export const useTranslation = () => ({ t:window.translate, i18n:{language:window.language} });`,
    '../context/AuthContext': `export const useAuth=()=>({user:null,setUser:user=>{window.registeredUser=user;}});`,
    '../hooks/useAuth': `export {useAuth} from '../context/AuthContext';`,
    '../api/auth': `export const persistSessionPayload=()=>{};`,
    '../components/PageMeta': `export default ()=>null;`,
    '../components/Footer': `import React from 'react';export default ()=> <footer data-footer>© OxSteed</footer>;`,
    './Navbar': `export {OxSteedIcon} from '${root}/src/components/OxSteedIcon.jsx';`,
    '../context/LanguageContext': `export const useLanguage=()=>({language:window.language,setLanguage:()=>{},availableLanguages:[{code:window.language,name:window.language,nativeName:window.language}]});`,
    '../context/ThemeContext': `export const useTheme=()=>({isDark:document.documentElement.classList.contains('dark'),toggleTheme:()=>document.documentElement.classList.toggle('dark')});`,
    '../api/geo': `export const suggestLocation=async()=>[];`,
    '../api/axios': `export default {post:async(url,payload)=>{
      window.calls.push({url,payload}); await new Promise(r=>setTimeout(r,100));
      const mode=window.failure;
      if(mode==='network')throw new Error('Synthetic offline');
      if(mode==='duplicate'&&url.endsWith('/start'))throw {response:{status:409,data:{error:'Email already registered'}}};
      if(mode==='fields'&&url.endsWith('/start'))throw {response:{status:400,data:{fields:{phone:'Opaque server message'}}}};
      if(mode==='unknown'&&url.endsWith('/start'))throw {response:{status:400,data:{fields:{internal:'Unsafe internal details'}}}};
      if(mode==='cooldown'&&url.endsWith('/resend-otp'))throw {response:{status:429,data:{code:'resend_cooldown',retryAfterMs:60000,error:'Please wait'}}};
      const expiry=new Date(Date.now()+1800000).toISOString();
      if(url.endsWith('/start'))return {data:{token:'synthetic-token',registrationExpiresAt:expiry}};
      if(url.endsWith('/accept-terms')||url.endsWith('/resend-otp'))return {data:{registrationExpiresAt:expiry,otpExpiresAt:new Date(Date.now()+900000).toISOString(),resendAvailableAt:new Date(Date.now()+60000).toISOString()}};
      if(url.endsWith('/verify-otp')){
        const code=mode==='locked'?'otp_locked':mode==='expired'?'registration_expired':mode==='otpExpired'?'otp_expired':'otp_invalid';
        if(mode!=='success')throw {response:{status:mode==='locked'?429:mode==='expired'?404:400,data:{code,error:'Synthetic verification failure',...(mode==='locked'?{lockoutUntil:new Date(Date.now()+3600000).toISOString(),retryAfterMs:3600000}:{})}}};
        return {data:{user:{id:'synthetic',email_verified:true,default_mode:window.calls.find(c=>c.url.endsWith('/start'))?.payload.defaultMode||'customer'}}};
      }
      return {data:{}};
    }};`,
  };
  const bundle = await build({ stdin:{resolveDir:root,loader:'jsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,useLocation} from 'react-router-dom';
    import Join from './src/pages/JoinPage.jsx';import Modal from './src/pages/media/MediaLinkModal.jsx';import './src/pages/media/MediaStyles.css';
    function Harness(){const location=useLocation();const [open,setOpen]=React.useState(false);return <><output data-route>{location.pathname}</output>
      {window.embedded?<><button id="trigger" onClick={()=>setOpen(true)}>Open signup</button>{open&&<Modal url={'/join'+location.search} onClose={()=>setOpen(false)}/>}</>:<Join/>}</>}
    createRoot(document.getElementById('root')).render(<BrowserRouter><Harness/></BrowserRouter>);`},
    bundle:true,write:false,outfile:'app.js',jsx:'automatic',define:{'import.meta.env':'{}'},
    plugins:[{name:'signup-fixture',setup(plugin){plugin.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);
      plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:root}));}}] });
  const server=http.createServer((req,res)=>{
    if(req.url==='/app.js'||req.url==='/app.css'){res.setHeader('Content-Type',req.url.endsWith('css')?'text/css':'text/javascript');res.end(bundle.outputFiles.find(f=>f.path.endsWith(req.url.endsWith('css')?'.css':'.js')).contents);return;}
    if(req.url==='/production.css'){
      const dir=path.join(root,'dist/assets');const files=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>f.endsWith('.css')):[];
      const largest=files.sort((a,b)=>fs.statSync(path.join(dir,b)).size-fs.statSync(path.join(dir,a)).size)[0];
      res.setHeader('Content-Type','text/css');res.end(largest?fs.readFileSync(path.join(dir,largest)): '');return;
    }
    const params=new URL(req.url,'http://fixture').searchParams,lang=params.get('lang')||'en';
    const catalog=JSON.parse(fs.readFileSync(path.join(root,'src/locales',lang+'.json')));
    const common=JSON.parse(fs.readFileSync(path.join(root,'src/i18n/locales',lang,'common.json')));
    res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"frame-src https://js.stripe.com; frame-ancestors 'self'");
    res.end(`<html lang="${lang}" dir="${lang==='ar'?'rtl':'ltr'}" class="${params.has('dark')?'dark':'light'}" data-theme="${params.has('dark')?'dark':'light'}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/production.css"><link rel="stylesheet" href="/app.css"><style>
      *{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}button,input,select{font:inherit}output{display:none}fieldset{min-width:0}
      :root{--color-surface:white;--color-text:#10182d;--color-text-muted:#526075;--color-border:#d8d4ce;--color-primary:#c2410c;--color-nav-bg:white;--color-nav-border:#d8d4ce}
      .dark{--color-surface:#131d30;--color-text:#f4f6fa;--color-text-muted:#b4bed0;--color-border:#42506a;--color-nav-bg:#131d30}
      nav>div{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;padding:16px;gap:10px}nav a{display:inline-flex;align-items:center;gap:8px;color:var(--color-text);text-decoration:none}nav>div>div{display:flex;gap:10px;align-items:center}nav button{min-height:44px}
      [data-footer]{padding:24px;text-align:center;color:var(--color-text-muted)}
    </style></head><body><div id="root"></div><script>
      window.embedded=${params.has('embedded')};window.calls=[];window.language=${JSON.stringify(lang)};window.failure='';
      window.catalog=${JSON.stringify(catalog).replace(/</g,'\\u003c')};window.common=${JSON.stringify(common).replace(/</g,'\\u003c')};
      window.translate=(key,options={})=>{const read=c=>key.split('.').reduce((v,k)=>v?.[k],c);const value=read(window.catalog)??read(window.common);return(typeof value==='string'?value:options.defaultValue||key).replace(/\\{\\{(\\w+)\\}\\}/g,(_,k)=>String(options[k]??''));};
    </script><script src="/app.js"></script></body></html>`);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>server.close(r))};
}
async function open(page,url,embedded=false){await page.goto(url);if(embedded)await page.locator('#trigger').click();await page.locator('#email').waitFor();}
async function fill(page){for(const [id,value] of Object.entries({firstName:'Synthetic',lastName:'Person',email:'synthetic@example.test',phone:'9375550100',addressLine1:'123 Test Street',city:'Springfield',zipCode:'45502',password:'Synthetic1'}))await page.locator('#'+id).fill(value);
  await page.locator('#country').selectOption('US');await page.locator('#state').selectOption('OH');await page.locator('#zipCode').fill('45502');await page.locator('#ageConfirmed').check();await page.locator('#termsAccepted').check();}
async function submit(page){await page.locator('button[type="submit"]').click();await page.locator('[autocomplete="one-time-code"]').waitFor();}

test('standalone and native modal layouts, light/dark, RTL, zoom and focus',async()=>{
  const app=await fixture();const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    for(const embedded of [false,true])for(const width of [320,390,768,1366])for(const dark of [false,true]){
      const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await open(page,`${app.url}/join?${embedded?'embedded&':''}${dark?'dark&':''}`,embedded);
      assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.locator('.signup-intro').count(),embedded?0:1);
      assert.equal(await page.locator('.signup-page nav').count(),embedded?0:1);
      assert.equal(await page.locator('#ageConfirmed').isChecked(),false);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${embedded}/${width}/${dark}`);
      assert.equal(await page.locator('label[for="password"]').count(),1);
      assert.equal(await page.locator('input[type="radio"]').count(),3);
      const font=await page.locator('#email').evaluate(el=>getComputedStyle(el).fontSize);assert.equal(font,'16px');
      if(width===390||width===1366)await page.screenshot({path:path.join(screenshots,`${embedded?'modal':'standalone'}-${width}-${dark?'dark':'light'}.png`),fullPage:true,animations:'disabled'});
      if(embedded){await page.locator('#firstName').focus();await page.keyboard.press('Escape');await page.locator('[role="dialog"]').waitFor({state:'hidden'});assert.equal(await page.locator('#trigger').evaluate(el=>el===document.activeElement),true);}
      assert.deepEqual(errors,[]);await page.close();
    }
    for(const embedded of [false,true]){
      const page=await browser.newPage({viewport:{width:390,height:900}});await open(page,`${app.url}/join?lang=ar&${embedded?'embedded':''}`,embedded);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'RTL overflow');
      await page.screenshot({path:path.join(screenshots,`${embedded?'modal':'standalone'}-arabic.png`),fullPage:true,animations:'disabled'});await page.close();
      const zoom=await browser.newPage({viewport:{width:683,height:450}}); // 1366x900 at 200% layout zoom
      await open(zoom,`${app.url}/join?${embedded?'embedded':''}`,embedded);assert.equal(await zoom.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'200% equivalent layout overflow');await zoom.close();
    }
    console.log('Signup screenshot evidence: '+screenshots);
  }finally{await browser.close();await app.close();}
});
test('age, drafts, errors, modes, referrals, OTP paste, routing and edit/restart',async()=>{
  const app=await fixture();const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    for(const mode of ['customer','helper','business_owner']){
      const page=await browser.newPage();await open(page,`${app.url}/join?mode=${mode}&ref=REFTEST`);
      assert.equal(await page.locator(`input[value="${mode}"]`).isChecked(),true);
      await fill(page);await page.locator('#ageConfirmed').uncheck();await page.locator('button[type="submit"]').click();
      assert.equal(await page.locator('#ageConfirmed').evaluate(el=>el===document.activeElement),true);
      assert.equal(await page.evaluate(()=>window.calls.length),0);
      await page.locator('#ageConfirmed').check();await submit(page);
      const payload=await page.evaluate(()=>window.calls[0].payload);assert.equal(payload.defaultMode,mode);assert.equal(payload.ref,'REFTEST');assert.equal(payload.ageConfirmed,true);
      const draft=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('oxsteed:join-draft:v1')));assert.equal(draft.form.password,undefined);assert.ok(draft.metadata.resendAvailableAt);
      assert.equal(await page.locator('.signup-secondary').isDisabled(),true);
      // Clipboard paste submits once even when another input event follows.
      await page.locator('[autocomplete="one-time-code"]').evaluate(el=>{const data=new DataTransfer();data.setData('text','000 000');el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true}));});
      await page.locator('#signup-otp-error').waitFor();assert.match(await page.locator('#signup-otp-error').textContent(),/incorrect|code/i);
      assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.url.endsWith('/verify-otp')).length),1);
      await page.reload();await page.locator('[autocomplete="one-time-code"]').waitFor();assert.match(await page.locator('.signup-secondary').textContent(),/\d/);
      await page.evaluate(()=>window.failure='expired');await page.locator('[autocomplete="one-time-code"]').fill('123456');await page.locator('#signup-otp-error').waitFor();
      await page.locator('.signup-verification .signup-primary').click();await page.locator('#email').waitFor();
      assert.equal(await page.locator('#email').inputValue(),'synthetic@example.test');assert.equal(await page.locator('#password').inputValue(),'');assert.equal(await page.locator('#ageConfirmed').isChecked(),false);
      await page.locator('#password').fill('Synthetic1');await page.locator('#ageConfirmed').check();await page.evaluate(()=>window.failure='success');await submit(page);await page.locator('[autocomplete="one-time-code"]').fill('123456');
      await page.waitForFunction(expected=>document.querySelector('[data-route]').textContent===expected,mode==='helper'?'/verify-identity':'/dashboard');
      assert.equal(await page.evaluate(()=>sessionStorage.getItem('oxsteed:join-draft:v1')),null);await page.close();
    }
    for(const failure of ['duplicate','fields','unknown','network']){
      const page=await browser.newPage();await open(page,app.url+'/join');await fill(page);await page.evaluate(f=>window.failure=f,failure);await page.locator('button[type="submit"]').click();await page.locator('.signup-error-summary').waitFor();
      assert.equal(await page.locator('#firstName').inputValue(),'Synthetic');if(failure==='duplicate')assert.equal(await page.locator('.signup-error-summary a[href="/login"]').count(),1);
      if(failure==='fields')assert.equal(await page.locator('#phone').evaluate(el=>el===document.activeElement),true);await page.close();
    }
    for(const failure of ['locked','otpExpired','network']){
      const page=await browser.newPage();await open(page,app.url+'/join');await fill(page);await submit(page);await page.evaluate(f=>window.failure=f,failure);await page.locator('[autocomplete="one-time-code"]').fill('123456');await page.locator('#signup-otp-error').waitFor();
      if(failure==='locked'){assert.equal(await page.locator('[autocomplete="one-time-code"]').isDisabled(),true);await page.reload();await page.locator('[autocomplete="one-time-code"]').waitFor();assert.equal(await page.locator('[autocomplete="one-time-code"]').isDisabled(),true);}
      else{await page.locator('.signup-text-button').click();await page.locator('#email').waitFor();assert.equal(await page.locator('#ageConfirmed').isChecked(),true);assert.equal(await page.locator('#password').inputValue(),'Synthetic1');}await page.close();
    }
  }finally{await browser.close();await app.close();}
});
test('legacy drafts restore without passwords/implicit age and resend stays single-flight',async()=>{
  const app=await fixture();const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();await open(page,app.url+'/join');await fill(page);
    await page.evaluate(()=>{const key='oxsteed:join-draft:v1';const draft=JSON.parse(sessionStorage.getItem(key));delete draft.form.ageConfirmed;draft.form.password='NeverRestore1';sessionStorage.setItem(key,JSON.stringify(draft));});
    await page.reload();await page.locator('#email').waitFor();assert.equal(await page.locator('#password').inputValue(),'');assert.equal(await page.locator('#ageConfirmed').isChecked(),false);
    assert.equal(await page.locator('#email').inputValue(),'synthetic@example.test');
    await page.locator('#password').fill('Synthetic1');await page.locator('#ageConfirmed').check();
    await page.clock.install();await submit(page);await page.clock.fastForward(61000);
    assert.equal(await page.locator('.signup-secondary').isDisabled(),false);
    await page.locator('.signup-secondary').evaluate(el=>{el.click();el.click();});
    await page.clock.runFor(200);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.url.endsWith('/resend-otp')).length),1);
    assert.equal(await page.locator('.signup-secondary').isDisabled(),true);
    await page.clock.fastForward(61000);await page.evaluate(()=>window.failure='cooldown');await page.locator('.signup-secondary').click();await page.clock.runFor(200);
    await page.locator('#signup-otp-error').waitFor();assert.equal(await page.locator('.signup-secondary').isDisabled(),true);
    await page.close();
  }finally{await browser.close();await app.close();}
});
