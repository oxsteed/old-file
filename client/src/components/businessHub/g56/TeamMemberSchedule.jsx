// Groups 5-6 items 277, 285, 291-300: shift coverage, handovers, absence
// delegation, unfinished work transfer, my visit feedback, and leaving.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBizG56 } from './useBizG56';
import './g56.css';

function Coverage({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/work/coverage`, 'sched');
  const [shiftId, setShiftId] = useState(''); const [reason, setReason] = useState('');
  if (!p.data) return null;
  const when = r => `${String(r.shift_date).slice(0, 10)} ${String(r.start_time).slice(0, 5)}–${String(r.end_time).slice(0, 5)}`;
  return (
    <section className="g56-panel">
      <h3>{p.tr('coverage')}</h3>
      <div className="g56-row">
        <label>{p.tr('shiftId')}<select value={shiftId} onChange={e => setShiftId(e.target.value)}><option value="">—</option>
          {p.data.my_shifts.map(s => <option key={s.id} value={s.id}>{when(s)} {s.role_label || ''}</option>)}</select></label>
        <label className="g56-grow">{p.tr('reason')}<input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} /></label>
        <button type="button" disabled={p.busy || !shiftId} onClick={async () => { if (await p.send('post', `/businesses/${businessId}/work/shifts/${shiftId}/coverage`, { reason: reason || undefined })) { setShiftId(''); setReason(''); } }} data-track="ui.af40cdbf1b.1">{p.tr('askCover')}</button>
      </div>
      <h4>{p.tr('mine')}</h4>
      <ul className="g56-list">{p.data.mine.map(r => <li key={r.id}>{when(r)} · <span className="g56-badge">{p.tr(`cov.${r.status}`)}</span>{r.claimed_by_name && ` · ${r.claimed_by_name}`}
        {['open', 'claimed'].includes(r.status) && <button type="button" disabled={p.busy} onClick={() => p.send('post', `/businesses/${businessId}/work/coverage/${r.id}/cancel`)} data-track="ui.af40cdbf1b.2">{p.common('cancel')}</button>}</li>)}</ul>
      <h4>{p.tr('available')}</h4>
      {!p.data.available.length ? <p>{p.common('none')}</p> : <ul className="g56-list">{p.data.available.map(r => <li key={r.id}>{when(r)} · {r.requester_name}{r.reason && ` · ${r.reason}`}
        <button type="button" disabled={p.busy} onClick={() => p.send('post', `/businesses/${businessId}/work/coverage/${r.id}/claim`)} data-track="ui.af40cdbf1b.3">{p.tr('cover')}</button></li>)}</ul>}
      {p.data.awaiting_approval.length > 0 && <><h4>{p.tr('approve')}</h4>
        <ul className="g56-list">{p.data.awaiting_approval.map(r => <li key={r.id}>{when(r)} · {r.requester_name} → {r.claimed_by_name}
          <button type="button" disabled={p.busy} onClick={() => p.send('post', `/businesses/${businessId}/owner/coverage/${r.id}/decision`, { decision: 'approve' })} data-track="ui.af40cdbf1b.4">{p.tr('approveBtn')}</button>
          <button type="button" disabled={p.busy} onClick={() => p.send('post', `/businesses/${businessId}/owner/coverage/${r.id}/decision`, { decision: 'decline' })} data-track="ui.af40cdbf1b.5">{p.tr('declineBtn')}</button></li>)}</ul></>}
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </section>
  );
}

function Handovers({ businessId, team }) {
  const p = useBizG56(`/businesses/${businessId}/work/handovers`, 'sched');
  const [f, setF] = useState({ to_user_id: '', summary: '', items: '' });
  if (!p.data) return null;
  return (
    <section className="g56-panel">
      <h3>{p.tr('handovers')}</h3>
      <div className="g56-row">
        <label>{p.tr('to')}<select value={f.to_user_id} onChange={e => setF({ ...f, to_user_id: e.target.value })}><option value="">{p.tr('toManager')}</option>{team.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label className="g56-grow">{p.tr('summary')}<textarea value={f.summary} onChange={e => setF({ ...f, summary: e.target.value })} maxLength={2000} /></label>
        <label className="g56-grow">{p.tr('openItems')}<textarea value={f.items} onChange={e => setF({ ...f, items: e.target.value })} /></label>
        <button type="button" disabled={p.busy || f.summary.trim().length < 5} onClick={async () => {
          const ok = await p.send('post', `/businesses/${businessId}/work/handovers`, { to_user_id: f.to_user_id || undefined, summary: f.summary, open_items: f.items.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 30) });
          if (ok) setF({ to_user_id: '', summary: '', items: '' });
        }} data-track="ui.af40cdbf1b.6">{p.tr('sendHandover')}</button>
      </div>
      <ul className="g56-list">{p.data.received.map(h => <li key={h.id}><strong>{h.from_name}</strong>: {h.summary}{h.open_items.length > 0 && <ul>{h.open_items.map((i, n) => <li key={n}>{i.label}</li>)}</ul>}
        {h.acknowledged_at ? <span className="g56-ok"> ✓</span> : <button type="button" disabled={p.busy} onClick={() => p.send('post', `/businesses/${businessId}/work/handovers/${h.id}/ack`)} data-track="ui.af40cdbf1b.7">{p.tr('ack')}</button>}</li>)}</ul>
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </section>
  );
}

function Delegation({ businessId, team }) {
  const p = useBizG56(`/businesses/${businessId}/work/delegations`, 'sched');
  const board = useBizG56(`/businesses/${businessId}/work/board`, 'sched');
  const [f, setF] = useState({ delegate_id: '', starts_at: '', ends_at: '', note: '' });
  const [xfer, setXfer] = useState({ to: '', ids: [] });
  if (!p.data) return null;
  const iso = v => (v ? new Date(v).toISOString() : '');
  const tasks = board.data?.tasks || [];
  return (
    <section className="g56-panel">
      <h3>{p.tr('away')}</h3>
      <p>{p.tr('awayHelp')}</p>
      <div className="g56-row">
        <label>{p.tr('delegate')}<select value={f.delegate_id} onChange={e => setF({ ...f, delegate_id: e.target.value })}><option value="">—</option>{team.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label>{p.tr('from')}<input type="datetime-local" value={f.starts_at} onChange={e => setF({ ...f, starts_at: e.target.value })} /></label>
        <label>{p.tr('until')}<input type="datetime-local" value={f.ends_at} onChange={e => setF({ ...f, ends_at: e.target.value })} /></label>
        <label className="g56-grow">{p.tr('note')}<input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} maxLength={500} /></label>
        <button type="button" disabled={p.busy || !f.delegate_id || !f.starts_at || !f.ends_at} onClick={async () => {
          if (await p.send('post', `/businesses/${businessId}/work/delegations`, { ...f, starts_at: iso(f.starts_at), ends_at: iso(f.ends_at), note: f.note || undefined })) setF({ delegate_id: '', starts_at: '', ends_at: '', note: '' });
        }} data-track="ui.af40cdbf1b.8">{p.tr('propose')}</button>
      </div>
      <ul className="g56-list">
        {p.data.mine.map(d => <li key={d.id}>{d.delegate_name} · {p.time(d.starts_at)} → {p.time(d.ends_at)} · <span className="g56-badge">{p.tr(`deleg.${d.status}`)}</span>
          {['proposed', 'accepted'].includes(d.status) && <button type="button" disabled={p.busy} onClick={() => p.send('post', `/businesses/${businessId}/work/delegations/${d.id}/respond`, { response: 'cancel' })} data-track="ui.af40cdbf1b.9">{p.common('cancel')}</button>}</li>)}
        {p.data.covering.map(d => <li key={`c${d.id}`}>{p.tr('coveringFor', { name: d.user_name })} · {p.time(d.starts_at)} → {p.time(d.ends_at)} · <span className="g56-badge">{p.tr(`deleg.${d.status}`)}</span>
          {d.status === 'proposed' && <><button type="button" disabled={p.busy} onClick={() => p.send('post', `/businesses/${businessId}/work/delegations/${d.id}/respond`, { response: 'accept' })} data-track="ui.af40cdbf1b.10">{p.tr('accept')}</button>
            <button type="button" disabled={p.busy} onClick={() => p.send('post', `/businesses/${businessId}/work/delegations/${d.id}/respond`, { response: 'decline' })} data-track="ui.af40cdbf1b.11">{p.tr('declineBtn')}</button></>}</li>)}
      </ul>
      {tasks.length > 0 && <>
        <h4>{p.tr('transfer')}</h4>
        <div className="g56-row">
          <label>{p.tr('tasksLabel')}<select multiple value={xfer.ids} onChange={e => setXfer({ ...xfer, ids: [...e.target.selectedOptions].map(o => o.value) })}>{tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
          <label>{p.tr('to')}<select value={xfer.to} onChange={e => setXfer({ ...xfer, to: e.target.value })}><option value="">—</option>{team.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <button type="button" disabled={p.busy || !xfer.to || !xfer.ids.length} onClick={async () => { if (await p.send('post', `/businesses/${businessId}/work/tasks/transfer`, { to_user_id: xfer.to, task_ids: xfer.ids })) { setXfer({ to: '', ids: [] }); board.refresh(); } }} data-track="ui.af40cdbf1b.12">{p.tr('handOver')}</button>
        </div></>}
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </section>
  );
}

function Feedback({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/work/feedback`, 'sched');
  if (!p.data || !p.data.feedback.length) return null;
  return (
    <section className="g56-panel">
      <h3>{p.tr('feedback')}</h3>
      <ul className="g56-list">{p.data.feedback.map(f => <li key={f.appointment_id}>{'★'.repeat(f.rating)} · {f.service_name} · {p.time(f.start_time)}{f.feedback_text && ` · ${f.feedback_text}`}
        {f.follow_up_status && <span className="g56-badge">{p.tr(`fu.${f.follow_up_status}`)}</span>}</li>)}</ul>
    </section>
  );
}

