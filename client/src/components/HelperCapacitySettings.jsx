import { useEffect,useId,useState,useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { currentAuthEpoch,isCurrentAuthEpoch } from '../api/authSessionEpoch';
import { ACCESS_CHANGED_EVENT } from '../hooks/useAccessProjection';
import api from '../api/axios';
import './HelperWorkPanel.css';
export default function HelperCapacitySettings(){const {user}=useAuth();const epoch=currentAuthEpoch();return user?.id?<Settings key={`${user.id}:${epoch}`} epoch={epoch}/>:null;}
function Settings({epoch}){
 const {t}=useTranslation(),id=useId(),tr=key=>t(`helperCapacity.${key}`);
 const generation=useRef(0);
 const [policy,setPolicy]=useState(null),[limit,setLimit]=useState(''),[travel,setTravel]=useState('0'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
 useEffect(()=>{let cancelled=false;const seq=++generation.current;setError('');api.get('/helpers/me/capacity').then(({data})=>{if(cancelled||seq!==generation.current||!isCurrentAuthEpoch(epoch))return;setPolicy(data.policy);setLimit(data.policy.daily_job_limit===null?'':String(data.policy.daily_job_limit));setTravel(String(data.policy.travel_buffer_minutes));}).catch(()=>{if(!cancelled&&seq===generation.current&&isCurrentAuthEpoch(epoch)){setPolicy(null);setError('loadError');}});return()=>{cancelled=true;generation.current++;};},[epoch,reload]);
 useEffect(()=>{const refresh=()=>{generation.current++;setPolicy(null);setReload(value=>value+1);};window.addEventListener(ACCESS_CHANGED_EVENT,refresh);return()=>window.removeEventListener(ACCESS_CHANGED_EVENT,refresh);},[]);
 async function save(){if(busy||!policy)return;const seq=generation.current;const valid=()=>seq===generation.current&&isCurrentAuthEpoch(epoch);setBusy(true);setError('');setNotice('');try{
  const {data}=await api.put('/helpers/me/capacity',{daily_job_limit:limit===''?null:Number(limit),travel_buffer_minutes:Number(travel),expectedVersion:policy.capacity_version});
  if(valid()){setPolicy(data.policy);setNotice('saved');}
 }catch(err){if(valid()){if([403,404].includes(err.response?.status))setPolicy(null);setError(err.response?.data?.code==='capacity_version_conflict'?'conflict':'saveError');}}finally{if(isCurrentAuthEpoch(epoch))setBusy(false);}}
 return <section className="helper-work" aria-label={tr('title')} data-track-private>
  <h3>{tr('title')}</h3><p>{tr('help')}</p><p>{tr('timezone')}</p><p>{tr('existing')}</p>
  {error&&<p role="alert">{tr(error)}</p>}<p role="status" aria-live="polite">{notice?tr(notice):''}</p>
  {!policy&&!error&&<p role="status">{tr('loading')}</p>}
  {policy&&<fieldset disabled={busy}>
   <legend>{tr('limits')}</legend><label htmlFor={`${id}-daily`}>{tr('daily')}</label><input id={`${id}-daily`} type="number" min="1" max="30" value={limit} onChange={e=>setLimit(e.target.value)}/><p>{tr('unlimited')}</p>
   <label htmlFor={`${id}-travel`}>{tr('travel')}</label><input id={`${id}-travel`} type="number" min="0" max="240" value={travel} onChange={e=>setTravel(e.target.value)}/>
   <button type="button" onClick={save}>{tr('save')}</button>
  </fieldset>}
  <button type="button" disabled={busy} onClick={()=>{generation.current++;setPolicy(null);setReload(value=>value+1);}}>{tr('reload')}</button><p>{tr('reloadHelp')}</p>
 </section>;
}
