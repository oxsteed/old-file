import { useTranslation } from 'react-i18next';
import { History } from 'lucide-react';
import './FranchiseApplicationDetail.css';

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Group 12 Slice 3j (650, D-351): the franchise support history — the
// full chronological history of the territory's support interactions
// (tickets, escalations, policy questions, appointments, training
// escalations, resolutions), derived from the existing records, never
// a duplicate history store. Readable by the operator and HQ.
export default function FranchiseSupportHistory({ history = null }) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const events = history?.history || [];
  const summary = history?.summary || null;

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <History size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('supportHistoryTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('supportHistorySubtitle')}</p>
        </div>
      </div>

      {summary && (
        <p className="fr-doc-file-meta">
          {copy('supportHistoryOpen', { count: summary.open_cases ?? 0 })}
          {' · '}
          {copy('supportHistoryResolved', { count: summary.resolved_cases ?? 0 })}
        </p>
      )}

      {events.length === 0 ? (
        <p className="fr-detail-empty">{copy('supportHistoryEmpty')}</p>
      ) : (
        <ul className="fr-history-list">
          {events.map((event, index) => (
            <li key={`${event.kind}-${event.ref_id}-${event.at}-${index}`} className="fr-history-item">
              <div className="fr-history-when">{formatDateTime(event.at)}</div>
              <div>
                <div className="fr-history-summary">
                  {copy(`supportHistoryKind_${event.kind}`)}
                  {' — '}
                  {event.title}
                </div>
                {(event.summary || event.actor_name) && (
                  <div className="fr-doc-file-meta">
                    {event.summary || ''}
                    {event.summary && event.actor_name ? ' · ' : ''}
                    {event.actor_name || ''}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
