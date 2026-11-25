// Groups 5-6 team member work (items 252-300): responsibilities, onboarding,
// permission help, inbox, work board + job detail, claim queue, dispatch,
// day view, end-of-shift review, schedule and leaving (TeamMemberSchedule).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBizG56, requestId } from './useBizG56';
import WorkJobDetail from './WorkJobDetail';
import TeamMemberSchedule from './TeamMemberSchedule';
import './g56.css';

function Overview({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/work/me`, 'work');
  const ob = useBizG56(`/businesses/${businessId}/work/onboarding`, 'work');
  const pr = useBizG56(`/businesses/${businessId}/work/permission-requests`, 'work');
  // G5-35/G5-38 (255): a denied Hub section links here with ?code= so the
  // permission code is prefilled instead of making the member guess it.
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('code') || '');
  const [reason, setReason] = useState('');
  if (!p.data) return p.errorText ? <section className="g56-panel"><p className="g56-error">{p.errorText}</p></section> : null;
  const me = p.data;
  // G5-24 (254): what a confirm item is confirming. Role renders through
  // the translated role label; the first task shows its label and time.
  const confirmDetail = (item) => {
    if (!item.detail) return null;
    if (item.key === 'role') return p.tr(`role.${item.detail}`);
    if (typeof item.detail === 'string') return item.detail;
    return `${item.detail.label}${item.detail.when ? ` · ${p.time(item.detail.when)}` : ''}`;
  };
  return (
    <section className="g56-panel">
      <h3>{p.tr('title')}</h3>
      <p><span className="g56-badge">{p.tr(`role.${me.role}`)}</span> {me.member_type === 'subcontractor' && <span className="g56-badge">{p.tr('subcontractor')} {me.company_name}</span>}
        {me.access_ends_at && <> · {p.tr('accessEnds', { date: p.time(me.access_ends_at) })}</>}</p>
      <div className="g56-row">
        <span>{p.tr('services')}: {me.services.map(s => s.name).join(', ') || p.common('none')}</span>
        <span>{p.tr('locations')}: {me.locations.map(l => l.name).join(', ') || p.common('none')}</span>
        <span>{p.tr('managers')}: {me.managers.map(m => m.name).join(', ')}</span>
      </div>
      {/* G5-40 (252): the effective permissions, which work/me already
          returned but no surface rendered. Role + duties (services,
          locations, tasks on the board) were already here. */}
      {Array.isArray(me.permissions) && (
        <p>{p.tr('permissions')}: {me.permissions.length ? me.permissions.join(', ') : p.common('none')}</p>
      )}
      {ob.data && !ob.data.complete && (<>
        <h4>{p.tr('onboarding')}</h4>
        <ul className="g56-list">{ob.data.items.map(i => <li key={i.key} className={i.done ? 'g56-ok' : 'g56-miss'}>{i.done ? '✓' : '•'} {p.tr(`ob.${i.key}`)}</li>)}</ul></>)}
      {ob.data?.confirm_items && !ob.data.confirm_complete && (<>
        <h4>{p.tr('confirmFirstShift')}</h4>
        <ul className="g56-list">{ob.data.confirm_items.map(i => (
          <li key={i.key} className={i.done ? 'g56-ok' : 'g56-miss'}>
            {i.done ? '✓' : '•'} {p.tr(`obConfirm.${i.key}`)}
            {confirmDetail(i) ? <> — {confirmDetail(i)}</> : null}
            {!i.done && (
              <button type="button" disabled={ob.busy || !i.can_confirm} onClick={() => ob.send('post', `/businesses/${businessId}/work/onboarding/confirm`, { item: i.key })} data-track="ui.9ab3b7b94b.11">{p.tr('confirm')}</button>
            )}
          </li>))}</ul>
        {ob.errorText && <p className="g56-error" role="alert">{ob.errorText}</p>}</>)}
      <h4>{p.tr('askAccess')}</h4>
      <p>{p.tr('askAccessHelp')}</p>
      <div className="g56-row">
        <label>{p.tr('permissionCode')}<input value={code} onChange={e => setCode(e.target.value.trim())} placeholder="jobs.edit" /></label>
        <label className="g56-grow">{p.tr('reason')}<input value={reason} onChange={e => setReason(e.target.value)} maxLength={500} /></label>
        <button type="button" disabled={pr.busy || !code || reason.trim().length < 5} onClick={async () => { if (await pr.send('post', `/businesses/${businessId}/work/permission-requests`, { permission_code: code, reason, context_path: window.location.pathname })) { setCode(''); setReason(''); } }} data-track="ui.9ab3b7b94b.1">{p.tr('send')}</button>
      </div>
      {pr.errorText && <p className="g56-error" role="alert">{pr.errorText}</p>}
      <ul className="g56-list">{(pr.data?.requests || []).map(r => (
        <li key={r.id}><code>{r.permission_code}</code> · <span className="g56-badge">{p.tr(`reqStatus.${r.status}`)}</span>
          {r.status === 'pending' && <button type="button" disabled={pr.busy} onClick={() => pr.send('post', `/businesses/${businessId}/work/permission-requests/${r.id}/cancel`)} data-track="ui.9ab3b7b94b.2">{p.common('cancel')}</button>}</li>))}</ul>
    </section>
  );
}

function Inbox({ businessId, onOpen }) {
  const p = useBizG56(`/businesses/${businessId}/work/inbox`, 'work');
  if (!p.data) return null;
  return (
    <section className="g56-panel">
      <h3>{p.tr('inbox')} {p.data.unread > 0 && <span className="g56-badge">{p.data.unread}</span>}</h3>
      {!p.data.items.length ? <p>{p.tr('inboxEmpty')}</p> : (
        <ul className="g56-list">{p.data.items.map(i => (
          <li key={`${i.kind}-${i.id}`} className={i.unread ? 'g56-unread' : ''}>
            <span className="g56-badge">{p.tr(`kind.${i.kind}`)}</span> {i.from_name ? `${i.from_name}: ` : ''}{String(i.preview || '').slice(0, 140)} · {p.time(i.created_at)}
            {i.appointment_id && <button type="button" onClick={() => onOpen(i.appointment_id)} data-track="ui.9ab3b7b94b.3">{p.tr('open')}</button>}
          </li>))}</ul>)}
      <button type="button" disabled={p.busy || !p.data.unread} onClick={() => p.send('post', `/businesses/${businessId}/work/inbox/seen`, {})} data-track="ui.9ab3b7b94b.4">{p.tr('markSeen')}</button>
    </section>
  );
}

function Board({ businessId, onOpen }) {
  const p = useBizG56(`/businesses/${businessId}/work/board`, 'work');
  const c = useBizG56(`/businesses/${businessId}/work/conflicts`, 'work');
  const navigate = useNavigate();
  const [note, setNote] = useState('');
  // D-460 (261, G5-41): the Mine filter narrows the merged requests to
  // the ones assigned to this member; appointments are already mine-scoped
  // server-side, so the filter only moves the requests.
  const [mineOnly, setMineOnly] = useState(false);
  if (!p.data) return p.errorText ? <section className="g56-panel"><p className="g56-error">{p.errorText}</p></section> : null;
  const respond = (id, response) => p.send('post', `/businesses/${businessId}/work/appointments/${id}/${response === 'attend' ? 'attendance' : 'dispatch'}`,
    response === 'attend' ? { response: 'confirm' } : { response, note: response === 'decline' ? note : undefined });
  const requests = (p.data.requests || []).filter((r) => !mineOnly || r.is_mine);
  return (
    <section className="g56-panel">
      <h3>{p.tr('board')}</h3>
      {(c.data?.warnings || []).length > 0 && <p className="g56-miss" role="status">{p.tr('conflicts', { count: c.data.warnings.length })}</p>}
      {['to_confirm', 'in_progress', 'today', 'upcoming', 'finish_up'].map(lane => (
        <div key={lane}>
          <h4>{p.tr(`lane.${lane}`)} ({p.data.lanes[lane].length})</h4>
          <ul className="g56-list">{p.data.lanes[lane].map(a => (
            <li key={`${lane}-${a.id}`}>
              {p.time(a.start_time)} · {a.service_name} · {a.customer_name}
              {a.checklist_total > 0 && <> · {a.checklist_done}/{a.checklist_total}</>}{a.progress != null && <> · {a.progress}%</>}
              {(c.data?.warnings || []).find(w => w.id === a.id)?.warnings.map(w => <span key={w} className="g56-badge g56-miss">{p.tr(`warn.${w}`)}</span>)}
              <div className="g56-row">
                <button type="button" onClick={() => onOpen(a.id)} data-track="ui.9ab3b7b94b.5">{p.tr('open')}</button>
                {lane === 'to_confirm' && (a.is_assignee ? <>
                  <button type="button" disabled={p.busy} onClick={() => respond(a.id, 'confirm')} data-track="ui.9ab3b7b94b.6">{p.tr('confirm')}</button>
                  <input aria-label={p.tr('declineReason')} placeholder={p.tr('declineReason')} value={note} onChange={e => setNote(e.target.value)} maxLength={300} />
                  <button type="button" disabled={p.busy || note.trim().length < 3} onClick={() => respond(a.id, 'decline')} data-track="ui.9ab3b7b94b.7">{p.tr('decline')}</button></>
                  : <button type="button" disabled={p.busy} onClick={() => respond(a.id, 'attend')} data-track="ui.9ab3b7b94b.8">{p.tr('confirmAttend')}</button>)}
              </div>
            </li>))}</ul>
        </div>))}
      {p.data.tasks.length > 0 && <><h4>{p.tr('tasks')}</h4><ul className="g56-list">{p.data.tasks.map(t => <li key={t.id}>{t.title} · {p.time(t.due_at)}</li>)}</ul></>}
      {/* D-460 (261, G5-41): the requests half of My work, merged with the
          appointments above. Open lands on the calendar tab, where the
          assignment queue panel holds the respond actions. */}
      <h4>{p.tr('requests')} ({requests.length})</h4>
      <div className="g56-row">
        <button type="button" disabled={mineOnly} onClick={() => setMineOnly(true)} data-track="ui.9ab3b7b94b.12">{p.tr('mine')}</button>
        <button type="button" disabled={!mineOnly} onClick={() => setMineOnly(false)} data-track="ui.9ab3b7b94b.13">{p.tr('all')}</button>
      </div>
      {!requests.length ? <p>{p.tr('requestsEmpty')}</p> : (
        <ul className="g56-list">{requests.map(r => (
          <li key={r.id}>
            {r.requested_date}{r.requested_start_time ? ` ${String(r.requested_start_time).slice(0, 5)}` : ''} · {r.service_name} · {r.customer_name || p.common('none')}
            {r.is_mine && r.dispatch_status === 'pending' && <span className="g56-badge">{p.tr('dispatchedToYou')}</span>}
            <div className="g56-row">
              <button type="button" onClick={() => navigate(`/business/${businessId}/workspace/calendar`)} data-track="ui.9ab3b7b94b.14">{p.tr('openQueue')}</button>
            </div>
          </li>))}</ul>)}
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </section>
  );
}

function Queue({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/work/queue`, 'work');
  if (!p.data || !p.data.visits.length) return null;
  return (
    <section className="g56-panel">
      <h3>{p.tr('queue')}</h3>
      {!p.data.self_claim && <p>{p.tr('queueManagerOnly')}</p>}
      <ul className="g56-list">{p.data.visits.map(v => (
        <li key={v.id}>{p.time(v.start_time)} · {v.service_name}
          {v.conflict && <span className="g56-badge g56-miss">{p.tr('warn.overlap')}</span>}{!v.available && <span className="g56-badge g56-miss">{p.tr('warn.outside_schedule')}</span>}
          <button type="button" disabled={p.busy || !p.data.self_claim} onClick={() => p.send('post', `/businesses/${businessId}/work/queue/${v.id}/claim`, { request_id: requestId() })} data-track="ui.9ab3b7b94b.9">{p.tr('claim')}</button></li>))}</ul>
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </section>
  );
}

