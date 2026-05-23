import React from 'react';
import { useTranslation } from 'react-i18next';

export default function BatchJobCard({ job }) {
  const { t } = useTranslation(['translator']);

  return (
    <section className="translator-card">
      <div className="translator-card-header">
        <h2>{t('translator:batch.title')}</h2>
      </div>

      {!job ? (
        <p className="translator-muted">{t('translator:batch.empty')}</p>
      ) : (
        <div className="translator-batch-grid">
          <div className="translator-result-block">
            <span className="translator-label">{t('translator:batch.jobId')}</span>
            <strong>{job.id}</strong>
          </div>
          <div className="translator-result-block">
            <span className="translator-label">{t('translator:batch.status')}</span>
            <strong>{job.status}</strong>
          </div>
          <div className="translator-result-block">
            <span className="translator-label">{t('translator:batch.progress')}</span>
            <strong>{job.progress}%</strong>
          </div>
          <div className="translator-result-block">
            <span className="translator-label">{t('translator:batch.completedItems')}</span>
            <strong>{job.completedCount} / {job.itemCount}</strong>
          </div>
          <div className="translator-result-block translator-result-block-wide">
            <span className="translator-label">{t('translator:batch.results')}</span>
            {Array.isArray(job.resultPayload) && job.resultPayload.length > 0 ? (
              <div className="translator-batch-results">
                {job.resultPayload.map((item, index) => (
                  <article className="translator-batch-item" key={`${job.id}-${index}`}>
                    <span className="translator-batch-index">#{index + 1}</span>
                    <p>{item.translatedText}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="translator-muted">{t('translator:batch.waiting')}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
