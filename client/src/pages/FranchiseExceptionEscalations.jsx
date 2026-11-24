import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpCircle } from 'lucide-react';
import './FranchiseApplicationDetail.css';

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Group 12 Slice 3g (631, D-331): territory-scoped issue escalation —
// the per-territory escalation queue plus the escalate form. Escalation
// is recorded on the ticket (priority bump + note), so the queue shows
// each escalation with the ticket and location it belongs to.
export default function FranchiseExceptionEscalations({
  escalations = [],
  canEscalate = false,
  onEscalate = null,
  busy = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [ticketNumber, setTicketNumber] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (!onEscalate || !ticketNumber.trim() || !reason.trim()) return;
    setFormError('');
    try {
      await onEscalate(ticketNumber.trim(), reason.trim());
      setTicketNumber('');
      setReason('');
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('escalationFailed'));
    }
  }

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <ArrowUpCircle size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('escalationTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('escalationSubtitle')}</p>
        </div>
      </div>

      {escalations.length === 0 ? (
        <p className="fr-detail-empty">{copy('escalationEmpty')}</p>
      ) : (
        <ul className="fr-doc-files">
          {escalations.map((escalation) => (
            <li key={escalation.id} className="fr-doc-file">
              <div>
                <div className="fr-doc-file-name">
                  #{escalation.ticket_number} — {escalation.subject}
                </div>
                <div className="fr-doc-file-meta">
                  {escalation.location_name || copy('exceptionTerritoryWide')}
                  {' · '}
                  {copy('escalationPriority', { before: escalation.priority_before, after: escalation.priority_after })}
                  {' · '}
                  {escalation.reason}
                </div>
                <div className="fr-doc-file-meta">
                  {copy('escalationBy', { name: escalation.escalated_by_name || '—' })}
                  {' · '}
                  {formatDate(escalation.created_at)}
                </div>
              </div>
              <span className="fr-status-badge fr-status-rejected">{escalation.status}</span>
            </li>
          ))}
        </ul>
      )}

      {canEscalate && onEscalate && (
        <form onSubmit={submit} className="fr-doc-list" data-track="ui.41b9c828a0.1">
          <div>
            <label className="fr-detail-list-label" htmlFor="escalation-ticket-number">
              {copy('escalationTicketLabel')}
            </label>
            <input
              id="escalation-ticket-number"
              className="fr-followup-input"
              value={ticketNumber}
              onChange={(event) => setTicketNumber(event.target.value)}
              placeholder={copy('escalationTicketPlaceholder')}
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="escalation-reason">
              {copy('escalationReasonLabel')}
            </label>
            <input
              id="escalation-reason"
              className="fr-followup-input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={copy('escalationReasonPlaceholder')}
            />
          </div>
          <div>
            <button type="submit" className="fr-btn-primary" disabled={busy || !ticketNumber.trim() || !reason.trim()} data-track="ui.41b9c828a0.2">
              {copy('escalationSubmit')}
            </button>
          </div>
          {formError && <p className="fr-detail-error">{formError}</p>}
        </form>
      )}
    </section>
  );
}
