import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import { formatDate } from '../lib/format';

// Group 4 rest, items 185 (support escalation) and 190 (payment issue
// intake) for the job's assigned helper. Server: /helpers/me/jobs/:id/support.
const KINDS = ['job_issue', 'safety', 'payment_issue'];
const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : null);

export default function HelperJobSupport({ jobId }) {
  const { t, i18n } = useTranslation();
  const c = (key, opts) => t(`helperG4.jobSupport.${key}`, opts);
  const [kind, setKind] = useState('job_issue');
  const [message, setMessage] = useState('');
  const [requestId, setRequestId] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [tickets, setTickets] = useState([]);

  useEffect(() => {
    const controller = new AbortController();
    api.get(`/helpers/me/jobs/${encodeURIComponent(jobId)}/support`, { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setTickets(data.tickets || []); })
      .catch(() => {});
    return () => controller.abort();
  }, [jobId]);

  async function submit(event) {
    event.preventDefault();
    if (!message.trim() || busy || !requestId) return;
    setBusy(true);
    setNotice('');
    try {
      const { data } = await api.post(`/helpers/me/jobs/${encodeURIComponent(jobId)}/support`, { kind, message: message.trim(), clientRequestId: requestId });
      setTickets((prev) => [data.ticket, ...prev.filter((x) => x.id !== data.ticket.id)]);
      setNotice(c('sent', { number: data.ticket.ticketNumber || data.ticket.id }));
      setMessage('');
      setRequestId(newKey());
    } catch {
      // Keep the same key so a retry of this exact request cannot duplicate.
      setNotice(c('failed'));
    } finally {
      setBusy(false);
    }
  }

  return <section className="jdp-secondary-action" aria-labelledby={`helper-job-support-${jobId}`}>
    <h3 id={`helper-job-support-${jobId}`}>{c('title')}</h3>
    <form onSubmit={submit} data-track-private>
      <label>{c('kind')} <select value={kind} onChange={(e) => { setKind(e.target.value); setRequestId(newKey()); }}>
        {KINDS.map((k) => <option key={k} value={k}>{c(`kinds.${k}`)}</option>)}
      </select></label>
      {kind === 'safety' && <p role="note">{c('safetyNote')}</p>}
      <label>{c('message')} <textarea dir="auto" maxLength={5000} value={message} onChange={(e) => { setMessage(e.target.value); }} /></label>
      <button type="submit" className="jdp-btn-ghost" disabled={busy || !message.trim()} data-track="ui.helperG4.jobSupport.submit" data-track-private>{c('submit')}</button>
    </form>
    {notice && <p role="status">{notice}</p>}
    {tickets.length > 0 && <>
      <h4>{c('history')}</h4>
      <ul>{tickets.map((tk) => <li key={tk.id}>
        <span>{tk.ticketNumber || tk.id}</span> · <span>{c(`kinds.${tk.kind}`, { defaultValue: tk.subject })}</span> · <span>{c(`status.${tk.status}`, { defaultValue: tk.status })}</span> · <time dateTime={tk.createdAt}>{formatDate(tk.createdAt, { locale: i18n.language })}</time>
      </li>)}</ul>
    </>}
  </section>;
}
