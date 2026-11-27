import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Layers } from 'lucide-react';
import './FranchiseApplicationDetail.css';

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Group 12 Slice 3j (649, D-350): the territory case tracker — the
// territory's cases in one view: support tickets, policy questions,
// training escalations, and handoff records. Filterable by status,
// type, and location. Derived from the existing records (629 queue,
// 628 summary, training escalations, handoffs) — no new case store —
// so a case never disagrees with its source record. Ticket cases link
// to the generic ticket detail, where the thread lives.
export default function FranchiseTerritoryCases({
  cases = [],
  locations = [],
  status = 'open',
  type = 'all',
  locationId = '',
  onStatusChange = null,
  onTypeChange = null,
  onLocationChange = null,
  busy = false,
  // G12-B6 (D-660): the tracker pages past 100 — total is the true
  // case count and onLoadMore appends the next cursor page.
  total = null,
  onLoadMore = null,
  loadingMore = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <Layers size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('casesTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('casesSubtitle')}</p>
        </div>
      </div>

      <div className="fr-doc-list">
        <div>
          <label className="fr-detail-list-label" htmlFor="territory-cases-status">
            {copy('casesFilterStatusLabel')}
          </label>
          <select
            id="territory-cases-status"
            className="fr-followup-input"
            value={status}
            disabled={!onStatusChange || busy}
            onChange={(event) => onStatusChange && onStatusChange(event.target.value)}
          >
            <option value="open">{copy('casesFilterStatusOpen')}</option>
            <option value="all">{copy('casesFilterStatusAll')}</option>
            <option value="resolved">{copy('casesFilterStatusResolved')}</option>
            <option value="closed">{copy('casesFilterStatusClosed')}</option>
            <option value="pending">{copy('casesFilterStatusPending')}</option>
          </select>
        </div>
        <div>
          <label className="fr-detail-list-label" htmlFor="territory-cases-type">
            {copy('casesFilterTypeLabel')}
          </label>
          <select
            id="territory-cases-type"
            className="fr-followup-input"
            value={type}
            disabled={!onTypeChange || busy}
            onChange={(event) => onTypeChange && onTypeChange(event.target.value)}
          >
            <option value="all">{copy('casesFilterTypeAll')}</option>
            <option value="ticket">{copy('casesType_ticket')}</option>
            <option value="policy_question">{copy('casesType_policy_question')}</option>
            <option value="training_escalation">{copy('casesType_training_escalation')}</option>
            <option value="handoff">{copy('casesType_handoff')}</option>
          </select>
        </div>
        <div>
          <label className="fr-detail-list-label" htmlFor="territory-cases-location">
            {copy('ticketsFilterLocationLabel')}
          </label>
          <select
            id="territory-cases-location"
            className="fr-followup-input"
            value={locationId}
            disabled={!onLocationChange || busy}
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

      {cases.length === 0 ? (
        <p className="fr-detail-empty">{copy('casesEmpty')}</p>
      ) : (
        <>
          <ul className="fr-doc-files">
            {cases.map((row) => (
              <li key={`${row.kind}-${row.id}`} className="fr-doc-file">
                <div>
                  <div className="fr-doc-file-name">
                    {row.ticket_number ? `#${row.ticket_number} — ` : ''}
                    {row.title}
                  </div>
                  <div className="fr-doc-file-meta">
                    {copy(`casesType_${row.kind}`)}
                    {' · '}
                    {row.status}
                    {row.priority && (
                      <>
                        {' · '}
                        {row.priority}
                      </>
                    )}
                    {' · '}
                    {row.location_name || copy('exceptionTerritoryWide')}
                    {row.actor_name && (
                      <>
                        {' · '}
                        {row.actor_name}
                      </>
                    )}
                    {' · '}
                    {formatDate(row.created_at)}
                  </div>
                  {row.summary && row.kind !== 'ticket' && (
                    <div className="fr-doc-file-meta">{row.summary}</div>
                  )}
                </div>
                <div>
                  {(row.kind === 'ticket' || row.kind === 'policy_question') && (
                    <Link to={`/support/my-tickets/${row.id}`} className="fr-btn-ghost">
                      {copy('exceptionViewTicket')}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {typeof total === 'number' && cases.length < total && onLoadMore && (
            <button type="button" className="fr-btn-ghost" disabled={loadingMore} onClick={onLoadMore} data-track="ui.44c4e76140.1">
              {copy('casesShowMore', { count: total - cases.length })}
            </button>
          )}
        </>
      )}
    </section>
  );
}
