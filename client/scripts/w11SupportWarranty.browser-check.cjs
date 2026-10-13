// Production components with synthetic API/auth boundaries. No live requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('W11 ticket reopen and warranty review work by keyboard across responsive locales', { timeout: 120000 }, async () => {
  const root = path.resolve(__dirname, '..');
  const catalogs = Object.fromEntries(['en', 'fr', 'ar'].map(lang => [lang, JSON.parse(fs.readFileSync(path.join(root, 'src/locales', `${lang}.json`), 'utf8'))]));
  const mocks = {
    'react-i18next': `const t = (key, options = {}) => key.split('.').reduce((v,k) => v?.[k], window.catalogs[window.fixture.lang]) ?? options.defaultValue ?? key;
      export const useTranslation = () => ({t});`,
    '../hooks/useAuth': `const useAuth = () => ({user: window.fixture.user}); export { useAuth }; export default useAuth;`,
    '../components/PageMeta': 'export default () => null;',
    '../components/PageShell': 'export default ({children}) => children;',
    '../components/SignaturePad': 'export default () => null;',
    '../components/PaymentReauthorizationBanner': 'export default () => null;',
    'react-hot-toast': 'export default {success: () => {}, error: () => {}};',
    '../api/axios': `export default {
      get: async url => {
        if (url.startsWith('/support')) return {data: {ticket: window.fixture.ticket, messages: []}};
        return {data: {agreement: {id:'agreement-1', status:'active', warranty_months:6}, myRole:window.fixture.myRole,
          warrantyClaims: window.fixture.claims, versions:[], signatures:[], changeOrders:[], evidence:[], documents:[]}};
      },
      post: async (url, body) => {
        window.fixture.posts.push({url,body});
        if (window.fixture.fail) throw new Error('synthetic unavailable');
        if (url.endsWith('/reopen')) window.fixture.ticket.status = 'open';
        else if (url.endsWith('/resolve')) window.fixture.claims[0].status = body.decision;
        return {data:{success:true}};
      }
    };`,
  };
  const built = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {BrowserRouter, Routes, Route} from 'react-router-dom';
      import Ticket from './src/pages/SupportTicketDetailPage.jsx';
      import Agreement from './src/pages/WorkAgreementPage.jsx';
      const query = new URLSearchParams(location.search);
      window.catalogs = ${JSON.stringify(catalogs)};
      window.fixture = {lang:query.get('lang') || 'en', posts:[], fail:false, user:{id:'helper-1'}, myRole:'helper',
        ticket:{id:'ticket-1',ticket_number:1201,status:'closed',subject:'Synthetic support ticket',created_at:'2026-10-13T00:00:00Z'},
        claims:[{id:'claim-1',filed_by:'customer-1',status:'filed',description:'Synthetic warranty claim'}]};
      document.documentElement.dir = window.fixture.lang === 'ar' ? 'rtl' : 'ltr';
      document.documentElement.dataset.theme = query.get('theme') || 'dark';
      document.documentElement.classList.toggle('dark', query.get('theme') !== 'light');
      createRoot(document.getElementById('root')).render(<BrowserRouter><Routes>
        <Route path='/support/my-tickets/:ticketId' element={<Ticket/>}/>
        <Route path='/agreements/:id' element={<Agreement/>}/>
      </Routes></BrowserRouter>);`, resolveDir: root, loader: 'jsx' },
    jsx: 'automatic', bundle: true, write: false, outdir: '/synthetic',
    plugins: [{ name: 'w11-synthetic-boundaries', setup(plugin) {
      plugin.onResolve({filter:/.*/}, args => Object.hasOwn(mocks,args.path) ? {path:args.path,namespace:'w11-fixture'} : undefined);
      plugin.onLoad({filter:/.*/,namespace:'w11-fixture'}, args => ({contents:mocks[args.path],loader:'js'}));
    }}],
  });
  const assets = path.join(root, 'dist/assets');
  const productionCss = fs.readdirSync(assets).filter(name => name.endsWith('.css')).map(name => fs.readFileSync(path.join(assets, name), 'utf8')).join('\n');
  const js = built.outputFiles.find(f => f.path.endsWith('.js')).contents;
  const css = `${productionCss}\n${built.outputFiles.find(f => f.path.endsWith('.css'))?.text || ''}`;
  const server = http.createServer((req,res) => {
    if (req.url === '/fixture.js') { res.setHeader('Content-Type','text/javascript'); res.end(js); }
    else if (req.url === '/fixture.css') { res.setHeader('Content-Type','text/css'); res.end(css); }
    else res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true,channel:'chrome'});
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const width of [320,390,768,1360,1600]) for (const lang of ['en','fr','ar']) for (const theme of ['light','dark']) {
      await page.setViewportSize({width,height:900});
      await page.goto(`${origin}/support/my-tickets/ticket-1?lang=${lang}&theme=${theme}`);
      const reopen = page.getByRole('button',{name:catalogs[lang].reviewW11.reopenTicket,exact:true});
      await reopen.waitFor();
      assert.ok((await reopen.boundingBox()).height >= 44);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `support overflow ${width}/${lang}/${theme}`);
      await reopen.focus();
      assert.equal(await reopen.evaluate(el => getComputedStyle(el).outlineStyle !== 'none'),true);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.fixture.posts.length === 1);
      await page.getByRole('textbox').waitFor();
      assert.equal(await page.evaluate(() => window.fixture.posts[0].url),'/support/my-tickets/ticket-1/reopen');

      await page.goto(`${origin}/agreements/agreement-1?lang=${lang}&theme=${theme}`);
      const review = page.getByRole('button',{name:catalogs[lang].reviewW11.reviewClaim,exact:true});
      await review.waitFor();
      assert.ok((await review.boundingBox()).height >= 44);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `agreement overflow ${width}/${lang}/${theme}`);
      await review.focus();
      assert.equal(await review.evaluate(el => getComputedStyle(el).outlineStyle !== 'none'),true);
      await page.keyboard.press('Space');
      await page.waitForFunction(() => window.fixture.claims[0].status === 'under_review');
      await review.waitFor({state:'hidden'});
      const resolve = page.locator('#wa-warranty button').filter({hasText: catalogs[lang].workAgreement.claimResolve});
      await resolve.click();
      await page.waitForFunction(() => window.fixture.claims[0].status === 'resolved');
      assert.deepEqual(await page.evaluate(() => window.fixture.posts.map(p => p.body.decision)),['under_review','resolved']);
      if (width === 320 && lang === 'ar' && theme === 'dark') await page.screenshot({path:'/tmp/oxsteed-w11-warranty-ar-320.png',fullPage:true});
    }
    await page.goto(`${origin}/support/my-tickets/ticket-1?lang=fr`);
    await page.getByRole('button',{name:catalogs.fr.reviewW11.reopenTicket,exact:true}).waitFor();
    await page.evaluate(() => { window.fixture.fail = true; });
    await page.getByRole('button',{name:catalogs.fr.reviewW11.reopenTicket,exact:true}).click();
    assert.equal(await page.getByRole('alert').innerText(),catalogs.fr.reviewW11.reopenFailed);
    assert.equal(await page.evaluate(() => window.fixture.ticket.status),'closed');
    await page.evaluate(() => { window.fixture.fail = false; });
    await page.getByRole('button',{name:catalogs.fr.reviewW11.reopenTicket,exact:true}).click();
    await page.getByRole('textbox').waitFor();
    assert.deepEqual(errors,[]);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