function Leave({ businessId, role }) {
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const p = useBizG56(show ? `/businesses/${businessId}/work/leave-preview` : null, 'sched');
  const [confirm, setConfirm] = useState(false); const [reason, setReason] = useState('');
  if (role === 'owner') return null;
  return (
    <section className="g56-panel">
      <h3>{p.tr('leave')}</h3>
      {!show ? <button type="button" onClick={() => setShow(true)} data-track="ui.af40cdbf1b.13">{p.tr('reviewLeave')}</button> : p.data && (<>
        <ul className="g56-list">{Object.entries(p.data.counts).map(([k, v]) => <li key={k} className={v ? 'g56-miss' : 'g56-ok'}>{p.tr(`pending.${k}`, { count: v })}</li>)}</ul>
        {p.data.blockers.map(b => <p key={b} className="g56-error">{p.tr(`blocker.${b}`)}</p>)}
        <p>{p.tr('afterLeave', { years: p.data.after_leaving.former_access_years })}</p>
        <label className="g56-grow">{p.tr('reason')}<input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} /></label>
        <label><span><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} data-track="ui.af40cdbf1b.14" /> {p.tr('confirmLeave', { name: p.data.business_name })}</span></label>
        <button type="button" disabled={p.busy || !confirm || !p.data.can_leave} onClick={async () => {
          const r = await p.send('post', `/businesses/${businessId}/work/leave`, { confirm: true, reason: reason || undefined });
          if (r && r.left) navigate(r.redirect || '/dashboard', { replace: true });
        }} data-track="ui.af40cdbf1b.15">{p.tr('leaveBtn')}</button></>)}
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </section>
  );
}

export default function TeamMemberSchedule({ businessId, role }) {
  const tm = useBizG56(`/businesses/${businessId}/work/teammates`, 'sched');
  const team = tm.data?.teammates || [];
  return (<>
    <Coverage businessId={businessId} />
    <Handovers businessId={businessId} team={team} />
    <Delegation businessId={businessId} team={team} />
    <Feedback businessId={businessId} />
    <Leave businessId={businessId} role={role} />
  </>);
}
