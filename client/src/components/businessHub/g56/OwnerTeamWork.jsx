// Groups 5-6 owner/manager side of team work (items 255-270, 277, 281-290):
// team-work rules, permission requests, dispatch confirmations, the issue
// queue, low-rating follow-ups, crews, service checklists, job documents.
import { useEffect, useState } from 'react';
import { useBizG56 } from './useBizG56';
import './g56.css';

function Rules({ businessId, role }) {
  const p = useBizG56(`/businesses/${businessId}/owner/policies`, 'team');
  const [f, setF] = useState(null);
  useEffect(() => { if (p.data) { const x = p.data.policy; setF({ allow_self_claim: !!x.allow_self_claim, require_completion_record: !!x.require_completion_record, dispatch_confirm_hours: x.dispatch_confirm_hours ?? '', escalation_hours: x.escalation_hours ?? 4 }); } }, [p.data]);
  if (!p.data || !f) return null;
  const set = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <section className="g56-panel">
      <h3>{p.tr('rules')}</h3>
      <fieldset disabled={role !== 'owner' || p.busy}>
        <div className="g56-row">
          <label><span><input type="checkbox" checked={f.allow_self_claim} onChange={set('allow_self_claim')} data-track="ui.234c9937d9.1" /> {p.tr('selfClaim')}</span></label>
          <label><span><input type="checkbox" checked={f.require_completion_record} onChange={set('require_completion_record')} data-track="ui.234c9937d9.2" /> {p.tr('requireRecord')}</span></label>
          <label>{p.tr('confirmHours')}<input type="number" min="1" max="168" value={f.dispatch_confirm_hours} onChange={set('dispatch_confirm_hours')} /></label>
          <label>{p.tr('escalationHours')}<input type="number" min="1" max="168" value={f.escalation_hours} onChange={set('escalation_hours')} /></label>
          <button type="button" onClick={() => p.send('put', `/businesses/${businessId}/owner/policies`, { ...f, dispatch_confirm_hours: f.dispatch_confirm_hours === '' ? null : Number(f.dispatch_confirm_hours), escalation_hours: Number(f.escalation_hours), expectedVersion: p.data.policy.version })} data-track="ui.234c9937d9.3">{p.common('save')}</button>
        </div>
      </fieldset>
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </section>
  );
}

