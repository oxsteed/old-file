import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { currentAuthEpoch, isCurrentAuthEpoch } from '../../api/authSessionEpoch';
import { ACCESS_CHANGED_EVENT } from '../../hooks/useAccessProjection';
import api from '../../api/axios';
import '../HelperWorkPanel.css';
export default function QuoteStandards({ businessId, form, setForm }) {
 const {user}=useAuth(),epoch=currentAuthEpoch();
 return user?.id ? <Standards key={`${user.id}:${epoch}:${businessId}`} businessId={businessId} epoch={epoch} form={form} setForm={setForm}/> : null;
}
function Standards({businessId,epoch,form,setForm}) {
 const {t}=useTranslation(),tr=key=>t(`businessStandards.${key}`),id=useId(),gen=useRef(0);
 const [data,setData]=useState(null),[terms,setTerms]=useState(''),[name,setName]=useState(''),[selected,setSelected]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reload,setReload]=useState(0);
 const formRef=useRef(form);formRef.current=form;
 useEffect(()=>{const seq=++gen.current;setError('');api.get(`/businesses/${businessId}/quote-standards`).then(({data:value})=>{
  if(seq!==gen.current||!isCurrentAuthEpoch(epoch))return;setData(value);setTerms(value.defaults.terms);
  if(formRef.current.standard_terms===undefined)setForm(current=>({...current,standard_terms:value.defaults.terms}));
 }).catch(()=>{if(seq===gen.current&&isCurrentAuthEpoch(epoch)){setData(null);setError('loadError');}});return()=>{gen.current++;};},[businessId,epoch,reload,setForm]);
 useEffect(()=>{const refresh=()=>{gen.current++;setData(null);setSelected('');setTerms('');setForm(current=>({...current,line_items:[],standard_terms:''}));setReload(value=>value+1);};window.addEventListener(ACCESS_CHANGED_EVENT,refresh);return()=>window.removeEventListener(ACCESS_CHANGED_EVENT,refresh);},[setForm]);
 async function mutate(kind){if(busy||!data)return;const seq=gen.current,valid=()=>seq===gen.current&&isCurrentAuthEpoch(epoch);setBusy(true);setError('');setNotice('');try{
  const template=data.templates.find(row=>row.id===selected);
  if(kind==='defaults')await api.put(`/businesses/${businessId}/quote-standards`,{terms,expectedVersion:data.defaults.version});
  else if(kind==='delete')await api.delete(`/businesses/${businessId}/quote-templates/${template.id}`,{data:{expectedVersion:template.version}});
  else{
   const line_items=form.line_items.map(row=>({description:row.description,quantity:Number(row.quantity),unit_price_cents:Math.round(Number(row.unit_price_cents)*100)}));
   const body={name,line_items,tax_rate:Number(form.tax_rate),terms:form.standard_terms||'',...(kind==='update'?{expectedVersion:template.version}:{})};
   if(kind==='update')await api.put(`/businesses/${businessId}/quote-templates/${template.id}`,body);else await api.post(`/businesses/${businessId}/quote-templates`,body);
  }
  if(valid()){setNotice('saved');setSelected('');setName('');setReload(value=>value+1);}
 }catch(err){if(valid()){if([403,404].includes(err.response?.status))setData(null);setError(err.response?.status===409?'conflict':'saveError');}}finally{if(isCurrentAuthEpoch(epoch))setBusy(false);}}
 const selectedTemplate=data?.templates.find(row=>row.id===selected);
 return <section className="helper-work" aria-label={tr('title')} data-track-private><h3>{tr('title')}</h3><p>{tr('help')}</p>
  {error&&<p role="alert">{tr(error)}</p>}<p role="status">{notice?tr(notice):''}</p>
  {data&&<fieldset disabled={busy}><legend>{tr('title')}</legend>
   <label htmlFor={`${id}-defaults`}>{tr('defaults')}</label><textarea id={`${id}-defaults`} maxLength={4000} value={terms} onChange={e=>setTerms(e.target.value)}/>
   <button type="button" onClick={()=>mutate('defaults')}>{tr('saveDefaults')}</button>
   <button type="button" onClick={()=>setForm(current=>({...current,standard_terms:data.defaults.terms}))}>{tr('useDefaults')}</button>
   <label htmlFor={`${id}-terms`}>{tr('terms')}</label><textarea id={`${id}-terms`} maxLength={4000} value={form.standard_terms||''} onChange={e=>setForm(current=>({...current,standard_terms:e.target.value}))}/>
   <label htmlFor={`${id}-template`}>{tr('templates')}</label><select id={`${id}-template`} value={selected} onChange={e=>{setSelected(e.target.value);setName(data.templates.find(row=>row.id===e.target.value)?.name||'');}}><option value="">{tr('choose')}</option>{data.templates.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select>
   <p>{tr('replaceHelp')}</p><button type="button" disabled={!selectedTemplate} onClick={()=>setForm(current=>({...current,line_items:selectedTemplate.line_items.map(row=>({...row,unit_price_cents:(row.unit_price_cents/100).toFixed(2)})),tax_rate:Number(selectedTemplate.tax_rate),standard_terms:selectedTemplate.terms}))}>{tr('apply')}</button>
   <label htmlFor={`${id}-name`}>{tr('name')}</label><input id={`${id}-name`} maxLength={100} value={name} onChange={e=>setName(e.target.value)}/>
   <button type="button" disabled={!name.trim()} onClick={()=>mutate('create')}>{tr('create')}</button>
   <button type="button" disabled={!selectedTemplate||!name.trim()} onClick={()=>mutate('update')}>{tr('update')}</button>
   <button type="button" disabled={!selectedTemplate} onClick={()=>mutate('delete')}>{tr('delete')}</button>
  </fieldset>}
  <button type="button" disabled={busy} onClick={()=>{gen.current++;setData(null);setReload(value=>value+1);}}>{tr('reload')}</button><p>{tr('reloadHelp')}</p>
 </section>;
}
