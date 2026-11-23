// Groups 5-6 items 241-245: ownership transfer, deputy, open work transition,
// departed members' record access and the closure checklist.
import { useState } from 'react';
import { useBizG56 } from './useBizG56';
import './g56.css';

function Transfer({ businessId, owner }) {
  const url = `/businesses/${businessId}/owner/ownership-transfer`;
  const p = useBizG56(url, 'continuity');
  const [f, setF] = useState({ to: '', name: '', note: '' });
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  const { open, mine, candidates } = p.data;
  return (
    <div>
      <h4>{p.tr('transfer')}</h4>
      {mine && mine.status === 'pending' && (
        <div className="g56-row" role="status">
          <span>{p.tr('transferForYou', { name: mine.from_name })}</span>
          <button type="button" disabled={p.busy} onClick={() => window.confirm(p.tr('acceptConfirm')) && p.send('post', `/businesses/${businessId}/ownership-transfer/${mine.id}/accept`)} data-track="ui.c3d9e8f117.1">{p.tr('accept')}</button>
          <button type="button" disabled={p.busy} onClick={() => p.send('post', `/businesses/${businessId}/ownership-transfer/${mine.id}/decline`)} data-track="ui.c3d9e8f117.2">{p.tr('decline')}</button>
        </div>
      )}
      {open ? (
        <p>
          <span className="g56-badge">{p.tr(`transferStatus.${open.status}`)}</span> {p.tr('transferTo', { name: open.to_name })} · {p.tr('expires')} {p.time(open.expires_at)}
          {owner && <> {' '}<button type="button" disabled={p.busy} onClick={() => p.send('post', `${url}/${open.id}/cancel`)} data-track="ui.c3d9e8f117.3">{p.common('cancel')}</button></>}
        </p>
      ) : owner && (
        <fieldset disabled={p.busy}>
          <p>{p.tr('transferHelp')}</p>
          <div className="g56-row">
            <label>{p.tr('newOwner')}<select value={f.to} onChange={e => setF({ ...f, to: e.target.value })}><option value="">—</option>{candidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>{p.tr('confirmName')}<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
            <label>{p.tr('note')}<input maxLength={500} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label>
            <button type="button" disabled={!f.to || !f.name} onClick={async () => { if (await p.send('post', url, { to_user_id: f.to, confirm_name: f.name, note: f.note || null })) setF({ to: '', name: '', note: '' }); }} data-track="ui.c3d9e8f117.4">{p.tr('requestTransfer')}</button>
          </div>
          {!candidates.length && <p>{p.tr('noManagers')}</p>}
        </fieldset>
      )}
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </div>
  );
}

function Deputy({ businessId, owner }) {
  const url = `/businesses/${businessId}/owner/deputy`;
  const p = useBizG56(url, 'continuity');
  const [f, setF] = useState({ user: '', ends: '', note: '' });
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  const cur = p.data.current;
  return (
    <div>
      <h4>{p.tr('deputy')}</h4>
      <p>{p.tr('deputyHelp')}</p>
      {cur ? (
        <p>{p.tr('deputyActive', { name: cur.deputy_name, until: p.time(cur.ends_at) })} {owner && <button type="button" disabled={p.busy} onClick={() => p.send('delete', url)} data-track="ui.c3d9e8f117.5">{p.tr('endDeputy')}</button>}</p>
      ) : owner && (
        <fieldset disabled={p.busy} className="g56-row">
          <label>{p.tr('deputyPerson')}<select value={f.user} onChange={e => setF({ ...f, user: e.target.value })}><option value="">—</option>{p.data.candidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>{p.tr('until')}<input type="date" value={f.ends} onChange={e => setF({ ...f, ends: e.target.value })} /></label>
          <label>{p.tr('note')}<input maxLength={500} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label>
          <button type="button" disabled={!f.user || !f.ends} onClick={async () => { if (await p.send('post', url, { user_id: f.user, ends_at: new Date(`${f.ends}T23:59:00`).toISOString(), note: f.note || null })) setF({ user: '', ends: '', note: '' }); }} data-track="ui.c3d9e8f117.6">{p.tr('designate')}</button>
        </fieldset>
      )}
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </div>
  );
}

function WorkTransition({ businessId, staff }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [result, setResult] = useState(null);
  const p = useBizG56(from ? `/businesses/${businessId}/owner/work-transition?from=${from}` : null, 'continuity');
  const move = async () => { const r = await p.send('post', `/businesses/${businessId}/owner/work-transition`, { from_user_id: from, to_user_id: to || null, include_tasks: true }); if (r) setResult(r); };
  return (
    <div>
      <h4>{p.tr('workTransition')}</h4>
      <p>{p.tr('workTransitionHelp')}</p>
      <div className="g56-row">
        <label>{p.tr('from')}<select value={from} onChange={e => { setFrom(e.target.value); setResult(null); }}><option value="">—</option>{staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>{p.tr('to')}<select value={to} onChange={e => setTo(e.target.value)}><option value="">{p.tr('unassign')}</option>{staff.filter(s => s.id !== from).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      </div>
      {p.data && <p>{p.tr('openWork', { visits: p.data.appointments.length, tasks: p.data.tasks.length })}</p>}
      {p.data && (p.data.appointments.length > 0 || p.data.tasks.length > 0) && <button type="button" disabled={p.busy} onClick={move} data-track="ui.c3d9e8f117.7">{p.tr('moveWork')}</button>}
      {result && <p role="status">{p.tr('moved', { visits: result.moved.length, tasks: result.tasks, skipped: result.skipped.length })}</p>}
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </div>
  );
}

function Departed({ businessId, owner }) {
  const p = useBizG56(`/businesses/${businessId}/owner/departed-members`, 'continuity');
  const [dates, setDates] = useState({});
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  return (
    <div>
      <h4>{p.tr('departed')}</h4>
      <p>{p.tr('departedHelp', { years: p.data.default_years })}</p>
      {!p.data.departed.length ? <p>{p.common('none')}</p> : (
        <ul className="g56-list">
          {p.data.departed.map(d => (
            <li key={d.id}>
              {d.name} · {p.tr('left')} {p.time(d.removed_at)} · {p.tr('accessUntil')} {p.time(d.access_until)} · {p.tr('records', { entries: d.time_entries, visits: d.visits })}
              {owner && (
                <span className="g56-row">
                  <input type="date" aria-label={p.tr('extendAccess')} value={dates[d.id] || ''} onChange={e => setDates({ ...dates, [d.id]: e.target.value })} />
                  <button type="button" disabled={p.busy || !dates[d.id]} onClick={() => p.send('patch', `/businesses/${businessId}/owner/departed-members/${d.id}`, { former_access_until: new Date(`${dates[d.id]}T23:59:00`).toISOString() })} data-track="ui.c3d9e8f117.8">{p.tr('extendAccess')}</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </div>
  );
}

function Closure({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/owner/closure-checklist`, 'continuity');
  const [f, setF] = useState(null);
  if (!p.data) return null;
  const plan = p.data.plan || {};
  const form = f || { target_date: plan.target_date?.slice(0, 10) || '', reason: plan.reason || '', customer_message: plan.customer_message || '', export_confirmed: !!plan.export_confirmed_at };
  return (
    <div>
      <h4>{p.tr('closure')}</h4>
      <p>{p.tr('closureHelp')}</p>
      <ul className="g56-list">
        {p.data.items.map(i => <li key={i.key} className={i.done ? 'g56-ok' : (i.blocking ? 'g56-error' : 'g56-miss')}>{i.done ? '✓' : '•'} {p.tr(`closureItem.${i.key}`, { count: i.count ?? 0 })}{!i.blocking && !i.done && ` (${p.tr('advisory')})`}</li>)}
      </ul>
      <p className={p.data.ready ? 'g56-ok' : 'g56-miss'}>{p.data.ready ? p.tr('closureReady') : p.tr('closureNotReady')}</p>
      <fieldset disabled={p.busy}>
        <div className="g56-row">
          <label>{p.tr('targetDate')}<input type="date" value={form.target_date} onChange={e => setF({ ...form, target_date: e.target.value })} /></label>
          <label className="g56-grow">{p.tr('reason')}<input maxLength={500} value={form.reason} onChange={e => setF({ ...form, reason: e.target.value })} /></label>
        </div>
        <label>{p.tr('customerMessage')}<textarea maxLength={2000} rows={3} value={form.customer_message} onChange={e => setF({ ...form, customer_message: e.target.value })} /></label>
        <label><span><input type="checkbox" checked={form.export_confirmed} onChange={e => setF({ ...form, export_confirmed: e.target.checked })} data-track="ui.c3d9e8f117.9" /> {p.tr('exportConfirmed')}</span></label>
        <button type="button" onClick={async () => { if (await p.send('put', `/businesses/${businessId}/owner/closure-plan`, { ...form, target_date: form.target_date || null, expectedVersion: plan.version ?? null })) setF(null); }} data-track="ui.c3d9e8f117.10">{p.common('save')}</button>
      </fieldset>
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </div>
  );
}

export default function OwnerContinuity({ businessId, role }) {
  const owner = role === 'owner';
  const locs = useBizG56(`/businesses/${businessId}/owner/locations`, 'continuity');
  return (
    <section className="g56-panel">
      <h3>{locs.tr('title')}</h3>
      <Transfer businessId={businessId} owner={owner} />
      <Deputy businessId={businessId} owner={owner} />
      <WorkTransition businessId={businessId} staff={locs.data?.staff || []} />
      <Departed businessId={businessId} owner={owner} />
      {owner && <Closure businessId={businessId} />}
    </section>
  );
}