function Requests({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/owner/permission-requests`, 'team');
  if (!p.data || !p.data.requests.length) return null;
  return (
    <section className="g56-panel">
      <h3>{p.tr('requests')}</h3>
      <ul className="g56-list">{p.data.requests.map(r => (
        <li key={r.id}>{r.requester_name} ({r.requester_role}) · <code>{r.permission_code}</code> · {r.reason}{r.duration_days && ` · ${p.tr('days', { count: r.duration_days })}`}
          <button type="button" disabled={p.busy} onClick={() => p.send('post', `/businesses/${businessId}/owner/permission-requests/${r.id}/decision`, { decision: 'approve' })} data-track="ui.234c9937d9.4">{p.tr('approve')}</button>
          <button type="button" disabled={p.busy} onClick={() => p.send('post', `/businesses/${businessId}/owner/permission-requests/${r.id}/decision`, { decision: 'deny' })} data-track="ui.234c9937d9.5">{p.tr('deny')}</button></li>))}</ul>
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </section>
  );
}

function Dispatch({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/owner/dispatch`, 'team');
  const [open, setOpen] = useState(null);
  const m = useBizG56(open ? `/businesses/${businessId}/owner/appointments/${open}/matches` : null, 'team');
  const [doc, setDoc] = useState({ title: '', body: '' });
  if (!p.data) return null;
  return (
    <section className="g56-panel">
      <h3>{p.tr('dispatch')}</h3>
      <p>{p.tr('dispatchHelp', { hours: p.data.confirm_within_hours })}</p>
      {!p.data.pending.length ? <p>{p.common('none')}</p> : <ul className="g56-list">{p.data.pending.map(a => (
        <li key={a.id} className={a.overdue ? 'g56-miss' : ''}>{p.time(a.start_time)} · {a.service_name} · {a.staff_name}
          <button type="button" onClick={() => setOpen(open === a.id ? null : a.id)} data-track="ui.234c9937d9.6">{p.tr('details')}</button>
          {open === a.id && <div>
            <h4>{p.tr('candidates')}</h4>
            <ul className="g56-list">{(m.data?.candidates || []).slice(0, 8).map(c => (
              <li key={c.user_id}>{c.name} {c.qualified ? '✓' : ''}{!c.available && <span className="g56-badge g56-miss">{p.tr('outside')}</span>}{c.conflict && <span className="g56-badge g56-miss">{p.tr('busy')}</span>}
                <button type="button" disabled={m.busy || c.conflict || String(c.user_id) === String(m.data.appointment.staff_id)} onClick={() => m.send('put', `/businesses/${businessId}/owner/appointments/${a.id}/crew`, { members: [{ user_id: c.user_id }] })} data-track="ui.234c9937d9.7">{p.tr('addCrew')}</button></li>))}</ul>
            {m.errorText && <p className="g56-error" role="alert">{m.errorText}</p>}
            <h4>{p.tr('addDoc')}</h4>
            <div className="g56-row">
              <label>{p.tr('docTitle')}<input value={doc.title} onChange={e => setDoc({ ...doc, title: e.target.value })} maxLength={120} /></label>
              <label className="g56-grow">{p.tr('docBody')}<input value={doc.body} onChange={e => setDoc({ ...doc, body: e.target.value })} maxLength={5000} /></label>
              <button type="button" disabled={p.busy || !doc.title.trim() || !doc.body.trim()} onClick={async () => { if (await p.send('post', `/businesses/${businessId}/owner/appointments/${a.id}/documents`, doc)) setDoc({ title: '', body: '' }); }} data-track="ui.234c9937d9.8">{p.tr('add')}</button>
            </div>
          </div>}</li>))}</ul>}
    </section>
  );
}

