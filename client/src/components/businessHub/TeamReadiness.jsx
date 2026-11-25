import {useEffect,useId,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Link} from 'react-router-dom';
import {useAuth} from '../../hooks/useAuth';
import {currentAuthEpoch,isCurrentAuthEpoch} from '../../api/authSessionEpoch';
import {ACCESS_CHANGED_EVENT} from '../../hooks/useAccessProjection';
import {createMessageRequestId} from '../../lib/messageRequestId';
import {formatDate} from '../../lib/format';
import api from '../../api/axios';
import '../HelperWorkPanel.css';
export default function TeamReadiness({businessId}){
 const {user}=useAuth(),epoch=currentAuthEpoch();return user?.id?<Readiness key={`${user.id}:${epoch}:${businessId}`} businessId={businessId} userId={user.id} epoch={epoch}/>:null;
}
function Readiness({businessId,userId,epoch}){
 const {t,i18n}=useTranslation(),tr=key=>t(`teamReadiness.${key}`),gen=useRef(0);
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[reload,setReload]=useState(0);
 const url=`/businesses/${businessId}/team`;
 useEffect(()=>{let cancelled=false;const seq=++gen.current;api.get(`${url}/readiness`).then(({data:value})=>{if(!Array.isArray(value?.documents)||!Array.isArray(value.tasks))throw new Error('Invalid team response');if(!cancelled&&seq===gen.current&&isCurrentAuthEpoch(epoch)){setData(value);setError('');}}).catch(()=>{if(!cancelled&&seq===gen.current&&isCurrentAuthEpoch(epoch)){setData(null);setError('loadError');}});return()=>{cancelled=true;gen.current++;};},[url,epoch,reload]);
 useEffect(()=>{const refresh=()=>setReload(value=>value+1);const revoke=()=>{gen.current++;setData(null);refresh();};const timer=setInterval(refresh,60000);window.addEventListener('focus',refresh);window.addEventListener(ACCESS_CHANGED_EVENT,revoke);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener(ACCESS_CHANGED_EVENT,revoke);};},[]);
 async function send(method,path,body){if(busy)return false;const seq=gen.current;setBusy(true);setError('');setNotice('');try{await api[method](path,body);if(seq===gen.current&&isCurrentAuthEpoch(epoch)){setNotice('saved');setReload(value=>value+1);return true;}return false;}catch(err){if(seq===gen.current&&isCurrentAuthEpoch(epoch)){if([403,404].includes(err.response?.status))setData(null);setError(err.response?.status===409?'conflict':'saveError');}return false;}finally{if(isCurrentAuthEpoch(epoch))setBusy(false);}}
 return <section className="helper-work" data-track-private aria-label={tr('title')}><h2>{tr('title')}</h2><p>{tr('help')}</p>{error&&<p role="alert">{tr(error)}</p>}<p role="status">{notice?tr(notice):''}</p>{data?.access_valid_until&&<p>{tr('accessEnds')}: {new Intl.DateTimeFormat(i18n.language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(data.access_valid_until))}</p>}{data?.overdue_count>0&&<p role="status">{t('teamReadiness.overdue',{count:data.overdue_count})}</p>}
  {data&&<Controls data={data} userId={userId} send={send} url={url} busy={busy} businessId={businessId}/>}
  {!data&&!error&&<p role="status">{t('common.loading')}</p>}<button type="button" disabled={busy} onClick={()=>setReload(value=>value+1)}>{tr('reload')}</button>
 </section>;
}
function Controls({data,userId,send,url,busy,businessId}){
 const {t,i18n}=useTranslation(),tr=key=>t(`teamReadiness.${key}`),id=useId(),retry=useRef(null);
 const [kind,setKind]=useState('guide'),[title,setTitle]=useState(''),[body,setBody]=useState(''),[version,setVersion]=useState(0);
 const [taskKind,setTaskKind]=useState('reminder'),[taskTitle,setTaskTitle]=useState(''),[due,setDue]=useState(''),[assignee,setAssignee]=useState(String(userId)),[jobId,setJobId]=useState('');
 const [expiryMember,setExpiryMember]=useState(''),[expiry,setExpiry]=useState('');
 const selectedMember=data.members.find(row=>String(row.membership_id)===expiryMember);
 const time=value=>new Intl.DateTimeFormat(i18n.language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
 function edit(nextKind){const current=data.documents.find(row=>row.kind===nextKind);setKind(nextKind);setTitle(current?.title||'');setBody(current?.body||'');setVersion(current?.version||0);}
 return <details><summary>{tr('open')}</summary><fieldset disabled={busy}>
  <legend>{tr('documents')}</legend>{data.documents.map(row=><article key={row.id}><h3>{row.title} · {tr(row.kind)} · v{row.version}</h3><p className="helper-work__text">{row.body}</p>{row.acknowledged?<p>{tr('acknowledged')}</p>:<button type="button" onClick={()=>send('post',`${url}/documents/${row.id}/acknowledge`,{})} data-track="ui.6ac80e3683.1">{tr('acknowledge')}</button>}</article>)}
  {data.owner&&<><h3>{tr('publish')}</h3><p>{tr('versionHelp')}</p><label htmlFor={`${id}-kind`}>{tr('documentKind')}</label><select id={`${id}-kind`} value={kind} onChange={e=>edit(e.target.value)}><option value="guide">{tr('guide')}</option><option value="policy">{tr('policy')}</option></select><button type="button" onClick={()=>edit(kind)} data-track="ui.6ac80e3683.2">{tr('editCurrent')}</button>
   <label htmlFor={`${id}-title`}>{tr('documentTitle')}</label><input id={`${id}-title`} maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/><label htmlFor={`${id}-body`}>{tr('body')}</label><textarea id={`${id}-body`} maxLength={4000} value={body} onChange={e=>setBody(e.target.value)}/>
   <button type="button" disabled={!title.trim()||!body.trim()} onClick={async()=>{if(await send('post',`${url}/documents`,{kind,title,body,expectedVersion:version}))setVersion(value=>value+1);}} data-track="ui.6ac80e3683.3">{tr('publish')}</button>
  </>}
  <h3>{tr('ackHistory')}</h3><ul>{data.history.map(row=><li key={row.acknowledgment_id}>{row.title} · v{row.version} · {row.first_name||tr('formerMember')} {row.last_name} · {time(row.acknowledged_at)}</li>)}</ul>
  <h3>{tr('work')}</h3><p>{tr('reminderHelp')}</p>
  <label htmlFor={`${id}-task-kind`}>{tr('workKind')}</label><select id={`${id}-task-kind`} value={taskKind} onChange={e=>setTaskKind(e.target.value)}><option value="reminder">{tr('reminder')}</option>{data.canAllocate&&<option value="task">{tr('task')}</option>}</select>
  <label htmlFor={`${id}-task-title`}>{tr('workTitle')}</label><input id={`${id}-task-title`} maxLength={200} value={taskTitle} onChange={e=>setTaskTitle(e.target.value)}/><label htmlFor={`${id}-due`}>{tr('due')}</label><input id={`${id}-due`} type="datetime-local" value={due} onChange={e=>setDue(e.target.value)}/>
  <label htmlFor={`${id}-job`}>{tr('jobId')}</label><input id={`${id}-job`} value={jobId} onChange={e=>setJobId(e.target.value)} placeholder={tr('jobIdHelp')}/>
  {data.canAllocate&&<><label htmlFor={`${id}-assignee`}>{tr('assignee')}</label><select id={`${id}-assignee`} value={assignee} onChange={e=>setAssignee(e.target.value)}>{data.members.map(row=><option key={row.id} value={row.id}>{row.first_name} {row.last_name}</option>)}</select></>}
  <button type="button" disabled={!taskTitle.trim()||!due} onClick={async()=>{const input={kind:taskKind,title:taskTitle,due_at:new Date(due).toISOString(),assignee_id:assignee,job_id:jobId.trim()||null};const fingerprint=JSON.stringify(input);if(retry.current?.fingerprint!==fingerprint)retry.current={fingerprint,id:createMessageRequestId()};if(await send('post',`${url}/tasks`,{...input,requestId:retry.current.id})){retry.current=null;setTaskTitle('');setJobId('');}}} data-track="ui.6ac80e3683.4">{tr('createWork')}</button>
  <ul>{data.tasks.map(row=><li key={row.id}><strong>{row.title}</strong> · {tr(row.kind)} · {time(row.due_at)} · {tr(row.status==='open'?'taskOpen':row.status)}{row.overdue&&<p>{tr('late')}</p>}<p>{row.first_name||tr('formerMember')} {row.last_name}</p>{row.job_title&&<p>{tr('forJob')}: {row.job_title}</p>}<button type="button" onClick={()=>send('put',`${url}/tasks/${row.id}`,{status:row.status==='open'?'completed':'open',expectedVersion:row.version})} data-track="ui.6ac80e3683.5">{tr(row.status==='open'?'complete':'reopen')}</button></li>)}</ul>
  {data.owner&&<><h3>{tr('expiryTitle')}</h3><p>{tr('expiryHelp')}</p><label htmlFor={`${id}-expiry-member`}>{tr('expiryMember')}</label><select id={`${id}-expiry-member`} value={expiryMember} onChange={e=>{setExpiryMember(e.target.value);setExpiry('');}}><option value="">{tr('chooseMember')}</option>{data.members.filter(row=>row.membership_id&&String(row.id)!==String(userId)).map(row=><option key={row.membership_id} value={row.membership_id}>{row.first_name} {row.last_name}</option>)}</select>
   {selectedMember?.access_valid_until&&<p>{tr('accessEnds')}: {time(selectedMember.access_valid_until)}</p>}
   <label htmlFor={`${id}-expiry`}>{tr('expiryDate')}</label><input id={`${id}-expiry`} type="datetime-local" value={expiry} onChange={e=>setExpiry(e.target.value)}/><button type="button" disabled={!selectedMember||!expiry} onClick={()=>send('put',`/businesses/${businessId}/memberships/${expiryMember}/access-expiry`,{expires_at:new Date(expiry).toISOString(),expectedVersion:selectedMember.permission_version})} data-track="ui.6ac80e3683.6">{tr('setExpiry')}</button><button type="button" disabled={!selectedMember||!selectedMember.access_valid_until} onClick={()=>send('put',`/businesses/${businessId}/memberships/${expiryMember}/access-expiry`,{expires_at:null,expectedVersion:selectedMember.permission_version})} data-track="ui.6ac80e3683.7">{tr('clearExpiry')}</button>
   <ul>{(data.expiryHistory||[]).map((row,index)=><li key={index}>{tr(row.event)} · {row.expires_at?time(row.expires_at):tr('ongoing')}</li>)}</ul>
   <h3>{t('businessHub.offboardingTitle')}</h3><p>{t('businessHub.offboardingSubtitle')}</p><ul>{data.offboarding.map(row=><li key={row.id}>{row.first_name||tr('formerMember')} {row.last_name||''} · {formatDate(row.removed_at)}<p>{row.reason}</p><p>{t('teamReadiness.reassigned',{count:(row.team_tasks_reassigned||0)+(row.crew_tasks_reassigned||0)+(row.corrective_actions_reassigned||0)})}</p><p>{t('teamReadiness.drawers',{count:row.drawers_flagged||0})}</p><p>{t('businessHub.offboardingRetainUntil')}: {formatDate(row.retain_until)}</p></li>)}</ul><Link to={`/business/${businessId}/workspace/team`}>{tr('manageTeam')}</Link></>}
 </fieldset></details>;
}
