import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { currentAuthEpoch, isCurrentAuthEpoch } from '../../api/authSessionEpoch';
import { ACCESS_CHANGED_EVENT } from '../../hooks/useAccessProjection';
import api from '../../api/axios';
import '../HelperWorkPanel.css';
export default function RoleTemplates({businessId}){
 const {user}=useAuth(),epoch=currentAuthEpoch();return user?.id&&businessId?<Templates key={`${user.id}:${epoch}:${businessId}`} businessId={businessId} epoch={epoch}/>:null;
}
function Templates({businessId,epoch}){
 const {t}=useTranslation(),tr=key=>t(`businessRoleTemplates.${key}`),id=useId(),gen=useRef(0);
 const [data,setData]=useState(null),[selected,setSelected]=useState(''),[name,setName]=useState(''),[role,setRole]=useState('employee'),[overrides,setOverrides]=useState({});
 const [member,setMember]=useState(''),[preview,setPreview]=useState(null),[reason,setReason]=useState(''),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reload,setReload]=useState(0);
 const invalidate=()=>{setPreview(null);setConfirm(false);};
 useEffect(()=>{const seq=++gen.current;setError('');api.get(`/businesses/${businessId}/team/role-templates`).then(({data:value})=>{if(!Array.isArray(value?.templates)||!Array.isArray(value.members)||!Array.isArray(value.history)||!Array.isArray(value.catalog?.permissions))throw new Error('Invalid team templates');if(seq===gen.current&&isCurrentAuthEpoch(epoch))setData(value);}).catch(()=>{if(seq===gen.current&&isCurrentAuthEpoch(epoch)){setData(null);setError('loadError');}});return()=>{gen.current++;};},[businessId,epoch,reload]);
 useEffect(()=>{const refresh=()=>{gen.current++;setData(null);setName('');setOverrides({});setReason('');invalidate();setReload(value=>value+1);};window.addEventListener(ACCESS_CHANGED_EVENT,refresh);return()=>window.removeEventListener(ACCESS_CHANGED_EVENT,refresh);},[]);
 const chosen=data?.templates.find(row=>row.id===selected);
 async function act(kind){if(busy||!data)return;const seq=gen.current,valid=()=>seq===gen.current&&isCurrentAuthEpoch(epoch);setBusy(true);setError('');setNotice('');try{
  if(kind==='preview'){
   const {data:value}=await api.get(`/businesses/${businessId}/team/role-templates/${selected}/preview/${member}`);if(valid()){setPreview(value);setConfirm(false);}return;
  }
  if(kind==='apply')await api.post(`/businesses/${businessId}/team/role-templates/${selected}/apply`,{membership_id:Number(member),confirmation:preview.confirmation,reason,confirm});
  else if(kind==='delete')await api.delete(`/businesses/${businessId}/team/role-templates/${selected}`,{data:{expectedVersion:chosen.version}});
  else{
   const body={name,role,overrides:Object.entries(overrides).filter(([,effect])=>effect).map(([permission_code,effect])=>({permission_code,effect})),...(kind==='update'?{expectedVersion:chosen.version}:{})};
   if(kind==='update')await api.put(`/businesses/${businessId}/team/role-templates/${selected}`,body);else await api.post(`/businesses/${businessId}/team/role-templates`,body);
  }
  if(valid()){invalidate();setNotice('saved');setSelected('');setName('');setOverrides({});setReload(value=>value+1);}
 }catch(err){if(valid()){invalidate();if([403,404].includes(err.response?.status))setData(null);setError(err.response?.status===409?'conflict':'saveError');}}finally{if(isCurrentAuthEpoch(epoch))setBusy(false);}}
 function choose(value){setSelected(value);invalidate();const row=data.templates.find(item=>item.id===value);setName(row?.name||'');setRole(row?.role||'employee');setOverrides(Object.fromEntries((row?.overrides||[]).map(item=>[item.permission_code,item.effect])));}
 const codes=values=>values?.length?<ul>{values.map(code=><li key={code}><code>{code}</code></li>)}</ul>:<p>{tr('none')}</p>;
 return <section className="helper-work" aria-label={tr('title')} aria-busy={busy || (!data && !error)} data-track-private><h3>{tr('title')}</h3><p>{tr('help')}</p>{error&&<p role="alert">{tr(error)}</p>}<p role="status">{notice?tr(notice):''}</p>
  {!data&&!error&&<p role="status">{t('common.loading')}</p>}{data&&<fieldset disabled={busy}><legend>{tr('edit')}</legend>
   <label htmlFor={`${id}-template`}>{tr('select')}</label><select id={`${id}-template`} value={selected} onChange={e=>choose(e.target.value)}><option value="">{tr('new')}</option>{data.templates.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select>
   <label htmlFor={`${id}-name`}>{tr('name')}</label><input id={`${id}-name`} maxLength={100} value={name} onChange={e=>setName(e.target.value)}/>
   <label htmlFor={`${id}-role`}>{tr('role')}</label><select id={`${id}-role`} value={role} onChange={e=>{setRole(e.target.value);invalidate();}}>{['employee','support_agent','representative','manager'].map(code=><option key={code} value={code}>{tr(code)}</option>)}</select>
   <details><summary>{tr('permissions')}</summary><p>{tr('codes')}</p>{data.catalog.permissions.map(permission=><label key={permission.code} htmlFor={`${id}-${permission.code}`}><code>{permission.code}</code><select id={`${id}-${permission.code}`} value={overrides[permission.code]||''} onChange={e=>{setOverrides(current=>({...current,[permission.code]:e.target.value}));invalidate();}}><option value="">{tr('default')}</option><option value="allow">{tr('allow')}</option><option value="deny">{tr('deny')}</option></select></label>)}</details>
   <button type="button" disabled={!name.trim()} onClick={()=>act('create')}>{tr('create')}</button><button type="button" disabled={!chosen||!name.trim()} onClick={()=>act('update')}>{tr('update')}</button><button type="button" disabled={!chosen} onClick={()=>act('delete')}>{tr('delete')}</button>
   <h4>{tr('applyTitle')}</h4><p>{tr('savedOnly')}</p><label htmlFor={`${id}-member`}>{tr('member')}</label><select id={`${id}-member`} value={member} onChange={e=>{setMember(e.target.value);invalidate();}}><option value="">{tr('chooseMember')}</option>{data.members.map(row=><option key={row.id} value={row.id}>{row.first_name} {row.last_name} · {tr(row.role)}</option>)}</select>
   <button type="button" disabled={!chosen||!member} onClick={()=>act('preview')}>{tr('preview')}</button>
   {preview&&<div role="status"><p>{tr('replace')}</p><p>{tr(preview.before_role)} → {tr(preview.after_role)}</p><h4>{tr('added')}</h4>{codes(preview.added)}<h4>{tr('removed')}</h4>{codes(preview.removed)}<h4>{tr('effective')}</h4>{codes(preview.after)}
    <label htmlFor={`${id}-reason`}>{tr('reason')}</label><textarea id={`${id}-reason`} value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/>
    <label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>{tr('confirm')}</label>
    <button type="button" disabled={!confirm||!reason.trim()} onClick={()=>act('apply')}>{tr('apply')}</button>
   </div>}
   <h4>{tr('history')}</h4><ul>{data.history.map(row=><li key={row.id}>{row.template_name} · {row.reason}</li>)}</ul>
  </fieldset>}
  <button type="button" disabled={busy} onClick={()=>{gen.current++;setData(null);invalidate();setReload(value=>value+1);}}>{tr('reload')}</button><p>{tr('reloadHelp')}</p>
 </section>;
}
