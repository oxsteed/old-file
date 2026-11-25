// Groups 5-6 items 231-234: invoice aging, refund request tracker, payout
// reconciliation against recorded bank deposits, and business expense categories.
import { useState } from 'react';
import { useBizG56 } from './useBizG56';
import './g56.css';

const BASE = ['materials', 'labor', 'vehicle', 'software', 'marketing', 'equipment', 'utilities', 'other'];
const BUCKETS = ['current_cents', 'd1_30_cents', 'd31_60_cents', 'd61_90_cents', 'd90_plus_cents'];

function useMoney(lang) {
  return c => new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD' }).format(Number(c || 0) / 100);
}

function InvoiceOverview({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/owner/invoice-overview`, 'finance');
  const money = useMoney();
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  const tt = p.data.totals;
  return (
    <div>
      <h4>{p.tr('invoices')}</h4>
      <div className="g56-row">
        <span className="g56-badge">{p.tr('outstanding')}: {money(tt.outstanding_cents)}</span>
        <span className="g56-badge">{p.tr('invoicedMonth')}: {money(tt.invoiced_this_month_cents)}</span>
        <span className="g56-badge">{p.tr('collectedMonth')}: {money(tt.collected_this_month_cents)}</span>
        <span className="g56-badge">{p.tr('drafts', { count: tt.drafts })}</span>
      </div>
      <table className="g56-table">
        <thead><tr>{BUCKETS.map(b => <th key={b} scope="col">{p.tr(`bucket.${b}`)}</th>)}</tr></thead>
        <tbody><tr>{BUCKETS.map(b => <td key={b}>{money(tt[b])}</td>)}</tr></tbody>
      </table>
      {p.data.overdue.length > 0 && (
        <ul className="g56-list">
          {p.data.overdue.map(o => <li key={o.id}>{o.invoice_number} · {o.client_name} · {money(o.balance_cents)} · {p.tr('daysOverdue', { count: o.days_overdue })}</li>)}
        </ul>
      )}
    </div>
  );
}

function RefundTracker({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/owner/refund-tracker`, 'finance');
  const money = useMoney();
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  return (
    <div>
      <h4>{p.tr('refunds')}</h4>
      {!p.data.requests.length ? <p>{p.tr('refundsNone')}</p> : (
        <ul className="g56-list">
          {p.data.requests.map(r => (
            <li key={r.id}>
              <span className="g56-badge">{p.tr(`refundStatus.${r.status}`)}</span> {money(r.amount_cents)} · {r.job_title || `#${r.job_id}`} · {r.reason} · {r.requested_by_name} · {p.time(r.created_at)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Reconciliation({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/owner/payout-reconciliation`, 'finance');
  const money = useMoney();
  const [picked, setPicked] = useState({});
  const [f, setF] = useState({ amount: '', date: '', reference: '' });
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  const key = u => `${u.source}:${u.source_id}`;
  const items = p.data.unmatched.filter(u => picked[key(u)]).map(u => ({ source: u.source, source_id: u.source_id }));
  const selected = p.data.unmatched.filter(u => picked[key(u)]).reduce((n, u) => n + Number(u.amount_cents), 0);
  const record = async () => {
    const ok = await p.send('post', `/businesses/${businessId}/owner/payout-deposits`, { amount_cents: Math.round(Number(f.amount) * 100), deposited_on: f.date, reference: f.reference || null, items });
    if (ok) { setPicked({}); setF({ amount: '', date: '', reference: '' }); }
  };
  return (
    <div>
      <h4>{p.tr('reconcile')}</h4>
      <p>{p.tr('reconcileHelp')}</p>
      <p>{p.tr('unmatched')}: {money(p.data.unmatched_cents)}</p>
      <ul className="g56-list">
        {p.data.unmatched.map(u => (
          <li key={key(u)}>
            <label><input type="checkbox" checked={!!picked[key(u)]} onChange={e => setPicked({ ...picked, [key(u)]: e.target.checked })} data-track="ui.a1f0c2d901.1" /> {p.tr(`source.${u.source}`)} {u.label} · {money(u.amount_cents)} · {p.time(u.paid_at)}</label>
          </li>
        ))}
      </ul>
      <fieldset disabled={p.busy} className="g56-row">
        <label>{p.tr('depositAmount')}<input type="number" min="0" step="0.01" inputMode="decimal" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></label>
        <label>{p.tr('depositDate')}<input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
        <label>{p.tr('reference')}<input maxLength={100} value={f.reference} onChange={e => setF({ ...f, reference: e.target.value })} /></label>
        <span>{p.tr('selected')}: {money(selected)}</span>
        <button type="button" disabled={!f.amount || !f.date} onClick={record} data-track="ui.a1f0c2d901.2">{p.tr('recordDeposit')}</button>
      </fieldset>
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
      <ul className="g56-list">
        {p.data.deposits.map(d => (
          <li key={d.id}>
            {d.deposited_on?.slice(0, 10)} · {money(d.amount_cents)} · {p.tr('matched', { count: d.items })} {money(d.matched_cents)}
            {' '}<span className={d.variance_cents === 0 ? 'g56-ok' : 'g56-miss'}>{d.variance_cents === 0 ? p.tr('balanced') : `${p.tr('variance')}: ${money(d.variance_cents)}`}</span>
            {d.reference && ` · ${d.reference}`}
            {' '}<button type="button" disabled={p.busy} onClick={() => p.send('delete', `/businesses/${businessId}/owner/payout-deposits/${d.id}`)} data-track="ui.a1f0c2d901.3">{p.tr('remove')}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExpenseCategories({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/owner/expense-categories`, 'finance');
  const money = useMoney();
  const [f, setF] = useState({ name: '', base: 'materials' });
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  const add = async () => { if (await p.send('post', `/businesses/${businessId}/owner/expense-categories`, { name: f.name, base_category: f.base })) setF({ name: '', base: 'materials' }); };
  return (
    <div>
      <h4>{p.tr('categories')}</h4>
      <p>{p.tr('categoriesHelp')}</p>
      <ul className="g56-list">
        {p.data.categories.map(c => (
          <li key={c.id}>
            {c.name} · {p.t(`businessHub.expenseTracker.categories.${c.base_category}`, { defaultValue: c.base_category })} · {money(c.total_cents)} ({c.expenses})
            {c.is_archived && <span className="g56-badge"> {p.tr('archived')}</span>}
            {' '}<button type="button" disabled={p.busy} onClick={() => p.send('put', `/businesses/${businessId}/owner/expense-categories/${c.id}`, { name: c.name, base_category: c.base_category, is_archived: !c.is_archived })} data-track="ui.a1f0c2d901.4">{c.is_archived ? p.tr('restore') : p.tr('archive')}</button>
          </li>
        ))}
      </ul>
      <fieldset disabled={p.busy} className="g56-row">
        <label>{p.tr('categoryName')}<input maxLength={60} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label>{p.tr('baseCategory')}<select value={f.base} onChange={e => setF({ ...f, base: e.target.value })}>{BASE.map(b => <option key={b} value={b}>{p.t(`businessHub.expenseTracker.categories.${b}`, { defaultValue: b })}</option>)}</select></label>
        <button type="button" disabled={!f.name.trim()} onClick={add} data-track="ui.a1f0c2d901.5">{p.tr('addCategory')}</button>
      </fieldset>
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </div>
  );
}

export default function OwnerFinance({ businessId }) {
  const p = useBizG56(null, 'finance');
  return (
    <section className="g56-panel">
      <h3>{p.tr('title')}</h3>
      <InvoiceOverview businessId={businessId} />
      <RefundTracker businessId={businessId} />
      <Reconciliation businessId={businessId} />
      <ExpenseCategories businessId={businessId} />
    </section>
  );
}