function Day({ businessId }) {
  const [date, setDate] = useState('');
  const p = useBizG56(`/businesses/${businessId}/work/day${date ? `?date=${date}` : ''}`, 'work');
  const e = useBizG56(`/businesses/${businessId}/work/end-of-shift`, 'work');
  const [notes, setNotes] = useState('');
  if (!p.data) return null;
  const tot = p.data.totals;
  const u = e.data?.unresolved;
  return (
    <section className="g56-panel">
      <h3>{p.tr('day')}</h3>
      <label>{p.tr('date')}<input type="date" value={date || p.data.date?.slice(0, 10)} onChange={ev => setDate(ev.target.value)} /></label>
      <p><span className={tot.load === 'over' ? 'g56-badge g56-miss' : 'g56-badge'}>{p.tr(`load.${tot.load}`)}</span> {p.tr('dayTotals', { booked: Math.round(tot.booked_minutes / 6) / 10, shift: Math.round(tot.shift_minutes / 6) / 10, tasks: tot.open_tasks })}</p>
      <ul className="g56-list">{p.data.appointments.map(a => <li key={a.id}>{p.time(a.start_time)} · {a.service_name} · {p.tr(`status.${a.status}`)}</li>)}</ul>
      {e.data && (<>
        <h4>{p.tr('endOfShift')}</h4>
        <ul className="g56-list">{['in_progress', 'missing_completion', 'required_checklist_open', 'open_tasks', 'open_exceptions'].map(k => (
          <li key={k} className={u[k].length ? 'g56-miss' : 'g56-ok'}>{p.tr(`eos.${k}`, { count: u[k].length })}</li>))}
          <li className={e.data.handover_sent ? 'g56-ok' : 'g56-miss'}>{p.tr(e.data.handover_sent ? 'eos.handoverSent' : 'eos.handoverMissing')}</li></ul>
        <label className="g56-grow">{p.tr('eosNotes')}<textarea value={notes || e.data.review?.notes || ''} onChange={ev => setNotes(ev.target.value)} maxLength={2000} /></label>
        <button type="button" disabled={e.busy} onClick={() => e.send('put', `/businesses/${businessId}/work/end-of-shift`, { notes })} data-track="ui.9ab3b7b94b.10">{p.tr('saveReview')}</button>
        {e.notice && <p role="status">{p.common('saved')}</p>}</>)}
    </section>
  );
}

function Roster({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/work/teammates`, 'work');
  if (!p.data) return null;
  return (
    <section className="g56-panel">
      <h3>{p.tr('roster')}</h3>
      <ul className="g56-list">{(p.data.teammates || []).map(m => {
        const key = `bizG56.work.role.${m.role}`;
        const label = p.t(key);
        return (<li key={m.id}>{m.name} — {label === key ? m.role : label}{m.member_type === 'subcontractor' ? ` (${p.tr('subcontractor')})` : ''}</li>);
      })}</ul>
    </section>
  );
}

export default function TeamMemberWork({ businessId, role }) {
  const [open, setOpen] = useState(null);
  if (!businessId) return null;
  return (
    <div>
      <Overview businessId={businessId} />
      <Inbox businessId={businessId} onOpen={setOpen} />
      {open && <WorkJobDetail businessId={businessId} appointmentId={open} role={role} onClose={() => setOpen(null)} />}
      <Board businessId={businessId} onOpen={setOpen} />
      <Queue businessId={businessId} />
      <Day businessId={businessId} />
      <Roster businessId={businessId} />
      <TeamMemberSchedule businessId={businessId} role={role} />
    </div>
  );
}
