const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright-core');
const { startPwaFixture } = require('./pwa-fixture-server.cjs');
const catalogs = Object.fromEntries(['en','es','fr','ht','ar'].map(lang => [lang, require(`../src/locales/${lang}.json`)]));

const restaurant = id => ({ id,display_name:`Fixture Kitchen ${id}`,cuisine_tags:['Caribbean'],address_city:'Fixture City',
  address_country:'US',fulfillment_modes:['pickup','dine_in'],accepts_online_orders:false,is_open:true,
  hours_message_code:'open_until',hours_message_params:{closesAt:'6:00 PM'},timezone:'America/New_York' });

test('built restaurant discovery has one useful grid, truthful details and working filters in five languages', {timeout:150000}, async () => {
  const fixture = await startPwaFixture();
  fixture.state.user = null;
  let rows = [restaurant(1)];
  const queries = [];
  fixture.state.readHandlers['/api/food/restaurants'] = url => {
    const params = Object.fromEntries(url.searchParams);queries.push(params);
    const q = String(params.q || '').toLowerCase();
    const filtered = rows.filter(row => row.display_name.toLowerCase().includes(q) && (!params.cuisine || row.cuisine_tags.includes(params.cuisine)));
    const offset = Number(params.offset || 0),limit = Number(params.limit || 24);
    return {restaurants:filtered.slice(offset,offset+limit).map(row=>({...row,...(params.lat!=null?{distance_km:4.2}:{})})),
      pagination:{total:filtered.length,offset,limit,hasMore:offset+limit<filtered.length,nextOffset:offset+limit<filtered.length?offset+limit:null}};
  };
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    for (const [language,width] of [['en',1440],['es',390],['fr',1440],['ht',390],['ar',390],['ar',1440]]) {
      const catalog = catalogs[language];
      const context = await browser.newContext({viewport:{width,height:900},geolocation:{latitude:0,longitude:0},permissions:['geolocation']});
      await context.addInitScript(({language,width}) => {
        localStorage.setItem('oxs:language',language);
        localStorage.setItem('theme',width===390?'dark':'light');
        localStorage.setItem('oxs:recentlyViewed',JSON.stringify({restaurants:[
          {id:'1',title:'Previously viewed duplicate',href:'/restaurants/r/1'},
          {id:'blank',title:'',href:'/restaurants/r/blank'},
          {id:'99',title:'Recent off-page kitchen',href:'/restaurants/r/99'},
        ]}));
      },{language,width});
      await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      const errors = [],assets=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('request',request=>{const pathname=new URL(request.url()).pathname;if(pathname.startsWith('/assets/'))assets.push(pathname);});
      try {
        rows=[restaurant(1)];
        await page.goto(fixture.origin+'/restaurants');
        await page.getByRole('heading',{name:'Fixture Kitchen 1',exact:true}).waitFor();
        const reject=page.getByRole('button',{name:catalog.cookieConsent.rejectAll,exact:true});
        if(await reject.isVisible())await reject.click();
        assert.equal(await page.locator('a[href="/restaurants/r/1"]').count(),1,'small inventory must not repeat cards');
        assert.equal(await page.locator('a[href="/restaurants/r/blank"]').count(),0);
        assert.equal(await page.getByRole('heading',{name:catalog.recentlyViewed.title,exact:true}).count(),0);
        assert.equal(await page.locator('.fd-tag-featured').count(),0,'highly rated alone never means featured');
        assert.equal(queries.some(query=>query.featured_only==='true'),false,'no duplicate shelf request');
        await page.getByText(catalog.food.home.discovery.onlineUnavailable,{exact:true}).waitFor();
        const clock=new Intl.DateTimeFormat(language,{hour:'numeric',minute:'2-digit',timeZone:'UTC'}).format(new Date(Date.UTC(2000,0,1,18)));
        await page.getByText(catalog.food.hours.openUntil.replace('{{time}}',clock),{exact:true}).waitFor();
        assert.equal(await page.locator('html').getAttribute('dir'),language==='ar'?'rtl':'ltr');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        assert.equal(assets.some(file=>file.includes('maplibre')),false,'map engine stays off initial discovery');
        if(language!=='en') {
          await page.getByRole('button',{name:catalog.food.home.nearMe,exact:true}).click();
          await page.getByRole('button',{name:catalog.food.home.discovery.clearLocation,exact:true}).waitFor();
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'translated location controls fit the viewport');
          await page.getByRole('button',{name:catalog.food.home.discovery.clearLocation,exact:true}).click();
          await page.getByRole('heading',{name:'Fixture Kitchen 1',exact:true}).waitFor();
        }
        const card=page.locator('a.fd-card[href="/restaurants/r/1"]');
        const lines=await card.locator('.fd-card-hours, .fd-card-body > .fd-card-meta').evaluateAll(elements=>elements.map(element=>({top:element.getBoundingClientRect().top,bottom:element.getBoundingClientRect().bottom})));
        assert.ok(lines.every((line,index)=>!index||line.top>=lines[index-1].bottom), 'card details must stay on separate readable lines');
        await card.focus();
        assert.equal(await card.evaluate(element=>element===document.activeElement),true);
        if ((language==='en'&&width===1440)||(language==='ar'&&width===390)) {
          await page.locator('.fd-discovery-toolbar').scrollIntoViewIfNeeded();
          await page.screenshot({path:path.join(os.tmpdir(),`oxsteed-discovery-${language}-${width}.png`)});
        }
        if(language==='en') {
          // Larger inventories still show each restaurant once, including after pagination.
          rows=Array.from({length:25},(_,index)=>({...restaurant(index+1),is_featured:index===0,cuisine_tags:index%2?['Vegan']:['Caribbean']}));
          await page.reload();
          await page.getByRole('heading',{name:'Fixture Kitchen 1',exact:true}).waitFor();
          assert.equal(await page.locator('a.fd-card').count(),24);
          assert.equal(await page.locator('a[href="/restaurants/r/1"]').count(),1);
          await page.getByRole('link',{name:/Recent off-page kitchen/}).waitFor();
          assert.equal(await page.locator('.fd-tag-featured').count(),1);
          await page.getByRole('button',{name:catalog.food.home.loadMore,exact:true}).click();
          await page.getByRole('heading',{name:'Fixture Kitchen 25',exact:true}).waitFor();
          assert.equal(await page.locator('a.fd-card').count(),25);
          assert.equal(new Set(await page.locator('a.fd-card').evaluateAll(cards=>cards.map(card=>card.getAttribute('href')))).size,25);
          await page.getByRole('button',{name:/Caribbean/,exact:false}).click();
          await page.getByRole('heading',{name:'Fixture Kitchen 1',exact:true}).waitFor();
          // Clearing device location preserves the entered search and resets only distance sorting.
          const search=page.getByRole('combobox',{name:catalog.food.home.searchPlaceholder});
          await search.fill('Kitchen');
          await page.getByRole('button',{name:catalog.food.home.searchBtn,exact:true}).click();
          await page.getByRole('heading',{name:'Fixture Kitchen 1',exact:true}).waitFor();
          await page.getByRole('button',{name:catalog.food.home.nearMe,exact:true}).click();
          await page.getByRole('button',{name:catalog.food.home.discovery.clearLocation,exact:true}).waitFor();
          await page.getByRole('heading',{name:'Fixture Kitchen 1',exact:true}).waitFor();
          assert.equal(await page.getByRole('combobox',{name:catalog.food.home.sortBy}).inputValue(),'distance');
          assert.ok(queries.some(query=>query.lat==='0'&&query.lng==='0'&&query.sort==='distance'));
          await page.getByRole('button',{name:catalog.food.home.discovery.clearLocation,exact:true}).click();
          await page.getByRole('heading',{name:'Fixture Kitchen 1',exact:true}).waitFor();
          // Typeahead shares this endpoint with limit=10 and intentionally
          // searches outside the active cuisine. Inspect the result-grid call.
          const last=queries.filter(query=>Number(query.limit)===24).at(-1);
          assert.equal(last.q,'Kitchen');assert.equal(last.cuisine,'Caribbean');assert.equal(last.sort,'recommended');assert.equal(last.lat,undefined);assert.equal(last.lng,undefined);
          await page.locator('.rd-active-filters').getByText('Caribbean',{exact:true}).waitFor();
          assert.equal(await search.inputValue(),'Kitchen');
          // API failure and an empty result remain recoverable through the same controls.
          fixture.state.failures['/api/food/restaurants']=503;
          await page.getByRole('button',{name:catalog.food.home.searchBtn,exact:true}).click();
          await page.getByRole('alert').filter({hasText:catalog.food.home.redesign.errorHint}).waitFor();
          await page.locator('.pwa-connection').waitFor({state:'detached'});
          delete fixture.state.failures['/api/food/restaurants'];
          await page.locator('.fd-home-empty').getByRole('button',{name:catalog.food.common.retry,exact:true}).click();
          await page.getByRole('heading',{name:'Fixture Kitchen 1',exact:true}).waitFor();
          await search.fill('No matching kitchen');
          await page.getByRole('button',{name:catalog.food.home.searchBtn,exact:true}).click();
          await page.getByRole('button',{name:catalog.food.home.clearSearch,exact:true}).waitFor();
          assert.equal(await page.locator('a.fd-card').count(),0);
          await page.getByRole('button',{name:catalog.food.home.clearSearch,exact:true}).click();
          await page.getByRole('heading',{name:'Fixture Kitchen 1',exact:true}).waitFor();
          await context.setGeolocation(null);
          await page.getByRole('button',{name:catalog.food.home.nearMe,exact:true}).click();
          await page.getByRole('alert').filter({hasText:catalog.food.home.redesign.locationError}).waitFor();
          assert.equal(await page.getByRole('button',{name:catalog.food.home.discovery.clearLocation,exact:true}).count(),0);
        }
        assert.deepEqual(errors,[],`${language}/${width}`);
      } finally {await context.close();}
    }
  } finally {await browser.close();await fixture.close();}
});
