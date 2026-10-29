const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
const {startPwaFixture}=require('./pwa-fixture-server.cjs');
const catalogs={en:require('../src/locales/en.json'),ar:require('../src/locales/ar.json')};
const artifact=process.env.OXSTEED_OPERATIONS_SCREENSHOTS;

function summary(role='owner',today=3,pending=27){
  const employee=role==='employee';
  return {businessId:4,businessKind:'service',timezone:'America/New_York',generatedAt:'2026-10-29T12:00:00Z',partial:false,
    sections:{bookings:{available:true,scope:employee?'self':'all',status:'ready',today,pending},
      messages:{available:true,scope:employee?'assigned':'all',status:'ready',unanswered:2},
      invoices:{available:!employee,status:employee?'not_available':'ready',overdue:3},
      setup:{available:!employee,status:employee?'not_available':'ready',pending:0}},
    tasks:[{type:'confirmBookings',count:pending,panel:'calendar'},{type:'replyToMessages',count:2,panel:'messages'},
      ...employee?[]:[{type:'followUpInvoices',count:3,panel:'invoices'}]],canViewAnalytics:!employee};
}
function configure(fixture,role='owner'){
  fixture.state.user={...fixture.state.user,role:'helper',default_mode:role==='owner'?'business_owner':'business_employee'};
  const business={id:4,business_id:4,business_name:'Synthetic Service Team',business_kind:'service',business_mode:'service',
    status:'active',setup_status:'active',role,is_owner:role==='owner',currency_code:'USD',address_country:'US',
    permissions:role==='owner'?['*']:['business.view','calendar.view_self','calendar.manage_self','messages.view_assigned','messages.reply']};
  fixture.state.readResponses={
    '/api/businesses':{businesses:role==='owner'?[business]:[]},
    '/api/businesses/managed':{businesses:role==='owner'?[]:[business]},
    '/api/me/businesses':{data:{items:[business]}},
    '/api/businesses/4/operations-summary':{data:summary(role)},
    '/api/businesses/4/services':[], '/api/businesses/4/hours':{hours:[]},
    '/api/businesses/4/calendar':{events:[],appointments:[]},
    '/api/businesses/4/messages':{conversations:[],total:0},
  };
  const userId=fixture.state.user.id;
  const permissions={all:role==='owner',userId,canManageAll:role==='owner',canManageSelf:true,canCreate:role==='owner',canRecordPayment:role==='owner'};
  const pending=Array.from({length:27},(_,index)=>({id:index+1,service_id:1,staff_id:userId,
    service_name:`Future booking ${index+1}`,customer_name:'Synthetic customer',status:'pending',payment_status:'pending',
    start_time:new Date(Date.UTC(2030,3,index+1,15)).toISOString(),end_time:new Date(Date.UTC(2030,3,index+1,16)).toISOString(),final_price_cents:100}));
  fixture.state.readHandlers['/api/businesses/4/appointments']=url=>{
    const rows=pending.filter(item=>item.status==='pending').sort((a,b)=>b.id-a.id);
    const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||50);
    return {appointments:rows.slice(offset,offset+limit),total:rows.length,permissions};
  };
  const now=new Date();
  const dayBookings=Array.from({length:4},(_,index)=>({...pending[0],id:100+index,status:'confirmed',
    service_name:`Day booking ${index+1}`,start_time:new Date(now.getFullYear(),now.getMonth(),now.getDate(),9+index).toISOString(),
    end_time:new Date(now.getFullYear(),now.getMonth(),now.getDate(),10+index).toISOString()}));
  fixture.state.readResponses['/api/businesses/4/appointments/calendar']={appointments:dayBookings,blocks:[],permissions};
  return {business,pending,permissions};
}
async function contextFor(browser,fixture,language,width){
  const context=await browser.newContext({viewport:{width,height:1000}});
  await context.addInitScript(language=>{localStorage.setItem('oxs:language',language);localStorage.setItem('theme',language==='ar'?'dark':'light');},language);
  await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort());
  return context;
}