function Issues({ businessId }) {
  const [closed, setClosed] = useState(false);
  const p = useBizG56(`/businesses/${businessId}/owner/exceptions${closed ? '?status=closed' : ''}`, 'team');
  const tm = useBizG56(`/businesses/${businessId}/work/teammates`, 'team');
  const [res, setRes] = useState({});
  // 292 (G5-21): the member a task-linked reassignment request moves
  // to, keyed by exception id.
  const [reassignTo, setReassignTo] = useState({});
  if (!p.data) return null;
  return (
    <section className="g56-panel">
      <h3>{p.tr('issues')}</h3>
      <label><span><input type="checkbox" checked={closed} onChange={e => setClosed(e.target.checked)} data-track="ui.234c9937d9.9" /> {p.tr('showClosed')}</span></label>
      {!p.data.exceptions.length ? <p>{p.common('none')}</p> : <ul className="g56-list">{p.data.exceptions.map(e => (
        <li key={e.id} className={e.overdue ? 'g56-miss' : ''}><span className="g56-badge">{p.tr(`sev.${e.severity}`)}</span> {e.raised_by_name}: {e.description} · {e.service_name} · {p.time(e.created_at)}
          {e.escalation_level > 0 && <span className="g56-badge">{p.tr('escalated')}</span>}
          {!closed && <div className="g56-row">
            <input aria-label={p.tr('resolution')} placeholder={p.tr('resolution')} value={res[e.id] || ''} onChange={ev => setRes({ ...res, [e.id]: ev.target.value })} maxLength={1000} />
            {e.kind === 'reassignment_request' && e.task_id && (
              <label>{p.tr('reassignTo')}
                <select aria-label={p.tr('reassignTo')} value={reassignTo[e.id] || ''} onChange={ev => setReassignTo({ ...reassignTo, [e.id]: ev.target.value })}>
                  <option value="">—</option>
                  {(tm.data?.teammates || []).filter(m => String(m.id) !== String(e.raised_by)).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
            )}
            {e.status === 'open' && <button type="button" disabled={p.busy} onClick={() => p.send('patch', `/businesses/${businessId}/work/exceptions/${e.id}`, { status: 'acknowledged', expectedVersion: e.version })} data-track="ui.234c9937d9.10">{p.tr('acknowledge')}</button>}
            <button type="button" disabled={p.busy || !(res[e.id] || '').trim()} onClick={() => p.send('patch', `/businesses/${businessId}/work/exceptions/${e.id}`, { status: 'resolved', resolution: res[e.id], expectedVersion: e.version, ...(reassignTo[e.id] ? { reassign_to_user_id: reassignTo[e.id] } : {}) })} data-track="ui.234c9937d9.11">{p.tr('resolve')}</button>
            <button type="button" disabled={p.busy || !(res[e.id] || '').trim()} onClick={() => p.send('patch', `/businesses/${businessId}/work/exceptions/${e.id}`, { status: 'dismissed', resolution: res[e.id], expectedVersion: e.version })} data-track="ui.234c9937d9.12">{p.tr('dismiss')}</button>
          </div>}</li>))}</ul>}
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </section>
  );
}

function FollowUps({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/owner/feedback-followups`, 'team');
  const [note, setNote] = useState({});
  if (!p.data || !p.data.followups.length) return null;
  return (
    <section className="g56-panel">
      <h3>{p.tr('followUps')}</h3>
      <ul className="g56-list">{p.data.followups.map(f => (
        <li key={f.id}>{'★'.repeat(f.rating)} · {f.service_name} · {f.staff_name} · {f.customer_name}{f.feedback_text && ` · ${f.feedback_text}`}
          <div className="g56-row">
            <input aria-label={p.tr('note')} placeholder={p.tr('note')} value={note[f.id] || ''} onChange={e => setNote({ ...note, [f.id]: e.target.value })} maxLength={1000} />
            {f.status === 'open' && <button type="button" disabled={p.busy} onClick={() => p.send('patch', `/businesses/${businessId}/owner/feedback-followups/${f.id}`, { status: 'contacted', note: note[f.id] || undefined })} data-track="ui.234c9937d9.13">{p.tr('contacted')}</button>}
            <button type="button" disabled={p.busy || !(note[f.id] || '').trim()} onClick={() => p.send('patch', `/businesses/${businessId}/owner/feedback-followups/${f.id}`, { status: 'resolved', note: note[f.id] })} data-track="ui.234c9937d9.14">{p.tr('resolve')}</button>
          </div></li>))}</ul>
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </section>
  );
}

function Crews({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/work/crews`, 'team');
  const tm = useBizG56(`/businesses/${businessId}/work/teammates`, 'team');
  const [f, setF] = useState({ name: '', lead_user_id: '', member_ids: [] });
  if (!p.data) return null;
  const team = tm.data?.teammates || [];
  return (
    <section className="g56-panel">
      <h3>{p.tr('crews')}</h3>
      <ul className="g56-list">{p.data.crews.map(c => <li key={c.id}><strong>{c.name}</strong>{c.lead_name && ` · ${p.tr('lead', { name: c.lead_name })}`} · {c.members.map(m => `${m.name}${m.member_type === 'subcontractor' ? ` (${p.tr('sub')})` : ''}`).join(', ')}</li>)}</ul>
      <div className="g56-row">
        <label>{p.tr('crewName')}<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} maxLength={60} /></label>
        <label>{p.tr('crewLead')}<select value={f.lead_user_id} onChange={e => setF({ ...f, lead_user_id: e.target.value })}><option value="">—</option>{team.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label>{p.tr('crewMembers')}<select multiple value={f.member_ids} onChange={e => setF({ ...f, member_ids: [...e.target.selectedOptions].map(o => o.value) })}>{team.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <button type="button" disabled={p.busy || !f.name.trim()} onClick={async () => { if (await p.send('post', `/businesses/${businessId}/owner/crews`, { ...f, lead_user_id: f.lead_user_id || undefined })) setF({ name: '', lead_user_id: '', member_ids: [] }); }} data-track="ui.234c9937d9.15">{p.tr('add')}</button>
      </div>
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </section>
  );
}

function Checklists({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/owner/service-checklists`, 'team');
  const [edit, setEdit] = useState({});
  if (!p.data) return null;
  return (
    <section className="g56-panel">
      <h3>{p.tr('checklists')}</h3>
      <p>{p.tr('checklistsHelp')}</p>
      <ul className="g56-list">{p.data.services.map(s => {
        const v = edit[s.service_id] ?? s.items.map(i => i.label).join('\n');
        return (<li key={s.service_id}><strong>{s.name}</strong>
          <div className="g56-row"><textarea className="g56-grow" aria-label={s.name} value={v} onChange={e => setEdit({ ...edit, [s.service_id]: e.target.value })} />
            <button type="button" disabled={p.busy} onClick={() => p.send('put', `/businesses/${businessId}/owner/services/${s.service_id}/checklist`, { items: v.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 50).map(label => ({ label })) })} data-track="ui.234c9937d9.16">{p.common('save')}</button></div></li>);
      })}</ul>
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </section>
  );
}

function Report({ businessId }) {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const p = useBizG56(`/businesses/${businessId}/owner/work-report?from=${from}&to=${to}`, 'team');
  const d = p.data;
  const statusKey = { confirmed: 'stConfirmed', in_progress: 'stInProgress', completed: 'stCompleted', cancelled: 'stCancelled' };
  return (
    <section className="g56-panel">
      <h3>{p.tr('report')}</h3>
      <div className="g56-row">
        <label>{p.tr('fromDate')} <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>{p.tr('toDate')} <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      </div>
      {d && (<>
        <p>{p.tr('totalAppointments')}: {d.appointments.total} · {p.tr('progressUpdates')}: {d.progressUpdates.count} · {p.tr('openExceptions')}: {d.openExceptions}</p>
        <ul className="g56-list">{Object.keys(statusKey).filter(s => d.appointments.byStatus[s]).map(s => (<li key={s}>{p.tr(statusKey[s])}: {d.appointments.byStatus[s]}</li>))}</ul>
        <h4>{p.tr('stalled')}</h4>
        {d.stalled.length === 0 ? <p>{p.tr('noStalled')}</p> : <ul className="g56-list">{d.stalled.map(a => (<li key={a.id}>{a.service_name} — {p.time(a.start_time)} ({p.tr('lastProgress')}: {a.last_progress ? p.time(a.last_progress) : '—'})</li>))}</ul>}
        <h4>{p.tr('progressUpdates')}</h4>
        {d.progressUpdates.items.length === 0 ? <p>{p.tr('noRecentUpdates')}</p> : <ul className="g56-list">{d.progressUpdates.items.map((u, i) => (<li key={i}>{u.service_name} — {u.percent}%{u.note ? ` — ${u.note}` : ''} · {u.author || ''} {p.time(u.created_at)}</li>))}</ul>}
      </>)}
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </section>
  );
}

export default function OwnerTeamWork({ businessId, role }) {
  if (!businessId || !['owner', 'manager'].includes(role)) return null;
  return (<>
    <Rules businessId={businessId} role={role} />
    <Requests businessId={businessId} />
    <Dispatch businessId={businessId} />
    <Issues businessId={businessId} />
    <FollowUps businessId={businessId} />
    <Crews businessId={businessId} />
    <Checklists businessId={businessId} />
    <Report businessId={businessId} />
  </>);
}
