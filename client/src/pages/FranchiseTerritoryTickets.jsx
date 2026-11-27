import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import './FranchiseApplicationDetail.css';

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Group 12 Slice 3f (629, D-329): the territory ticket queue — the
// territory's support requests, filterable by status and location. Every
// row carries its franchise link (application + location) and a link to
// the generic ticket detail, so a request never appears without saying
// which application and location it belongs to.
export default function FranchiseTerritoryTickets({
  tickets = [],
  locations = [],
  status = 'open',
  locationId = '',
  onStatusChange = null,
  onLocationChange = null,
  canUnlink = false,
  onUnlink = null,
  busy = false,
  // G12-B6 (D-660): the queue pages past 100 — total is the true
  // queue size and onLoadMore appends the next cursor page.
  total = null,
  onLoadMore = null,
  loadingMore = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <Inbox size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('ticketsTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('ticketsSubtitle')}</p>
        </div>
      </div>

      <div className="fr-doc-list">
        <div>
          <label className="fr-detail-list-label" htmlFor="territory-tickets-status">
            {copy('ticketsFilterStatusLabel')}
          </label>
          <select
            id="territory-tickets-status"
            className="fr-followup-input"
            value={status}
            disabled={!onStatusChange}
            onChange={(event) => onStatusChange && onStatusChange(event.target.value)}
          >
            <option value="open">{copy('ticketsFilterStatusOpen')}</option>
            <option value="all">{copy('ticketsFilterStatusAll')}</option>
            <option value="resolved">{copy('ticketsFilterStatusResolved')}</option>
            <option value="closed">{copy('ticketsFilterStatusClosed')}</option>
          </select>
        </div>
        <div>
          <label className="fr-detail-list-label" htmlFor="territory-tickets-location">
            {copy('ticketsFilterLocationLabel')}
          </label>
          <select
            id="territory-tickets-location"
            className="fr-followup-input"
            value={locationId}
            disabled={!onLocationChange}
            onChange={(event) => onLocationChange && onLocationChange(event.target.value)}
          >
            <option value="">{copy('ticketsFilterLocationAll')}</option>
            <option value="unassigned">{copy('ticketsFilterLocationUnassigned')}</option>
            {(locations || []).map((location) => (
              <option key={location.id} value={location.id}>{location.name}</option>
            ))}
          </select>
        </div>
      </div>

      {tickets.length === 0 ? (
        <p className="fr-detail-empty">{copy('ticketsEmpty')}</p>
      ) : (
        <>
          <ul className="fr-doc-files">
            {tickets.map((ticket) => (
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
                    {ticket.category}
                    {' · '}
                    {ticket.location_name || copy('exceptionTerritoryWide')}
                    {' · '}
                    {ticket.requester_name || ticket.requester_email || '—'}
                    {' · '}
                    {formatDate(ticket.created_at)}
                  </div>
                </div>
                <div>
                  <Link to={`/support/my-tickets/${ticket.id}`} className="fr-btn-ghost">
                    {copy('exceptionViewTicket')}
                  </Link>
                  {canUnlink && onUnlink && (
                    <button
                      type="button"
                      className="fr-btn-ghost"
                      disabled={busy}
                      onClick={() => onUnlink(ticket.id)} data-track="ui.7646bcf7dc.1"
                    >
                      {copy('exceptionUnlink')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {typeof total === 'number' && tickets.length < total && onLoadMore && (
            <button type="button" className="fr-btn-ghost" disabled={loadingMore} onClick={onLoadMore} data-track="ui.7646bcf7dc.2">
              {copy('ticketsShowMore', { count: total - tickets.length })}
            </button>
          )}
        </>
      )}
    </section>
  );
}
