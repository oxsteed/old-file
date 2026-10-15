import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, FileSearch, X } from 'lucide-react';
import { getStatementEntry, createStatementCase } from '../../api/statementInvestigation';
import { formatStatementMoney } from '../../lib/creditStatementFormat';
import './InvestigationPanel.css';

// InvestigationPanel: entry drilldown for any statement product.
// Given a product + document + entry, it shows the statement source, the
// immutable historical facts, the labeled current state, the explicitly
// linked related record, and the case actions (existing cases + open a case).
//
// Mount point (coordinator): render inside the statement archive and credit
// statement pages wherever an entry row is expanded or a "Review or report"
// action exists, e.g. StatementArchivePage entries list and the credit
// statement transaction lists. Props: { product, documentId, entryId,
// initialData?, onClose? }. initialData skips the fetch when the drilldown
// payload is already in hand.
const REASONS = [
  { key: 'unrecognized', labelKey: 'investigation.reasonUnrecognized' },
  { key: 'duplicate', labelKey: 'investigation.reasonDuplicate' },
  { key: 'incorrect_amount', labelKey: 'investigation.reasonIncorrectAmount' },
  { key: 'other', labelKey: 'investigation.reasonOther' },
];

function signedAmount(entry) {
  const debit = Number(entry.debitCents || 0);
  const credit = Number(entry.creditCents || 0);
  return credit > 0 ? credit : -debit;
}