test('built workspaces prioritize real activity, page through pending bookings and honor calendar capabilities',{timeout:180000},async()=>{
  const fixture=await startPwaFixture(),browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    for(const [role,language,width]of [['owner','en',1440],['owner','ar',390],['employee','en',390]]){
      const {pending}=configure(fixture,role),catalog=catalogs[language],copy=catalog.businessOperations;
      fixture.state.requests=[];fixture.state.writes=[];
      const context=await contextFor(browser,fixture,language,width),page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
      const writes=[];
      await context.route('**/api/businesses/4/appointments/*/status',async route=>{
        const id=Number(new URL(route.request().url()).pathname.split('/').at(-2));
        const body=route.request().postDataJSON(),item=pending.find(item=>item.id===id);
        assert.ok(item);writes.push({id,status:body.status});item.status=body.status;
        await route.fulfill({status:200,json:item});
      });
      try{
        await page.goto(fixture.origin+'/business/4/workspace');
        const overview=page.locator('.business-operations');
        await overview.locator('.business-operations__card').first().waitFor();
        assert.equal(await page.locator('.bh-mode-center').count(),0,'guidance does not precede daily activity');
        const tabLabels=await page.locator('.bh-tabs button').allTextContents();
        assert.ok(tabLabels.indexOf(catalog.businessHub.tabCalendarLabel)<tabLabels.indexOf(catalog.businessAnalytics.title)||role!=='owner','calendar precedes analytics');
        assert.equal(await overview.getByRole('heading',{name:copy.title,exact:true}).count(),1);
        assert.equal(await overview.locator('.business-operations__card').count(),role==='owner'?3:2);
        assert.equal(await overview.locator('.business-operations__analytics').count(),role==='owner'?1:0);
        assert.equal(fixture.state.requests.some(row=>row.path.endsWith('/analytics')),false,'overview does not fetch financial analytics');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        assert.equal(await page.locator('html').getAttribute('dir'),language==='ar'?'rtl':'ltr');
        const cookies=page.getByRole('button',{name:/Essential only|Necessary only|Reject all|Only necessary/i}).first();
        if(await cookies.isVisible())await cookies.click();
        if(artifact){fs.mkdirSync(artifact,{recursive:true});await page.screenshot({path:path.join(artifact,`operations-${role}-${language}-${width}.png`),fullPage:true});}
        const attention=overview.locator('.business-operations__attention li').first();
        await attention.getByRole('button',{name:copy.review,exact:true}).click();
        const list=page.locator('.acv-pending-list');await list.getByRole('button',{name:/Future booking 27/}).waitFor();
        assert.equal(await list.locator('li').count(),25);
        const pendingRequest=fixture.state.requests.find(row=>row.path==='/api/businesses/4/appointments');
        assert.ok(pendingRequest.search.includes('status=pending'));
        assert.equal(pendingRequest.search.includes('start_date'),false,'future and overdue pending bookings are not hidden by the current month');
        await list.getByRole('button',{name:copy.next,exact:true}).click();
        await list.getByRole('button',{name:/Future booking 1 ·/}).waitFor();
        assert.equal(await list.locator('li').count(),2);
        await list.getByRole('button',{name:copy.previous,exact:true}).click();
        await list.getByRole('button',{name:/Future booking 27/}).click();
        const detail=page.locator('.acv-detail-panel');await detail.waitFor();
        assert.equal(await detail.getByText(catalog.businessAppointments.reassignStaff,{exact:true}).count(),role==='owner'?1:0);
        assert.equal(await detail.getByRole('button',{name:catalog.businessAppointments.confirm,exact:true}).count(),1);
        await detail.getByRole('button',{name:catalog.businessAppointments.confirm,exact:true}).click();
        await detail.waitFor({state:'detached'});
        await list.getByRole('button',{name:/Future booking 26/}).waitFor();
        assert.deepEqual(writes,[{id:27,status:'confirmed'}]);
        await page.locator('.acv-filter-buttons').getByRole('button',{name:catalog.businessAppointments.status.all,exact:true}).click();
        const more=page.locator('.acv-day-more');await more.waitFor();await more.focus();await page.keyboard.press('Enter');
        const agenda=page.locator('.acv-day-agenda');await agenda.waitFor();
        assert.equal(await agenda.locator('li').count(),4,'every booking remains reachable beyond the first two badges');
        assert.equal(await page.locator('#acv-agenda-title').evaluate(el=>el===document.activeElement),true);
        await agenda.getByRole('button',{name:/Day booking 4/}).click();
        await detail.getByRole('heading',{name:'Day booking 4',exact:true}).waitFor();
        assert.deepEqual(errors,[]);
      }finally{await context.close();}
    }
  }finally{await browser.close();await fixture.close();}
});

