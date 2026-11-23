import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import { formatDateTime } from '../lib/format';

// Group 4 rest, item 181: job-level reschedule proposals for hired jobs
// without an appointment. Server: /jobs/:id/reschedule-proposals.
export default function JobRescheduleProposals({ jobId, userId, canPropose, onChanged }) {
  const { t, i18n } = useTranslation();
  const c = (key, opts) => t(`helperG4.reschedule.${key}`, opts);
  const [items, setItems] = useState([]);
  const [when, setWhen] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = `/jobs/${encodeURIComponent(jobId)}/reschedule-proposals`;

  const load = useCallback((signal) => api.get(base, { signal })
    .then(({ data }) => { if (!signal?.aborted) setItems(data.proposals || []); })
    .catch(() => {}), [base]);
  useEffect(() => { const ctrl = new AbortController(); load(ctrl.signal); return () => ctrl.abort(); }, [load]);

  async function run(fn) {
    setBusy(true); setError('');
    try { await fn(); await load(); onChanged?.(); } catch { setError(c('failed')); } finally { setBusy(false); }
  }
  const fmt = (v) => formatDateTime(v, { locale: i18n.language });

  if (!canPropose && items.length === 0) return null;
  return <section className="jdp-secondary-action" aria-labelledby={`job-resched-${jobId}`}>
    <h3 id={`job-resched-${jobId}`}>{c('title')}</h3>
    {canPropose && <form onSubmit={(e) => { e.preventDefault(); if (!when) return; run(() => api.post(base, { proposedTime: new Date(when).toISOString(), reason: reason.trim() || undefined })).then(() => { setWhen(''); setReason(''); }); }} data-track="ui.2c8b47a982.1">
      <p>{c('hint')}</p>
      <label>{c('newTime')} <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required /></label>
      <label>{c('reason')} <input type="text" dir="auto" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <button type="submit" className="jdp-btn-ghost" disabled={busy || !when} data-track="ui.helperG4.reschedule.propose">{c('propose')}</button>
    </form>}
    {error && <p role="alert">{error}</p>}
    {items.length > 0 && <ul>{items.map((p) => {
      const mine = String(p.proposedBy) === String(userId);
      return <li key={p.id}>
        <span>{mine ? c('byYou') : c('byOther')}: <time dateTime={p.proposedTime}>{fmt(p.proposedTime)}</time></span>
        {p.reason && <span dir="auto"> — {p.reason}</span>}
        <span> · {c(`status.${p.status}`)}</span>
        {p.status === 'proposed' && !mine && <>
          {' '}<button type="button" className="jdp-btn-ghost" disabled={busy} onClick={() => run(() => api.post(`${base}/${encodeURIComponent(p.id)}/respond`, { action: 'accept' }))} data-track="ui.helperG4.reschedule.accept">{c('accept')}</button>
          {' '}<button type="button" className="jdp-btn-ghost" disabled={busy} onClick={() => run(() => api.post(`${base}/${encodeURIComponent(p.id)}/respond`, { action: 'decline' }))} data-track="ui.helperG4.reschedule.decline">{c('decline')}</button>
        </>}
        {p.status === 'proposed' && mine && <>{' '}<button type="button" className="jdp-btn-ghost" disabled={busy} onClick={() => run(() => api.post(`${base}/${encodeURIComponent(p.id)}/respond`, { action: 'withdraw' }))} data-track="ui.helperG4.reschedule.withdraw">{c('withdraw')}</button></>}
      </li>;
    })}</ul>}
  </section>;
}
