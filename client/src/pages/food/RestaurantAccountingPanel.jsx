import React, { useCallback, useEffect, useRef, useState } from 'react';
import { listAccountingIntegrations, listAccountingExports, saveAccountingIntegration, connectAccountingProvider, queueAccountingJournal, reconcileAccountingExport } from '../../api/restaurants';
import { apiErrorMessage } from './foodShared';

const accounts = ['sales','taxPayable','serviceFees','deliveryFees','tipsPayable','paymentClearing'];
const defaults = ['4000','2100','4100','4200','2200','1000'];
export default function RestaurantAccountingPanel({ restaurant, t }) {
  const [integrations,setIntegrations]=useState([]),[exports,setExports]=useState([]),[provider,setProvider]=useState('quickbooks');
  const [company,setCompany]=useState(''),[mapping,setMapping]=useState(Object.fromEntries(accounts.map((a,i)=>[a,defaults[i]])));
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const key=useRef(null),prefix='restaurants.accountingRuntime.';
  const load=useCallback(async()=>{const [i,e]=await Promise.all([listAccountingIntegrations(restaurant.id),listAccountingExports(restaurant.id)]);setIntegrations(i);setExports(e);},[restaurant.id]);
  useEffect(()=>{load().catch(e=>setMessage(apiErrorMessage(e)));},[load]);
  useEffect(()=>{const i=integrations.find(i=>i.provider===provider);setCompany(i?.externalCompanyId||'');setMapping(i?.accountMapping||Object.fromEntries(accounts.map((a,i)=>[a,defaults[i]])));},[provider,integrations]);
  async function run(fn){setBusy(true);setMessage('');try{await fn();await load();}catch(e){setMessage(apiErrorMessage(e));}finally{setBusy(false);}}
  return <div className="space-y-4">
    <p className="text-sm text-gray-600 dark:text-gray-300">{t(prefix+'description')}</p>
    <p role="status" className="text-sm">{message}</p>
    <form onSubmit={e=>{e.preventDefault();run(()=>saveAccountingIntegration(restaurant.id,provider,{status:'configured',externalCompanyId:company,accountMapping:mapping}));}} className="space-y-3" data-track="ui.12407f1614.1">
      <label className="block">{t(prefix+'provider')}<select value={provider} onChange={e=>setProvider(e.target.value)} className="input w-full" disabled={busy}><option value="quickbooks">QuickBooks</option><option value="xero">Xero</option></select></label>
      <label className="block">{t(prefix+'company')}<input value={company} onChange={e=>setCompany(e.target.value)} maxLength={180} required className="input w-full" disabled={busy}/></label>
      <div className="grid gap-2 sm:grid-cols-2">{accounts.map(a=><label key={a}>{t(prefix+'accounts.'+a)}<input className="input w-full" value={mapping[a]} onChange={e=>setMapping({...mapping,[a]:e.target.value})} required pattern="[A-Za-z0-9._-]{1,80}" disabled={busy}/></label>)}</div>
      <button className="btn-secondary" disabled={busy} data-track="ui.12407f1614.2">{t(prefix+'save')}</button>
      <button type="button" className="btn-secondary ms-2" disabled={busy||!integrations.some(i=>i.provider===provider)} onClick={()=>run(async()=>{const result=await connectAccountingProvider(restaurant.id,provider);const url=new URL(result.authorizationUrl);if(url.protocol==='https:'&&['appcenter.intuit.com','login.xero.com'].includes(url.hostname))window.location.assign(url.href);})} data-track="ui.12407f1614.3">{t(prefix+'connect')}</button>
    </form>
    <ul>{integrations.map(i=><li key={i.id}>{i.provider==='xero'?'Xero':'QuickBooks'} · {t(prefix+'states.'+i.status)}</li>)}</ul>
    <form className="flex flex-wrap gap-3" onSubmit={e=>{e.preventDefault();run(async()=>{key.current=key.current||crypto.randomUUID();await queueAccountingJournal(restaurant.id,provider,{from,to,currencyCode:restaurant.currency_code||'USD'},key.current);key.current=null;});}} data-track="ui.12407f1614.4">
      <label>{t(prefix+'from')}<input className="input block" type="date" value={from} required onChange={e=>{setFrom(e.target.value);key.current=null;}}/></label>
      <label>{t(prefix+'to')}<input className="input block" type="date" min={from} value={to} required onChange={e=>{setTo(e.target.value);key.current=null;}}/></label>
      <button className="btn-secondary self-end" disabled={busy} data-track="ui.12407f1614.5">{t(prefix+'queue')}</button>
    </form>
    <button className="btn-secondary" disabled={busy} onClick={()=>run(load)} data-track="ui.12407f1614.6">{t(prefix+'refresh')}</button>
    <ul className="space-y-2">{exports.map(e=><li key={e.id} className="flex flex-wrap items-center gap-2"><span>#{e.id} · {e.currencyCode} · {t(prefix+'states.'+e.status)}</span><button className="btn-secondary" disabled={busy||e.status==='sending'} onClick={()=>run(async()=>{const result=await reconcileAccountingExport(restaurant.id,e.id);setMessage(t(prefix+(result.verified?'verified':'review')));})} data-track="ui.12407f1614.7">{t(prefix+'reconcile')}</button></li>)}</ul>
  </div>;
}
