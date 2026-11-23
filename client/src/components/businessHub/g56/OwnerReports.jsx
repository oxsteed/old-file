// Groups 5-6 items 246-250: quote acceptance, utilization, service quality
// trends, operating cost snapshots and recurring revenue.
import { useState } from 'react';
import { useBizG56 } from './useBizG56';
import './g56.css';

const pct = v => (v == null ? '—' : `${Math.round(v * 100)}%`);
const useMoney = () => c => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(c || 0) / 100);
const PERIODS = ['30d', '90d', '365d'];

function Period({ p, value, onChange }) {
  return <label>{p.tr('period')}<select value={value} onChange={e => onChange(e.target.value)}>{PERIODS.map(v => <option key={v} value={v}>{p.tr(`periods.${v}`)}</option>)}</select></label>;
}

function Quotes({ base }) {
  const [period, setPeriod] = useState('90d');
  const p = useBizG56(`${base}/quote-acceptance?period=${period}`, 'reports');
  const money = useMoney();
  return (
    <div>
      <h4>{p.tr('quotes')}</h4>
      <Period p={p} value={period} onChange={setPeriod} />
      {!p.data ? (p.errorText && <p className="g56-error">{p.errorText}</p>) : (
        <>
          <div className="g56-row">
            <span className="g56-badge">{p.tr('acceptance')}: {pct(p.data.acceptance_rate)}</span>
            <span className="g56-badge">{p.tr('sent')}: {p.data.totals.sent}</span>
            <span className="g56-badge">{p.tr('accepted')}: {p.data.totals.accepted}</span>
            <span className="g56-badge">{p.tr('declined')}: {p.data.totals.declined}</span>
            <span className="g56-badge">{p.tr('expired')}: {p.data.totals.expired}</span>
            <span className="g56-badge">{p.tr('waiting')}: {p.data.totals.waiting}</span>
            <span className="g56-badge">{p.tr('avgAccepted')}: {p.data.average_accepted_cents == null ? '—' : money(p.data.average_accepted_cents)}</span>
          </div>
          {p.data.by_person.length > 0 && (
            <table className="g56-table">
              <thead><tr><th scope="col">{p.tr('person')}</th><th scope="col">{p.tr('sent')}</th><th scope="col">{p.tr('accepted')}</th><th scope="col">{p.tr('acceptance')}</th><th scope="col">{p.tr('acceptedValue')}</th></tr></thead>
              <tbody>{p.data.by_person.map(r => <tr key={r.user_id || 'none'}><td>{r.name || '—'}</td><td>{r.sent}</td><td>{r.accepted}</td><td>{pct(r.acceptance_rate)}</td><td>{money(r.accepted_cents)}</td></tr>)}</tbody>
            </table>
          )}
          {p.data.decline_reasons.length > 0 && <p>{p.tr('topReasons')}: {p.data.decline_reasons.map(r => `${r.reason} (${r.n})`).join(' · ')}</p>}
        </>
      )}
    </div>
  );
}

