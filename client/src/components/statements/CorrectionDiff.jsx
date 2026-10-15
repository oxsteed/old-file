import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileDiff } from 'lucide-react';
import { getCorrectionDiff } from '../../api/statementCases';
import { formatStatementMoney } from '../../lib/creditStatementFormat';
import './CorrectionDiff.css';

// CorrectionDiff: readable correction comparison for a statement.
// Given the original and one corrected version (correctionId), it renders an
// inline diff showing exactly which rows and amounts changed: added, removed,
// and modified rows with old to new amounts, currency preserved. Accessible:
// a real table with row-level text change descriptions, never color-only.
//
// Mount point (coordinator): render on the statement archive and credit
// statement pages wherever a correction notice or revision history appears,
// e.g. StatementArchivePage document details (the "Corrected" badge) and the
// accessible statement view. Props: { product, documentId, correctionId }.
function formatMinor(value, currencyCode, language) {
  if (value === null || value === undefined) return '—';
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) return String(value);
  return formatStatementMoney(numeric, currencyCode, language);
}

function fieldLabel(t, field) {
  const key = `correctionDiff.fields.${field}`;
  const labeled = t(key);
  return labeled === key ? field : labeled;
}

export default function CorrectionDiff({ product, documentId, correctionId }) {
  const { t, i18n } = useTranslation('statements');
  const language = (i18n.resolvedLanguage || i18n.language || 'en').split(/[-_]/)[0];
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await getCorrectionDiff(product, documentId, correctionId, { signal });
      setData(payload);
    } catch (err) {
      if (err?.code === 'ERR_CANCELED') return;
      setError(t('correctionDiff.loadError'));
    } finally {
      setLoading(false);
    }
  }, [product, documentId, correctionId, t]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const currencyCode = data?.currencyCode || 'USD';
  const diff = data?.diff || { counts: { added: 0, removed: 0, modified: 0 }, summaryChanges: [], rows: [] };
  const hasChanges = diff.summaryChanges.length > 0 || diff.rows.length > 0;

  return (
    <section className="stc-panel" aria-label={t('correctionDiff.title')}>
      <div className="stc-panel-head">
        <h2><FileDiff aria-hidden="true" /> {t('correctionDiff.title')}</h2>
      </div>

      {loading ? <p className="stc-state">{t('correctionDiff.loading')}</p> : null}
      {error ? (
        <div className="stc-state">
          <p className="stc-error-text">{error}</p>
          <button type="button" onClick={() => load()}>{t('common.retry')}</button>
        </div>
      ) : null}

      {data ? (
        <>
          <div className="stc-card">
            <dl className="stc-facts">
              <div><dt>{t('correctionDiff.revisionLabel')}</dt><dd>{data.correction?.revisionNumber}</dd></div>
              <div><dt>{t('correctionDiff.amendmentType')}</dt><dd>{data.correction?.amendmentType}</dd></div>
              <div><dt>{t('correctionDiff.presentation')}</dt><dd>{data.correction?.presentation}</dd></div>
              <div>
                <dt>{t('correctionDiff.correctedAt')}</dt>
                <dd>{data.correction?.createdAt ? new Date(data.correction.createdAt).toLocaleString(language) : '—'}</dd>
              </div>
            </dl>
            <p className="stc-note">
              {t('correctionDiff.countsSummary', {
                added: diff.counts.added,
                removed: diff.counts.removed,
                modified: diff.counts.modified,
              })}
            </p>
          </div>

          {!hasChanges ? (
            <p className="stc-state">{t('correctionDiff.noChanges')}</p>
          ) : (
            <>
              {diff.summaryChanges.length > 0 ? (
                <div className="stc-card">
                  <h3>{t('correctionDiff.summaryTitle')}</h3>
                  <div className="stc-table-wrap">
                    <table className="stc-table">
                      <thead>
                        <tr>
                          <th scope="col">{t('correctionDiff.fieldLabel')}</th>
                          <th scope="col">{t('correctionDiff.oldValueLabel')}</th>
                          <th scope="col">{t('correctionDiff.newValueLabel')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diff.summaryChanges.map((change) => (
                          <tr key={change.field}>
                            <th scope="row">{fieldLabel(t, change.field)}</th>
                            <td className="stc-mono">{formatMinor(change.oldValue, currencyCode, language)}</td>
                            <td className="stc-mono">{formatMinor(change.newValue, currencyCode, language)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {diff.rows.length > 0 ? (
                <div className="stc-card">
                  <h3>{t('correctionDiff.rowsTitle')}</h3>
                  <div className="stc-table-wrap">
                    <table className="stc-table">
                      <thead>
                        <tr>
                          <th scope="col">{t('correctionDiff.entryLabel')}</th>
                          <th scope="col">{t('correctionDiff.fieldLabel')}</th>
                          <th scope="col">{t('correctionDiff.oldValueLabel')}</th>
                          <th scope="col">{t('correctionDiff.newValueLabel')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diff.rows.map((row) => (
                          <RowDiff key={`${row.change}-${row.entryId}`} row={row} t={t} currencyCode={currencyCode} language={language} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </section>
  );
}

function changeBadge(t, change) {
  if (change === 'added') return <span className="stc-change stc-change-added">{t('correctionDiff.changeAdded')}</span>;
  if (change === 'removed') return <span className="stc-change stc-change-removed">{t('correctionDiff.changeRemoved')}</span>;
  return <span className="stc-change stc-change-modified">{t('correctionDiff.changeModified')}</span>;
}

function changeDescription(t, change) {
  if (change === 'added') return t('correctionDiff.changeDescriptionAdded');
  if (change === 'removed') return t('correctionDiff.changeDescriptionRemoved');
  return t('correctionDiff.changeDescriptionModified');
}

function RowDiff({ row, t, currencyCode, language }) {
  if (row.change !== 'modified' || row.changes.length === 0) {
    return (
      <tr>
        <th scope="row">
          <div>{changeBadge(t, row.change)}</div>
          <div className="stc-mono stc-entry-id">{row.entryId}</div>
          <div className="stc-muted">{changeDescription(t, row.change)}</div>
          {row.description ? <div className="stc-muted">{row.description}</div> : null}
        </th>
        <td colSpan={3} className="stc-muted">—</td>
      </tr>
    );
  }
  return (
    <>
      {row.changes.map((change, index) => (
        <tr key={`${row.entryId}-${change.field}`}>
          {index === 0 ? (
            <th scope="row" rowSpan={row.changes.length}>
              <div>{changeBadge(t, row.change)}</div>
              <div className="stc-mono stc-entry-id">{row.entryId}</div>
              <div className="stc-muted">{changeDescription(t, row.change)}</div>
              {row.description ? <div className="stc-muted">{row.description}</div> : null}
            </th>
          ) : null}
          <td>{fieldLabel(t, change.field)}</td>
          <td className="stc-mono">{formatMinor(change.oldValue, currencyCode, language)}</td>
          <td className="stc-mono">{formatMinor(change.newValue, currencyCode, language)}</td>
        </tr>
      ))}
    </>
  );
}
