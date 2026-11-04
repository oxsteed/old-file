const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('support yields to page controls and returns after scrolling, dynamic content and direction changes', { timeout: 45000 }, async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React,{useState} from 'react';import{createRoot}from'react-dom/client';
      import{BrowserRouter,useNavigate}from'react-router-dom';
      import Launcher from'./src/components/SupportLauncher';
      function Page(){const[late,setLate]=useState(false),[open,setOpen]=useState(false),navigate=useNavigate();
        window.addAction=()=>setLate(true);window.removeAction=()=>setLate(false);window.navigate=navigate;
        return <><main id="main-content" tabIndex={-1}>
          <h1>Food directory</h1><button className="map" onClick={()=>window.mapClicks=(window.mapClicks||0)+1}>Show map</button>
          {late&&<button className="late">Late action</button>}
        </main><Launcher yieldToPage={!open} aria-label="Open assistant" className="fixed launcher" onClick={()=>setOpen(!open)}>Ask AI</Launcher>
        {open&&<div role="dialog"><button onClick={()=>setOpen(false)}>Close assistant</button></div>}</>;
      }createRoot(document.getElementById('root')).render(<BrowserRouter><Page/></BrowserRouter>);` },
    bundle: true, write: false, jsx: 'automatic', format: 'esm', loader: { '.css': 'empty' },
  });
  const css = `body{margin:0}main{min-height:1800px}button{min-height:44px}h1{margin:0}
    .map{position:absolute;top:735px;inset-inline-end:20px;width:120px}
    .launcher{position:fixed;inset-inline-end:16px;width:100px;height:44px}
    .late{position:fixed;bottom:88px;inset-inline-end:16px;width:100px;height:44px}`;
  const noticeCss = fs.readFileSync(path.join(root, 'src/styles/PwaExperience.css'), 'utf8');
  const server = http.createServer((req,res)=>{
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);}
    else{res.setHeader('Content-Type','text/html');res.end(`<html><head><style>${noticeCss}${css}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({channel:'chrome',headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(3000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const launcher=page.getByRole('button',{name:'Open assistant',exact:true});
    await page.getByRole('heading',{name:'Food directory'}).waitFor();
    await launcher.waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Show map',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.mapClicks),1,'the page action receives the tap');
    await page.evaluate(()=>window.scrollTo(0,250));
    await launcher.waitFor({state:'visible'});
    await launcher.click();await page.getByRole('dialog').waitFor();
    await page.getByRole('button',{name:'Close assistant',exact:true}).click();
    await launcher.waitFor({state:'visible'});
    await page.evaluate(()=>window.addAction());
    await launcher.waitFor({state:'hidden'});
    await page.evaluate(()=>{window.removeAction();document.documentElement.dir='rtl';window.scrollTo(0,0);});
    await launcher.waitFor({state:'hidden'});
    await page.evaluate(()=>window.scrollTo(0,250));
    await launcher.waitFor({state:'visible'});
    await page.evaluate(()=>document.documentElement.style.setProperty('--cookie-banner-height','190px'));
    await page.evaluate(()=>window.scrollTo(0,88));
    // Moving the launcher for another overlay must update its collision region.
    await page.waitForFunction(()=>document.querySelector('[data-pwa-support-launcher]').getBoundingClientRect().bottom<650);
    await launcher.waitFor({state:'hidden'});
    await page.evaluate(()=>{document.documentElement.style.removeProperty('--cookie-banner-height');window.navigate('/other');});
    await launcher.waitFor({state:'visible'});
    await page.setViewportSize({width:1440,height:900});
    await page.evaluate(()=>Object.assign(document.querySelector('.map').style,{position:'fixed',top:'auto',bottom:'24px',insetInlineEnd:'24px'}));
    await launcher.waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Show map',exact:true}).press('Enter');
    assert.equal(await page.evaluate(()=>window.mapClicks),2,'keyboard activation stays with the page action');
    await page.evaluate(()=>document.querySelector('.map').style.bottom='240px');
    await launcher.waitFor({state:'visible'});
    await launcher.focus();
    await page.evaluate(()=>document.querySelector('.map').style.bottom='24px');
    await page.waitForTimeout(100);
    assert.equal(await launcher.isVisible(),true,'a focused launcher does not disappear while another control moves');
    await page.getByRole('button',{name:'Show map',exact:true}).focus();
    await launcher.waitFor({state:'hidden'});
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
