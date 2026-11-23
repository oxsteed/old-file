// Groups 5-6 items 226-228: approval thresholds, work authorization policy,
// cancellation settings, and the pending-approval list.
import { useEffect, useState } from 'react';
import { useBizG56 } from './useBizG56';
import './g56.css';

const dollars = c => (c == null ? '' : String(Number(c) / 100));
const cents = v => (v === '' || v == null ? null : Math.round(Number(v) * 100));

export default function OwnerPolicies({ businessId, role }) {
  const p = useBizG56(`/businesses/${businessId}/owner/policies`, 'policies');
  const [f, setF] = useState(null);
  useEffect(() => {
    if (!p.data) return;
    const { policy, cancellation } = p.data;
    setF({ quote: dollars(policy.quote_approval_cents), expense: dollars(policy.expense_approval_cents), refund: dollars(policy.refund_approval_cents),
      work_start_requires: policy.work_start_requires, work_start_min_role: policy.work_start_min_role,
      fee: policy.default_cancellation_fee_percent, noShow: policy.no_show_fee_percent, notice: cancellation.notice_hours,
      reschedule: cancellation.allow_customer_reschedule !== false, autoNoShow: cancellation.auto_cancel_no_show_hours ?? '' });
  }, [p.data]);
  if (!p.data || !f) return p.errorText ? <section className="g56-panel"><p className="g56-error">{p.errorText}</p></section> : null;
  const owner = role === 'owner';
  const set = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = () => p.send('put', `/businesses/${businessId}/owner/policies`, {
    quote_approval_cents: cents(f.quote), expense_approval_cents: cents(f.expense), refund_approval_cents: cents(f.refund),
    work_start_requires: f.work_start_requires, work_start_min_role: f.work_start_min_role,
    default_cancellation_fee_percent: Number(f.fee) || 0, no_show_fee_percent: Number(f.noShow) || 0,
    cancellation_notice_hours: Number(f.notice) || 0, allow_customer_reschedule: f.reschedule,
    auto_cancel_no_show_hours: f.autoNoShow === '' ? null : Number(f.autoNoShow), expectedVersion: p.data.policy.version });
  return (
    <section className="g56-panel">
      <h3>{p.tr('title')}</h3>
      {!owner && <p>{p.tr('ownerOnly')}</p>}
      <fieldset disabled={!owner || p.busy}>
        <h4>{p.tr('thresholds')}</h4>
        <p>{p.tr('thresholdsHelp')}</p>
        <div className="g56-row">
          <label>{p.tr('quote')}<input type="number" min="0" step="0.01" inputMode="decimal" value={f.quote} onChange={set('quote')} /></label>
          <label>{p.tr('expense')}<input type="number" min="0" step="0.01" inputMode="decimal" value={f.expense} onChange={set('expense')} /></label>
          <label>{p.tr('refund')}<input type="number" min="0" step="0.01" inputMode="decimal" value={f.refund} onChange={set('refund')} /></label>
        </div>
        <h4>{p.tr('workAuth')}</h4>
        <div className="g56-row">
          <label>{p.tr('startRequires')}<select value={f.work_start_requires} onChange={set('work_start_requires')}>{['none', 'confirmed_booking', 'accepted_quote'].map(v => <option key={v} value={v}>{p.tr(`requires.${v}`)}</option>)}</select></label>
          <label>{p.tr('startRole')}<select value={f.work_start_min_role} onChange={set('work_start_min_role')}>{['employee', 'representative', 'manager', 'owner'].map(v => <option key={v} value={v}>{p.tr(`role.${v}`)}</option>)}</select></label>
        </div>
        <h4>{p.tr('cancellation')}</h4>
        <div className="g56-row">
          <label>{p.tr('notice')}<input type="number" min="0" max="720" value={f.notice} onChange={set('notice')} /></label>
          <label>{p.tr('fee')}<input type="number" min="0" max="100" value={f.fee} onChange={set('fee')} /></label>
          <label>{p.tr('noShow')}<input type="number" min="0" max="100" value={f.noShow} onChange={set('noShow')} /></label>
          <label>{p.tr('autoNoShow')}<input type="number" min="1" max="72" value={f.autoNoShow} onChange={set('autoNoShow')} /></label>
          <label><span><input type="checkbox" checked={f.reschedule} onChange={set('reschedule')} data-track="ui.71b99d1d52.1" /> {p.tr('reschedule')}</span></label>
        </div>
        <button type="button" onClick={save} data-track="ui.71b99d1d52.2">{p.common('save')}</button>
      </fieldset>
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
      {p.notice && <p role="status">{p.common('saved')}</p>}
      <h4>{p.tr('pending')}</h4>
      {!p.data.pending.length ? <p>{p.tr('pendingNone')}</p> : (
        <ul className="g56-list">{p.data.pending.map(item => (
          <li key={`${item.kind}-${item.id}`}><span className="g56-badge">{p.tr(`kind.${item.kind}`)}</span> {item.label} · {(Number(item.amount_cents) / 100).toFixed(2)} · {item.requester}
            <div className="g56-row">
              {item.kind === 'quote'
                ? <button type="button" disabled={p.busy} onClick={() => p.send('post', `/businesses/${businessId}/owner/quotes/${item.id}/approve`)} data-track="ui.71b99d1d52.3">{p.tr('approve')}</button>
                : <>
                  <button type="button" disabled={p.busy} onClick={() => p.send('post', `/businesses/${businessId}/owner/expenses/${item.id}/decision`, { decision: 'approved' })} data-track="ui.71b99d1d52.4">{p.tr('approve')}</button>
                  <button type="button" disabled={p.busy} onClick={() => p.send('post', `/businesses/${businessId}/owner/expenses/${item.id}/decision`, { decision: 'rejected' })} data-track="ui.71b99d1d52.5">{p.tr('reject')}</button></>}
            </div></li>))}</ul>)}
      <h4>{p.tr('history')}</h4>
      <ul className="g56-list">{p.data.history.map(h => <li key={h.version}>v{h.version} · {p.time(h.created_at)} · {h.actor_name}</li>)}</ul>
    </section>
  );
}
