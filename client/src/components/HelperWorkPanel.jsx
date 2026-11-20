import { useEffect, useState, useRef, useId } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import { useAuth } from '../hooks/useAuth';
import { currentAuthEpoch, isCurrentAuthEpoch } from '../api/authSessionEpoch';
import { ACCESS_CHANGED_EVENT } from '../hooks/useAccessProjection';
import { accessAPI } from '../api/access';
import { formatDate } from '../lib/format';
import './HelperWorkPanel.css';

const EMPTY = { version: 0, checklist: [], private_notes: '', handover: '', aftercare: '' };
export function JobWorkRecord({ jobId }) {
  const { user } = useAuth();
  const epoch = currentAuthEpoch();
  return user?.id ? <WorkRecord key={`${user.id}:${epoch}:${jobId}`} jobId={jobId} epoch={epoch} /> : null;
}
function WorkRecord({ jobId, epoch }) {
  const fieldId = useId();
  const { t } = useTranslation();
  const [state, setState] = useState(null);
  const [draft, setDraft] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [item, setItem] = useState('');
  const [update, setUpdate] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateName, setTemplateName] = useState('');
  const retryKey = useRef(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const current = () => alive.current && isCurrentAuthEpoch(epoch);
  const key = name => t(`helperWork.${name}`);
  async function load() {
    const requestGeneration = ++generation.current;
    const valid = () => current() && requestGeneration === generation.current;
    setError('');
    try {
      const { data } = await api.get(`/helpers/me/work-records/${jobId}`);
      if (!valid()) return;
      if (!data?.work || !Array.isArray(data.updates)) throw new Error('Invalid work response');
      setState(data); setDraft({ ...EMPTY, ...data.work });
      if (data.writable) {
        const saved = await api.get('/helpers/me/work-templates');
        if (valid()) setTemplates(Array.isArray(saved.data.templates) ? saved.data.templates : []);
      }
    } catch { if (valid()) { setState(null); setDraft(EMPTY); setTemplates([]); setError('loadError'); } }
  }
  useEffect(() => {
    alive.current = true;
    const refresh = () => { setState(null); setDraft(EMPTY); setTemplates([]); load(); };
    load(); window.addEventListener(ACCESS_CHANGED_EVENT, refresh);
    return () => { alive.current = false; generation.current += 1; window.removeEventListener(ACCESS_CHANGED_EVENT, refresh); };
  }, [jobId, epoch]);
  async function run(action) {
    if (busy || !current()) return;
    const operationGeneration = generation.current;
    const valid = () => current() && generation.current === operationGeneration;
    setBusy(true); setError(''); setNotice('');
    try { await action(valid); }
    catch (err) { if (valid()) {
      if ([403,404].includes(err.response?.status)) { setState(null); setDraft(EMPTY); setTemplates([]); }
      setError(err.response?.data?.code === 'work_version_conflict' ? 'conflict' : 'saveError');
    } }
    finally { if (current()) setBusy(false); }
  }
  const save = () => run(async (valid) => {
    const { data } = await api.put(`/helpers/me/work-records/${jobId}`, { ...draft, expectedVersion: draft.version });
    if (valid()) { setDraft(value => ({ ...value, version: data.version })); setNotice('saved'); }
  });
  const publish = () => run(async (valid) => {
    if (!update.trim()) return;
    if (!retryKey.current || retryKey.current.body !== update.trim()) retryKey.current = { body: update.trim(), requestId: crypto.randomUUID() };
    const { data } = await api.post(`/helpers/me/work-records/${jobId}/updates`, retryKey.current);
    if (valid()) {
      setState(value => ({ ...value, updates: [data.update, ...value.updates.filter(row => row.id !== data.update.id)] }));
      retryKey.current = null; setUpdate(''); setNotice('published');
    }
  });
  if (!state) return <section data-track-private className="helper-work" aria-label={key('recordTitle')}><p role={error ? 'alert' : 'status'}>{key(error || 'loading')}</p>{error && <button type="button" onClick={load} data-track="ui.5a31efa0b3.1">{key('reload')}</button>}</section>;
  return <section data-track-private className="helper-work" aria-label={key('recordTitle')}>
    <h2>{key('recordTitle')}</h2>
    {error && <div role="alert"><p>{key(error)}</p><button type="button" onClick={load} data-track="ui.5a31efa0b3.2">{key('reload')}</button><p>{key('reloadWarning')}</p></div>}
    <p role="status" aria-live="polite">{notice ? key(notice) : ''}</p>
    {state.writable && <fieldset disabled={busy}>
      <legend>{key('privateTitle')}</legend><p>{key('privateHelp')}</p>
      <ul>{draft.checklist.map((row, index) => <li key={index}>
        <label><input type="checkbox" checked={row.done} onChange={event => setDraft(value => ({ ...value, checklist: value.checklist.map((entry, i) => i === index ? { ...entry, done: event.target.checked } : entry) }))} data-track="ui.5a31efa0b3.3" />{row.label}</label>
        <button type="button" aria-label={`${key('remove')}: ${row.label}`} onClick={() => setDraft(value => ({ ...value, checklist: value.checklist.filter((_, i) => i !== index) }))} data-track="ui.5a31efa0b3.4">{key('remove')}</button>
      </li>)}</ul>
      <label>{key('newTask')}<input value={item} maxLength={200} onChange={event => setItem(event.target.value)} /></label>
      <button type="button" disabled={!item.trim() || draft.checklist.length >= 40} onClick={() => { setDraft(value => ({ ...value, checklist: [...value.checklist, { label: item.trim(), done: false }] })); setItem(''); }} data-track="ui.5a31efa0b3.5">{key('add')}</button>
      <label htmlFor={`${fieldId}-private_notes`}>{key('privateNotes')}</label><textarea id={`${fieldId}-private_notes`} value={draft.private_notes} maxLength={4000} onChange={event => setDraft(value => ({ ...value, private_notes: event.target.value }))} />
      <label>{key('templateName')}<input maxLength={100} value={templateName} onChange={event => setTemplateName(event.target.value)} /></label>
      <button type="button" disabled={!templateName.trim() || !draft.checklist.length} onClick={() => run(async (valid) => {
        const { data } = await api.post('/helpers/me/work-templates', { name: templateName.trim(), items: draft.checklist });
        if (valid()) { setTemplates(value => [data.template, ...value]); setTemplateName(''); setNotice('saved'); }
      })} data-track="ui.5a31efa0b3.6">{key('saveTemplate')}</button>
      {templates.map(template => <div className="helper-work__actions" key={template.id}>
        <button type="button" onClick={() => setDraft(value => ({ ...value, checklist: template.items.map(row => ({ ...row, done: false })) }))} data-track="ui.5a31efa0b3.7">{key('useTemplate')}: {template.name}</button>
        <button type="button" aria-label={`${key('remove')}: ${template.name}`} onClick={() => run(async (valid) => { await api.delete(`/helpers/me/work-templates/${template.id}`); if (valid()) setTemplates(value => value.filter(row => row.id !== template.id)); })} data-track="ui.5a31efa0b3.8">{key('remove')}</button>
      </div>)}
      <p>{key('templateWarning')}</p>
      <h3>{key('sharedTitle')}</h3><p>{key('sharedHelp')}</p>
      <label htmlFor={`${fieldId}-handover`}>{key('handover')}</label><textarea id={`${fieldId}-handover`} value={draft.handover} maxLength={4000} onChange={event => setDraft(value => ({ ...value, handover: event.target.value }))} />
      <label htmlFor={`${fieldId}-aftercare`}>{key('aftercare')}</label><textarea id={`${fieldId}-aftercare`} value={draft.aftercare} maxLength={4000} onChange={event => setDraft(value => ({ ...value, aftercare: event.target.value }))} />
      <button type="button" onClick={save} data-track="ui.5a31efa0b3.9">{key('save')}</button>
      <p>{key('completionHelp')}</p>
    </fieldset>}
    {!state.writable && <>{[['handover', state.work.handover], ['aftercare', state.work.aftercare]].map(([label, content]) => <div key={label}><h3>{key(label)}</h3><p className="helper-work__text">{content || key('notShared')}</p></div>)}</>}
    <h3>{key('updates')}</h3>
    {state.writable && <fieldset disabled={busy}><legend>{key('newUpdate')}</legend>
      <label htmlFor={`${fieldId}-update`}>{key('sharedHelp')}</label><textarea id={`${fieldId}-update`} maxLength={2000} value={update} onChange={event => setUpdate(event.target.value)} />
      <button type="button" disabled={!update.trim()} onClick={publish} data-track="ui.5a31efa0b3.10">{key('publish')}</button>
    </fieldset>}
    <ol>{state.updates.map(row => <li key={row.id}><time dateTime={row.created_at}>{formatDate(row.created_at)}</time><p className="helper-work__text">{row.body}</p></li>)}</ol>
    {!state.updates.length && <p>{key('noUpdates')}</p>}
  </section>;
}
export default function HelperWorkPanel() {
  const { user } = useAuth();
  const epoch = currentAuthEpoch();
  return user?.id ? <WorkBoard key={`${user.id}:${epoch}`} epoch={epoch} /> : null;
}
function WorkBoard({ epoch }) {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState([]);
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('active');
  const [reload, setReload] = useState(0);
  const key = name => t(`helperWork.${name}`);
  useEffect(() => {
    let cancelled = false;
    setError(false); setLoaded(false);
    Promise.all([api.get('/helpers/me/work-board'), accessAPI.listRequests({ limit: 50 })])
      .then(([work, apps]) => {
        if (cancelled || !isCurrentAuthEpoch(epoch)) return;
        setJobs(work.data.jobs || []);
        setRequests((apps.requests || []).filter(row => row.capability === 'helper.offer_services'));
        setLoaded(true);
      }).catch(() => { if (!cancelled && isCurrentAuthEpoch(epoch)) { setJobs([]); setRequests([]); setSelected(''); setError(true); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [epoch, reload]);
  useEffect(() => {
    const refresh = () => { setJobs([]); setRequests([]); setSelected(''); setReload(value => value + 1); };
    window.addEventListener(ACCESS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ACCESS_CHANGED_EVENT, refresh);
  }, []);
  const visible = jobs.filter(job => filter === 'active' ? ['accepted', 'in_progress'].includes(job.status) : ['completed', 'closed'].includes(job.status));
  return <section data-track-private className="helper-work" aria-label={key('boardTitle')}>
    <h2>{key('boardTitle')}</h2><p>{key('boardHelp')}</p>
    <nav className="helper-work__actions" aria-label={key('workLinks')}><Link to="/jobs">{key('opportunities')}</Link><Link to="/my-bids">{key('myBids')}</Link><Link to="/saved-searches">{key('savedSearches')}</Link><Link to="/settings/applications">{key('applications')}</Link></nav>
    <h3>{key('questions')}</h3>
    {requests.filter(row => row.status === 'needs_information').map(row => <p key={row.id}><Link to={`/settings/applications?request=${encodeURIComponent(row.id)}`}>{key('answerQuestion')}</Link></p>)}
    {loaded && !error && !requests.some(row => row.status === 'needs_information') && <p>{key('noQuestions')}</p>}
    {!loaded && <p role="status">{key('loading')}</p>}
    {error && <p role="alert">{key('loadError')}</p>}
    <button type="button" onClick={() => { setSelected(''); setReload(value => value + 1); }} data-track="ui.5a31efa0b3.11">{key('reload')}</button>
    <label>{key('show')}<select value={filter} onChange={event => { setFilter(event.target.value); setSelected(''); }}><option value="active">{key('active')}</option><option value="history">{key('history')}</option></select></label>
    <p>{key('bounded')} <Link to="/my-jobs?tab=assigned">{key('history')}</Link></p>
    <ul>{visible.map(job => <li key={job.id}><div><Link to={`/jobs/${job.id}`}>{job.title}</Link><p>{t(`myBids.${job.status === 'in_progress' ? 'jobInProgress' : job.status === 'accepted' ? 'jobAwarded' : job.status === 'closed' ? 'jobCompleted' : 'jobCompleted'}`, { defaultValue: job.status })}</p>{job.scheduled_date && <time dateTime={job.scheduled_date}>{formatDate(job.scheduled_date)}</time>}</div><button type="button" onClick={() => setSelected(job.id)} data-track="ui.5a31efa0b3.12">{key('openRecord')}</button></li>)}</ul>
    {loaded && !error && !visible.length && <p>{key('noWork')}</p>}
    {selected && <JobWorkRecord jobId={selected} />}
  </section>;
}
