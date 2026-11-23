import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import api from '../api/axios';
import { formatDate } from '../lib/format';

// Group 4 rest, item 193: repeat customer follow-up.
// Server: GET /helpers/me/repeat-customers, POST .../:customerId/invite.
export default function HelperRepeatCustomers() {
  const { user } = useAuth();
  return user?.id ? <RepeatCustomers key={user.id} /> : null;
}

function RepeatCustomers() {
  const { t, i18n } = useTranslation();
  const c = (key, opts) => t(`helperG4.repeat.${key}`, opts);
  const [customers, setCustomers] = useState(null);
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api.get('/helpers/me/repeat-customers', { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setCustomers(data.customers || []); })
      .catch(() => { if (!controller.signal.aborted) setCustomers(null); });
    return () => controller.abort();
  }, []);

  async function invite(customer) {
    setBusy(customer.customerId);
    setNotice('');
    try {
      const note = (notes[customer.customerId] || '').trim();
      const { data } = await api.post(`/helpers/me/repeat-customers/${encodeURIComponent(customer.customerId)}/invite`, note ? { message: note } : {});
      const next = new Date(new Date(data.invite.sentAt).getTime() + 30 * 86400000).toISOString();
      setCustomers((list) => list.map((x) => (x.customerId === customer.customerId ? { ...x, canInvite: false, lastInvitedAt: data.invite.sentAt, nextInviteAt: next } : x)));
      setNotice(c('invited'));
    } catch {
      setNotice(c('failed'));
    } finally {
      setBusy(null);
    }
  }

  if (customers === null) return null;
  return <section className="helper-reputation" aria-labelledby="helper-repeat-title">
    <h2 id="helper-repeat-title">{c('title')}</h2>
    <p>{c('hint')}</p>
    {notice && <p role="status">{notice}</p>}
    {customers.length === 0 ? <p>{c('empty')}</p> : <ul className="helper-reputation-list">
      {customers.map((x) => <li key={x.customerId}>
        <header>
          <strong>{x.firstName || c('customer')}</strong>
          <span>{c('jobs', { count: x.completedJobs })}</span>
          {x.lastCompletedAt && <time dateTime={x.lastCompletedAt}>{formatDate(x.lastCompletedAt, { locale: i18n.language })}</time>}
          {x.lastJobTitle && <span dir="auto">{x.lastJobTitle}</span>}
        </header>
        {x.canInvite ? <div className="helper-reputation-respond">
          <label htmlFor={`rebook-${x.customerId}`}>{c('note')}</label>
          <textarea id={`rebook-${x.customerId}`} dir="auto" maxLength={500} value={notes[x.customerId] || ''}
            onChange={(e) => setNotes((n) => ({ ...n, [x.customerId]: e.target.value }))} />
          <button type="button" disabled={busy === x.customerId} onClick={() => invite(x)} data-track="ui.helperG4.repeat.invite">{c('invite')}</button>
        </div> : x.nextInviteAt && <p>{c('nextOn', { date: formatDate(x.nextInviteAt, { locale: i18n.language }) })}</p>}
      </li>)}
    </ul>}
  </section>;
}
