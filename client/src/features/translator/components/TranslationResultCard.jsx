import React from 'react';
import { useTranslation } from 'react-i18next';

function Badge({ children }) {
  return <span className="translator-badge">{children}</span>;
}

export default function TranslationResultCard({ result }) {
  const { t } = useTranslation(['translator']);

  return (
    <section className="translator-card">
      <div className="translator-card-header">
        <h2>{t('translator:results.title')}</h2>
      </div>

      {!result ? (
        <p className="translator-muted">{t('translator:results.empty')}</p>
      ) : (
        <div className="translator-result-grid">
          <div className="translator-result-block translator-result-block-wide">
            <span className="translator-label">{t('translator:results.translatedText')}</span>
            <pre className="translator-output">{result.translatedText}</pre>
          </div>
          <div className="translator-result-block">
            <span className="translator-label">{t('translator:results.sourceLanguage')}</span>
            <strong>{result.sourceLanguage}</strong>
          </div>
          <div className="translator-result-block">
            <span className="translator-label">{t('translator:results.targetLanguage')}</span>
            <strong>{result.targetLanguage}</strong>
          </div>
          <div className="translator-result-block">
            <span className="translator-label">{t('translator:results.provider')}</span>
            <strong>{result.provider}</strong>
          </div>
          <div className="translator-result-block">
            <span className="translator-label">{t('translator:results.model')}</span>
            <strong>{result.model}</strong>
          </div>
          <div className="translator-result-block">
            <span className="translator-label">{t('translator:results.confidence')}</span>
            <strong>{typeof result.confidence === 'number' ? result.confidence.toFixed(2) : 'n/a'}</strong>
          </div>
          <div className="translator-result-block">
            <span className="translator-label">{t('translator:results.cacheStatus')}</span>
            <Badge>{result.cached ? t('translator:results.cached') : t('translator:results.fresh')}</Badge>
          </div>
          <div className="translator-result-block translator-result-block-wide">
            <span className="translator-label">{t('translator:results.glossaryHits')}</span>
            {result.glossaryHits?.length ? (
              <div className="translator-chip-row">
                {result.glossaryHits.map((term) => <Badge key={term}>{term}</Badge>)}
              </div>
            ) : (
              <p className="translator-muted">{t('translator:results.none')}</p>
            )}
          </div>
          <div className="translator-result-block translator-result-block-wide">
            <span className="translator-label">{t('translator:results.warnings')}</span>
            {result.warnings?.length ? (
              <ul className="translator-warning-list">
                {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            ) : (
              <p className="translator-muted">{t('translator:results.none')}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
