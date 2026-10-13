const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {build}=require('esbuild');
const {chromium}=require('playwright-core');

test('actual Learn queues expose older pages, reset filters, and retry failures', {timeout:120000}, async()=>{
  const root=path.resolve(__dirname,'..');
  const catalogs=Object.fromEntries(['fr','ar'].map(lang=>[lang,JSON.parse(fs.readFileSync(path.join(root,`src/locales/${lang}.json`),'utf8'))]));
  const mocks={
    'react-i18next':`const t=(key,o={})=>String(key.split('.').reduce((v,k)=>v?.[k],window.catalogs[window.lang])??o.defaultValue??key).replace(/\\{\\{(\\w+)\\}\\}/g,(_,k)=>o[k]??'');export const useTranslation=()=>({t});`,
    '../../lib/adminApi':`export default {
      get:async(url,{params={}}={})=>{
        window.requests.push({url,params});
        const isVideo=url.endsWith('/video-submissions'),isFlag=url.endsWith('/video-flags');
        if(!isVideo&&!isFlag)return{data:{submissions:[],guides:[],total:0}};
        if(window.fail&&params.cursor)throw new Error('synthetic queue outage');
        const start=params.cursor?200:0,end=params.cursor?205:200;
        const rows=Array.from({length:end-start},(_,i)=>({id:'fixture-'+(start+i+1),guide_id:'fixture-guide',
          guide_title:(isVideo?'Video ':'Flag ')+(start+i+1),video_url:'https://vimeo.com/'+(start+i+1),
          status:params.status,reason:'spam',open_flags:1,created_at:'2026-10-13T00:00:00Z'}));
        return{data:{[isVideo?'submissions':'flags']:rows,has_more:!params.cursor,next_cursor:params.cursor?null:(isVideo?'video-next':'flag-next')}};
      },post:async()=>({data:{success:true}}),patch:async()=>({data:{success:true}})
    };`,
  };
  const bundled=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Page from'./src/admin/pages/LearnSubmissionsAdmin.jsx';
    window.catalogs=${JSON.stringify(catalogs)};window.lang=new URLSearchParams(location.search).get('lang')||'fr';window.requests=[];window.fail=false;
    document.documentElement.dir=window.lang==='ar'?'rtl':'ltr';document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme');
    document.documentElement.classList.toggle('dark',document.documentElement.dataset.theme==='dark');
    createRoot(document.getElementById('root')).render(<Page/>);`,resolveDir:root,loader:'jsx'},jsx:'automatic',bundle:true,write:false,
    plugins:[{name:'synthetic-review-api',setup(p){p.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:undefined);p.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
  const assets=path.join(root,'dist/assets');
  const css=fs.readdirSync(assets).filter(n=>n.endsWith('.css')).map(n=>fs.readFileSync(path.join(assets,n),'utf8')).join('\n');
  const server=http.createServer((req,res)=>{
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundled.outputFiles[0].contents);}
    else if(req.url==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css);}
    else res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage();const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    for(const width of[320,390,768,1360,1600])for(const lang of['fr','ar'])for(const theme of['light','dark']){
      await page.setViewportSize({width,height:900});await page.goto(`http://127.0.0.1:${server.address().port}/?lang=${lang}&theme=${theme}`);
      const labels=catalogs[lang];
      const video=page.locator('section').filter({has:page.getByRole('heading',{name:labels.adminLearnSubmissions.videoSectionTitle,exact:true})});
      const flags=page.locator('section').filter({has:page.getByRole('heading',{name:labels.adminLearnSubmissions.flagSectionTitle,exact:true})});
      await video.getByText('Video 200',{exact:true}).waitFor();await flags.getByText('Flag 200',{exact:true}).waitFor();
      for(const [section,last,cursor]of[[video,'Video 205','video-next'],[flags,'Flag 205','flag-next']]){
        assert.equal(await section.locator('li').count(),200);
        const next=section.getByRole('button',{name:labels.reviewW11Learn.nextPage,exact:true});
        assert.ok((await next.boundingBox()).height>=44);
        await page.keyboard.press('Tab'); await next.focus();
        assert.equal(await next.evaluate(el=>getComputedStyle(el).outlineStyle!=='none'),true);
        await page.keyboard.press('Enter');await section.getByText(last,{exact:true}).waitFor();
        assert.equal(await section.locator('li').count(),5);assert.equal(await next.isDisabled(),true);
        assert.equal(await page.evaluate(cursor=>window.requests.some(r=>r.params.cursor===cursor),cursor),true);
        await section.getByRole('button',{name:labels.reviewW11Learn.previousPage,exact:true}).click();
        await section.getByText(last.replace('205','200'),{exact:true}).waitFor();
      }
      await video.getByRole('button',{name:labels.adminLearnSubmissions.videoStatusLive,exact:true}).click();
      await page.waitForFunction(()=>window.requests.some(r=>r.params.status==='live'&&!r.params.cursor));
      assert.equal(await video.getByRole('button',{name:labels.reviewW11Learn.previousPage,exact:true}).isDisabled(),true);
      // Assert the new pagination row itself wraps at 320px in RTL and French.
      const next=video.getByRole('button',{name:labels.reviewW11Learn.nextPage,exact:true});
      const bounds=await next.boundingBox();assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=width+1);
    }
    const labels=catalogs.ar;
    const video=page.locator('section').filter({has:page.getByRole('heading',{name:labels.adminLearnSubmissions.videoSectionTitle,exact:true})});
    await page.evaluate(()=>{window.fail=true;});
    await video.getByRole('button',{name:labels.reviewW11Learn.nextPage,exact:true}).click();
    await video.getByRole('button',{name:labels.common.retry,exact:true}).waitFor();
    await page.evaluate(()=>{window.fail=false;});
    await video.getByRole('button',{name:labels.common.retry,exact:true}).click();
    await video.getByText('Video 205',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});
