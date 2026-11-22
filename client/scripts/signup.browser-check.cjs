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
    'react-i18next': `export const useTranslation = () => ({ t:window.translate, i18n:{language:window.language} }); export const Trans = ({children}) => children; export const initReactI18next = { type: '3rdParty', init: () => {} };`,
    '../context/AuthContext': `import React from 'react'; export const AuthContext = React.createContext(null); export const useAuth=()=>({user:window.signedIn?{id:"existing",email_verified:true}:null,setUser:user=>{window.registeredUser=user;}});`,
    '../hooks/useAuth': `export {useAuth} from '../context/AuthContext'; import {useAuth as ua} from '../context/AuthContext'; export default ua;`,
    'unused-modal-page': `export default ()=>null;`,
    '../api/businesses': `export const listMyInvitations=async()=>window.missingInvite?[]:[{id:'invite-123',business_name:'Synthetic team',role:'employee'}];
      export const acceptInvitation=async(id)=>{window.calls.push({url:'accept-invitation',id});};
      export const declineInvitation=async(id)=>{window.calls.push({url:'decline-invitation',id});};`,
    '../api/auth': `export const persistSessionPayload=()=>{}; export const authAPI = { post: async () => ({}) }; export const clearStoredSession = () => {}; export default { get: async () => ({ data: {} }), post: async () => ({ data: {} }), put: async () => ({ data: {} }) };`,
    '../components/PageMeta': `export default ()=>null;`,
    '../components/Footer': `import React from 'react';export default ()=> <footer data-footer>© OxSteed</footer>;`,
    './Navbar': `import React from 'react'; export {OxSteedIcon} from '${root}/src/components/OxSteedIcon.jsx'; export default () => <nav>Mock Navbar</nav>;`,
    '../context/LanguageContext': `export const useLanguage=()=>({language:window.language,setLanguage:()=>{},availableLanguages:[{code:window.language,name:window.language,nativeName:window.language}]});`,
    '../context/ThemeContext': `export const useTheme=()=>({isDark:document.documentElement.classList.contains('dark'),toggleTheme:()=>document.documentElement.classList.toggle('dark')});`,
    '../api/geo': `export const suggestLocation=async()=>[];`,
    '../api/axios': `export default {
    get: async () => ({ data: { capabilities: { customerFirstSignup: { available: window.customerFirst } } } }),
    post:async(url,payload)=>{
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
        const start=window.calls.find(c=>c.url.endsWith('/start'))?.payload;
        const capability={offer_services:'helper.offer_services',run_business:'business.own',run_restaurant:'restaurant.own',ship_goods:'logistics.ship',consult:'consultant.accept_paying_clients',list_equipment:'tool_owner.list_equipment',request_reporting:'investor.reporting'}[start?.signupIntent];
        const admission={join_business_team:'organization_invitation',join_restaurant_team:'organization_invitation',franchise:'domain_enrollment',join_credit:'domain_enrollment',join_partner:'domain_enrollment',join_workforce:'domain_enrollment',request_reviewer:'staff_provisioning',request_support:'staff_provisioning',request_operations:'staff_provisioning',request_device:'nonhuman_provisioning'}[start?.signupIntent];
        const statusPath={join_business_team:'/vortex',join_restaurant_team:'/vortex',join_credit:'/credit/apply'}[start?.signupIntent] || '/settings/applications';
        const access=start?.signupIntent&&start.signupIntent!=='find_help'?{nextStep:capability?{type:'application',intent:start.signupIntent,capability,requestId:window.missingApplication?null:'application-1'}:{type:'none',intent:start.signupIntent,kind:admission,statusPath}}:undefined;
        return {data:{user:{id:'synthetic',email_verified:true,role:'customer',default_mode:'customer'},access}};
      }
      return {data:{}};
    }};`,
    '../../api/access': `
      const area={ name:'serviceArea',type:'service_area',required:true };
      const helperFields=[{ name:'serviceCategories',type:'string_list',required:true },area];
      const businessFields=[{ name:'businessName',type:'string',required:true },{ name:'businessType',type:'enum',options:['llc'],required:true },area];
      let capability;
      let application={ id:'application-1',status:'draft',version:1,answers:{} };
      export const accessAPI={
        getPolicy: async (requested) => {
          capability=requested;
          if (window.failApplication) throw new Error('Synthetic application unavailable');
          const helper=requested==='helper.offer_services';
          return {policy:{subjectTypes:[helper?'self':'business_proposal'],form:{fields:helper?helperFields:businessFields}}};
        },
        getRequest: async () => ({request:{...application,capability}}),
        createRequest: async (body,key) => {
          window.calls.push({url:'create-application',body,key});
          return {request:{...application,capability}};
        },
        updateRequest: async () => ({request:{...application,capability}}),
        transition: async (id,action,body) => {
          window.calls.push({url:action,id,body});
          application={...application,status:'submitted',version:2,answers:body.answers};
          return {request:{...application,capability}};
        },
      };
    `,
  };
  const bundle = await build({ stdin:{resolveDir:root,loader:'jsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,useLocation} from 'react-router-dom';
    import Join from './src/pages/JoinPage.jsx';import Modal from './src/pages/media/MediaLinkModal.jsx';import './src/pages/media/MediaStyles.css';
    function Harness(){const location=useLocation();const [open,setOpen]=React.useState(false);return <><output data-route>{location.pathname}</output>
      {window.embedded?<><button id="trigger" onClick={()=>setOpen(true)}>Open signup</button>{open&&<Modal url={'/join'+location.search} onClose={()=>setOpen(false)}/>}</>:<Join/>}</>}
    createRoot(document.getElementById('root')).render(<BrowserRouter><Harness/></BrowserRouter>);`},
    bundle:true,write:false,outfile:'app.js',jsx:'automatic',define:{'import.meta.env':'{}'},
    plugins:[{name:'signup-fixture',setup(plugin){plugin.onResolve({filter:/.*/},args=>{
        if(args.importer.endsWith('/media/MediaLinkModal.jsx')&&['../Login','../ForgotPassword','../PublicProfile','../SmartDashboard','../SettingsPage','../Settings/Notifications','../SupportEscalationPage','../DiscoverPage'].includes(args.path))return {path:'unused-modal-page',namespace:'fixture'};
        if(args.path==='../api/businesses'&&!args.importer.endsWith('/pages/JoinPage.jsx'))return undefined;
        return mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined;});
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
      window.signedIn=${params.has('signedIn')};window.missingInvite=${params.has('missingInvite')};window.embedded=${params.has('embedded')};window.customerFirst=${params.has('customerFirst')};window.missingApplication=${params.has('missingApplication')};window.calls=[];window.language=${JSON.stringify(lang)};window.failure='';
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

test('customer-first signup presents goals and gathers approval details in the same flow', { timeout: 90_000 }, async () => {
  const app = await fixture();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [goal, intent] of [['customer', 'find_help'], ['helper', 'offer_services'], ['business_owner', 'run_business']]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const owner = goal === 'business_owner';
      await open(page, `${app.url}/join?customerFirst${owner ? '&missingApplication' : ''}`);
      const choices = page.locator('.signup-mode-section');
      await choices.getByText('Offer services', { exact: true }).waitFor();
      assert.ok(await choices.getByText('Run a business', { exact: true }).isVisible());
      assert.match(await choices.innerText(), /Everyone starts with customer access/);
      assert.doesNotMatch(await choices.innerText(), /mode|switcher/i);
      // WP-104: no ?mode= preset. The intent cards are the choice; the
      // customer intent is selected by default and the other cards are
      // picked on the page.
      if (goal !== 'customer') await choices.getByText(goal === 'helper' ? 'Offer services' : 'Run a business', { exact: true }).click();
      assert.equal(await choices.locator(`input[value="${intent}"]`).isChecked(), true);
      await fill(page);
      await submit(page);
      await page.evaluate((unavailable) => { window.failure = 'success'; window.failApplication = unavailable; }, owner);
      await page.locator('[autocomplete="one-time-code"]').fill('123456');
      await page.waitForFunction(() => Boolean(window.registeredUser));
      assert.deepEqual(await page.evaluate(() => [window.registeredUser.role, window.registeredUser.default_mode]), ['customer', 'customer']);
      const start = await page.evaluate(() => window.calls.find((entry) => entry.url.endsWith('/start')).payload);
      assert.equal(start.signupIntent, intent);
      assert.equal(Object.hasOwn(start, 'defaultMode'), false);
      if (goal === 'customer') {
        await page.waitForURL('**/dashboard');
      } else {
        if (owner) {
          await page.getByRole('alert').filter({ hasText: 'couldn’t load the application' }).waitFor();
          assert.equal(await page.getByRole('link', { name: 'Finish later' }).getAttribute('href'), '/dashboard');
          await page.evaluate(() => { window.failApplication = false; });
          await page.getByRole('button', { name: 'Try again', exact: true }).click();
          await page.getByLabel('Business name').fill('Synthetic Repair');
          await page.getByLabel('Business type').selectOption('llc');
          const creation = await page.evaluate(() => window.calls.find((entry) => entry.url === 'create-application'));
          assert.equal(creation.key, 'signup-synthetic');
          assert.equal(creation.body.subject.type, 'business_proposal');
        } else {
          await page.getByLabel('Services you offer').fill('Plumbing, carpentry');
        }
        assert.equal(new URL(page.url()).pathname, '/join');
        assert.equal(await page.getByRole('link', { name: 'Sign In', exact: true }).count(), 0);
        assert.equal(await page.locator('#req-application-1-serviceArea-city').inputValue(), 'Springfield');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.getByRole('button', { name: 'Submit application' }).click();
        await page.getByRole('status').filter({ hasText: 'Application status: Submitted' }).waitFor();
        const answers = await page.evaluate(() => window.calls.find((entry) => entry.url === 'submit').body.answers);
        assert.deepEqual(answers.serviceArea, { country: 'US', region: 'OH', city: 'Springfield', postalCode: '45502' });
        if (owner) assert.equal(answers.businessName, 'Synthetic Repair');
        else assert.deepEqual(answers.serviceCategories, ['Plumbing', 'carpentry']);
        await page.getByRole('link', { name: 'Go to my account' }).click();
        await page.waitForURL('**/dashboard');
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await app.close();
  }
});

test('non-application personas receive a safe admission handoff after verification', async () => {
  const app = await fixture();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [choice, destination, admission] of [
      ['Join a business team', '/vortex', /invitation|membership/i],
      ['Work at a restaurant', '/vortex', /invitation|membership/i],
      ['Participate in OxSteed Credit', '/credit/apply', /owning program/i],
    ]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await open(page, `${app.url}/join?customerFirst`);
      await page.getByText('More ways to use OxSteed', { exact: true }).click();
      await page.getByText(choice, { exact: true }).click();
      await fill(page); await submit(page);
      await page.evaluate(() => { window.failure = 'success'; });
      await page.locator('[autocomplete="one-time-code"]').fill('123456');
      await page.getByRole('heading', { name: 'Your account is ready for this path' }).waitFor();
      assert.equal(await page.evaluate(() => window.registeredUser.role), 'customer');
      assert.match(await page.locator('.signup-intent-confirmation').innerText(), admission);
      await page.getByRole('link', { name: 'View next step' }).click();
      await page.waitForURL(`**${destination}`);
      await page.close();
    }
  } finally { await browser.close(); await app.close(); }
});

test('standalone and native modal layouts, light/dark, RTL, zoom and focus',async()=>{
  const app=await fixture();const browser=await chromium.launch({channel: 'chrome',headless:true});
  try{
    for(const embedded of [false,true])for(const width of [320,390,768,1366])for(const dark of [false,true]){
      const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await open(page,`${app.url}/join?${embedded?'embedded&':''}${dark?'dark&':''}`,embedded);
      assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.locator('.signup-intro').count(),embedded?0:1);
      assert.equal(await page.locator('.signup-page nav').count(),embedded?0:1);
      assert.equal(await page.locator('#ageConfirmed').isChecked(),false);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${embedded}/${width}/${dark}`);
      assert.equal(await page.locator('label[for="password"]').count(),1);
      // Investor reporting is private and invite-only, so the public picker
      // contains the remaining 17 catalog paths only.
      assert.equal(await page.locator('input[type="radio"]').count(),17);
      assert.equal(await page.locator('.signup-common-goals input').count(),3);
      assert.equal(await page.locator('.signup-more-goals').getAttribute('open'),null);
      assert.equal(await page.locator('input[type=radio]:visible').count(),3);
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
test('age, drafts, errors, intents, referrals, OTP paste, routing and edit/restart',async()=>{
  const app=await fixture();const browser=await chromium.launch({channel: 'chrome',headless:true});
  try{
    for(const mode of ['customer','helper','business_owner']){
      const page=await browser.newPage();await open(page,`${app.url}/join?customerFirst&ref=REFTEST`);
      const intent={customer:'find_help',helper:'offer_services',business_owner:'run_business'}[mode];
      // WP-104: no ?mode= preset; the intent is picked on the cards.
      if(mode!=='customer')await page.getByText(mode==='helper'?'Offer services':'Run a business',{exact:true}).click();
      assert.equal(await page.locator(`input[value="${intent}"]`).isChecked(),true);
      await fill(page);await page.locator('#ageConfirmed').uncheck();await page.locator('button[type="submit"]').click();
      assert.equal(await page.locator('#ageConfirmed').evaluate(el=>el===document.activeElement),true);
      assert.equal(await page.evaluate(()=>window.calls.length),0);
      await page.locator('#ageConfirmed').check();await submit(page);
      const payload=await page.evaluate(()=>window.calls[0].payload);assert.equal(payload.signupIntent,{customer:'find_help',helper:'offer_services',business_owner:'run_business'}[mode]);assert.equal(Object.hasOwn(payload,'defaultMode'),false);assert.equal(payload.ref,'REFTEST');assert.equal(payload.ageConfirmed,true);
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
      // Helper/business intents stay on /join (application panel), so the
      // route wait below resolves immediately and cannot prove the OTP
      // verification finished. Wait for the registered user first: the
      // mock sets it after the draft is removed in handleOtpComplete.
      await page.waitForFunction(() => Boolean(window.registeredUser));
      await page.waitForFunction(expected=>document.querySelector('[data-route]').textContent===expected,mode==='customer'?'/dashboard':'/join');
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
  const app=await fixture();const browser=await chromium.launch({channel: 'chrome',headless:true});
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

test('goal-first discovery keeps every catalog path and direct links skip discovery', {timeout:90_000}, async()=>{
  const app=await fixture();const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:390,height:844}});
    await open(page, app.url+'/join');
    const more=page.getByText('More ways to use OxSteed',{exact:true});
    await more.focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('input[type=radio]:visible').count(),17);
    await page.getByText('Consult for clients',{exact:true}).click();
    await page.reload();await page.locator('#email').waitFor();
    assert.equal(await page.locator('input[value=consult]').isVisible(),true,'specialized draft stays discoverable');
    assert.equal(await page.locator('input[value=consult]').isChecked(),true);
    await page.close();
    const drafted=await browser.newPage();
    await drafted.addInitScript(()=>sessionStorage.setItem('oxsteed:join-draft:v1',JSON.stringify({
      form:{signupIntent:'offer_services',email:'draft@example.test'},registrationToken:'old-pending',otpSent:true,
    })));
    await open(drafted,app.url+'/join?goal=equipment-owner');
    assert.equal(await drafted.locator('[autocomplete="one-time-code"]').count(),0,'a different goal cannot reuse the old registration');
    assert.equal(await drafted.locator('#email').inputValue(),'draft@example.test');
    await drafted.close();
    const {SIGNUP_PERSONAS}=await import('../src/utils/signupPersonas.js');
    for(const persona of SIGNUP_PERSONAS){
      const direct=await browser.newPage({viewport:{width:390,height:844}});
      await open(direct, app.url+'/join?goal='+encodeURIComponent(persona.id));
      assert.equal(await direct.locator('.signup-selected-goal').count(),1,persona.id);
      assert.equal(await direct.locator('input[type=radio]:visible').count(),0,persona.id);
      await direct.getByRole('button',{name:'Change goal',exact:true}).click();
      assert.equal(await direct.locator(`input[value="${persona.intent}"]`).isChecked(),true,persona.id);
      assert.equal(await direct.locator(`input[value="${persona.intent}"]`).isVisible(),true,persona.id);
      assert.equal(await direct.locator(`input[value="${persona.intent}"]`).evaluate(el=>el===document.activeElement),true);
      await direct.close();
    }
    for(const query of ['mode=driver','intent=consult']){
      const direct=await browser.newPage();await open(direct,app.url+'/join?'+query);
      assert.equal(await direct.locator('.signup-selected-goal').count(),1);
      await fill(direct);await submit(direct);
      assert.equal(await direct.evaluate(()=>window.calls.find(c=>c.url.endsWith('/start')).payload.signupIntent),query.includes('driver')?'ship_goods':'consult');
      await direct.close();
    }
  }finally{await browser.close();await app.close();}
});

test('invitation entry goes straight to verified acceptance without choosing a goal', async()=>{
  const app=await fixture();const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();await open(page,app.url+'/join?invite=invite-123&goal=business-owner');
    await page.getByText('Join your invited team',{exact:true}).waitFor();
    assert.equal(await page.locator('input[type=radio]').count(),0);
    await fill(page);await submit(page);
    assert.equal(await page.evaluate(()=>window.calls.find(c=>c.url.endsWith('/start')).payload.signupIntent),'join_business_team');
    await page.evaluate(()=>{window.failure='success';});await page.locator('[autocomplete="one-time-code"]').fill('123456');
    await page.getByRole('button',{name:'Accept invitation',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.url==='accept-invitation').length),1);
    assert.equal(await page.evaluate(()=>window.registeredUser.role),'customer');
    await page.close();
    const existing=await browser.newPage();await existing.goto(app.url+'/join?invite=invite-123&signedIn');
    await existing.getByRole('button',{name:'Accept invitation',exact:true}).waitFor();
    assert.equal(await existing.locator('#email').count(),0);
    await existing.close();
    const missing=await browser.newPage();await missing.goto(app.url+'/join?invite=invite-123&signedIn&missingInvite');
    await missing.locator('#signup-invite-title').waitFor();
    assert.equal(await missing.getByRole('button',{name:'Accept invitation',exact:true}).count(),0);
    assert.equal(await missing.locator('.signup-intent-confirmation a').getAttribute('href'),'/settings/applications');
    await missing.close();
  }finally{await browser.close();await app.close();}
});
