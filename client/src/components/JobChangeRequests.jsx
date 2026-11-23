import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import { formatCents } from '../lib/format';

// Group 4 rest, item 183: scope/price change requests for hired jobs with no
// work agreement. Server: /jobs/:id/change-requests. Plain groups, not
// <form>s: the job page's own forms expect one submit button each.
function Draft({ c, busy, label, track, onSend }) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const cents = Math.round(Number(amount) * 100);
  const ok = description.trim().length >= 10 && amount !== '' && Number.isSafeInteger(cents);
  const send = async () => { if (await onSend({ description: description.trim(), priceChangeCents: cents })) { setDescription(''); setAmount(''); } };
  return <div role="group" aria-label={label}>
    <label>{c('description')} <textarea dir="auto" maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    <label>{c('priceChange')} <input type="number" inputMode="decimal" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
    {track === 'counter'
      ? <button type="button" className="jdp-btn-ghost" disabled={busy || !ok} onClick={send} data-track="ui.helperG4.changes.sendCounter">{label}</button>
      : <button type="button" className="jdp-btn-ghost" disabled={busy || !ok} onClick={send} data-track="ui.helperG4.changes.propose">{label}</button>}
  </div>;
}

export default function JobChangeRequests({ jobId, userId, isHelper, canWrite, currency = 'USD', onChanged }) {
  const { t } = useTranslation();
  const c = (key, opts) => t(`helperG4.changes.${key}`, opts);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [countering, setCountering] = useState(null);
  const base = `/jobs/${encodeURIComponent(jobId)}/change-requests`;

  const load = useCallback((signal) => api.get(base, { signal })
    .then(({ data }) => { if (!signal?.aborted) setItems(data.changeRequests || []); })
    .catch(() => {}), [base]);
  useEffect(() => { const ctrl = new AbortController(); load(ctrl.signal); return () => ctrl.abort(); }, [load]);

  async function run(fn) {
    setBusy(true); setError('');
    try { await fn(); await load(); setCountering(null); onChanged?.(); return true; } catch (err) {
      const code = err?.response?.data?.code;
      setError(code === 'use_work_agreement_change_order' ? c(`errors.${code}`) : c('errors.generic'));
      return false;
    } finally { setBusy(false); }
  }
  const respond = (id, body) => run(() => api.post(`${base}/${encodeURIComponent(id)}/respond`, body));
  const open = items.find((x) => x.status === 'proposed');
  const money = (v) => `${v > 0 ? '+' : ''}${formatCents(v, { currency })}`;

  if (!canWrite && items.length === 0) return null;
  return <section className="jdp-secondary-action" aria-labelledby={`job-changes-${jobId}`}>
    <h3 id={`job-changes-${jobId}`}>{c('title')}</h3>
    <p>{c('hint')}</p>
    {error && <p role="alert">{error}</p>}
    {canWrite && isHelper && !open && <Draft c={c} busy={busy} label={c('propose')} track="propose" onSend={(body) => run(() => api.post(base, body))} />}
    {items.length > 0 && <ol>{items.map((x) => {
      const mine = String(x.proposedBy) === String(userId);
      return <li key={x.id}>
        <p><strong>{c('version', { version: x.version })}</strong> · {c('from', { who: mine ? c('byYou') : c('byOther') })} · {c(`status.${x.status}`)}</p>
        <p dir="auto">{x.description}</p>
        <p><bdi>{money(x.priceChangeCents)}</bdi></p>
        {x.paymentAction === 'reauthorization_required' && <p>{c('reauth')}</p>}
        {canWrite && x.status === 'proposed' && !mine && <>
          <button type="button" className="jdp-btn-ghost" disabled={busy} onClick={() => respond(x.id, { action: 'accept' })} data-track="ui.helperG4.changes.accept">{c('accept')}</button>
          {' '}<button type="button" className="jdp-btn-ghost" disabled={busy} onClick={() => respond(x.id, { action: 'decline' })} data-track="ui.helperG4.changes.decline">{c('decline')}</button>
          {' '}<button type="button" className="jdp-btn-ghost" disabled={busy} onClick={() => setCountering(x.id)} data-track="ui.helperG4.changes.counter">{c('counter')}</button>
          {countering === x.id && <Draft c={c} busy={busy} label={c('sendCounter')} track="counter" onSend={(body) => respond(x.id, { action: 'counter', ...body })} />}
        </>}
        {x.status === 'proposed' && mine && <button type="button" className="jdp-btn-ghost" disabled={busy} onClick={() => respond(x.id, { action: 'withdraw' })} data-track="ui.helperG4.changes.withdraw">{c('withdraw')}</button>}
      </li>;
    })}</ol>}
  </section>;
}
