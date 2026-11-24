import { useTranslation } from 'react-i18next';
import { ClipboardCheck } from 'lucide-react';
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

// Group 12 Slice 3c (613, D-313): the formal readiness review — HQ
// sign-off (or request-changes) with notes and date. Read-only for the
// operator: the review is what moves readiness to `ready`, never a bare
// admin status set. The reviewer is never shown here (D-313).
export default function FranchiseReadinessReviews({ reviews = [] }) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <ClipboardCheck size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('readinessReviewTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('readinessReviewSubtitle')}</p>
        </div>
      </div>

      {reviews.length === 0 ? (
        <p className="fr-detail-empty">{copy('readinessReviewEmpty')}</p>
      ) : (
        <ul className="fr-doc-files">
          {reviews.map((review) => (
            <li key={review.id} className="fr-doc-file">
              <div>
                <div className="fr-doc-file-meta">{formatDateTime(review.created_at)}</div>
                {review.notes && (
                  <div className="fr-doc-file-name">{review.notes}</div>
                )}
              </div>
              <span className={`fr-status-badge ${review.outcome === 'passed' ? 'fr-status-accepted' : 'fr-status-rejected'}`}>
                {review.outcome === 'passed' ? copy('readinessReviewPassed') : copy('readinessReviewChangesRequested')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
