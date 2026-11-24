import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import './FranchiseApplicationDetail.css';

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Group 12 Slice 3j (646, D-347): the franchise-scoped policy-question
// intake. A policy question IS a support ticket with category
// 'policy_question' — the operator asks it tied to the territory (and
// optionally a location or a standard), and HQ answers in-thread on the
// ticket. The list links to the generic ticket detail, where the thread
// lives; there is no parallel inbox.
export default function FranchisePolicyQuestions({
  questions = [],
  locations = [],
  standards = [],
  canAsk = false,
  onAsk = null,
  busy = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [subject, setSubject] = useState('');
  const [question, setQuestion] = useState('');
  const [locationId, setLocationId] = useState('');
  const [standardId, setStandardId] = useState('');
  const [formError, setFormError] = useState('');

  const standardById = new Map((standards || []).map((standard) => [standard.id, standard]));

  async function submit(event) {
    event.preventDefault();
    if (!onAsk || !subject.trim() || !question.trim()) return;
    setFormError('');
    try {
      await onAsk({
        subject: subject.trim(),
        question: question.trim(),
        location_id: locationId || undefined,
        standard_id: standardId || undefined,
      });
      setSubject('');
      setQuestion('');
      setLocationId('');
      setStandardId('');
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('policyAskFailed'));
    }
  }

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <HelpCircle size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('policyTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('policySubtitle')}</p>
        </div>
      </div>

      {questions.length === 0 ? (
        <p className="fr-detail-empty">{copy('policyEmpty')}</p>
      ) : (
        <ul className="fr-doc-files">
          {questions.map((ticket) => {
            const standard = ticket.metadata?.standard_id
              ? standardById.get(ticket.metadata.standard_id)
              : null;
            return (
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
                    {standard && (
                      <>
                        {' · '}
                        {standard.guide_title || standard.guide_id}
                      </>
                    )}
                    {' · '}
                    {formatDate(ticket.created_at)}
                  </div>
                </div>
                <div>
                  <Link to={`/support/my-tickets/${ticket.id}`} className="fr-btn-ghost">
                    {copy('exceptionViewTicket')}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canAsk && onAsk && (
        <form onSubmit={submit} className="fr-doc-list" data-track="ui.6d7b95f774.1">
          <div>
            <label className="fr-detail-list-label" htmlFor="policy-question-subject">
              {copy('policySubjectLabel')}
            </label>
            <input
              id="policy-question-subject"
              className="fr-followup-input"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder={copy('policySubjectPlaceholder')}
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="policy-question-body">
              {copy('policyQuestionLabel')}
            </label>
            <textarea
              id="policy-question-body"
              className="fr-followup-input"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={copy('policyQuestionPlaceholder')}
              rows={3}
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="policy-question-location">
              {copy('policyLocationLabel')}
            </label>
            <select
              id="policy-question-location"
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
            <label className="fr-detail-list-label" htmlFor="policy-question-standard">
              {copy('policyStandardLabel')}
            </label>
            <select
              id="policy-question-standard"
              className="fr-followup-input"
              value={standardId}
              onChange={(event) => setStandardId(event.target.value)}
            >
              <option value="">{copy('policyStandardNone')}</option>
              {(standards || []).map((standard) => (
                <option key={standard.id} value={standard.id}>
                  {standard.guide_title || standard.guide_id}
                  {standard.version ? ` (v${standard.version})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <button type="submit" className="fr-btn-primary" disabled={busy || !subject.trim() || !question.trim()} data-track="ui.6d7b95f774.2">
              {copy('policyAsk')}
            </button>
          </div>
          {formError && <p className="fr-detail-error">{formError}</p>}
        </form>
      )}
    </section>
  );
}
