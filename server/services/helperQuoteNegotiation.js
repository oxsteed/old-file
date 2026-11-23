'use strict';
const crypto=require('crypto');
const pool=require('../db');
const {withTransaction}=require('../utils/transaction');
const access=require('./access/accessService');
const {bidFromAcceptedQuote}=require('./jobQuoteBridge');
const {sendNotification}=require('./notificationService');
const logger=require('../utils/logger');
const AppError=require('../utils/appError');
const money=require('../validation/money');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(status,code)=>{throw new AppError(code,status,code);};
function id(value){if(!UUID.test(value||''))fail(400,'validation_failed');return value;}
function text(value,max){if(typeof value!=='string'||value.length>max)fail(400,'validation_failed');return value.trim();}
function terms(body){
 if(!body||!Array.isArray(body.line_items)||body.line_items.length<1||body.line_items.length>50)fail(400,'validation_failed');
 const line_items=body.line_items.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.quantity!=='number')fail(400,'validation_failed');
  const description=text(item.description,500),quantity=Number(item.quantity),price=item.unit_price_cents;
  if(!description||!Number.isFinite(quantity)||quantity<=0||quantity>10000||Math.abs(quantity*1000-Math.round(quantity*1000))>0.00001||!Number.isSafeInteger(price)||price<0||price>100000000||!['labor','material'].includes(item.type))fail(400,'validation_failed');
  return {description,quantity,unit_price_cents:price,type:item.type};
 });
 const subtotal_cents=line_items.reduce((sum,item)=>sum+money.bpsOf(item.unit_price_cents,Math.round(item.quantity*1000)*10),0);
 const tax_basis_points=body.tax_basis_points??0,valid_days=body.valid_days??7,notes=text(body.notes??'',4000);
 if(!Number.isInteger(tax_basis_points)||tax_basis_points<0||tax_basis_points>10000||!Number.isInteger(valid_days)||valid_days<1||valid_days>90)fail(400,'validation_failed');
 const tax_cents=money.bpsOf(subtotal_cents,tax_basis_points),total_cents=subtotal_cents+tax_cents;
 if(!Number.isSafeInteger(total_cents)||total_cents<=0||total_cents>2000000000)fail(400,'validation_failed');
 return {line_items,subtotal_cents,tax_cents,total_cents,tax_basis_points,valid_days,notes};
}
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Group 4 Slice C (169): every negotiation event notifies the counterparty.
// Sends run AFTER the transaction commits (sendNotification uses the pool,
// not the tx client) and only on a fresh state change — idempotent replays
// return the prior row and notify nothing. A failed send is logged, never
// thrown: a missed ping must not roll back an accepted quote.
async function notifyQuoteEvent({userId,type,title,body,data,actionUrl,key}){
 try{await sendNotification({userId,type,title,body,data,action_url:actionUrl,idempotencyKey:key});}
 catch(err){logger.warn('Failed to send quote negotiation notification',{type,error:err.message});}
}
async function helper(db,userId){if(!(await access.can(userId,'helper.offer_services',undefined,db)).allowed)fail(403,'access_required');}
async function job(db,jobId,userId,{write=false,provider=false}={}){
 id(jobId);
 const {rows:[row]}=await db.query(`SELECT id,client_id,title,status,revision,currency_code FROM jobs WHERE id=$1 AND deleted_at IS NULL${write?' FOR UPDATE':''}`,[jobId]);
 if(!row)fail(404,'not_found');
 if(!money.normalizeCurrency(row.currency_code||'USD'))fail(409,'unsupported_currency');
 if(String(row.client_id)!==String(userId))await helper(db,userId);
 if(provider&&String(row.client_id)===String(userId))fail(403,'own_job_quote');
 if(write&&!['published','matched','negotiating'].includes(row.status))fail(409,'job_not_open');
 return row;
}
async function quote(db,quoteId,userId,write=true){
 id(quoteId);
 const {rows:[ref]}=await db.query('SELECT job_id FROM helper_quotes WHERE id=$1 AND negotiation_managed=TRUE',[quoteId]);
 if(!ref)fail(404,'not_found');
 const owner=await job(db,ref.job_id,userId,{write});
 const {rows:[row]}=await db.query(`SELECT * FROM helper_quotes WHERE id=$1 AND negotiation_managed=TRUE${write?' FOR UPDATE':''}`,[quoteId]);
 if(String(owner.client_id)!==String(userId)&&String(row.helper_id)!==String(userId))fail(404,'not_found');
 return {row,owner};
}
function mutable(row,owner,expectedVersion,allowJobChange=false,allowExpiry=false){
 if(!Number.isInteger(expectedVersion)||expectedVersion!==row.version)fail(409,'quote_version_conflict');
 if(row.superseded_at||!(allowExpiry?['sent','declined','expired']:['sent','declined']).includes(row.status)||row.booking_request_id)fail(409,'quote_locked');
 if(!allowExpiry&&(!row.valid_until||new Date(row.valid_until).getTime()<=Date.now()))fail(409,'quote_expired');
 if(!allowJobChange&&Number(row.job_revision)!==Number(owner.revision))fail(409,'job_revision_changed');
}
async function insert(db,owner,userId,value,requestId,fingerprint,parent=null){
 const {rows:[row]}=await db.query(`INSERT INTO helper_quotes(job_id,helper_id,client_user_id,title,line_items,tax_rate,subtotal_cents,tax_cents,total_cents,notes,status,valid_until,parent_quote_id,version,negotiation_managed,job_revision,currency_code,client_request_id,request_hash)
 VALUES($1,$2,$3,'Job quote',$4,$5,$6,$7,$8,$9,'sent',NOW()+($10::int * INTERVAL '1 day'),$11,$12,TRUE,$13,$14,$15,$16) RETURNING *`,
 [owner.id,userId,owner.client_id,JSON.stringify(value.line_items),value.tax_basis_points/10000,value.subtotal_cents,value.tax_cents,value.total_cents,value.notes,value.valid_days,parent?.id||null,(parent?.version||0)+1,owner.revision,owner.currency_code||'USD',requestId,fingerprint]);
 if(parent){
  await db.query('UPDATE helper_quotes SET superseded_at=NOW(),updated_at=NOW() WHERE id=$1',[parent.id]);
  await db.query("UPDATE helper_quote_counters SET status='superseded' WHERE quote_id=$1 AND status='pending'",[parent.id]);
 }
 return row;
}
async function create(jobId,userId,body){
 const value=terms(body),requestId=id(body.requestId),fingerprint=hash({jobId,value});
 let created=null,owner=null;
 const quote=await withTransaction(pool,async db=>{
  owner=await job(db,jobId,userId,{write:true,provider:true});
  if(body.expectedJobRevision!==owner.revision)fail(409,'job_revision_changed');
  const {rows:[prior]}=await db.query('SELECT * FROM helper_quotes WHERE helper_id=$1 AND client_request_id=$2',[userId,requestId]);
  if(prior){if(prior.request_hash!==fingerprint)fail(409,'idempotency_conflict');return prior;}
  const existing=await db.query("SELECT id FROM helper_quotes WHERE job_id=$1 AND helper_id=$2 AND negotiation_managed AND superseded_at IS NULL AND status IN ('sent','accepted')",[jobId,userId]);
  if(existing.rows.length)fail(409,'quote_exists');
  created=await insert(db,owner,userId,value,requestId,fingerprint);
  return created;
 },'helper_quote_create');
 if(created)await notifyQuoteEvent({userId:owner.client_id,type:'helper_quote_received',title:'New quote on your job',body:'A helper sent an itemized quote for your job.',data:{job_id:owner.id,quote_id:created.id,total_cents:created.total_cents,currency_code:created.currency_code},actionUrl:`/jobs/${owner.id}`,key:`helper-quote-received:${created.id}`});
 return quote;
}
async function revise(quoteId,userId,body){
 const value=terms(body),requestId=id(body.requestId),fingerprint=hash({quoteId,value});
 let created=null,owner=null;
 const result=await withTransaction(pool,async db=>{
  const found=await quote(db,quoteId,userId);
  const row=found.row;owner=found.owner;
  if(String(row.helper_id)!==String(userId))fail(403,'forbidden');
  const {rows:[prior]}=await db.query('SELECT * FROM helper_quotes WHERE helper_id=$1 AND client_request_id=$2',[userId,requestId]);
  if(prior){if(prior.request_hash!==fingerprint)fail(409,'idempotency_conflict');return prior;}
  if(body.expectedJobRevision!==owner.revision)fail(409,'job_revision_changed');
  mutable(row,owner,body.expectedVersion,true,true);
  created=await insert(db,owner,userId,value,requestId,fingerprint,row);
  return created;
 },'helper_quote_revise');
 if(created)await notifyQuoteEvent({userId:owner.client_id,type:'helper_quote_revised',title:'A quote was revised',body:'A helper updated their itemized quote for your job.',data:{job_id:owner.id,quote_id:created.id,total_cents:created.total_cents,currency_code:created.currency_code},actionUrl:`/jobs/${owner.id}`,key:`helper-quote-revised:${created.id}`});
 return result;
}
async function respond(quoteId,userId,body){
 if(!['accepted','declined'].includes(body?.status))fail(400,'validation_failed');
 let changed=null,owner=null;
 const result=await withTransaction(pool,async db=>{
  const found=await quote(db,quoteId,userId);
  const row=found.row;owner=found.owner;
  if(String(owner.client_id)!==String(userId))fail(403,'forbidden');
  await helper(db,row.helper_id);
  if(row.status===body.status&&!row.superseded_at&&row.version===body.expectedVersion){
   const {rows:[prior]}=await db.query("SELECT id FROM bids WHERE job_id=$1 AND helper_id=$2 AND metadata->>'quote_id'=$3",[owner.id,row.helper_id,row.id]);
   return {...row,bid_id:prior?.id||null};
  }
  mutable(row,owner,body.expectedVersion);
  if(row.status!=='sent')fail(409,'quote_locked');
  const {rows:[updated]}=await db.query('UPDATE helper_quotes SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *',[row.id,body.status]);
  const bidId=body.status==='accepted'?await bidFromAcceptedQuote(updated,db):null;
  if(body.status==='accepted'&&!bidId)fail(409,'bid_conflict');
  await db.query("UPDATE helper_quote_counters SET status='superseded' WHERE quote_id=$1 AND status='pending'",[row.id]);
  changed={...updated,bid_id:bidId};
  return changed;
 },'helper_quote_respond');
 if(changed)await notifyQuoteEvent({userId:changed.helper_id,type:body.status==='accepted'?'helper_quote_accepted':'helper_quote_declined',title:body.status==='accepted'?'Your quote was accepted':'Your quote was declined',body:body.status==='accepted'?'The customer accepted your quote.':'The customer declined your quote.',data:{job_id:owner.id,quote_id:changed.id,bid_id:changed.bid_id||null,total_cents:changed.total_cents,currency_code:changed.currency_code},actionUrl:`/jobs/${owner.id}`,key:`helper-quote-${body.status}:${changed.id}:${changed.version}`});
 return result;
}
async function counter(quoteId,userId,body){
 const value=terms(body),requestId=id(body.requestId),fingerprint=hash({quoteId,value});
 let created=null,owner=null,quoteRow=null;
 const result=await withTransaction(pool,async db=>{
  const found=await quote(db,quoteId,userId);
  const row=found.row;owner=found.owner;quoteRow=row;
  if(String(owner.client_id)!==String(userId))fail(403,'forbidden');
  const {rows:[prior]}=await db.query('SELECT * FROM helper_quote_counters WHERE customer_id=$1 AND request_id=$2',[userId,requestId]);
  if(prior){if(prior.request_hash!==fingerprint)fail(409,'idempotency_conflict');return prior;}
  mutable(row,owner,body.expectedVersion);
  const pending=await db.query("SELECT id FROM helper_quote_counters WHERE quote_id=$1 AND status='pending'",[row.id]);
  if(pending.rows.length)fail(409,'counter_pending');
  created=(await db.query(`INSERT INTO helper_quote_counters(quote_id,customer_id,line_items,tax_basis_points,valid_days,notes,request_id,request_hash)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[row.id,userId,JSON.stringify(value.line_items),value.tax_basis_points,value.valid_days,value.notes,requestId,fingerprint])).rows[0];
  return created;
 },'helper_quote_counter');
 if(created)await notifyQuoteEvent({userId:quoteRow.helper_id,type:'helper_quote_counter_proposed',title:'New counteroffer on your quote',body:'The customer proposed a counteroffer on your quote.',data:{job_id:owner.id,quote_id:quoteRow.id,counter_id:created.id},actionUrl:`/jobs/${owner.id}`,key:`helper-quote-counter:${created.id}`});
 return result;
}
async function counterRespond(counterId,userId,body){
 id(counterId);if(!['accepted','declined'].includes(body?.status))fail(400,'validation_failed');
 let changed=null,owner=null,quoteRow=null;
 const result=await withTransaction(pool,async db=>{
  const {rows:[ref]}=await db.query('SELECT quote_id FROM helper_quote_counters WHERE id=$1',[counterId]);
  if(!ref)fail(404,'not_found');
  const found=await quote(db,ref.quote_id,userId);
  const row=found.row;owner=found.owner;quoteRow=row;
  if(String(row.helper_id)!==String(userId))fail(403,'forbidden');
  const {rows:[proposal]}=await db.query('SELECT * FROM helper_quote_counters WHERE id=$1 FOR UPDATE',[counterId]);
  if(proposal.status===body.status)return {counter:proposal};
  mutable(row,owner,body.expectedVersion);
  if(proposal.status!=='pending')fail(409,'counter_locked');
  const revised=body.status==='accepted'?await insert(db,owner,userId,terms(proposal),null,null,row):null;
  const {rows:[updated]}=await db.query('UPDATE helper_quote_counters SET status=$2,result_quote_id=$3 WHERE id=$1 RETURNING *',[counterId,body.status,revised?.id||null]);
  changed={counter:updated,quote:revised};
  return changed;
 },'helper_counter_respond');
 if(changed)await notifyQuoteEvent({userId:owner.client_id,type:body.status==='accepted'?'helper_quote_counter_accepted':'helper_quote_counter_declined',title:body.status==='accepted'?'Counteroffer accepted':'Counteroffer declined',body:body.status==='accepted'?'The helper accepted your counteroffer and issued a revised quote.':'The helper declined your counteroffer. The original quote still stands.',data:{job_id:owner.id,quote_id:changed.quote?.id||quoteRow.id,counter_id:changed.counter.id},actionUrl:`/jobs/${owner.id}`,key:`helper-quote-counter-${body.status}:${changed.counter.id}`});
 return result;
}
async function list(jobId,userId){
 const owner=await job(pool,jobId,userId);
 const customer=String(owner.client_id)===String(userId);
 const {rows:quotes}=await pool.query(`SELECT hq.*, (SELECT b.id FROM bids b WHERE b.job_id=hq.job_id AND b.helper_id=hq.helper_id AND b.metadata->>'quote_id'=hq.id::text LIMIT 1) AS bid_id FROM helper_quotes hq WHERE hq.job_id=$1 AND hq.negotiation_managed AND ($2 OR hq.helper_id=$3) ORDER BY hq.created_at DESC,hq.id DESC LIMIT 200`,[jobId,customer,userId]);
 const {rows:counters}=await pool.query('SELECT * FROM helper_quote_counters WHERE quote_id=ANY($1::uuid[]) ORDER BY created_at DESC',[quotes.map(row=>row.id)]);
 return {quotes,counters,customer,currency_code:owner.currency_code||'USD',job_revision:owner.revision,open:['published','matched','negotiating'].includes(owner.status)};
}
async function templates(userId){await helper(pool,userId);return (await pool.query('SELECT id,name,currency_code,line_items,version FROM helper_material_templates WHERE helper_id=$1 ORDER BY created_at DESC LIMIT 50',[userId])).rows;}
async function templateCreate(userId,body){
 const value=terms({...body,tax_basis_points:0,valid_days:7,notes:''}),name=text(body.name,100);
 if(!name||!money.normalizeCurrency(body.currency_code))fail(400,'validation_failed');
 return withTransaction(pool,async db=>{
  await helper(db,userId);await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
  const {rows:[count]}=await db.query('SELECT COUNT(*)::int AS total FROM helper_material_templates WHERE helper_id=$1',[userId]);
  if(count.total>=50)fail(409,'template_limit');
  return (await db.query('INSERT INTO helper_material_templates(helper_id,name,currency_code,line_items) VALUES($1,$2,$3,$4) RETURNING *',[userId,name,body.currency_code,JSON.stringify(value.line_items)])).rows[0];
 },'helper_material_template');
}
async function templateUpdate(userId,templateId,body){
 id(templateId);const value=terms({...body,tax_basis_points:0,valid_days:7,notes:''}),name=text(body.name,100);
 if(!name||!money.normalizeCurrency(body.currency_code)||!Number.isInteger(body.expectedVersion))fail(400,'validation_failed');
 await helper(pool,userId);
 const {rows:[row]}=await pool.query(`UPDATE helper_material_templates SET name=$3,currency_code=$4,line_items=$5,version=version+1
  WHERE id=$1 AND helper_id=$2 AND version=$6 RETURNING *`,[templateId,userId,name,body.currency_code,JSON.stringify(value.line_items),body.expectedVersion]);
 if(!row)fail(409,'template_version_conflict');return row;
}
async function templateDelete(userId,templateId){id(templateId);await helper(pool,userId);const result=await pool.query('DELETE FROM helper_material_templates WHERE id=$1 AND helper_id=$2',[templateId,userId]);if(!result.rowCount)fail(404,'not_found');}
module.exports={terms,create,revise,respond,counter,counterRespond,list,templates,templateCreate,templateUpdate,templateDelete};
