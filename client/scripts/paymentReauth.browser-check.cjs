const test=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const{build}=require('esbuild');const{chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const catalogs=Object.fromEntries(['en','ar'].map(lang=>[lang,{translation:JSON.parse(fs.readFileSync(path.join(root,`src/locales/${lang}.json`)))}]));
// Change-order re-authorization banner: card (with SCA via confirmCardPayment
// on the helper's connected account), decline, helper waiting view, Credit,
// no request for unflagged jobs, and RTL.
test('payment re-authorization banner: card, decline, credit, helper view, and RTL', {timeout:120_000},async()=>{
  const mocks={
    '../api/axios':`const reply=(r)=>{if(r&&r.error){const e=new Error('x');e.response={status:r.error.status,data:r.error.data};throw e;}return {data:r};};
      export default {get:async(path)=>{window.calls.push({method:'get',path});return reply(window.fx.states.length>1?window.fx.states.shift():window.fx.states[0]);},
        post:async(path,body,options={})=>{window.calls.push({method:'post',path,body,headers:options.headers||{}});
          if(/\\/confirm$/.test(path))return reply(window.fx.confirm);return reply(window.fx.start);}};`,
    '@stripe/stripe-js':`export const loadStripe=async(key,options)=>{window.loadStripeArgs={key,options};return window.fakeStripe;};`,
    '@stripe/react-stripe-js':`import React from 'react';const Ctx=React.createContext(null);
      export function Elements({stripe,children}){const[s,setS]=React.useState(null);React.useEffect(()=>{Promise.resolve(stripe).then(setS);},[stripe]);return <Ctx.Provider value={s}>{children}</Ctx.Provider>;}
      export const useStripe=()=>React.useContext(Ctx);export const useElements=()=>({getElement:()=>({card:true})});
      export function CardElement(){return <input aria-label="card number" defaultValue="4242 4242 4242 4242"/>;}`,
  };
  const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import{createInstance}from'i18next';import{I18nextProvider}from'react-i18next';import Banner from './src/components/PaymentReauthorizationBanner.jsx';
    const i18n=createInstance();await i18n.init({lng:'en',fallbackLng:'en',resources:${JSON.stringify(catalogs)},interpolation:{escapeValue:false}});
    window.calls=[];window.resolved=0;
    window.fakeStripe={confirmCardPayment:async(secret,data)=>{window.confirmArgs={secret,data};return window.fx.confirmCard||{paymentIntent:{status:'requires_capture'}};}};
    function Harness(){const[cfg,setCfg]=React.useState(null);window.configure=async(fx)=>{window.fx=fx;window.calls=[];await i18n.changeLanguage(fx.language||'en');document.documentElement.dir=fx.language==='ar'?'rtl':'ltr';setCfg({...fx,n:(cfg?.n||0)+Math.random()});await new Promise(requestAnimationFrame);};
      if(!cfg)return null;return <main style={{padding:'8px'}}><Banner key={cfg.n} jobId="job-1" job={cfg.job} alwaysCheck={cfg.alwaysCheck} onResolved={()=>{window.resolved+=1;}}/></main>;}
    createRoot(document.getElementById('root')).render(<BrowserRouter><I18nextProvider i18n={i18n}><Harness/></I18nextProvider></BrowserRouter>);`,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'esm',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':'{}'},plugins:[{name:'reauth-fixture',setup(plugin){plugin.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:root}));}}]});
  const css='*{box-sizing:border-box}body{margin:0;font-family:sans-serif}'+fs.readFileSync(path.join(root,'src/components/PaymentReauthorizationBanner.css'),'utf8');
  const server=http.createServer((req,res)=>{
    if(req.url==='/app.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].contents);}
    else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);}
    else res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  const flagged={metadata:{paymentAdjustmentRequired:'reauthorization_required'}};
  const cardState={required:true,can_authorize:true,requirement:{card:'reauthorization_required',authorized_cents:18000,increase_cents:2500,target_cents:20500},latest_attempt:null};
  const started={status:'requires_confirmation',client_secret:'pi_new_secret',payment_intent_id:'pi_new',stripe_account_id:'acct_helper',publishable_key:'pk_test_x',attempt:{id:'3',amount_cents:20500,status:'pending'}};
  try{
    browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage();page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});
    await page.goto(`http://127.0.0.1:${server.address().port}/`,{timeout:60_000});await page.waitForFunction(()=>window.configure,null,{timeout:60_000});
    const configure=fx=>page.evaluate(f=>window.configure(f),fx);
    const calls=()=>page.evaluate(()=>window.calls);

    // 1. Card: authorize → Stripe Elements on the connected account → confirm → resolved.
    await configure({job:flagged,states:[cardState,{required:false}],start:started,confirm:{status:'authorized',attempt:{id:'3',status:'authorized'}}});
    const banner=page.getByTestId('payment-reauth-banner');
    await banner.getByRole('heading',{name:'Authorize the new price'}).waitFor();
    await banner.getByText('raised the job price to $205.00. You have authorized $180.00.',{exact:false}).waitFor();
    await banner.getByRole('button',{name:'Authorize $205.00'}).click();
    await banner.getByRole('button',{name:'Confirm $205.00'}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.loadStripeArgs),{key:'pk_test_x',options:{stripeAccount:'acct_helper'}});
    await banner.getByRole('button',{name:'Confirm $205.00'}).click();
    await banner.waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>window.confirmArgs.secret),'pi_new_secret');
    const c1=await calls();
    assert.deepEqual(c1.filter(c=>c.method==='post').map(c=>c.path),['/jobs/job-1/payment-reauthorization','/jobs/job-1/payment-reauthorization/3/confirm']);
    assert.equal(c1[1].body.method,'card');assert.ok(c1[1].headers['Idempotency-Key']);
    assert.equal(await page.evaluate(()=>window.resolved),1);

    // 2. Decline: the card error is shown and the form stays for another card.
    await configure({job:flagged,states:[cardState],start:started,confirm:{status:'declined',attempt:{id:'3',status:'pending',failure_code:'card_declined'}},confirmCard:{error:{message:'Your card has insufficient funds.'}}});
    await banner.getByRole('button',{name:'Authorize $205.00'}).click();
    await banner.getByRole('button',{name:'Confirm $205.00'}).click();
    await banner.getByRole('alert').filter({hasText:'Your card has insufficient funds.'}).waitFor();
    assert.equal(await banner.getByRole('button',{name:'Confirm $205.00'}).isEnabled(),true);

    // 3. A previous decline is surfaced when the customer comes back.
    await configure({job:flagged,states:[{...cardState,latest_attempt:{id:'3',status:'pending',failure_code:'card_declined',expires_at:'2030-01-02T15:00:00Z'}}]});
    await banner.getByText('Your last card was declined. Try another card.').waitFor();
    await banner.getByText('Finish by',{exact:false}).waitFor();

    // 4. Helper: waiting message, no payment actions.
    await configure({job:flagged,states:[{required:true,can_authorize:false,requirement:{card:'reauthorization_required'}}]});
    await banner.getByRole('heading',{name:'Waiting for the customer'}).waitFor();
    assert.equal(await banner.getByRole('button').count(),0);

    // 5. Credit: insufficient Credit explains what to do and links to add Credit.
    await configure({job:{metadata:{creditAdjustmentRequired:true}},states:[{required:true,can_authorize:true,requirement:{credit:true,credit_amount_cents:20500}}],start:{error:{status:409,data:{code:'credit_insufficient_funds'}}}});
    await banner.getByRole('button',{name:'Hold $205.00 of Credit'}).click();
    await banner.getByText('You don’t have enough OxSteed Credit yet.',{exact:false}).waitFor();
    assert.equal(await banner.getByRole('link',{name:'Add Credit'}).getAttribute('href'),'/wallet');
    assert.equal((await calls()).find(c=>c.method==='post').body.method,'credit');

    // 6. Unflagged job: no request at all.
    await configure({job:{metadata:{}},states:[cardState]});
    await page.waitForTimeout(150);
    assert.equal((await calls()).length,0);
    assert.equal(await banner.count(),0);

    // 7. Arabic: right-to-left, localized, no horizontal overflow, 44px targets.
    for(const width of [320,768,1360]){
      await page.setViewportSize({width,height:800});
      await configure({language:'ar',job:flagged,states:[cardState]});
      await banner.getByRole('heading',{name:'وافق على السعر الجديد'}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.dir),'rtl');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow ar ${width}`);
      const h=await banner.getByRole('button').first().evaluate(b=>b.getBoundingClientRect().height);
      assert.ok(h>=44,`touch target ${h}`);
    }
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();server.close();}
});
