import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flag } from 'lucide-react';
import { createStatementReport, listStatementReports } from '../../api/statementCases';
import './StatementReport.css';

// StatementReport: report a problem with a WHOLE statement without selecting
// an entry (missing transaction, wrong opening balance, incomplete period,
// other statement problem). Shows the report-type picker + description +
// submit, then the user's existing reports on the document with status.
//
// Mount point (coordinator): render on the statement archive and credit
// statement pages at the document level, next to the entries list, e.g.
// StatementArchivePage document details and the credit statement views.
// Props: { product, documentId }.
const REPORT_TYPES = [
  { key: 'missing_transaction', labelKey: 'report.typeMissing' },
  { key: 'wrong_opening_balance', labelKey: 'report.typeOpening' },
  { key: 'incomplete_period', labelKey: 'report.typeIncomplete' },
  { key: 'other_statement_problem', labelKey: 'report.typeOther' },
];

const STATUS_CLASS = {
  open: 'stc-case-status-open',
  under_review: 'stc-case-status-under_review',
  resolved: 'stc-case-status-resolved',
  closed: 'stc-case-status-closed',
};

const STATUS_LABEL = {
  open: 'report.statusOpen',
  under_review: 'report.statusUnderReview',
  resolved: 'report.statusResolved',
  closed: 'report.statusClosed',
};

export default function StatementReport({ product, documentId }) {
  const { t, i18n } = useTranslation('statements');
  const language = (i18n.resolvedLanguage || i18n.language || 'en').split(/[-_]/)[0];
  const [reportType, setReportType] = useState('missing_transaction');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [done, setDone] = useState(false);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const payload = await listStatementReports(product, documentId, { signal });
      setReports(Array.isArray(payload?.reports) ? payload.reports : []);
    } catch (err) {
      if (err?.code === 'ERR_CANCELED') return;
      setLoadError(t('report.error'));
    } finally {
      setLoading(false);
    }
  }, [product, documentId, t]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const submit = async (event) => {
    event.preventDefault();
    const trimmed = description.trim();
    if (!reportType || !trimmed) {
      setFormError(t('report.validationError'));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await createStatementReport(product, documentId, { reportType, description: trimmed });
      setDone(true);
      setDescription('');
      const controller = new AbortController();
      await load(controller.signal);
    } catch {
      setFormError(t('report.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="stc-panel" aria-label={t('report.title')}>
      <div className="stc-panel-head">
        <h2><Flag aria-hidden="true" /> {t('report.title')}</h2>
      </div>
      <p className="stc-muted">{t('report.body')}</p>

      {done ? <p className="stc-notice" role="status">{t('report.success')}</p> : null}

      <form className="stc-form" onSubmit={submit}>
        <fieldset className="stc-radio-group">
          <legend>{t('report.typeLabel')}</legend>
          {REPORT_TYPES.map(({ key, labelKey }) => (
            <label key={key} className="stc-radio">
              <input
                type="radio"
                name="statement-report-type"
                value={key}
                checked={reportType === key}
                onChange={() => setReportType(key)}
              />
              <span>{t(labelKey)}</span>
            </label>
          ))}
        </fieldset>
        <label className="stc-field">
          <span>{t('report.detailsLabel')}</span>
          <textarea
            rows={4}
            value={description}
            maxLength={2000}
            placeholder={t('report.detailsPlaceholder')}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </label>
        {formError ? <p className="stc-error-text" role="alert">{formError}</p> : null}
        <div className="stc-actions">
          <button type="submit" className="stc-primary" disabled={submitting}>
            {submitting ? t('report.submitting') : t('report.submit')}
          </button>
        </div>
      </form>

      <div className="stc-card">
        <h3>{t('report.existingTitle')}</h3>
        {loading ? <p className="stc-muted">{t('common.loading')}</p> : null}
        {loadError ? (
          <div>
            <p className="stc-error-text">{loadError}</p>
            <button type="button" onClick={() => load()}>{t('common.retry')}</button>
          </div>
        ) : null}
        {!loading && !loadError && reports.length === 0 ? (
          <p className="stc-muted">{t('report.empty')}</p>
        ) : null}
        {reports.length > 0 ? (
          <ul className="stc-cases">
            {reports.map((report) => (
              <li key={report.reportId} className="stc-case">
                <span className={`stc-case-status ${STATUS_CLASS[report.status] || ''}`}>
                  {t(STATUS_LABEL[report.status] || 'report.statusOpen')}
                </span>
                <span><strong>{t(REPORT_TYPES.find((r) => r.key === report.reportType)?.labelKey || 'report.typeOther')}</strong></span>
                <span className="stc-muted">{report.description}</span>
                <span className="stc-muted">
                  {t('report.reportedAt')}: {report.createdAt ? new Date(report.createdAt).toLocaleString(language) : '—'}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
