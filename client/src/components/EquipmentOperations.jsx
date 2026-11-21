import { useEffect,useId,useRef,useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { currentAuthEpoch,isCurrentAuthEpoch } from '../api/authSessionEpoch';
import { ACCESS_CHANGED_EVENT } from '../hooks/useAccessProjection';
import { createMessageRequestId } from '../lib/messageRequestId';
import { formatDate } from '../lib/format';
import api from '../api/axios';
import './HelperWorkPanel.css';
const BASE='/tool-rentals/operations';
export function EquipmentOwnerWorkspace({tools=[]}){
 const {t}=useTranslation(),[selected,setSelected]=useState(''),id=useId();
 return <section className="helper-work" data-track-private><h2>{t('equipmentOperations.ownerTitle')}</h2><label htmlFor={id}>{t('equipmentOperations.chooseTool')}</label><select id={id} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">{t('equipmentOperations.chooseTool')}</option>{tools.map(tool=><option key={tool.id} value={tool.id}>{tool.name||tool.title}</option>)}</select>{selected&&<EquipmentPanel kind="tools" id={selected}/>}</section>;
}
export function EquipmentBookingPanel({bookingId}){
 const {t}=useTranslation(),[open,setOpen]=useState(false);
 return <details className="helper-work" onToggle={e=>setOpen(e.currentTarget.open)} data-track-private><summary>{t('equipmentOperations.bookingTitle')}</summary>{open&&<EquipmentPanel kind="bookings" id={bookingId}/>}</details>;
}
function EquipmentPanel({kind,id}){
 const {user}=useAuth(),epoch=currentAuthEpoch();return user?.id?<Panel key={`${user.id}:${epoch}:${kind}:${id}`} kind={kind} id={id} epoch={epoch} userId={user.id}/>:null;
}
function Panel({kind,id,epoch,userId}){
 const {t}=useTranslation(),tr=key=>t(`equipmentOperations.${key}`),gen=useRef(0);
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[reload,setReload]=useState(0);
 const url=`${BASE}/${kind}/${id}`;
 useEffect(()=>{const seq=++gen.current;setError('');api.get(url).then(({data:value})=>{if(!value?.[kind==='tools'?'tool':'booking'])throw new Error('Invalid equipment response');if(seq===gen.current&&isCurrentAuthEpoch(epoch))setData(value);}).catch(()=>{if(seq===gen.current&&isCurrentAuthEpoch(epoch)){setData(null);setError('loadError');}});return()=>{gen.current++;};},[url,epoch,reload]);
 useEffect(()=>{const refresh=()=>{gen.current++;setData(null);setReload(value=>value+1);};window.addEventListener(ACCESS_CHANGED_EVENT,refresh);return()=>window.removeEventListener(ACCESS_CHANGED_EVENT,refresh);},[]);
 async function send(method,path,body){if(busy)return false;const seq=gen.current;setBusy(true);setError('');setNotice('');try{await api[method](path,body);if(seq===gen.current&&isCurrentAuthEpoch(epoch)){setNotice('saved');setReload(value=>value+1);return true;}return false;}catch(err){if(seq===gen.current&&isCurrentAuthEpoch(epoch)){if([403,404].includes(err.response?.status))setData(null);setError(err.response?.data?.code==='equipment_calendar_conflict'?'conflict':err.response?.status===409?'changed':'saveError');}return false;}finally{if(isCurrentAuthEpoch(epoch))setBusy(false);}}
 return <div data-track-private aria-busy={busy}>{error&&<p role="alert">{tr(error)}</p>}<p role="status">{notice?tr(notice):''}</p>{!data&&!error&&<p role="status">{t('common.loading')}</p>}
  {data&&(kind==='tools'?<ToolControls data={data} send={send} url={url} busy={busy}/>:<BookingControls data={data} send={send} url={url} busy={busy} userId={userId}/>)}
  <button type="button" disabled={busy} onClick={()=>{gen.current++;setData(null);setReload(value=>value+1);}}>{tr('reload')}</button><p>{tr('reloadHelp')}</p>
 </div>;
}
function ToolControls({data,send,url,busy}){
 const {t}=useTranslation(),tr=key=>t(`equipmentOperations.${key}`),id=useId(),tool=data.tool;
 const [items,setItems]=useState(tool.accessories),[checks,setChecks]=useState(tool.condition_checklist.join('\n')),[rules,setRules]=useState(tool.owner_rules||'');
 const [repair,setRepair]=useState(''),[date,setDate]=useState(new Date().toISOString().slice(0,10));
 useEffect(()=>{setItems(tool.accessories);setChecks(tool.condition_checklist.join('\n'));setRules(tool.owner_rules||'');},[tool]);
 return <fieldset disabled={busy}><legend>{tool.name}</legend><p>{tr('snapshotHelp')}</p><h3>{tr('accessories')}</h3>
  {items.map((item,index)=><div key={index}><label>{tr('itemName')}<input value={item.name} maxLength={100} onChange={e=>setItems(current=>current.map((row,i)=>i===index?{...row,name:e.target.value}:row))}/></label><label>{tr('quantity')}<input type="number" min="1" max="999" value={item.quantity} onChange={e=>setItems(current=>current.map((row,i)=>i===index?{...row,quantity:Number(e.target.value)}:row))}/></label><button type="button" onClick={()=>setItems(current=>current.filter((_,i)=>i!==index))} data-track="ui.8535e53f37.1">{tr('remove')}</button></div>)}
  <button type="button" disabled={items.length>=50} onClick={()=>setItems(current=>[...current,{name:'',quantity:1}])} data-track="ui.8535e53f37.2">{tr('add')}</button>
  <label htmlFor={`${id}-checks`}>{tr('checklist')}</label><textarea id={`${id}-checks`} value={checks} onChange={e=>setChecks(e.target.value)}/><p>{tr('onePerLine')}</p>
  <label htmlFor={`${id}-rules`}>{tr('rules')}</label><textarea id={`${id}-rules`} maxLength={4000} value={rules} onChange={e=>setRules(e.target.value)}/>
  <button type="button" onClick={()=>send('put',url,{accessories:items,checklist:checks.split('\n').map(s=>s.trim()).filter(Boolean),rules,expectedVersion:tool.equipment_version})} data-track="ui.8535e53f37.3">{tr('savePolicy')}</button>
  <h3>{tr('repairs')}</h3><label>{tr('date')}<input type="date" value={date} max={new Date().toISOString().slice(0,10)} onChange={e=>setDate(e.target.value)}/></label><label>{tr('notes')}<textarea maxLength={2000} value={repair} onChange={e=>setRepair(e.target.value)}/></label><button type="button" disabled={!repair.trim()} onClick={async()=>{if(await send('post',`${url}/records`,{kind:'repair',notes:repair,occurred_on:date}))setRepair('');}} data-track="ui.8535e53f37.4">{tr('addRepair')}</button>
  <ul>{data.repairs.map(row=><li key={row.id}>{formatDate(row.occurred_on)} · {row.notes}</li>)}</ul>
  <h3>{tr('overdue')}</h3><ul>{data.overdue.map(row=><li key={row.id}>{tr('booking')} {row.id} · {formatDate(row.end_date)} <Link to="/my-bookings">{tr('openBookings')}</Link></li>)}</ul>
 </fieldset>;
}
function BookingControls({data,send,url,busy,userId}){
 const {t}=useTranslation(),tr=key=>t(`equipmentOperations.${key}`),id=useId(),retry=useRef(null),b=data.booking,snapshot=b.equipment;
 const [phase,setPhase]=useState('pickup'),[counts,setCounts]=useState((snapshot.accessories||[]).map(item=>item.quantity)),[checks,setChecks]=useState((snapshot.checklist||[]).map(()=>false)),[notes,setNotes]=useState(''),[end,setEnd]=useState(''),[noCharge,setNoCharge]=useState(false),[resolution,setResolution]=useState(''),[followup,setFollowup]=useState('');
 const latest=data.reports.filter(row=>row.phase===phase&&String(row.actor_id)===String(userId)).reduce((n,row)=>Math.max(n,row.version),0);
 const canReport=['payment_confirmed','returned','completed'].includes(b.status),pending=data.extensions.some(row=>row.status==='pending');
 return <fieldset disabled={busy}><legend>{tr('booking')} {b.id}</legend><p>{tr('due')}: {formatDate(b.end_date)}</p><p>{tr('rules')}: {snapshot.rules||tr('none')}</p><p>{tr('reportHelp')}</p>
  {canReport&&<><label htmlFor={`${id}-phase`}>{tr('phase')}</label><select id={`${id}-phase`} value={phase} onChange={e=>setPhase(e.target.value)}><option value="pickup">{tr('pickup')}</option><option value="return">{tr('return')}</option></select>
   {(snapshot.accessories||[]).map((item,index)=><label key={item.name}>{item.name} · {tr('expected')}: {item.quantity}<input aria-label={`${tr('count')}: ${item.name}`} type="number" min="0" max="999" value={counts[index]} onChange={e=>setCounts(current=>current.map((value,i)=>i===index?Number(e.target.value):value))}/></label>)}
   {(snapshot.checklist||[]).map((label,index)=><label key={label}><input type="checkbox" checked={checks[index]} onChange={e=>setChecks(current=>current.map((value,i)=>i===index?e.target.checked:value))} data-track="ui.8535e53f37.5"/>{label}</label>)}
   <label htmlFor={`${id}-notes`}>{tr('notes')}</label><textarea id={`${id}-notes`} maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/><button type="button" disabled={!notes.trim()||(phase==='pickup'&&b.status!=='payment_confirmed')} onClick={async()=>{if(await send('post',`${url}/reports`,{phase,counts,checklist:checks,notes,expectedVersion:latest}))setNotes('');}} data-track="ui.8535e53f37.6">{tr('saveReport')}</button>
  </>}
  <h3>{tr('history')}</h3><ul>{data.reports.map(row=><li key={row.id}><strong>{tr(row.phase)} · {String(row.actor_id)===String(b.owner_id)?tr('owner'):tr('renter')} · v{row.version}</strong><p>{row.notes}</p><ul>{row.counts.map(item=><li key={item.name}>{item.name} × {item.quantity}</li>)}</ul><ul>{row.checklist.map(item=><li key={item.label}>{item.checked?'✓':'—'} {item.label}</li>)}</ul>
   {!!row.missing_items?.length&&<><h4>{tr('missing')}</h4><ul>{row.missing_items.map(item=><li key={item.name}>{item.name} × {item.quantity}</li>)}</ul>{row.resolved_at?<p>{tr('resolved')}: {row.resolution}</p>:data.owner&&<><label>{tr('resolution')}<input maxLength={2000} value={resolution} onChange={e=>setResolution(e.target.value)}/></label><button type="button" disabled={!resolution.trim()} onClick={async()=>{if(await send('post',`${url}/missing/${row.id}`,{notes:resolution,expectedVersion:row.missing_version}))setResolution('');}} data-track="ui.8535e53f37.7">{tr('resolve')}</button></>}</>}
  </li>)}</ul>
  <h3>{tr('extensions')}</h3><p>{tr('extensionHelp')}</p>
  {b.status==='payment_confirmed'&&<label><input type="checkbox" checked={noCharge} onChange={e=>setNoCharge(e.target.checked)} data-track="ui.8535e53f37.8"/>{tr('noCharge')}</label>}
  {!data.owner&&b.status==='payment_confirmed'&&!pending&&<><label>{tr('newEnd')}<input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label><button type="button" disabled={!end||!noCharge} onClick={async()=>{if(retry.current?.end!==end)retry.current={end,id:createMessageRequestId()};if(await send('post',`${url}/extensions`,{end_date:end,requestId:retry.current.id,no_additional_charge:true})){retry.current=null;setEnd('');setNoCharge(false);}}} data-track="ui.8535e53f37.9">{tr('request')}</button></>}
  <ul>{data.extensions.map(row=><li key={row.id}>{formatDate(row.requested_end)} · {tr(row.status)}{row.status==='pending'&&b.status==='payment_confirmed'&&<div>{data.owner?<><button type="button" disabled={!noCharge} onClick={()=>send('post',`${url}/extensions/${row.id}`,{status:'approved',no_additional_charge:true})} data-track="ui.8535e53f37.10">{tr('approve')}</button><button type="button" onClick={()=>send('post',`${url}/extensions/${row.id}`,{status:'declined'})} data-track="ui.8535e53f37.11">{tr('decline')}</button></>:<button type="button" onClick={()=>send('post',`${url}/extensions/${row.id}`,{status:'cancelled'})} data-track="ui.8535e53f37.12">{tr('cancel')}</button>}</div>}</li>)}</ul>
  <h3>{tr('followups')}</h3>{data.owner&&b.status==='payment_confirmed'&&<><label>{tr('followupNote')}<textarea value={followup} maxLength={2000} onChange={e=>setFollowup(e.target.value)}/></label><button type="button" disabled={!followup.trim()} onClick={async()=>{if(await send('post',`${BASE}/tools/${b.tool_id}/records`,{kind:'late_return_followup',booking_id:b.id,notes:followup,occurred_on:new Date().toISOString().slice(0,10)}))setFollowup('');}} data-track="ui.8535e53f37.13">{tr('saveFollowup')}</button></>}
  <ul>{data.followups.map(row=><li key={row.id}>{formatDate(row.occurred_on)} · {row.notes}</li>)}</ul>
 </fieldset>;
}
