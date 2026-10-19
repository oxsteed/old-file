// Synthetic browser check: logistics checkout country-on-file prompt.
// Run: node --test scripts/logisticsCountryRequired.browser-check.cjs (needs Chrome).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {build}=require('esbuild');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const catalogs=Object.fromEntries(['en','fr','ar'].map(l=>[l,JSON.parse(fs.readFileSync(path.join(root,`src/locales/${l}.json`)))]));

test('country prompt saves via PATCH /auth/me, handles errors, holds 320px and RTL',async()=>{
  const mocks={
    'react-i18next':`export function useTranslation(){return{i18n:{language:window.lang},t:window.translate}};`,
    '../../api/axios':`export default {patch:async(url,body)=>{window.calls.push({url,body});if(window.fail)throw{response:{status:400,data:{error:'invalid_country'}}};return{data:{}};}};`,
    '../../context/AuthContext':`export const useAuth=()=>({refreshUser:async()=>{window.refreshed=(window.refreshed||0)+1;}});`,
  };
  const entry=`import React from 'react';import{createRoot}from'react-dom/client';import Panel from './src/components/logistics/CountryRequiredPanel.jsx';
window.catalogs=${JSON.stringify(catalogs)};window.lang='en';window.calls=[];window.saved=0;
window.translate=(key,o={})=>{const raw=key.split('.').reduce((a,k)=>a?.[k],window.catalogs[window.lang]);const s=typeof raw==='string'?raw:(o.defaultValue||key);return s.replace(/{{\\s*(\\w+)\\s*}}/g,(m,k)=>o[k]!=null?String(o[k]):m);};
const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<div className="lx-root"><Panel key={window.lang} onSaved={()=>{window.saved++;}}/></div>);window.render();`;
  const bundled=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'esm',loader:{'.css':'empty'},plugins:[{name:'fixtures',setup(p){p.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);p.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'jsx'}));}}]});
  const css=['src/styles/logistics/LogisticsHomePage.css','src/styles/logistics/LogisticsWorkspaces.css','src/styles/logistics/LogisticsCheckout.css'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');
  const server=http.createServer((req,res)=>{if(req.url.startsWith('/app.js')){res.setHeader('Content-Type','text/javascript');return res.end(bundled.outputFiles[0].contents);}res.end(`<style>:root{--app-bg:#fff;--card-bg:#f5f7fb;--app-text:#162033;--color-text:#162033;--muted-text:#46556b;--border-color:#cbd5e1;--color-error:#b42318}.dark{--app-bg:#111827;--card-bg:#1f2937;--app-text:#f3f5f9;--color-text:#f3f5f9;--muted-text:#bac4d4;--border-color:#455167;--color-error:#fda29b}*{box-sizing:border-box}body{margin:8px;font-family:Arial;background:var(--app-bg);color:var(--app-text)}${css}</style><div id="root"></div><script type="module" src="/app.js"></script>`);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});const ctx=await browser.newContext({locale:'en-US'});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const en=catalogs.en.logistics.checkout.countryRequired;
    await page.getByRole('heading',{name:en.title}).waitFor();
    const select=page.getByLabel(en.label,{exact:true});
    assert.equal(await select.inputValue(),'US');
    // Blank selection is rejected client-side without a request.
    await select.selectOption('');await page.getByRole('button',{name:en.save}).click();
    await page.getByRole('alert').filter({hasText:en.required}).waitFor();
    assert.equal(await page.evaluate(()=>window.calls.length),0);
    // Server error keeps the user on the prompt.
    await page.evaluate(()=>{window.fail=true;});
    await select.selectOption('HT');await page.getByRole('button',{name:en.save}).focus();await page.keyboard.press('Enter');
    await page.getByRole('alert').filter({hasText:en.error}).waitFor();
    assert.equal(await page.evaluate(()=>window.saved),0);
    // Success: PATCH with the chosen country, refresh user, reload checkout.
    await page.evaluate(()=>{window.fail=false;});
    await page.getByRole('button',{name:en.save}).click();
    await page.waitForFunction(()=>window.saved===1);
    assert.deepEqual(await page.evaluate(()=>window.calls.at(-1)),{url:'/auth/me',body:{country:'HT'}});
    assert.equal(await page.evaluate(()=>window.refreshed),1);
    const shots=path.join(os.tmpdir(),'oxsteed-logistics-country');fs.mkdirSync(shots,{recursive:true});
    for(const lang of ['en','fr','ar'])for(const dark of [false,true]){
      await page.evaluate(({lang,dark})=>{window.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';document.documentElement.lang=lang;document.documentElement.classList.toggle('dark',dark);window.render();},{lang,dark});
      await page.getByRole('heading',{name:catalogs[lang].logistics.checkout.countryRequired.title}).waitFor();
      for(const width of [320,390,1360]){await page.setViewportSize({width,height:900});await page.waitForTimeout(30);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${lang}/${dark}/${width}`);
        if(width===320)await page.screenshot({path:path.join(shots,`country-${lang}-${dark?'dark':'light'}-320.png`),fullPage:true});}
    }
    assert.deepEqual(errors,[]);console.log(`Synthetic logistics country captures: ${shots}`);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
