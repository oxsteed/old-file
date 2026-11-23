import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';

const REASONS = ['schedule_conflict', 'illness', 'outside_skills', 'travel', 'other'];
const KNOWN = ['handback_money_on_job', 'handback_agreement_signed', 'handback_after_start'];

// Group 4 rest, item 184: the assigned helper hands a hired job back before
// it starts. The server decides; this only collects the reason.
export default function JobHandback({ jobId, onDone }) {
  const { t } = useTranslation();
  const c = (key) => t(`helperG4.handback.${key}`);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('schedule_conflict');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (reason === 'other' && !note.trim()) { setError(c('noteRequired')); return; }
    setBusy(true); setError('');
    try {
      await api.post(`/jobs/${encodeURIComponent(jobId)}/hand-back`, { reasonCode: reason, note: note.trim() || undefined });
      onDone?.(c('done'));
    } catch (err) {
      const code = err?.response?.data?.code || err?.response?.data?.error?.code;
      setError(KNOWN.includes(code) ? c(`errors.${code}`) : c('errors.generic'));
    } finally { setBusy(false); }
  }

  return <section className="jdp-secondary-action" aria-labelledby={`job-handback-${jobId}`}>
    <h3 id={`job-handback-${jobId}`}>{c('title')}</h3>
    <p>{c('hint')}</p>
    {!open && <button type="button" className="jdp-btn-ghost" onClick={() => setOpen(true)} data-track="ui.helperG4.handback.open">{c('open')}</button>}
    {open && <div role="group" aria-label={c('open')}>
      <label>{c('reason')} <select value={reason} onChange={(e) => setReason(e.target.value)}>
        {REASONS.map((r) => <option key={r} value={r}>{c(`reasons.${r}`)}</option>)}
      </select></label>
      <label>{c('note')} <textarea dir="auto" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <button type="button" className="jdp-btn-ghost" disabled={busy} onClick={submit} data-track="ui.helperG4.handback.confirm">{c('confirm')}</button>
      {' '}<button type="button" className="jdp-btn-ghost" disabled={busy} onClick={() => { setOpen(false); setError(''); }} data-track="ui.helperG4.handback.cancel">{c('cancel')}</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
