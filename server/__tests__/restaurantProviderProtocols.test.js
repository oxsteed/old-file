'use strict';
jest.mock('../db',()=>({query:jest.fn()}));
jest.mock('../services/restaurantProviderSecrets',()=>({resolveReferences:jest.fn()}));
const crypto=require('crypto');
const db=require('../db');
const secrets=require('../services/restaurantProviderSecrets');
const {encrypt}=require('../utils/encryption');
const provider=require('../services/restaurantAccountingProvider');
const webhook=require('../controllers/restaurantMarketplaceWebhookController');
const oldFetch=global.fetch;
afterEach(()=>{global.fetch=oldFetch;jest.clearAllMocks();});
const integration={id:1,provider:'quickbooks',external_company_id:'synthetic-company',credential_version:0};
const document={id:'00000000-0000-4000-8000-000000000001',document_date:'2026-10-01',payload:{currency:'USD',lines:[
  {account:'1000',debit:'12.00',credit:'0.00',description:'Cash'},
  {account:'4000',debit:'0.00',credit:'12.00',description:'Sales'},
]}};
const response=value=>({ok:true,text:async()=>JSON.stringify(value)});
test('QuickBooks resolves account IDs and sends a balanced journal with a stable request ID',async()=>{
  const calls=[];
  global.fetch=jest.fn(async(url,options)=>{calls.push({url,options});return response(url.includes('/query?')?{QueryResponse:{Account:[{Id:url.includes('1000')?'10':'40',Active:true}]}}:{JournalEntry:{Id:'journal-1'}});});
  expect(await provider.postDocument(integration,document,{accessToken:'synthetic'})).toBe('journal-1');
  const post=calls.find(c=>c.options.method==='POST');expect(post.url).toContain('sandbox-quickbooks.api.intuit.com');expect(post.url).toContain('requestid='+document.id);
  const journal=JSON.parse(post.options.body);expect(journal.CurrencyRef.value).toBe('USD');expect(journal.Line.map(l=>l.JournalEntryLineDetail.PostingType)).toEqual(['Debit','Credit']);
  expect(journal.Line.map(l=>l.JournalEntryLineDetail.AccountRef.value)).toEqual(['10','40']);
});
test('matching journal names cannot reconcile wrong amounts',async()=>{
  global.fetch=jest.fn(async url=>response(url.includes('/query?')?{QueryResponse:{JournalEntry:[{Id:'journal-1'}]}}:url.includes('/account/')?{Account:{AcctNum:url.endsWith('/10')?'1000':'4000'}}:{JournalEntry:{Id:'journal-1',PrivateNote:provider.marker(document.id),TxnDate:document.document_date,CurrencyRef:{value:'USD'},Line:[{Amount:11,JournalEntryLineDetail:{PostingType:'Debit',AccountRef:{value:'10'}}},{Amount:11,JournalEntryLineDetail:{PostingType:'Credit',AccountRef:{value:'40'}}}]}}));
  expect(await provider.reconcileDocument(integration,document,{accessToken:'synthetic'})).toEqual([expect.objectContaining({verified:false})]);
});
test('refresh fences stale rotated credentials before a provider call',async()=>{
  secrets.resolveReferences.mockResolvedValue({clientId:'synthetic',clientSecret:'synthetic'});db.query.mockResolvedValue({rowCount:0,rows:[]});global.fetch=jest.fn();
  await expect(provider.tokens({...integration,credentials_ciphertext:encrypt(JSON.stringify({refreshToken:'stale'}))})).rejects.toMatchObject({code:'provider_refresh_busy'});
  expect(global.fetch).not.toHaveBeenCalled();expect(db.query.mock.calls[0][0]).toContain('credential_version=$3');
});
test('Xero refuses dispatch in a different base currency',async()=>{
  global.fetch=jest.fn(async()=>response({Organisations:[{BaseCurrency:'EUR'}]}));
  await expect(provider.postDocument({...integration,provider:'xero'},document,{accessToken:'synthetic'})).rejects.toMatchObject({code:'provider_currency_mismatch'});
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
test('webhook verification covers exact bytes and configured auth tokens',()=>{
  const raw=Buffer.from('{"event_type":"orders.notification"}'),secret='synthetic-test-secret';
  const signature=crypto.createHmac('sha256',secret).update(raw).digest('hex');
  expect(webhook.verify('uber_eats',raw,{'x-uber-signature':signature},secret)).toBe(true);
  expect(webhook.verify('uber_eats',Buffer.concat([raw,Buffer.from(' ')]),{'x-uber-signature':signature},secret)).toBe(false);
  expect(webhook.verify('doordash',raw,{authorization:secret},secret)).toBe(true);
  expect(webhook.verify('doordash',raw,{authorization:'forged'},secret)).toBe(false);
  expect(webhook.verify('grubhub',raw,{authorization:secret},secret)).toBe(false);
});
test('OAuth state replay is rejected before code exchange',async()=>{
  db.query.mockResolvedValue({rows:[]});global.fetch=jest.fn();
  await expect(provider.finishOAuth(integration,'synthetic-user',{state:'a'.repeat(64),code:'synthetic-code'})).rejects.toMatchObject({code:'provider_oauth_state_invalid'});
  expect(global.fetch).not.toHaveBeenCalled();
});

test('two-decimal journal contract rejects minor-unit precision it cannot represent',async()=>{
  await expect(require('../services/restaurantAccountingService').queueExport(db,{restaurantId:1,provider:'xero',periodFrom:'2026-10-01',periodTo:'2026-10-01',currencyCode:'JPY',idempotencyKey:'synthetic-key',lines:[]})).rejects.toMatchObject({code:'accounting_currency_precision_unsupported'});
  expect(db.query).not.toHaveBeenCalled();
});