function Utilization({ base }) {
  const [period, setPeriod] = useState('30d');
  const p = useBizG56(`${base}/utilization?period=${period}`, 'reports');
  return (
    <div>
      <h4>{p.tr('utilization')}</h4>
      <Period p={p} value={period} onChange={setPeriod} />
      {!p.data ? (p.errorText && <p className="g56-error">{p.errorText}</p>) : (
        <>
          <p>{p.tr('utilizationSummary', { booked: p.data.booked_hours, scheduled: p.data.scheduled_hours, rate: pct(p.data.utilization) })}</p>
          <table className="g56-table">
            <thead><tr><th scope="col">{p.tr('person')}</th><th scope="col">{p.tr('scheduled')}</th><th scope="col">{p.tr('booked')}</th><th scope="col">{p.tr('visits')}</th><th scope="col">{p.tr('utilization')}</th></tr></thead>
            <tbody>{p.data.people.map(r => <tr key={r.user_id}><td>{r.name}</td><td>{r.scheduled_hours}</td><td>{r.booked_hours}</td><td>{r.visits}</td><td>{pct(r.utilization)}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Quality({ base }) {
  const p = useBizG56(`${base}/quality`, 'reports');
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  return (
    <div>
      <h4>{p.tr('quality')}</h4>
      <table className="g56-table">
        <thead><tr><th scope="col">{p.tr('month')}</th><th scope="col">{p.tr('completed')}</th><th scope="col">{p.tr('rating')}</th><th scope="col">{p.tr('issueRate')}</th><th scope="col">{p.tr('noShowRate')}</th><th scope="col">{p.tr('cancelRate')}</th></tr></thead>
        <tbody>{p.data.months.map(m => <tr key={m.month}><td>{m.month}</td><td>{m.completed}</td><td>{m.avg_rating ?? '—'}{m.ratings ? ` (${m.ratings})` : ''}</td><td>{pct(m.issue_rate)}</td><td>{pct(m.no_show_rate)}</td><td>{pct(m.cancel_rate)}</td></tr>)}</tbody>
      </table>
      {p.data.services.length > 0 && (
        <ul className="g56-list">{p.data.services.map(s => <li key={s.id}>{s.name} · {p.tr('completed')} {s.completed} · {p.tr('rating')} {s.avg_rating ?? '—'} · {p.tr('issueRate')} {pct(s.issue_rate)}</li>)}</ul>
      )}
    </div>
  );
}

function Costs({ base }) {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const p = useBizG56(`${base}/costs?month=${month}`, 'reports');
  const money = useMoney();
  const l = p.data?.live;
  return (
    <div>
      <h4>{p.tr('costs')}</h4>
      <label>{p.tr('month')}<input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></label>
      {!p.data ? (p.errorText && <p className="g56-error">{p.errorText}</p>) : (
        <>
          <div className="g56-row">
            <span className="g56-badge">{p.tr('revenue')}: {money(l.revenue_cents)}</span>
            <span className="g56-badge">{p.tr('expenses')}: {money(l.expense_cents)}</span>
            <span className="g56-badge">{p.tr('labor')}: {money(l.labor_cents)} ({l.labor_hours} h)</span>
            <span className="g56-badge">{p.tr('margin')}: {money(l.margin_cents)} ({pct(l.margin_rate)})</span>
          </div>
          {l.entries_without_rate > 0 && <p className="g56-miss">{p.tr('missingRates', { count: l.entries_without_rate })}</p>}
          <ul className="g56-list">{Object.entries(l.expenses_by_category || {}).map(([k, v]) => <li key={k}>{p.t(`businessHub.expenseTracker.categories.${k}`, { defaultValue: k })}: {money(v)}</li>)}</ul>
          <button type="button" disabled={p.busy} onClick={() => p.send('post', `${base}/costs/snapshots`, { month })} data-track="ui.d4a1b6c552.1">{p.tr('saveSnapshot')}</button>
          {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
          {p.data.snapshots.length > 0 && (
            <table className="g56-table">
              <thead><tr><th scope="col">{p.tr('month')}</th><th scope="col">{p.tr('revenue')}</th><th scope="col">{p.tr('expenses')}</th><th scope="col">{p.tr('labor')}</th><th scope="col">{p.tr('margin')}</th><th scope="col">{p.tr('savedAt')}</th></tr></thead>
              <tbody>{p.data.snapshots.map(s => <tr key={s.id}><td>{s.month} v{s.version}</td><td>{money(s.revenue_cents)}</td><td>{money(s.expense_cents)}</td><td>{money(s.labor_cents)}</td><td>{money(Number(s.revenue_cents) - Number(s.expense_cents) - Number(s.labor_cents))}</td><td>{p.time(s.created_at)}</td></tr>)}</tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function Recurring({ base }) {
  const p = useBizG56(`${base}/recurring`, 'reports');
  const money = useMoney();
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  const d = p.data;
  return (
    <div>
      <h4>{p.tr('recurring')}</h4>
      <div className="g56-row">
        <span className="g56-badge">{p.tr('mrr')}: {money(d.mrr_cents)}</span>
        <span className="g56-badge">{p.tr('arr')}: {money(d.arr_cents)}</span>
        <span className="g56-badge">{p.tr('activePlans')}: {d.active}</span>
        <span className="g56-badge">{p.tr('pausedPlans')}: {d.paused} ({money(d.paused_mrr_cents)})</span>
        <span className="g56-badge">{p.tr('churned')}: {d.churned_90d} ({money(d.churned_mrr_90d_cents)})</span>
      </div>
      {d.top_clients.length > 0 && <p>{p.tr('topClients')}: {d.top_clients.map(c => `${c.client_name} ${money(c.mrr_cents)}`).join(' · ')}</p>}
      {d.upcoming.length > 0 && <ul className="g56-list">{d.upcoming.map(u => <li key={u.id}>{String(u.next_billing_date).slice(0, 10)} · {u.client_name} · {money(u.amount_cents)}</li>)}</ul>}
    </div>
  );
}

export default function OwnerReports({ businessId }) {
  const base = `/businesses/${businessId}/owner/reports`;
  const p = useBizG56(null, 'reports');
  return (
    <section className="g56-panel">
      <h3>{p.tr('title')}</h3>
      <Quotes base={base} />
      <Utilization base={base} />
      <Quality base={base} />
      <Costs base={base} />
      <Recurring base={base} />
    </section>
  );
}
