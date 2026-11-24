import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import './FranchiseApplicationDetail.css';

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Group 12 Slice 3f (628, D-327): the service exception summary — the
// territory's support tickets aggregated (D-293: tickets own exceptions).
// Read-only when canLink is false (HQ detail); the operator links one of
// their own tickets by ticket number and unlinks it again.
export default function FranchiseExceptionSummary({
  summary = null,
  locations = [],
  canLink = false,
  onLink = null,
  onUnlink = null,
  busy = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [ticketNumber, setTicketNumber] = useState('');
  const [locationId, setLocationId] = useState('');
  const [linkError, setLinkError] = useState('');

  const openCount = summary?.open_count ?? 0;
  const urgentCount = summary?.open_urgent_count ?? 0;

  async function submitLink(event) {
    event.preventDefault();
    if (!onLink || !ticketNumber.trim()) return;
    setLinkError('');
    try {
      await onLink(ticketNumber.trim(), locationId || null);
      setTicketNumber('');
      setLocationId('');
    } catch (err) {
      setLinkError(err?.response?.data?.error || copy('exceptionLinkFailed'));
    }
  }

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <AlertTriangle size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('exceptionTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('exceptionSubtitle')}</p>
        </div>
      </div>

      {!summary || summary.total === 0 ? (
        <p className="fr-detail-empty">{copy('exceptionEmpty')}</p>
      ) : (
        <>
          <ul className="fr-doc-files">
            <li className="fr-doc-file">
              <div>
                <div className="fr-doc-file-name">{copy('exceptionOpen')}</div>
                <div className="fr-doc-file-meta">
                  {copy('exceptionUrgentOpen', { count: urgentCount })}
                  {' · '}
                  {copy('exceptionResolved', { count: summary.closed_count ?? 0 })}
                  {' · '}
                  {copy('exceptionTotal', { count: summary.total ?? 0 })}
                </div>
              </div>
              <span className={`fr-status-badge ${openCount > 0 ? 'fr-status-rejected' : 'fr-status-accepted'}`}>
                {openCount}
              </span>
            </li>
            {(summary.by_location || []).map((row) => (
              <li key={row.location_id || 'territory'} className="fr-doc-file">
                <div>
                  <div className="fr-doc-file-name">
                    {row.location_name || copy('exceptionTerritoryWide')}
                  </div>
                  <div className="fr-doc-file-meta">
                    {copy('exceptionOpen')}: {row.open_count ?? 0}
                    {' · '}
                    {copy('exceptionTotal')}: {row.total ?? 0}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {(summary.by_category || []).length > 0 && (
            <>
              <div className="fr-detail-list-label">{copy('exceptionByCategory')}</div>
              <p className="fr-doc-file-meta">
                {(summary.by_category || []).map((row) => `${row.category}: ${row.count}`).join(' · ')}
              </p>
            </>
          )}
          {(summary.by_priority || []).length > 0 && (
            <>
              <div className="fr-detail-list-label">{copy('exceptionByPriority')}</div>
              <p className="fr-doc-file-meta">
                {(summary.by_priority || []).map((row) => `${row.priority}: ${row.count}`).join(' · ')}
              </p>
            </>
          )}
          {summary.oldest_open_at && (
            <p className="fr-doc-file-meta">
              {copy('exceptionOldestOpen')}: {formatDate(summary.oldest_open_at)}
            </p>
          )}

          {(summary.recent_open || []).length > 0 && (
            <>
              <div className="fr-detail-list-label">{copy('exceptionRecentOpen')}</div>
              <ul className="fr-doc-files">
                {(summary.recent_open || []).map((ticket) => (
                  <li key={ticket.id} className="fr-doc-file">
                    <div>
                      <div className="fr-doc-file-name">
                        #{ticket.ticket_number} — {ticket.subject}
                      </div>
                      <div className="fr-doc-file-meta">
                        {ticket.status}
                        {' · '}
                        {ticket.priority}
                        {' · '}
                        {ticket.location_name || copy('exceptionTerritoryWide')}
                        {' · '}
                        {formatDate(ticket.created_at)}
                      </div>
                    </div>
                    <div>
                      <Link to={`/support/my-tickets/${ticket.id}`} className="fr-btn-ghost">
                        {copy('exceptionViewTicket')}
                      </Link>
                      {canLink && onUnlink && (
                        <button
                          type="button"
                          className="fr-btn-ghost"
                          disabled={busy}
                          onClick={async () => {
                            setLinkError('');
                            try {
                              await onUnlink(ticket.id);
                            } catch (err) {
                              setLinkError(err?.response?.data?.error || copy('exceptionUnlinkFailed'));
                            }
                          }}
                        >
                          {copy('exceptionUnlink')}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {canLink && onLink && (
        <form onSubmit={submitLink} className="fr-doc-list">
          <div className="fr-detail-list-label">{copy('exceptionLinkTitle')}</div>
          <div>
            <label className="fr-detail-list-label" htmlFor="exception-ticket-number">
              {copy('exceptionLinkTicketNumberLabel')}
            </label>
            <input
              id="exception-ticket-number"
              className="fr-followup-input"
              value={ticketNumber}
              onChange={(event) => setTicketNumber(event.target.value)}
              placeholder={copy('exceptionLinkTicketNumberPlaceholder')}
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="exception-location">
              {copy('exceptionLinkLocationLabel')}
            </label>
            <select
              id="exception-location"
              className="fr-followup-input"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              <option value="">{copy('exceptionTerritoryWide')}</option>
              {(locations || []).map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </div>
          <div>
            <button type="submit" className="fr-btn-primary" disabled={busy || !ticketNumber.trim()}>
              {copy('exceptionLinkSubmit')}
            </button>
          </div>
          {linkError && <p className="fr-detail-error">{linkError}</p>}
        </form>
      )}
    </section>
  );
}
