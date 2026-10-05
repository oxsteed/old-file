import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCreditDateTime } from '../../lib/creditDateTime';
import './CardSecurity.css';

export default function CardHistory({ cardId, fetchHistory, admin = false }) {
  const { t, i18n } = useTranslation('credit');
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState([]);
  const [nextOffset, setNextOffset] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const load = async (offset = 0) => {
    setBusy(true); setError(false);
    try {
      const result = await fetchHistory(cardId, offset);
      setEvents(current => offset === 0 ? result.events : [...new Map([...current, ...result.events].map(event => [event.id, event])).values()]);
      setNextOffset(result.pagination.nextOffset);
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  return <section className="card-history">
    <button type="button" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) load(); }}>{t('cards.security.history')}</button>
    {open && <>
      {busy && <p role="status">{t('cards.security.working')}</p>}
      {error && <p role="alert">{t('cards.security.failed')} <button type="button" onClick={() => load()} disabled={busy}>{t('cards.retry')}</button></p>}
      {!busy && !error && !events.length && <p>{t('cards.security.noHistory')}</p>}
      <ol>{events.map(event => <li key={event.id}>
        <strong>{t(`cards.security.events.${event.action.replace('credit.card.', '')}`, { defaultValue: t('cards.security.activity') })}</strong>
        <p>{formatCreditDateTime(event.createdAt, t('cards.notAvailable'), i18n.resolvedLanguage)} · {t(`cards.security.actors.${event.actor}`)}</p>
        {admin && <details><summary>{t('cards.security.evidence')}</summary>
          <p>{event.actorUserId} · {event.reason} · {event.correlationId} · {event.requestIp}</p>
          <pre>{JSON.stringify({ before: event.beforeState, after: event.afterState, metadata: event.metadata }, null, 2)}</pre>
        </details>}
      </li>)}</ol>
      {nextOffset !== null && <button type="button" disabled={busy} onClick={() => load(nextOffset)}>{t('cards.security.more')}</button>}
    </>}
  </section>;
}