export default function InvestigationPanel({ product, documentId, entryId, initialData = null, onClose = null }) {
  const { t, i18n } = useTranslation('statements');
  const language = (i18n.resolvedLanguage || i18n.language || 'en').split(/[-_]/)[0];
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState('unrecognized');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reportError, setReportError] = useState(null);
  const [reportDone, setReportDone] = useState(false);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await getStatementEntry(documentId, entryId, { signal });
      setData(payload);
    } catch (err) {
      if (err?.code === 'ERR_CANCELED') return;
      setError(t('investigation.loadError'));
    } finally {
      setLoading(false);
    }
  }, [documentId, entryId, t]);

  useEffect(() => {
    if (initialData) {
      setData(initialData);
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [initialData, load]);

  const submitReport = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setReportError(null);
    try {
      await createStatementCase(documentId, entryId, { reason, description: details });
      setReportDone(true);
      setReportOpen(false);
      setDetails('');
      const controller = new AbortController();
      await load(controller.signal);
    } catch {
      setReportError(t('investigation.reportError'));
    } finally {
      setSubmitting(false);
    }
  };

  const productLabel = t(`products.${product}`);

  return (
    <section className="stc-panel" aria-label={t('investigation.title')}>
      <div className="stc-panel-head">
        <h2><FileSearch aria-hidden="true" /> {t('investigation.title')}</h2>
        {onClose ? (
          <button type="button" className="stc-icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <X aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {loading ? <p className="stc-state">{t('investigation.loading')}</p> : null}
      {error ? (
        <div className="stc-state">
          <p className="stc-error-text">{error}</p>
          <button type="button" onClick={() => load()}>{t('common.retry')}</button>
        </div>
      ) : null}

      {data ? (
        <>
          <div className="stc-card">
            <h3>{t('investigation.source')}</h3>
            <dl className="stc-facts">
              <div><dt>{t('investigation.title')}</dt><dd>{productLabel}</dd></div>
              <div>
                <dt>{t('investigation.period')}</dt>
                <dd>{data.period?.from} – {data.period?.to}</dd>
              </div>
              <div><dt>{t('correctionDiff.revisionLabel')}</dt><dd>{data.revision}</dd></div>
            </dl>
          </div>

          <div className="stc-card">
            <h3>{t('investigation.entryDetails')}</h3>
            <dl className="stc-facts">
              <div><dt>{t('investigation.postedAt')}</dt><dd>{data.statement?.postedAt ? new Date(data.statement.postedAt).toLocaleString(language) : '—'}</dd></div>
              <div><dt>{t('investigation.type')}</dt><dd>{data.statement?.type}</dd></div>
              <div><dt>{t('investigation.description')}</dt><dd>{data.statement?.description}</dd></div>
              <div>
                <dt>{t('investigation.amount')}</dt>
                <dd className="stc-amount">{formatStatementMoney(signedAmount(data.statement || {}), data.currencyCode, language)}</dd>
              </div>
              <div>
                <dt>{t('investigation.balanceAfter')}</dt>
                <dd className="stc-mono">{formatStatementMoney(Number(data.statement?.balanceAfterCents || 0), data.currencyCode, language)}</dd>
              </div>
              {data.statement?.maskedReference ? (
                <div><dt>{t('investigation.reference')}</dt><dd className="stc-mono">{data.statement.maskedReference}</dd></div>
              ) : null}
              {data.statement?.feeReference ? (
                <div><dt>{t('investigation.feeReference')}</dt><dd className="stc-mono">{data.statement.feeReference}</dd></div>
              ) : null}
              {data.statement?.refundReference ? (
                <div><dt>{t('investigation.refundReference')}</dt><dd className="stc-mono">{data.statement.refundReference}</dd></div>
              ) : null}
              <div><dt>{t('investigation.journalId')}</dt><dd className="stc-mono">{data.statement?.journalId}</dd></div>
              <div><dt>{t('investigation.journalEntryId')}</dt><dd className="stc-mono">{data.statement?.journalEntryId}</dd></div>
            </dl>
            <p className="stc-note">{t('investigation.historicalNote')}</p>
          </div>

          <div className="stc-card">
            <h3>{t('investigation.liveStatus')}</h3>
            <p>
              {data.live?.status ? <strong>{data.live.status}</strong> : <span className="stc-muted">—</span>}
              <span className="stc-live-tag">{t('investigation.liveStatus')}</span>
            </p>
            <p className="stc-note">{data.live?.note || t('investigation.liveStatusNote')}</p>
          </div>

          <div className="stc-card">
            <h3>{t('investigation.related')}</h3>
            <RelatedRecord related={data.related} t={t} />
          </div>

          <div className="stc-card">
            <h3>{t('investigation.caseActions')}</h3>
            {reportDone ? <p className="stc-notice" role="status">{t('investigation.reportSuccess')}</p> : null}
            {data.cases?.length ? (
              <ul className="stc-cases">
                {data.cases.map((c) => (
                  <li key={c.caseId} className="stc-case">
                    <span className={`stc-case-status stc-case-status-${c.status}`}>{c.status}</span>
                    <span className="stc-muted">{t('investigation.caseOpenedAt')}: {c.openedAt ? new Date(c.openedAt).toLocaleString(language) : '—'}</span>
                    {c.detailUrl ? <a href={c.detailUrl}>{t('investigation.caseDetail')}</a> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="stc-muted">{t('investigation.noCases')}</p>
            )}
            {!reportOpen ? (
              <button type="button" className="stc-primary" onClick={() => setReportOpen(true)}>
                <AlertTriangle aria-hidden="true" /> {t('investigation.openCase')}
              </button>
            ) : (
              <form className="stc-form" onSubmit={submitReport}>
                <label className="stc-field">
                  <span>{t('investigation.reportReason')}</span>
                  <select value={reason} onChange={(e) => setReason(e.target.value)}>
                    {REASONS.map(({ key, labelKey }) => (
                      <option key={key} value={key}>{t(labelKey)}</option>
                    ))}
                  </select>
                </label>
                <label className="stc-field">
                  <span>{t('investigation.reportDetails')}</span>
                  <textarea
                    rows={4}
                    value={details}
                    maxLength={1000}
                    placeholder={t('investigation.reportDetailsPlaceholder')}
                    onChange={(e) => setDetails(e.target.value)}
                  />
                </label>
                {reportError ? <p className="stc-error-text" role="alert">{reportError}</p> : null}
                <div className="stc-actions">
                  <button type="submit" className="stc-primary" disabled={submitting}>
                    {submitting ? t('investigation.reportSubmitting') : t('investigation.reportSubmit')}
                  </button>
                  <button type="button" onClick={() => setReportOpen(false)}>{t('common.cancel')}</button>
                </div>
              </form>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function RelatedRecord({ related, t }) {
  if (!related || related.status === 'unsupported') {
    return <p className="stc-muted">{t('investigation.relatedUnsupported')}</p>;
  }
  if (related.status === 'unavailable') {
    return <p className="stc-muted">{t('investigation.relatedUnavailable')}</p>;
  }
  if (related.status === 'external') {
    return (
      <dl className="stc-facts">
        <div><dt>{t('investigation.relatedExternal')}</dt><dd className="stc-mono">{related.maskedReference}</dd></div>
      </dl>
    );
  }
  const kindLabel = related.kind === 'order'
    ? t('investigation.relatedOrder')
    : related.kind === 'source_observation'
      ? t('investigation.relatedSourceObservation')
      : t('investigation.relatedTransaction');
  return (
    <div className="stc-related">
      <p className="stc-related-kind">{kindLabel}</p>
      <dl className="stc-facts">
        {related.sourceKind ? <div><dt>{t('investigation.source')}</dt><dd>{related.sourceKind}</dd></div> : null}
        {related.recordedAt ? (
          <div><dt>{t('investigation.recordedAt')}</dt><dd>{new Date(related.recordedAt).toLocaleString()}</dd></div>
        ) : null}
        {related.statusLive ? <div><dt>{t('investigation.status')}</dt><dd>{related.statusLive}</dd></div> : null}
        {related.totalCents !== undefined ? (
          <div>
            <dt>{t('investigation.amount')}</dt>
            <dd className="stc-mono">{formatStatementMoney(Number(related.totalCents), related.currencyCode || 'USD', 'en')}</dd>
          </div>
        ) : null}
        {related.restaurantName ? <div><dt>{t('investigation.description')}</dt><dd>{related.restaurantName}</dd></div> : null}
      </dl>
      {related.note ? <p className="stc-note">{related.note}</p> : null}
      {related.detailUrl ? <a className="stc-link" href={related.detailUrl}>{t('investigation.viewRelated')}</a> : null}
    </div>
  );
}