test('activity failures and workspace changes cannot paint invented zeroes or a previous workspace snapshot',{timeout:90000},async()=>{
  const fixture=await startPwaFixture(),browser=await chromium.launch({channel:'chrome',headless:true});
  configure(fixture);
  const second={...fixture.state.readResponses['/api/businesses'].businesses[0],id:5,business_id:5,business_name:'Second synthetic team'};
  fixture.state.readResponses['/api/businesses'].businesses.push(second);
  fixture.state.readResponses['/api/businesses/5/operations-summary']={data:{...summary('owner',7),businessId:5}};
  const context=await contextFor(browser,fixture,'en',1440),page=await context.newPage();page.setDefaultTimeout(15000);
  try{
    await page.goto(fixture.origin+'/business/4/workspace');const overview=page.locator('.business-operations'),copy=catalogs.en.businessOperations;
    await overview.locator('.business-operations__card').first().waitFor();
    const unavailable=summary();unavailable.partial=true;unavailable.tasks=[];
    for(const section of ['bookings','messages','invoices'])unavailable.sections[section]={available:true,status:'unavailable'};
    fixture.state.readResponses['/api/businesses/4/operations-summary']={data:unavailable};
    await overview.getByRole('button',{name:copy.refresh,exact:true}).click();
    await overview.getByText(copy.attentionUnavailable,{exact:true}).waitFor();
    assert.deepEqual(await overview.locator('dd').allTextContents(),[copy.unavailable,copy.unavailable,copy.unavailable]);
    assert.equal(await overview.getByText(copy.nothingPending,{exact:true}).count(),0);
    fixture.state.failures['/api/businesses/4/operations-summary']=503;
    await overview.getByRole('button',{name:copy.refresh,exact:true}).click();await overview.getByRole('alert').waitFor();
    assert.equal(await overview.locator('.business-operations__card').count(),0);
    delete fixture.state.failures['/api/businesses/4/operations-summary'];
    fixture.state.readResponses['/api/businesses/4/operations-summary']={data:summary('owner',999)};
    await overview.getByRole('button',{name:copy.refresh,exact:true}).click();await overview.locator('dd',{hasText:'999'}).waitFor();
    let release;const held=new Promise(resolve=>{release=resolve;});
    await context.route('**/api/businesses/5/operations-summary',async route=>{await held;await route.continue().catch(()=>{});});
    try{
      await page.locator('.bh-switcher select').selectOption('5');
      await page.waitForURL(url=>url.pathname.includes('/business/5/'));
      await overview.locator('dd',{hasText:'999'}).waitFor({state:'detached'});
      assert.equal(await overview.locator('.business-operations__card').count(),0,'old private activity disappears before the new request resolves');
      release();await overview.locator('.business-operations__card dd').first().filter({hasText:'7'}).waitFor();
      assert.equal(await overview.locator('dd',{hasText:'999'}).count(),0);
    }finally{release();}
  }finally{await context.close();await browser.close();await fixture.close();}
});
