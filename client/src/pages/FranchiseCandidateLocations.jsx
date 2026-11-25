import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import './FranchiseApplicationDetail.css';

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const CANDIDATE_STATUS_KEYS = {
  scouting: 'candidateStatus_scouting',
  shortlisted: 'candidateStatus_shortlisted',
  approved: 'candidateStatus_approved',
  rejected: 'candidateStatus_rejected',
};

const CANDIDATE_STATUS_BADGE = {
  scouting: 'fr-status-pending',
  shortlisted: 'fr-status-pending',
  approved: 'fr-status-accepted',
  rejected: 'fr-status-rejected',
};

// Group 12 Slice 3h (636, D-336): the candidate location tracker —
// locations inside the territory the operator is scouting. The operator
// proposes (scouting) and submits for review; HQ shortlists, approves,
// or rejects, and reopens a rejected candidate. Approval is a decision
// record, not a launch: promoting a candidate stays the HQ add-location
// step.
export default function FranchiseCandidateLocations({
  candidates = null,
  canPropose = false,
  canReview = false,
  onPropose = null,
  onStatusChange = null,
  onRemove = null,
  busy = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [form, setForm] = useState({ proposed_name: '', city: '', region: '', country: '', notes: '' });
  const [formError, setFormError] = useState('');

  const list = candidates?.candidate_locations || [];
  const byStatus = candidates?.by_status || {};

  async function submit(event) {
    event.preventDefault();
    if (!onPropose || !form.proposed_name.trim()) return;
    setFormError('');
    try {
      await onPropose({
        proposed_name: form.proposed_name.trim(),
        city: form.city.trim() || undefined,
        region: form.region.trim() || undefined,
        country: form.country.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      setForm({ proposed_name: '', city: '', region: '', country: '', notes: '' });
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('candidateProposeFailed'));
    }
  }

  async function move(candidate, status) {
    if (!onStatusChange) return;
    setFormError('');
    try {
      await onStatusChange(candidate.id, status);
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('candidateUpdateFailed'));
    }
  }

  async function remove(candidate) {
    if (!onRemove) return;
    setFormError('');
    try {
      await onRemove(candidate.id);
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('candidateRemoveFailed'));
    }
  }

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <MapPin size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('candidateTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('candidateSubtitle')}</p>
        </div>
      </div>

      {candidates && (
        <p className="fr-doc-file-meta">
          {copy('candidateScouting', { count: byStatus.scouting ?? 0 })}
          {' · '}
          {copy('candidateShortlisted', { count: byStatus.shortlisted ?? 0 })}
          {' · '}
          {copy('candidateApproved', { count: byStatus.approved ?? 0 })}
          {' · '}
          {copy('candidateRejected', { count: byStatus.rejected ?? 0 })}
        </p>
      )}

      {list.length === 0 ? (
        <p className="fr-detail-empty">{copy('candidateEmpty')}</p>
      ) : (
        <ul className="fr-doc-files">
          {list.map((candidate) => (
            <li key={candidate.id} className="fr-doc-file">
              <div>
                <div className="fr-doc-file-name">{candidate.proposed_name}</div>
                <div className="fr-doc-file-meta">
                  {candidate.area || '—'}
                  {' · '}
                  {copy('candidateProposedBy', { name: candidate.proposed_by_name || '—' })}
                  {' · '}
                  {formatDate(candidate.created_at)}
                </div>
                {candidate.notes && (
                  <div className="fr-doc-file-meta">{candidate.notes}</div>
                )}
                {candidate.reviewed_by_name && (
                  <div className="fr-doc-file-meta">
                    {copy('candidateReviewedBy', { name: candidate.reviewed_by_name })}
                    {' · '}
                    {formatDate(candidate.reviewed_at)}
                  </div>
                )}
                <div className="fr-doc-file-meta">
                  {canPropose && candidate.status === 'scouting' && (
                    <button type="button" className="fr-btn-ghost" disabled={busy} onClick={() => move(candidate, 'shortlisted')} data-track="ui.b7dfb6110d.1">
                      {copy('candidateSubmitReview')}
                    </button>
                  )}
                  {canPropose && candidate.status === 'shortlisted' && (
                    <button type="button" className="fr-btn-ghost" disabled={busy} onClick={() => move(candidate, 'scouting')} data-track="ui.b7dfb6110d.2">
                      {copy('candidateWithdraw')}
                    </button>
                  )}
                  {canReview && candidate.status === 'scouting' && (
                    <>
                      <button type="button" className="fr-btn-primary" disabled={busy} onClick={() => move(candidate, 'shortlisted')} data-track="ui.b7dfb6110d.3">
                        {copy('candidateShortlist')}
                      </button>
                      <button type="button" className="fr-btn-ghost" disabled={busy} onClick={() => move(candidate, 'rejected')} data-track="ui.b7dfb6110d.4">
                        {copy('candidateReject')}
                      </button>
                    </>
                  )}
                  {canReview && candidate.status === 'shortlisted' && (
                    <>
                      <button type="button" className="fr-btn-primary" disabled={busy} onClick={() => move(candidate, 'approved')} data-track="ui.b7dfb6110d.5">
                        {copy('candidateApprove')}
                      </button>
                      <button type="button" className="fr-btn-ghost" disabled={busy} onClick={() => move(candidate, 'rejected')} data-track="ui.b7dfb6110d.6">
                        {copy('candidateReject')}
                      </button>
                    </>
                  )}
                  {canReview && candidate.status === 'rejected' && (
                    <button type="button" className="fr-btn-ghost" disabled={busy} onClick={() => move(candidate, 'scouting')} data-track="ui.b7dfb6110d.7">
                      {copy('candidateReopen')}
                    </button>
                  )}
                  {((canPropose && candidate.status === 'scouting')
                    || (canReview && candidate.status !== 'approved')) && onRemove && (
                    <button type="button" className="fr-btn-ghost" disabled={busy} onClick={() => remove(candidate)} data-track="ui.b7dfb6110d.8">
                      {copy('candidateRemove')}
                    </button>
                  )}
                </div>
              </div>
              <span className={`fr-status-badge ${CANDIDATE_STATUS_BADGE[candidate.status] || 'fr-status-pending'}`}>
                {copy(CANDIDATE_STATUS_KEYS[candidate.status] || 'candidateStatus_scouting')}
              </span>
            </li>
          ))}
        </ul>
      )}

      {(canPropose || canReview) && onPropose && (
        <form onSubmit={submit} className="fr-doc-list" data-track="ui.b7dfb6110d.9">
          <div>
            <label className="fr-detail-list-label" htmlFor="candidate-proposed-name">
              {copy('candidateNameLabel')}
            </label>
            <input
              id="candidate-proposed-name"
              className="fr-followup-input"
              value={form.proposed_name}
              onChange={(event) => setForm((v) => ({ ...v, proposed_name: event.target.value }))}
              placeholder={copy('candidateNamePlaceholder')}
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="candidate-city">
              {copy('candidateCityLabel')}
            </label>
            <input
              id="candidate-city"
              className="fr-followup-input"
              value={form.city}
              onChange={(event) => setForm((v) => ({ ...v, city: event.target.value }))}
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="candidate-region">
              {copy('candidateRegionLabel')}
            </label>
            <input
              id="candidate-region"
              className="fr-followup-input"
              value={form.region}
              onChange={(event) => setForm((v) => ({ ...v, region: event.target.value }))}
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="candidate-country">
              {copy('candidateCountryLabel')}
            </label>
            <input
              id="candidate-country"
              className="fr-followup-input"
              value={form.country}
              onChange={(event) => setForm((v) => ({ ...v, country: event.target.value }))}
              placeholder="US"
              maxLength={2}
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="candidate-notes">
              {copy('candidateNotesLabel')}
            </label>
            <input
              id="candidate-notes"
              className="fr-followup-input"
              value={form.notes}
              onChange={(event) => setForm((v) => ({ ...v, notes: event.target.value }))}
            />
          </div>
          <div>
            <button type="submit" className="fr-btn-primary" disabled={busy || !form.proposed_name.trim()} data-track="ui.b7dfb6110d.10">
              {copy('candidatePropose')}
            </button>
          </div>
          {formError && <p className="fr-detail-error">{formError}</p>}
        </form>
      )}
      {formError && !((canPropose || canReview) && onPropose) && <p className="fr-detail-error">{formError}</p>}
    </section>
  );
}
