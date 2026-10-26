'use strict';
const crypto=require('crypto');
const {encrypt,decrypt}=require('../utils/encryption');
const db=require('../db');
const secrets=require('./restaurantProviderSecrets');
const accounting=require('./restaurantAccountingService');
const error=(code)=>Object.assign(Error(code),{code});
const config=provider=>provider==='xero'?{
  authorize:'https://login.xero.com/identity/connect/authorize',token:'https://identity.xero.com/connect/token',
  api:'https://api.xero.com/api.xro/2.0',scope:'offline_access accounting.transactions accounting.settings',prefix:'XERO',
}:{authorize:'https://appcenter.intuit.com/connect/oauth2',token:'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
  api:process.env.RESTAURANT_ACCOUNTING_PRODUCTION==='true'?'https://quickbooks.api.intuit.com/v3/company':'https://sandbox-quickbooks.api.intuit.com/v3/company',
  scope:'com.intuit.quickbooks.accounting',prefix:'QUICKBOOKS'};

async function json(url,options={}) {
  const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Object.assign(error(`provider_http_${response.status}`),{httpStatus:response.status});
  const text=await response.text();if(text.length>2*1024*1024)throw error('provider_response_too_large');
  try{return JSON.parse(text);}catch{throw error('provider_invalid_response');}
}
async function clientCredentials(integration){
  const c=config(integration.provider);
  return secrets.resolveReferences({clientId:process.env[`RESTAURANT_${c.prefix}_CLIENT_ID`]||'',
    clientSecret:process.env[`RESTAURANT_${c.prefix}_CLIENT_SECRET_REF`]||'',
    accessToken:integration.access_token_ref,refreshToken:integration.refresh_token_ref});
}
async function tokens(integration){
  let credentials=integration.credentials_ciphertext?JSON.parse(decrypt(integration.credentials_ciphertext)):await clientCredentials(integration);
  if(integration.token_expires_at&&Date.parse(integration.token_expires_at)>Date.now()+60000){
    if(!credentials.accessToken)throw error('provider_oauth_required');
    return credentials;
  }
  const lease=crypto.randomUUID();
  const {rowCount}=await db.query(`UPDATE restaurant_accounting_integrations SET credential_lease=$2,credential_lease_until=NOW()+INTERVAL '1 minute'
    WHERE id=$1 AND credential_version=$3 AND (credential_lease_until IS NULL OR credential_lease_until<NOW())`,[integration.id,lease,integration.credential_version]);
  if(!rowCount)throw error('provider_refresh_busy');
  try{
    const c=config(integration.provider);
    const app=await clientCredentials(integration);
    if(!app.clientId||!app.clientSecret||!credentials.refreshToken)throw error('provider_oauth_required');
    const renewed=await json(c.token,{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}`,
      'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:credentials.refreshToken})});
    if(!renewed.access_token||!renewed.refresh_token||!Number.isFinite(renewed.expires_in)||renewed.expires_in<=0)throw error('provider_token_invalid');
    credentials={accessToken:renewed.access_token,refreshToken:renewed.refresh_token};
    const saved=await db.query(`UPDATE restaurant_accounting_integrations SET credentials_ciphertext=$3,token_expires_at=NOW()+($4*INTERVAL '1 second'),
      credential_version=credential_version+1,credential_lease=NULL,credential_lease_until=NULL WHERE id=$1 AND credential_lease=$2 RETURNING id`,
      [integration.id,lease,encrypt(JSON.stringify(credentials)),renewed.expires_in]);
    if(!saved.rowCount)throw error('provider_refresh_fenced');
    return credentials;
  }finally{await db.query('UPDATE restaurant_accounting_integrations SET credential_lease=NULL,credential_lease_until=NULL WHERE id=$1 AND credential_lease=$2',[integration.id,lease]);}
}
async function api(integration,credentials,path,options={}){
  if(!integration.external_company_id)throw error('provider_company_required');
  const c=config(integration.provider);
  const base=integration.provider==='xero'?c.api:`${c.api}/${encodeURIComponent(integration.external_company_id)}`;
  const cacheable = !options.method && (path === '/Organisation' || path.startsWith('/query?') || path.startsWith('/account/'));
  if (!credentials.metadataCache) Object.defineProperty(credentials,'metadataCache',{value:new Map(),enumerable:false});
  const key = `${integration.provider}:${integration.external_company_id}:${path}`;
  const prior = credentials.metadataCache.get(key);
  if (cacheable && prior && prior.expires>Date.now()) return prior.value;
  const request = () => json(`${base}${path}`,{...options,headers:{Authorization:`Bearer ${credentials.accessToken}`,
    Accept:'application/json','Content-Type':'application/json',...(integration.provider==='xero'?{'Xero-tenant-id':integration.external_company_id}:{}),...options.headers}});
  const value = await request();
  if (cacheable) {
    if (credentials.metadataCache.size>=100) credentials.metadataCache.clear();
    credentials.metadataCache.set(key,{value,expires:Date.now()+60000});
  }
  return value;
}
const marker=id=>`OxSteed journal ${id}`;
function qboLines(lines,accounts){return lines.map(line=>({Amount:Number(line.debit||0)+Number(line.credit||0),Description:line.description,
  DetailType:'JournalEntryLineDetail',JournalEntryLineDetail:{PostingType:Number(line.debit)>0?'Debit':'Credit',AccountRef:{value:accounts[line.account]}}}));}

async function postDocument(integration,document,credentials){
  const lines=document.payload.lines;
  if(integration.provider==='xero'){
    const organisation=await api(integration,credentials,'/Organisation');
    if(organisation.Organisations?.[0]?.BaseCurrency!==document.payload.currency)throw error('provider_currency_mismatch');
    const result=await api(integration,credentials,'/ManualJournals',{method:'POST',headers:{'Idempotency-Key':document.id},body:JSON.stringify({ManualJournals:[{
      Narration:marker(document.id),Date:document.document_date,Status:'POSTED',LineAmountTypes:'NoTax',
      JournalLines:lines.map(l=>({Description:l.description,AccountCode:l.account,LineAmount:Number(l.debit)-Number(l.credit),TaxType:'NONE'})),
    }]})});
    const row=result.ManualJournals?.[0];
    if(!row?.ManualJournalID||row.HasErrors||row.Status!=='POSTED')throw error('provider_journal_not_posted');
    return String(row.ManualJournalID);
  }
  const codes=[...new Set(lines.map(l=>l.account))];
  const accounts={};
  for(const code of codes){
    // Mapping values are validated account codes, never arbitrary provider SQL.
    if(!/^[A-Za-z0-9._-]{1,80}$/.test(code))throw error('provider_account_mapping_invalid');
    const query=encodeURIComponent(`select * from Account where AcctNum = '${code}'`);
    const rows=(await api(integration,credentials,`/query?query=${query}`)).QueryResponse?.Account;
    if(rows?.length!==1||!rows[0].Active)throw error('provider_account_not_found');
    accounts[code]=rows[0].Id;
  }
  const result=await api(integration,credentials,`/journalentry?requestid=${document.id}`,{method:'POST',body:JSON.stringify({
    TxnDate:document.document_date,DocNumber:document.id.slice(0,21),PrivateNote:marker(document.id),
    CurrencyRef:{value:document.payload.currency},Line:qboLines(lines,accounts),
  })});
  if(!result.JournalEntry?.Id)throw error('provider_journal_not_posted');
  return String(result.JournalEntry.Id);
}

async function reconcileDocument(integration,document,credentials){
  let rows;
  if(integration.provider==='xero'){
    rows=(await api(integration,credentials,`/ManualJournals?where=${encodeURIComponent(`Narration=="${marker(document.id)}"`)}`)).ManualJournals||[];
  }else{
    rows=(await api(integration,credentials,`/query?query=${encodeURIComponent(`select * from JournalEntry where DocNumber = '${document.id.slice(0,21)}'`)}`)).QueryResponse?.JournalEntry||[];
  }
  const candidates=[];
  for(const summary of rows){
    const id=String(summary.ManualJournalID||summary.Id);
    if(!/^[a-zA-Z0-9-]{1,100}$/.test(id))continue;
    const result=await api(integration,credentials,integration.provider==='xero'?`/ManualJournals/${id}`:`/journalentry/${id}`);
    const row=integration.provider==='xero'?result.ManualJournals?.[0]:result.JournalEntry;
    if(!row)continue;
    let currency=row.CurrencyRef?.value;
    let date=row.TxnDate;
    let remote=[];
    if(integration.provider==='xero'){
      currency=(await api(integration,credentials,'/Organisation')).Organisations?.[0]?.BaseCurrency;
      date=row.DateString?.slice(0,10)||row.Date?.slice(0,10);
      const timestamp=/^\/Date\((\d+)/.exec(row.Date||'');
      if(timestamp)date=new Date(Number(timestamp[1])).toISOString().slice(0,10);
      remote=(row.JournalLines||[]).map(l=>({account:l.AccountCode,debit:Number(l.LineAmount)>0?l.LineAmount:0,credit:Number(l.LineAmount)<0?-Number(l.LineAmount):0}));
    }else{
      for(const line of row.Line||[]){
        const detail=line.JournalEntryLineDetail;if(!detail)continue;
        const accountId=String(detail.AccountRef?.value||'');if(!/^[A-Za-z0-9-]+$/.test(accountId))continue;
        const account=(await api(integration,credentials,`/account/${accountId}`)).Account;
        remote.push({account:account?.AcctNum,debit:detail.PostingType==='Debit'?line.Amount:0,credit:detail.PostingType==='Credit'?line.Amount:0});
      }
    }
    let amountsMatch=false;
    try{amountsMatch=journalFacts(remote)===journalFacts(document.payload.lines);}catch{/* malformed remote facts never verify */}
    const reference=integration.provider==='xero'?row.Narration:row.PrivateNote;
    const verified=reference===marker(document.id)&&date===String(document.document_date).slice(0,10)&&currency===document.payload.currency
      && amountsMatch && (integration.provider!=='xero'||row.Status==='POSTED')
      && (!document.external_id||document.external_id===id);
    candidates.push({externalId:id,status:row.Status||null,verified});
  }
  return candidates;
}

function journalFacts(lines){
  if(!Array.isArray(lines)||!lines.length)throw error('provider_journal_empty');
  const facts=new Map();
  for(const l of lines){if(!l.account)throw error('provider_account_missing');
    const key=String(l.account);const old=facts.get(key)||[0n,0n];
    const debit=accounting.money(l.debit||0).cents,credit=accounting.money(l.credit||0).cents;
    facts.set(key,[old[0]+debit,old[1]+credit]);
  }
  return JSON.stringify([...facts].sort(([a],[b])=>a.localeCompare(b)).map(([account,[debit,credit]])=>[account,String(debit),String(credit)]));
}

async function startOAuth(integration,userId){
  accounting.normalizeProvider(integration.provider);
  const base=new URL(process.env.RESTAURANT_ACCOUNTING_CALLBACK_BASE||'');
  if(base.protocol!=='https:'||base.username||base.password)throw error('provider_callback_configuration_required');
  const redirect=new URL(`/api/restaurants/${integration.restaurant_id}/accounting/${integration.provider}/oauth/callback`,base).href;
  const app=await clientCredentials(integration);
  if(!app.clientId||!app.clientSecret)throw error('provider_credentials_unavailable');
  const state=crypto.randomBytes(32).toString('hex');
  await db.query(`INSERT INTO restaurant_accounting_oauth_states(state_hash,integration_id,user_id,redirect_uri) VALUES($1,$2,$3,$4)`,
    [crypto.createHash('sha256').update(state).digest('hex'),integration.id,userId,redirect]);
  const url=new URL(config(integration.provider).authorize);
  url.search=new URLSearchParams({client_id:app.clientId,response_type:'code',scope:config(integration.provider).scope,redirect_uri:redirect,state}).toString();
  return {authorizationUrl:url.href};
}
async function finishOAuth(integration,userId,{state,code,realmId},afterConnect=async()=>{}){
  if(!/^[a-f0-9]{64}$/.test(state||'')||typeof code!=='string'||code.length>4096)throw error('provider_oauth_invalid');
  const {rows:[grant]}=await db.query(`UPDATE restaurant_accounting_oauth_states SET consumed_at=NOW()
    WHERE state_hash=$1 AND integration_id=$2 AND user_id=$3 AND expires_at>NOW() AND consumed_at IS NULL RETURNING *`,
    [crypto.createHash('sha256').update(state).digest('hex'),integration.id,userId]);
  if(!grant)throw error('provider_oauth_state_invalid');
  const app=await clientCredentials(integration);
  const response=await json(config(integration.provider).token,{method:'POST',headers:{
    Authorization:`Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:grant.redirect_uri})});
  if(!response.access_token||!response.refresh_token||!Number.isFinite(response.expires_in)||response.expires_in<=0)throw error('provider_token_invalid');
  let company=realmId;
  if(integration.provider==='xero'){
    const connections=await json('https://api.xero.com/connections',{headers:{Authorization:`Bearer ${response.access_token}`}});
    company=connections.find(c=>c.tenantId===integration.external_company_id)?.tenantId;
  }
  if(!company||String(company)!==integration.external_company_id)throw error('provider_company_mismatch');
  await require('../utils/transaction').withTransaction(db,async client=>{
  const saved=await client.query(`UPDATE restaurant_accounting_integrations SET credentials_ciphertext=$2,
    token_expires_at=NOW()+($3*INTERVAL '1 second'),credential_version=credential_version+1,status='active' WHERE id=$1 AND credential_version=$4 AND external_company_id=$5 RETURNING id`,
    [integration.id,encrypt(JSON.stringify({accessToken:response.access_token,refreshToken:response.refresh_token})),response.expires_in,integration.credential_version,integration.external_company_id]);
  if(!saved.rowCount)throw error('provider_connection_changed');
  await afterConnect(client);
  });
  return {connected:true,provider:integration.provider};
}
module.exports={tokens,postDocument,reconcileDocument,startOAuth,finishOAuth,marker,qboLines,journalFacts};
