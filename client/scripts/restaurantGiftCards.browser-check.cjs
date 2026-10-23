const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  http = require('node:http');
const { build } = require('esbuild'),
  { chromium } = require('playwright-core');
test(
  'gift-card issue retries, physical handoff, zero statement and delivery resolution work in the merchant UI',
  { timeout: 45000 },
  async () => {
    const root = path.resolve(__dirname, '..'),
      locale = JSON.parse(
        fs.readFileSync(path.join(root, 'src/locales/en.json')),
      );
    const mocks = {
      '../../api/axios': `export default {get:async(url,options)=>window.fixtureGet(url,options),post:async(url,body,options)=>window.fixturePost(url,body,options),patch:async()=>({data:{}})};`,
    };
    const bundle = await build({
      stdin: {
        resolveDir: root,
        loader: 'jsx',
        contents: `import React from 'react';import{createRoot}from'react-dom/client';import Panel from './src/pages/food/GiftCardProductsPanel';
 const locale=${JSON.stringify(locale)};const t=key=>key.split('.').reduce((a,k)=>a?.[k],locale)||key;
 window.posts=[];window.failedOnce=false;window.handed=false;window.resolved=false;
 window.fixtureGet=async(url)=>({data:url.endsWith('gift-card-products')?{products:[{id:1,name:'Physical',amountCents:1005,currencyCode:'KWD',deliveryType:'physical',isActive:true}]}:url.endsWith('/print')?'<!doctype html><title>Printable card</title><p>ABCD2345EFGH6789</p>':url.endsWith('/reconciliation')?{rows:[{id:1,code_last4:'6789',currency_code:'KWD',balance_cents:'1005',ledger_balance_cents:'1005'}],next:null}:{cards:[{id:1,cardId:1,codeLast4:'6789',currencyCode:'KWD',balanceCents:1005,kind:'physical',status:window.handed?'handed_out':'ready',canPrint:!window.handed},{id:2,cardId:2,codeLast4:'AAAA',currencyCode:'KWD',balanceCents:1005,kind:'e_gift',status:window.resolved?'pending':'needs_review'}],next:null,deliveryEnabled:false}});
 window.fixturePost=async(url,body,options)=>{window.posts.push({url,body,options});if(url.endsWith('/gift-cards')){if(!window.failedOnce){window.failedOnce=true;throw Error('lost response');}return{data:{card:{id:1,code:'ABCD2345EFGH6789'}}};}if(url.endsWith('/handoff'))window.handed=true;if(url.endsWith('/delivery-resolution'))window.resolved=true;return{data:{}};};
 createRoot(document.getElementById('root')).render(<Panel restaurant={{id:42,currency_code:'KWD'}} t={t}/>);`,
      },
      bundle: true,
      write: false,
      jsx: 'automatic',
      plugins: [
        {
          name: 'gift-fixture',
          setup(p) {
            p.onResolve({ filter: /.*/ }, (a) =>
              mocks[a.path]
                ? { path: a.path, namespace: 'fixture' }
                : undefined,
            );
            p.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
              contents: mocks[a.path],
              loader: 'jsx',
            }));
          },
        },
      ],
    });
    const server = http.createServer((req, res) => {
      if (req.url === '/app.js') {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(bundle.outputFiles[0].contents);
      } else
        res.end(
          '<div id="root"></div><script type="module" src="/app.js"></script>',
        );
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
    });
    try {
      const page = await browser.newPage(),
        errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.setDefaultTimeout(8000);
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.getByLabel('SKU', { exact: true }).fill('TEST-1');
      await page
        .getByLabel('Product name', { exact: true })
        .fill('Kuwait gift');
      await page.getByLabel('Value', { exact: true }).fill('1.005');
      await page
        .getByRole('button', { name: 'Add product', exact: true })
        .click();
      await page.waitForFunction(() =>
        window.posts.some((p) => p.url.endsWith('gift-card-products')),
      );
      assert.equal(
        await page.evaluate(() => window.posts[0].body.amountCents),
        1005,
      );
      assert.equal(
        await page.evaluate(() => window.posts[0].body.currencyCode),
        'KWD',
      );
      await page
        .getByLabel(
          'Preprinted card code (optional; blank generates a new code)',
          { exact: true },
        )
        .fill('ABCD2345EFGH6789');
      await page
        .getByRole('button', { name: 'Issue card', exact: true })
        .click();
      await page
        .getByText('Could not issue gift card.', { exact: true })
        .waitFor();
      await page
        .getByRole('button', { name: 'Issue card', exact: true })
        .click();
      await page.getByText('ABCD2345EFGH6789', { exact: true }).waitFor();
      const issues = await page.evaluate(() =>
        window.posts.filter((p) => p.url.endsWith('/gift-cards')),
      );
      assert.equal(issues.length, 2);
      assert.equal(
        issues[0].options.headers['Idempotency-Key'],
        issues[1].options.headers['Idempotency-Key'],
      );
      const popup = page.waitForEvent('popup');
      await page
        .getByRole('button', { name: 'Open printable card', exact: true })
        .click();
      const card = await popup;
      await card.getByText('ABCD2345EFGH6789', { exact: true }).waitFor();
      await card.close();
      await page
        .getByRole('button', { name: 'Record handoff', exact: true })
        .click();
      await page
        .getByLabel('Receipt or provider evidence reference', { exact: true })
        .fill('counter-receipt-1');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.getByText('Handed out', { exact: true }).waitFor();
      await page
        .getByRole('button', { name: 'Resolve delivery', exact: true })
        .click();
      await page
        .getByLabel('Receipt or provider evidence reference', { exact: true })
        .fill('provider-confirmed-unsent');
      await page
        .getByLabel('Corrected recipient email (optional)', { exact: true })
        .fill('fixed@example.invalid');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.getByText('Queued', { exact: true }).waitFor();
      await page
        .getByRole('button', { name: 'Record statement', exact: true })
        .click();
      await page
        .getByLabel('Statement source', { exact: true })
        .fill('external');
      await page
        .getByLabel('Statement reference', { exact: true })
        .fill('closing-1');
      await page.getByLabel('External balance', { exact: true }).fill('0');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForFunction(() =>
        window.posts.some((p) => p.url.endsWith('/reconciliation')),
      );
      assert.equal(
        await page.evaluate(
          () =>
            window.posts.find((p) => p.url.endsWith('/reconciliation')).body
              .externalBalanceCents,
        ),
        0,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
    }
  },
);
