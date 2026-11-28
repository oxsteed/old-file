// Credit redesign (D-806): the /oxsteed-credit page renders as a compact
// hero with an action row, activity tabs, a right rail, and drawers for
// every panel. The fixture bundles the real page with a mocked API and
// the real credit.json catalogs, then checks the hero, the drawers, the
// tabs, the rail-paused disabled state, and the RTL drawer dock across
// the five locales and both themes.
//
// Run: node --test scripts/creditRedesign.browser-check.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');

async function fixture() {
  const api = `
    const record = (action, payload, key) => { window.writes.push({action,payload,key}); };
    const account = { currencyCode: 'USD', status: 'active', balanceCents: 12500, reservedCents: 0, availableBalanceCents: 12500 };
    export const listOxsteedCreditAccounts = async () => [account];
    export const getOxsteedCreditAccount = async () => account;
    export const getOxsteedCreditStatus = async () => ({ enabled: window.railEnabled, supportedCurrencies: ['USD', 'EUR'], currencyMetadata: {} });
    export const getOxsteedCreditLimitSummary = async () => ({ resetsAt: '2026-11-29T00:00:00Z', spending: { centsRemaining: 9000, centsUsed: 1000, centsLimit: 10000, countRemaining: 9, countUsed: 1, countLimit: 10 }, transfers: { enabled: true, centsRemaining: 5000, centsUsed: 0, centsLimit: 5000, countRemaining: 5, countUsed: 0, countLimit: 5 } });
    export const listOxsteedCreditHolds = async () => ({ holds: [], pagination: { limit: 50, offset: 0, hasMore: false, nextOffset: null } });
    export const getOxsteedCreditEligiblePartnerPage = async () => ({ partners: [{ partnerId: 'p1', restaurantId: 'r1', restaurantName: 'Fixture Bistro', city: 'Columbus', state: 'OH', allowedOrderTypes: ['pickup', 'delivery'], customerTerms: 'Fixture terms' }], pagination: { limit: 50, offset: 0, hasMore: false, nextOffset: null } });
    export const getOxsteedCreditStatement = async () => ({ period: { from: '2026-11-01', to: '2026-11-30' }, transactions: [], totalCreditsCents: 0, totalDebitsCents: 0, closingBalanceCents: 12500, hasMore: false });
    export const getOxsteedCreditTransactionPage = async () => ({ transactions: [], pagination: { limit: 50, offset: 0, hasMore: false, nextOffset: null } });
    export const getOxsteedCreditDisputePage = async () => ({ disputes: [], pagination: { limit: 50, offset: 0, hasMore: false, nextOffset: null } });
    export const listOxsteedCreditDisputeEvidence = async () => [];
    export const getOxsteedCreditStatementPeriods = async () => [{ year: 2026, month: 11, transactionCount: 0 }];
    export const getConsentHistory = async () => ({ consents: [], disclosures: [] });
    export const getRestaurantConversionEligibility = async () => ({ enabledRestaurantIds: ['p1'] });
    export const listOxsteedCreditTopups = async () => [];
    export const listOxsteedCreditWithdrawals = async () => [];
    export const listOxsteedCreditCards = async () => window.cards;
    export const getOxsteedCreditAccountDetails = async () => ({ accountId: '1', accountNumber: '8123456789', memberCode: '12345678', accountHolderName: 'Fixture Customer' });
    export const getOxsteedCreditFeeQuote = async () => ({ feeCents: 0, currencyCode: 'USD' });
    export const getOxsteedCreditTransferRecipient = async () => null;
    export const resolveOxsteedCreditTransferRecipient = async () => null;
    export const getOxsteedCreditConversionQuote = async () => null;
    export const createOxsteedCreditConversionQuote = async (payload, key) => { record('conversion-quote', payload, key); return { quote: { id: 'q1', sourceCurrencyCode: payload.sourceCurrencyCode, targetCurrencyCode: payload.targetCurrencyCode, sourceAmountMinorUnits: payload.sourceAmountMinorUnits, targetAmountMinorUnits: 900, feeAmountMinorUnits: 25, rateNumerator: 9, rateDenominator: 10, status: 'active', expiresAt: '2026-11-29T00:00:00Z' } }; };
    export const convertOxsteedCredit = async (payload, key) => { record('convert', payload, key); return {}; };
    export const createOxsteedCreditHold = async (payload, key) => { record('hold', payload, key); return {}; };
    export const releaseOxsteedCreditHold = async (id, key) => { record('release-hold', { id }, key); return {}; };
    export const reauthorizeOxsteedCreditHold = async (id, key) => { record('reauthorize-hold', { id }, key); return {}; };
    export const openOxsteedCreditDispute = async (payload, key) => { record('dispute', payload, key); return {}; };
    export const submitOxsteedCreditDisputeEvidence = async (payload, key) => { record('dispute-evidence', payload, key); return {}; };
    export const requestOxsteedCreditWithdrawal = async (payload, key) => { record('withdrawal', payload, key); return {}; };
    export const cancelOxsteedCreditWithdrawal = async (id, key) => { record('cancel-withdrawal', { id }, key); return {}; };
    export const createOxsteedCreditTransfer = async (payload, key) => { record('transfer', payload, key); return {}; };
    export const createOxsteedCreditRestaurantConversion = async (payload, key) => { record('restaurant-conversion', payload, key); return {}; };
    export const issueOxsteedCreditMoneyOutStepup = async (payload) => { record('stepup', payload); return { challenge: { id: 'fixture-challenge', expiresAt: '2026-11-28T18:00:00Z' } }; };
    export const downloadOxsteedCreditStatement = async () => ({});
    export const downloadOxsteedCreditAccountLetter = async () => ({});
    export const issueOxsteedCreditVirtualCard = async (payload, key) => { record('issue-virtual', payload, key); return { card: window.cards[0] }; };
    export const freezeOxsteedCreditCard = async () => ({});
    export const unfreezeOxsteedCreditCard = async (id, payload, key) => { record('unfreeze', payload, key); return {}; };
    export const reportOxsteedCreditCardLost = async (id, payload) => { record('report', payload); return {}; };
    export const revealOxsteedCreditCard = async (id, payload, key) => { record('reveal', payload, key); return { card: window.cards[0], cardNumber: '9700123456789012' }; };
    export const resetOxsteedCreditCardSecurityCode = async (id, payload, key) => { record('reset-code', payload, key); return { card: window.cards[0], securityCode: '123' }; };
    export const setOxsteedCreditCardLimits = async (id, payload, key) => { record('limits', payload, key); return { card: { ...window.cards[0], dailyLimitCents: payload.dailyLimitCents, merchantTypeLimits: payload.merchantTypeLimits } }; };
    export const issueCreditCardSecurityChallenge = async (id, payload) => { record('challenge', payload); return { challenge: { id: 'fixture-grant' } }; };
    export const getCreditCardHistory = async () => ({ events: [], pagination: { nextOffset: null } });
  `;
  const mocks = {
    'react-i18next': `const translate=(key,options={})=>{const value=key.split('.').reduce((o,p)=>o?.[p],window.catalog);return typeof value==='string'?value:options.defaultValue||key;};export const useTranslation=()=>({t:translate,i18n:{resolvedLanguage:window.language}});`,
    'react-hot-toast': `export default { success(){}, error(){}, dismiss(){}, loading(){} };`,
    '../../api/oxsteedCredit': api,
    '../../api/creditStatements': `export const listArchive = async () => ({ items: [] }); export const downloadArchiveDocument = async () => ({});`,
    '../../components/Navbar': 'export default ()=>null;',
    '../../components/Footer': 'export default ()=>null;',
    '../../components/PageMeta': 'export default ()=>null;',
    '../../components/credit/OxsteedCreditTopupPanel': `export default () => <div data-testid="wallet-topup">Top-up panel stub</div>;`,
    '../../components/paymentLayers/CreditWindDownBanner': 'export default ()=>null;',
    '../../components/paymentLayers/CreditDisclosuresPanel': 'export default ()=>null;',
    '../../components/credit/CreditDomainRecoveryLinks': 'export default ()=>null;',
    '../../hooks/useAppResume': 'export default ()=>{};',
    '../../hooks/useSocket': `const socket={on(){},off(){}};export const useSocket=()=>({socket});`,
  };
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `import React from 'react';import {createRoot} from 'react-dom/client';
      import {BrowserRouter} from 'react-router-dom';import CreditPage from './src/pages/food/OxsteedCreditPage.jsx';
      createRoot(document.getElementById('root')).render(<BrowserRouter><CreditPage/></BrowserRouter>);` },
    bundle: true, write: false, format: 'esm', jsx: 'automatic',
    plugins: [{ name: 'fixture', setup(builder) {
      builder.onResolve({filter:/.*/}, args => mocks[args.path] ? {path:args.path,namespace:'fixture'} : undefined);
      builder.onLoad({filter:/.*/,namespace:'fixture'}, args => ({contents:mocks[args.path],loader:'jsx',resolveDir:root}));
      builder.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));
    }}],
  });
  const server = http.createServer((request,response) => {
    if(request.url === '/app.js') {response.setHeader('Content-Type','text/javascript');response.end(bundle.outputFiles[0].contents);return;}
    const params = new URL(request.url,'http://localhost').searchParams;
    const language = params.get('lang') || 'en';
    const theme = params.get('theme') || 'light';
    const catalog=JSON.parse(fs.readFileSync(path.join(root,'src/i18n/locales',language,'credit.json'),'utf8'));
    const styles=fs.readFileSync(path.join(root,'src/pages/food/OxsteedCreditPage.css'),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/pages/food/OxsteedCreditCardsPage.css'),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/components/credit/CardSecurity.css'),'utf8');
    response.setHeader('Content-Type','text/html; charset=utf-8');
    response.end(`<html data-theme="${theme}" dir="${language==='ar'?'rtl':'ltr'}"><head><style>${styles}</style></head><body><div id="root"></div>
      <script>window.language=${JSON.stringify(language)};window.catalog=${JSON.stringify(catalog).replace(/</g,'\\u003c')};window.writes=[];
      window.railEnabled=${params.get('rail') === 'paused' ? 'false' : 'true'};
      window.cards=[{id:'card1',status:'active',cardType:'virtual',nickname:'Everyday',credentialLast4:'1234',hasRevealableNumber:true,hasSecurityCode:true,dailyLimitCents:null,merchantTypeLimits:null,hasPin:false,freezeOrigin:'customer'}];</script>
      <script type="module" src="/app.js"></script></body></html>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try { browser=await chromium.launch({headless:true,channel:'chrome'}); }
  catch(error) {await new Promise(resolve=>server.close(resolve));throw error;}
  return {browser,base:`http://127.0.0.1:${server.address().port}`,close:async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));}};
}

test('redesign renders in five locales, themes, RTL, mobile and reduced motion', async () => {
  const env=await fixture();
  try {
    const page=await env.browser.newPage(); const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    for(const language of ['en','es','fr','ht','ar']) for(const theme of ['light','dark']) {
      await page.setViewportSize(theme==='dark'?{width:390,height:844}:{width:1280,height:900});
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.goto(`${env.base}/?lang=${language}&theme=${theme}`);
      const catalog=JSON.parse(fs.readFileSync(path.join(root,'src/i18n/locales',language,'credit.json'),'utf8'));
      const t=catalog.redesign;
      const cards=catalog.cards;
      const addCredit=page.getByRole('button',{name:t.addCredit,exact:true});
      await addCredit.waitFor();
      // Hero action row: money-out actions are enabled while the rail is on.
      assert.equal(await page.getByRole('button',{name:t.send,exact:true}).isDisabled(),false);
      assert.equal(await page.getByRole('button',{name:t.withdraw,exact:true}).isDisabled(),false);
      assert.equal(await page.getByRole('button',{name:t.payInStore,exact:true}).isDisabled(),false);
      // The hero card thumbnail shows the masked number, never the full one.
      await page.getByText('•••• •••• •••• 1234').waitFor();
      assert.equal(await page.getByText('9700123456789012').count(),0);

      // Add Credit drawer opens, Escape closes it, focus returns to the trigger.
      await addCredit.click();
      const topupDialog=page.locator('dialog.ox-credit-drawer');
      await topupDialog.waitFor();
      assert.equal(await topupDialog.getAttribute('aria-label'),t.addCredit);
      await page.getByTestId('wallet-topup').waitFor();
      await page.keyboard.press('Escape');
      await topupDialog.waitFor({state:'detached'});
      assert.equal(await addCredit.evaluate(element=>element===document.activeElement),true);

      // Send drawer opens onto the transfer panel.
      await page.getByRole('button',{name:t.send,exact:true}).click();
      const sendDialog=page.locator('dialog.ox-credit-drawer');
      await sendDialog.waitFor();
      // The drawer head and the transfer panel both carry the title; the
      // panel heading (by id) is the one that proves the panel rendered.
      await sendDialog.locator('#credit-transfer-heading').waitFor();
      await sendDialog.getByRole('button',{name:t.closeDrawer,exact:true}).click();
      await sendDialog.waitFor({state:'detached'});

      // More menu lists Convert; the Convert drawer offers a self-serve quote.
      await page.getByRole('button',{name:t.more,exact:true}).click();
      await page.getByRole('button',{name:catalog.convertCredit,exact:true}).click();
      const convertDialog=page.locator('dialog.ox-credit-drawer');
      await convertDialog.waitFor();
      assert.equal(await convertDialog.getAttribute('aria-label'),catalog.convertCredit);
      await convertDialog.getByRole('button',{name:t.getQuote,exact:true}).waitFor();
      await convertDialog.getByRole('button',{name:t.closeDrawer,exact:true}).click();
      await convertDialog.waitFor({state:'detached'});

      // Cards drawer: Reveal runs the security step-up and shows the number once.
      await page.getByText('•••• •••• •••• 1234').click();
      const cardsDialog=page.locator('dialog.ox-credit-drawer');
      await cardsDialog.waitFor();
      await cardsDialog.getByRole('button',{name:cards.reveal,exact:true}).click();
      const securityDialog=page.locator('dialog.card-security-dialog');
      await securityDialog.waitFor();
      await securityDialog.getByLabel(cards.security.password,{exact:true}).fill('synthetic-password');
      await securityDialog.getByRole('button',{name:cards.security.send,exact:true}).click();
      await securityDialog.getByLabel(cards.security.emailCode,{exact:true}).fill('123456');
      await securityDialog.getByRole('button',{name:cards.security.verify,exact:true}).click();
      await securityDialog.waitFor({state:'detached'});
      await cardsDialog.getByText('9700 1234 5678 9012').waitFor();
      await cardsDialog.getByRole('button',{name:t.closeDrawer,exact:true}).click();
      await cardsDialog.waitFor({state:'detached'});

      // Activity tabs switch and each tab has a real empty state.
      await page.getByRole('tab',{name:t.tab.holds,exact:true}).click();
      await page.getByText(t.noHolds,{exact:true}).waitFor();
      await page.getByRole('tab',{name:t.tab.pending,exact:true}).click();
      await page.getByText(t.noPendingActivity,{exact:true}).waitFor();
      await page.getByRole('tab',{name:t.tab.disputes,exact:true}).click();
      await page.getByText(t.noDisputes,{exact:true}).waitFor();
      await page.getByRole('tab',{name:t.tab.all,exact:true}).click();
      await page.getByText(catalog.noActivity,{exact:true}).waitFor();

      // Header menu opens the Account drawer with the number and member code.
      await page.getByRole('button',{name:t.menu,exact:true}).click();
      await page.getByRole('menuitem',{name:t.cardsAndAccount,exact:true}).click();
      const accountDialog=page.locator('dialog.ox-credit-drawer');
      await accountDialog.waitFor();
      await accountDialog.getByText('8123456789',{exact:true}).waitFor();
      await accountDialog.getByText('12345678',{exact:true}).waitFor();
      // The drawer docks to the inline end: right edge in LTR, left edge in RTL.
      const box=await accountDialog.boundingBox();
      const viewport=page.viewportSize();
      if(language==='ar') assert.ok(box.x<=1, `RTL drawer should dock left, got x=${box.x}`);
      else assert.ok(box.x+box.width>=viewport.width-1, `LTR drawer should dock right, got right=${box.x+box.width} vs ${viewport.width}`);
      await accountDialog.getByRole('button',{name:t.closeDrawer,exact:true}).click();
      await accountDialog.waitFor({state:'detached'});

      assert.equal(await page.locator('html').getAttribute('dir'),language==='ar'?'rtl':'ltr');
      assert.deepEqual(errors,[]);
    }
  } finally {await env.close();}
});

test('money-out actions disable with a stated reason while the rail is paused', async () => {
  const env=await fixture();
  try {
    const page=await env.browser.newPage(); const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${env.base}/?lang=en&theme=light&rail=paused`);
    const catalog=JSON.parse(fs.readFileSync(path.join(root,'src/i18n/locales','en','credit.json'),'utf8'));
    const t=catalog.redesign;
    const addCredit=page.getByRole('button',{name:t.addCredit,exact:true});
    await addCredit.waitFor();
    assert.equal(await addCredit.isDisabled(),false);
    assert.equal(await page.getByRole('button',{name:t.send,exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:t.withdraw,exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:t.payInStore,exact:true}).isDisabled(),true);
    await page.getByText(t.moneyOutBlockedRail,{exact:true}).waitFor();
    await page.getByRole('button',{name:t.more,exact:true}).click();
    assert.equal(await page.getByRole('button',{name:catalog.convertCredit,exact:true}).isDisabled(),true);
    assert.deepEqual(errors,[]);
  } finally {await env.close();}
});

test('a top-up deep link opens the Add Credit drawer on load', async () => {
  const env=await fixture();
  try {
    const page=await env.browser.newPage(); const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${env.base}/?lang=en&theme=light&topupId=fixture-topup`);
    const catalog=JSON.parse(fs.readFileSync(path.join(root,'src/i18n/locales','en','credit.json'),'utf8'));
    await page.locator('dialog.ox-credit-drawer').waitFor();
    assert.equal(await page.locator('dialog.ox-credit-drawer').getAttribute('aria-label'),catalog.redesign.addCredit);
    await page.getByTestId('wallet-topup').waitFor();
    assert.deepEqual(errors,[]);
  } finally {await env.close();}
});
