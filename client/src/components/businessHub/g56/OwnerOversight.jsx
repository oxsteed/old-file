// Groups 5-6 items 217, 218, 220, 222, 225: owner oversight panels.
import { useState } from 'react';
import { useBizG56 } from './useBizG56';
import './g56.css';

const DAYS = [0, 1, 2, 3, 4, 5, 6];
const money = (cents, lang) => new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);

function OpenAssignments({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/owner/open-assignments`, 'oversight');
  const [pick, setPick] = useState({});
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  return (<>
    <h4>{p.tr('openTitle')}</h4>
    {!p.data.appointments.length && <p>{p.tr('openNone')}</p>}
    <ul className="g56-list">{p.data.appointments.map(a => (
      <li key={a.id}><strong>{a.service_name}</strong> · {p.time(a.start_time)} · {a.customer_name} <span className="g56-badge">{p.tr(`reason.${a.reason}`)}</span>
        <div className="g56-row">
          <label>{p.tr('assignTo')}<select value={pick[a.id] || ''} onChange={e => setPick({ ...pick, [a.id]: e.target.value })}><option value="">{p.tr('choose')}</option>{a.eligible.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <button type="button" disabled={p.busy || !pick[a.id]} onClick={() => p.send('put', `/businesses/${businessId}/appointments/${a.id}/staff`, { staff_id: pick[a.id] })} data-track="ui.219308c9bf.1">{p.tr('assign')}</button>
        </div></li>))}</ul>
    {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
  </>);
}

function Heatmap({ businessId }) {
  const [range, setRange] = useState('upcoming');
  const p = useBizG56(`/businesses/${businessId}/owner/schedule-heatmap?range=${range}&weeks=4`, 'oversight');
  const { t } = p;
  return (<>
    <h4>{p.tr('heatTitle')}</h4>
    <div className="g56-row"><label>{p.tr('range')}<select value={range} onChange={e => setRange(e.target.value)}><option value="upcoming">{p.tr('upcoming')}</option><option value="past">{p.tr('past')}</option></select></label></div>
    {p.data && (
      <div role="table" aria-label={p.tr('heatTitle')}>
        <p>{p.tr('heatLegend', { tz: p.data.timezone })}</p>
        {DAYS.map(d => (
          <div key={d} role="row" className="g56-row">
            <span role="rowheader" className="g56-dayhead">{t(`bizG56.days.${d}`)}</span>
            <div className="g56-grid g56-grow">{p.data.cells.filter(c => c.dow === d && c.hour >= 6 && c.hour <= 21).map(c => {
              const level = p.data.peak ? Math.ceil((c.booked / p.data.peak) * 4) : 0;
              return <span role="cell" key={c.hour} className={`g56-cell g56-heat-${level}${c.booked > c.staffed ? ' g56-over' : ''}`} title={p.tr('cellTitle', { hour: c.hour, booked: c.booked, staffed: c.staffed })}>{c.booked || ''}</span>;
            })}</div>
          </div>))}
        <p>{p.tr('heatHelp')}</p>
      </div>)}
  </>);
}

function Timeline({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/owner/handoff-timeline`, 'oversight');
  if (!p.data) return null;
  return (<>
    <h4>{p.tr('timelineTitle')}</h4>
    {!p.data.events.length && <p>{p.tr('timelineNone')}</p>}
    <ul className="g56-list">{p.data.events.map((e, i) => (
      <li key={i}>{p.time(e.at)} · {p.tr(`event.${e.event}`)} {e.from_name ? `· ${e.from_name}` : ''} {e.to_name ? `→ ${e.to_name}` : ''} {e.actor_name ? `(${p.tr('by', { name: e.actor_name })})` : ''}{e.kind === 'assignment' && e.detail ? ` · ${e.detail}` : ''}</li>))}</ul>
  </>);
}

function RepeatCustomers({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/owner/repeat-customers`, 'oversight');
  if (!p.data) return null;
  const lang = document.documentElement.lang || 'en';
  return (<>
    <h4>{p.tr('repeatTitle')}</h4>
    {!p.data.customers.length ? <p>{p.tr('repeatNone')}</p> : (
      <table className="g56-table"><thead><tr><th>{p.tr('customer')}</th><th>{p.tr('visits')}</th><th>{p.tr('lastVisit')}</th><th>{p.tr('every')}</th><th>{p.tr('lifetime')}</th></tr></thead>
        <tbody>{p.data.customers.map(c => <tr key={c.customer_key}><td>{c.customer_name}<br /><small>{(c.services || []).join(', ')}</small></td><td>{c.visits}</td><td>{p.time(c.last_visit)}</td><td>{c.avg_days_between != null ? p.tr('days', { n: c.avg_days_between }) : ''}</td><td>{money(c.lifetime_cents, lang)}</td></tr>)}</tbody></table>)}
  </>);
}

function ServiceIssues({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/owner/service-issues`, 'issues');
  const [draft, setDraft] = useState({});
  if (!p.data) return null;
  return (<>
    <h4>{p.tr('title')}</h4>
    {!p.data.issues.length && <p>{p.tr('none')}</p>}
    <ul className="g56-list">{p.data.issues.map(i => (
      <li key={i.id}><span className="g56-badge">{p.tr(`status.${i.status}`)}</span> <strong>{p.tr(`category.${i.category}`)}</strong> · {i.service_name} · {p.time(i.start_time)} · {i.customer_name}{i.staff_name ? ` · ${i.staff_name}` : ''}
        <p>{i.description}</p>
        {i.resolution && <p><em>{i.resolution}</em></p>}
        {['open', 'in_review'].includes(i.status) && (
          <div className="g56-row">
            <label>{p.tr('response')}<textarea value={draft[i.id] || ''} maxLength={2000} onChange={e => setDraft({ ...draft, [i.id]: e.target.value })} /></label>
            {i.status === 'open' && <button type="button" disabled={p.busy} onClick={() => p.send('patch', `/businesses/${businessId}/owner/service-issues/${i.id}`, { status: 'in_review', expectedVersion: i.version })} data-track="ui.219308c9bf.2">{p.tr('startReview')}</button>}
            <button type="button" disabled={p.busy || !(draft[i.id] || '').trim()} onClick={() => p.send('patch', `/businesses/${businessId}/owner/service-issues/${i.id}`, { status: 'resolved', resolution: draft[i.id], expectedVersion: i.version })} data-track="ui.219308c9bf.3">{p.tr('resolve')}</button>
            <button type="button" disabled={p.busy || !(draft[i.id] || '').trim()} onClick={() => p.send('patch', `/businesses/${businessId}/owner/service-issues/${i.id}`, { status: 'dismissed', resolution: draft[i.id], expectedVersion: i.version })} data-track="ui.219308c9bf.4">{p.tr('dismiss')}</button>
          </div>)}
      </li>))}</ul>
    {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
  </>);
}

export default function OwnerOversight({ businessId }) {
  const p = useBizG56(null, 'oversight');
  return (
    <section className="g56-panel">
      <h3>{p.tr('title')}</h3>
      <OpenAssignments businessId={businessId} />
      <Heatmap businessId={businessId} />
      <Timeline businessId={businessId} />
      <RepeatCustomers businessId={businessId} />
      <ServiceIssues businessId={businessId} />
    </section>
  );
}
