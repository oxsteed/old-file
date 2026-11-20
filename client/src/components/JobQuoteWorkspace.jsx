import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import { createMessageRequestId } from '../lib/messageRequestId';
import { useAuth } from '../hooks/useAuth';
import useAccessProjection, { ACCESS_CHANGED_EVENT } from '../hooks/useAccessProjection';
import { currentAuthEpoch, isCurrentAuthEpoch } from '../api/authSessionEpoch';
import { toMinor, fromMinor, formatMoney, bpsOf } from '../shared/money';
import { formatDate } from '../lib/format';
import './HelperWorkPanel.css';

const ROOT='/helper-quotes/negotiations';
const empty=()=>({line_items:[{description:'',quantity:'1',price:'',type:'labor'}],notes:'',tax:'0',valid_days:'7'});
export default function JobQuoteWorkspace({jobId,isOwner}) {
 const {user}=useAuth();
 const projection=useAccessProjection(user);
 const allowed=projection?.status==='ready'&&projection.access?.personal?.includes('helper.offer_services')&&projection.access?.activation?.['helper.offer_services']?.ready!==false;
 const epoch=currentAuthEpoch();
 return user?.id&&(isOwner||allowed)?<Workspace key={`${user.id}:${epoch}:${jobId}`} jobId={jobId} epoch={epoch}/>:null;
}
function Workspace({jobId,epoch}) {
 const {t,i18n}=useTranslation(),fieldId=useId();
 const tr=name=>t(`quoteWorkspace.${name}`);
 const [data,setData]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [draft,setDraft]=useState(empty),[parent,setParent]=useState(null),[editing,setEditing]=useState(false);
 const [templates,setTemplates]=useState([]),[templateName,setTemplateName]=useState(''),[templateEdit,setTemplateEdit]=useState(null),[busy,setBusy]=useState(false);
 const alive=useRef(true),generation=useRef(0),retry=useRef(null);
 const current=()=>alive.current&&isCurrentAuthEpoch(epoch);
 async function load() {
  const seq=++generation.current;setError('');
  try {
   const response=await api.get(`${ROOT}/jobs/${jobId}`);
   if(!current()||seq!==generation.current)return;
   if(!Array.isArray(response.data?.quotes)||!Array.isArray(response.data?.counters))throw new Error('Invalid quote response');
   setData(response.data);
   if(!response.data.customer){
    const saved=await api.get(`${ROOT}/materials`);
    if(current()&&seq===generation.current)setTemplates(saved.data.templates||[]);
   }
  }catch{if(current()&&seq===generation.current){setData(null);setTemplates([]);setEditing(false);setError('loadError');}}
 }
 useEffect(()=>{
  alive.current=true;load();
  const refresh=()=>{setData(null);setEditing(false);setDraft(empty());setTemplates([]);load();};
  window.addEventListener(ACCESS_CHANGED_EVENT,refresh);
  return()=>{alive.current=false;generation.current++;window.removeEventListener(ACCESS_CHANGED_EVENT,refresh);};
 },[jobId,epoch]);
 async function run(action) {
  if(busy||!current())return;
  const seq=generation.current,valid=()=>current()&&seq===generation.current;
  setBusy(true);setError('');setNotice('');
  try{await action(valid);}catch(err){if(valid()){
   if([403,404].includes(err.response?.status)){setData(null);setTemplates([]);setEditing(false);setDraft(empty());}
   const code=err.response?.data?.code;
   setError(['quote_version_conflict','job_revision_changed','quote_locked','quote_expired','counter_pending','idempotency_conflict','quote_exists','template_version_conflict'].includes(code)?code:'saveError');
  }}finally{if(current())setBusy(false);}
 }
 const currency=data?.currency_code||'USD';
 const money=value=>formatMoney(Number(value),currency,i18n.language);
 function payload(){
  const line_items=draft.line_items.map(row=>({description:row.description.trim(),quantity:Number(row.quantity),unit_price_cents:toMinor(row.price,currency),type:row.type}));
  const tax_basis_points=toMinor(draft.tax,'USD'),valid_days=Number(draft.valid_days);
  if(line_items.some(row=>!row.description||row.unit_price_cents===null||!(row.quantity>0))||!Number.isInteger(tax_basis_points)||!Number.isInteger(valid_days))throw new Error('Invalid terms');
  return {line_items,notes:draft.notes,tax_basis_points,valid_days,expectedJobRevision:data.job_revision,...(parent?{expectedVersion:parent.version}:{})};
 }
 function open(row=null){
  setParent(row);setTemplateEdit(null);setTemplateName('');retry.current=null;setError('');setNotice('');
  setDraft(row?{line_items:row.line_items.map(item=>({...item,price:fromMinor(item.unit_price_cents,currency)})),notes:row.notes||'',tax:fromMinor(Math.round(Number(row.tax_rate)*10000),'USD'),valid_days:'7'}:empty());
  setEditing(true);
 }
 const submit=()=>run(async valid=>{
  const body=payload(),fingerprint=JSON.stringify(body);
  if(!retry.current||retry.current.fingerprint!==fingerprint)retry.current={fingerprint,id:createMessageRequestId()};
  const path=parent?`${ROOT}/${parent.id}/${data.customer?'counter':'revise'}`:`${ROOT}/jobs/${jobId}`;
  await api.post(path,{...body,requestId:retry.current.id});
  if(valid()){setEditing(false);retry.current=null;setNotice('sent');await load();}
 });
 async function respond(row,status){await run(async valid=>{
  await api.post(`${ROOT}/${row.id}/respond`,{status,expectedVersion:row.version});
  if(valid()){setNotice('decisionSaved');await load();}
 });}
 async function counterRespond(counter,row,status){await run(async valid=>{
  await api.post(`${ROOT}/counters/${counter.id}/respond`,{status,expectedVersion:row.version});
  if(valid()){setNotice('counterSaved');await load();}
 });}
 const updateLine=(index,key,value)=>setDraft(old=>({...old,line_items:old.line_items.map((row,i)=>i===index?{...row,[key]:value}:row)}));
 const preview=draft.line_items.reduce((sum,row)=>sum+(bpsOf(toMinor(row.price,currency)||0,Math.round((Number(row.quantity)||0)*1000)*10)||0),0);
 const head=row=>!row.superseded_at&&row.status==='sent'&&new Date(row.valid_until).getTime()>Date.now()&&data.open;
 const renderLines=(items)=><ul>{items.map((item,index)=><li key={index}>{item.description} · {item.quantity} × {money(item.unit_price_cents)} · {tr(item.type==='material'?'material':'labor')}</li>)}</ul>;
 return <section className="helper-work" aria-label={tr('title')} data-track-private>
  <h2>{tr('title')}</h2><p>{tr('help')}</p>
  {error&&<p role="alert">{tr(error)}</p>}<p role="status" aria-live="polite">{notice?tr(notice):''}</p>
  {!data&&!error&&<p role="status">{tr('loading')}</p>}
  <button type="button" disabled={busy} onClick={()=>{setEditing(false);setDraft(empty());load();}}>{tr('reload')}</button><p>{tr('reloadHelp')}</p>
  {data&&<>
   <p>{tr('currency')}: {currency}</p>
   {!data.customer&&data.open&&!data.quotes.some(row=>!row.superseded_at&&['sent','accepted'].includes(row.status))&&!editing&&<button type="button" onClick={()=>open()}>{tr('newQuote')}</button>}
   {editing&&<fieldset disabled={busy}>
    <legend>{tr(data.customer?'counterTitle':parent?'revisionTitle':'builderTitle')}</legend>
    <p>{tr('jobRevision')}: {data.job_revision}</p>
    {draft.line_items.map((row,index)=><fieldset key={index}>
     <legend>{tr('line')} {index+1}</legend>
     <label htmlFor={`${fieldId}-${index}-type`}>{tr('type')}</label><select id={`${fieldId}-${index}-type`} value={row.type} onChange={e=>updateLine(index,'type',e.target.value)}><option value="labor">{tr('labor')}</option><option value="material">{tr('material')}</option></select>
     <label htmlFor={`${fieldId}-${index}-description`}>{tr('description')}</label><input id={`${fieldId}-${index}-description`} maxLength={500} value={row.description} onChange={e=>updateLine(index,'description',e.target.value)}/>
     <label htmlFor={`${fieldId}-${index}-quantity`}>{tr('quantity')}</label><input id={`${fieldId}-${index}-quantity`} type="number" min="0.001" max="10000" step="0.001" value={row.quantity} onChange={e=>updateLine(index,'quantity',e.target.value)}/>
     <label htmlFor={`${fieldId}-${index}-price`}>{tr('price')} ({currency})</label><input id={`${fieldId}-${index}-price`} inputMode="decimal" value={row.price} onChange={e=>updateLine(index,'price',e.target.value)}/>
     <button type="button" disabled={draft.line_items.length===1} onClick={()=>setDraft(old=>({...old,line_items:old.line_items.filter((_,i)=>i!==index)}))}>{tr('remove')}</button>
    </fieldset>)}
    <button type="button" disabled={draft.line_items.length>=50} onClick={()=>setDraft(old=>({...old,line_items:[...old.line_items,{description:'',quantity:'1',price:'',type:'material'}]}))}>{tr('addLine')}</button>
    <label htmlFor={`${fieldId}-tax`}>{tr('tax')}</label><input id={`${fieldId}-tax`} type="number" min="0" max="100" step="0.01" value={draft.tax} onChange={e=>setDraft(old=>({...old,tax:e.target.value}))}/>
    <label htmlFor={`${fieldId}-valid`}>{tr('validDays')}</label><input id={`${fieldId}-valid`} type="number" min="1" max="90" value={draft.valid_days} onChange={e=>setDraft(old=>({...old,valid_days:e.target.value}))}/>
    <label htmlFor={`${fieldId}-notes`}>{tr('notes')}</label><textarea id={`${fieldId}-notes`} maxLength={4000} value={draft.notes} onChange={e=>setDraft(old=>({...old,notes:e.target.value}))}/>
    <p>{tr('total')}: {money(preview+(bpsOf(preview,toMinor(draft.tax||'0','USD')||0)||0))}</p>
    {!data.customer&&<>
     <label htmlFor={`${fieldId}-template`}>{tr('templateName')}</label><input id={`${fieldId}-template`} maxLength={100} value={templateName} onChange={e=>setTemplateName(e.target.value)}/>
     <button type="button" disabled={!templateName.trim()} onClick={()=>run(async valid=>{
      const body=payload();await api.post(`${ROOT}/materials`,{name:templateName,currency_code:currency,line_items:body.line_items});
      if(valid()){const saved=await api.get(`${ROOT}/materials`);if(valid())setTemplates(saved.data.templates);setNotice('templateSaved');}
     })}>{tr('saveTemplate')}</button>
     {templateEdit&&<button type="button" onClick={()=>run(async valid=>{const body=payload();const response=await api.put(`${ROOT}/materials/${templateEdit.id}`,{name:templateName,currency_code:currency,line_items:body.line_items,expectedVersion:templateEdit.version});if(valid()){setTemplates(old=>old.map(item=>item.id===templateEdit.id?response.data.template:item));setTemplateEdit(response.data.template);setNotice('templateSaved');}})}>{tr('updateTemplate')}</button>}
     {templates.filter(template=>template.currency_code===currency).map(template=><div className="helper-work__actions" key={template.id}>
      <button type="button" onClick={()=>{setTemplateEdit(template);setTemplateName(template.name);setDraft(old=>({...old,line_items:template.line_items.map(item=>({...item,price:fromMinor(item.unit_price_cents,currency)}))}));}}>{tr('useTemplate')}: {template.name}</button>
      <button type="button" aria-label={`${tr('remove')}: ${template.name}`} onClick={()=>run(async valid=>{await api.delete(`${ROOT}/materials/${template.id}`);if(valid())setTemplates(old=>old.filter(item=>item.id!==template.id));})}>{tr('remove')}</button>
     </div>)}<p>{tr('templateHelp')}</p>
    </>}
    <button type="button" onClick={submit}>{tr(data.customer?'sendCounter':'sendQuote')}</button><button type="button" onClick={()=>setEditing(false)}>{tr('cancel')}</button>
   </fieldset>}
   <h3>{tr('history')}</h3><p>{tr('bounded')}</p>
   {!data.quotes.length&&<p>{tr('noQuotes')}</p>}
   {data.quotes.map(row=><article key={row.id}>
    <h4>{tr('version')} {row.version} · {money(row.total_cents)}</h4>
    <p>{tr(row.superseded_at?'superseded':row.status==='sent'&&new Date(row.valid_until).getTime()<=Date.now()?'expired':row.status)} · <time dateTime={row.created_at}>{formatDate(row.created_at)}</time></p>
    <p>{tr('expires')}: <time dateTime={row.valid_until}>{formatDate(row.valid_until,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</time></p>
    {row.parent_quote_id&&data.quotes.some(prior=>prior.id===row.parent_quote_id)&&<details><summary>{tr('comparePrevious')}</summary>{renderLines(data.quotes.find(prior=>prior.id===row.parent_quote_id).line_items)}<p>{tr('previousTotal')}: {money(data.quotes.find(prior=>prior.id===row.parent_quote_id).total_cents)}</p><p>{tr('total')}: {money(row.total_cents)}</p></details>}
    <details><summary>{tr('showTerms')}</summary>{renderLines(row.line_items)}<p className="helper-work__text">{row.notes}</p><p>{tr('tax')}: {fromMinor(Math.round(Number(row.tax_rate)*10000),'USD')}%</p></details>
    {head(row)&&data.customer&&<div className="helper-work__actions">
     <button type="button" disabled={busy} onClick={()=>respond(row,'accepted')}>{tr('accept')}</button><button type="button" disabled={busy} onClick={()=>respond(row,'declined')}>{tr('decline')}</button><button type="button" disabled={busy} onClick={()=>open(row)}>{tr('counterTitle')}</button>
    </div>}
    {!data.customer&&!row.superseded_at&&['sent','declined','expired'].includes(row.status)&&data.open&&<button type="button" disabled={busy} onClick={()=>open(row)}>{tr('revise')}</button>}
    {row.status==='accepted'&&<p>{tr('acceptHelp')} {row.bid_id&&<Link to={`/bids/${row.bid_id}`}>{tr('openBid')}</Link>}</p>}
    {data.counters.filter(counter=>counter.quote_id===row.id).map(counter=><details key={counter.id} open={counter.status==='pending'}>
     <summary>{tr('counterTitle')} · {tr(counter.status)}</summary>{renderLines(counter.line_items)}<p>{counter.notes}</p>
     {!data.customer&&counter.status==='pending'&&head(row)&&<div className="helper-work__actions"><button type="button" disabled={busy} onClick={()=>counterRespond(counter,row,'accepted')}>{tr('acceptCounter')}</button><button type="button" disabled={busy} onClick={()=>counterRespond(counter,row,'declined')}>{tr('decline')}</button></div>}
    </details>)}
   </article>)}
  </>}
 </section>;
}
