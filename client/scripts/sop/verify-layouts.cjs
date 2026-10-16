/** Synthetic browser QA. Does not contact production or submit real actions. */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const H=require('./harness.cjs');
(async()=>{
 const {port,close}=await H.startAppFixture();const browser=await H.launchBrowser();
 const output=process.env.SOP_QA_DIR || '/tmp/sop-layout-review';fs.mkdirSync(output,{recursive:true});
 const evidence=[];
 try {
  for(const width of (process.argv.includes('--task-only')?[]:[320,390,768,1360,1600])) for(const theme of ['light','dark']) for(const lang of ['en','fr','ar']) {
   const page=await H.newFixturePage(browser,{viewport:{width,height:900},user:null});
   await page.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'||u.protocol==='data:'?route.continue():route.abort();});
   await page.goto(`http://127.0.0.1:${port}/how-it-works/guides`,{waitUntil:'domcontentloaded',timeout:60000});
   await page.waitForSelector('.sop-guide-card',{timeout:60000});
   if(lang!=='en') {
    const legacy=JSON.parse(fs.readFileSync(path.join(H.ROOT,`src/locales/${lang}.json`)));
    const common=JSON.parse(fs.readFileSync(path.join(H.ROOT,`src/i18n/locales/${lang}/common.json`)));
    await page.evaluate(async({lang,legacy,common})=>{const i=window.__sopI18n;i.addResourceBundle(lang,'translation',legacy,true,true);i.addResourceBundle(lang,'common',common,true,true);await i.changeLanguage(lang);document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';},{lang,legacy,common});
   }
   await page.evaluate(theme=>{document.documentElement.classList.toggle('dark',theme==='dark');document.documentElement.dataset.theme=theme;},theme);
   await page.waitForTimeout(100);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,`${width} ${theme} ${lang}: page overflow`);
   assert.ok(await page.locator('nav').count(),'shared navigation present');
   await page.screenshot({path:path.join(output,`${width}-${theme}-${lang}.png`),fullPage:false});
   evidence.push({width,theme,lang,overflow});await page.close();
  }
  const p=await H.newFixturePage(browser,{viewport:{width:390,height:844},user:null});
  await p.goto(`http://127.0.0.1:${port}/how-it-works/account/join-oxsteed`,{waitUntil:'domcontentloaded',timeout:60000});await p.waitForSelector('.sop-shot img',{timeout:60000});
  await p.locator('.sop-shot img').first().scrollIntoViewIfNeeded();await p.waitForFunction(()=>[...document.querySelectorAll('.sop-shot img')].some(x=>x.complete&&x.naturalWidth>0));
  const trigger=p.locator('.sop-shot-zoom-btn').first();await trigger.click();assert.equal(await p.locator('dialog[open]').count(),1);await p.keyboard.press('Escape');assert.equal(await p.locator('dialog[open]').count(),0);assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
  const download=await p.locator('a[download]').first().getAttribute('href');const response=await p.request.get(`http://127.0.0.1:${port}${download}`);assert.equal(response.status(),200);assert.equal((await response.body()).subarray(0,5).toString(),'%PDF-');
  await p.screenshot({path:path.join(output,'guide-mobile.png')});await p.close();
  const task=await H.newFixturePage(browser,{viewport:{width:390,height:844},user:require('./recipes.cjs').USERS.customer});
  await task.goto(`http://127.0.0.1:${port}/post-job`,{waitUntil:'domcontentloaded',timeout:60000});
  await task.waitForSelector('#pjw-title',{timeout:60000});
  await task.fill('#pjw-title','Unsaved SOP verification draft');
  assert.ok((await task.locator('.sop-guide-button').boundingBox()).height>=44,'guide touch target');
  await task.locator('.sop-guide-button').click();
  await task.waitForSelector('.sop-modal .sop-step');
  assert.equal(await task.locator('.sop-modal-actions a').getAttribute('target'),'_blank');
  await task.screenshot({path:path.join(output,'contextual-help-mobile.png')});
  await task.keyboard.press('Escape');
  assert.equal(await task.locator('.sop-modal').count(),0);
  assert.equal(await task.inputValue('#pjw-title'),'Unsaved SOP verification draft');
  assert.equal(await task.locator('.sop-guide-button').evaluate(el=>el===document.activeElement),true);
  await task.close();
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(evidence,null,2));console.log(`Passed ${evidence.length} layout variants, image zoom/Escape/focus return and PDF download.`);
 } finally {await browser.close();await close();}
})().catch(e=>{console.error(e);process.exitCode=1});
