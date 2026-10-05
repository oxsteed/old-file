import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, FileWarning, Link2, Receipt, ShieldAlert } from 'lucide-react';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PageMeta from '../../components/PageMeta';
import { getStatementEntry, createStatementCase } from '../../api/statementInvestigation';
import { formatStatementMoney } from '../../lib/creditStatementFormat';
import { formatCreditDateTime } from '../../lib/creditDateTime';
import { localizeCreditTransactionType } from '../../lib/creditStatus';
import './StatementTransactionView.css';

// Complete five-locale catalogs are authoritative; English defaults provide
// a readable fallback if an optional locale chunk cannot be loaded.
export const INVESTIGATION_STRINGS = Object.freeze({
  title: 'Statement transaction',
  backToStatements: 'Back to statements',
  loading: 'Loading transaction…',
  loadError: 'This transaction could not be loaded. Please try again.',
  entryNotFound: 'This statement entry was not found.',
  retry: 'Try again',
  statement: 'Statement',
  period: 'Period',
  document: 'Document',
  entryDetails: 'Entry details',
  postedAt: 'Posted (UTC)',
  type: 'Type',
  description: 'Description',
  amount: 'Amount',
  balanceAfter: 'Balance after',
  reference: 'Reference',
  feeReference: 'Fee reference',
  refundReference: 'Refund reference',
  status: 'Status',
  journalId: 'Journal ID',
  journalEntryId: 'Journal entry ID',
  liveStatus: 'Live status',
  liveStatusNote: 'Checked just now. Current statuses are not part of the historical statement.',
  historicalNote: 'Historical facts as recorded on the statement. They never change.',
  related: 'Related record',
  relatedOrder: 'Food order',
  relatedTransaction: 'Related credit transaction',
  relatedExternal: 'External payment reference',
  relatedUnavailable: 'The related record is no longer available.',
  relatedUnsupported: 'This entry has no linked record to show.',
  viewRelated: 'View',
  reportIssue: 'Report an issue',
  reportTitle: 'Report an issue with this transaction',
  reportBody: 'Tell us what looks wrong. Filing a report never moves money; it opens a case for review.',
  reportReason: 'Reason',
  reasonUnrecognized: "I don't recognize this",
  reasonDuplicate: 'Duplicate charge',
  reasonIncorrectAmount: 'Incorrect amount',
  reasonOther: 'Something else',
  reportDetails: 'Details (optional)',
  reportDetailsPlaceholder: 'What looks wrong about this transaction?',
  reportSubmit: 'Submit report',
  reportSubmitting: 'Submitting…',
  reportCancel: 'Cancel',
  reportError: 'Your report could not be submitted. Please try again.',
  reportDuplicate: 'You already reported this transaction. Your open case is shown below.',
  reportSuccess: 'Your report was received. We will review it and follow up.',
  cases: 'Your reports',
  noCases: 'You have not reported this transaction.',
  caseOpened: 'Opened',
  caseSla: 'Expected review by',
  caseResolution: 'Resolution',
  statusOpen: 'Open',
  statusInReview: 'In review',
  statusResolved: 'Resolved',
  statusRejected: 'Rejected',
  statusResolvedCustomer: 'Resolved in your favor',
  statusResolvedMerchant: 'Resolved',
  unsupportedCases: 'Reports are not available for restaurant wallet entries yet. Contact support if you need help with this entry.',
  contactSupport: 'Contact support',
  none: 'None',
});

const REPORT_REASONS = [
  { value: 'unrecognized', labelKey: 'reasonUnrecognized' },
  { value: 'duplicate', labelKey: 'reasonDuplicate' },
  { value: 'incorrect_amount', labelKey: 'reasonIncorrectAmount' },
  { value: 'other', labelKey: 'reasonOther' },
];

const CASE_STATUS_LABELS = {
  open: 'statusOpen',
  in_review: 'statusInReview',
  resolved: 'statusResolved',
  rejected: 'statusRejected',
  resolved_customer: 'statusResolvedCustomer',
  resolved_merchant: 'statusResolvedMerchant',
};

function signedAmount(entry) {
  const debit = Number(entry?.debitCents || 0);
  const credit = Number(entry?.creditCents || 0);
  return debit > 0 ? -debit : credit;
}

export default function StatementTransactionView() {
  const { documentId, entryId } = useParams();
  const { t, i18n } = useTranslation('credit');
  const language = (i18n.resolvedLanguage || i18n.language || 'en').split(/[-_]/)[0];
  const text = (key, options = {}) => t(`statementInvestigation.${key}`, { defaultValue: INVESTIGATION_STRINGS[key], ...options });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('unrecognized');
  const [reportDetails, setReportDetails] = useState('');
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState(null);
  const [reportNotice, setReportNotice] = useState(null);
  const requestRef = useRef(null);

  const load = useCallback(() => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    getStatementEntry(documentId, entryId, { signal: controller.signal })
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        const code = err?.response?.data?.code;
        setError(code === 'statement_entry_not_found' ? 'entryNotFound' : 'loadError');
        setLoading(false);
      });
  }, [documentId, entryId]);

  useEffect(() => {
    load();
    return () => requestRef.current?.abort();
  }, [load]);

  async function submitReport(event) {
    event.preventDefault();
    if (reporting) return;
    setReporting(true);
    setReportError(null);
    setReportNotice(null);
    try {
      const result = await createStatementCase(documentId, entryId, { reason: reportReason, description: reportDetails });
      setReportNotice(result?.replayed ? 'reportDuplicate' : 'reportSuccess');
      setReportOpen(false);
      setReportDetails('');
      load();
    } catch (err) {
      const code = err?.response?.data?.code;
      setReportError(code === 'credit_dispute_idempotency_conflict' ? 'reportDuplicate' : 'reportError');
    } finally {
      setReporting(false);
    }
  }

  const timestamp = (value) => formatCreditDateTime(value, text('none'), language);
  const statement = data?.statement || null;
  const related = data?.related || null;
  const cases = Array.isArray(data?.cases) ? data.cases : [];
  const canReport = statement?.caseSupport === 'credit_disputes';
  const statementsPath = data?.product === 'restaurant' ? '/restaurant-credit/statements' : '/oxsteed-credit/statements';

  function relatedKindLabel(kind) {
    if (kind === 'order') return text('relatedOrder');
    if (kind === 'transaction') return text('relatedTransaction');
    return text('relatedExternal');
  }

  function renderRelated() {
    if (!related) return null;
    if (related.status === 'linked') {
      return (
        <div className="stv-related-linked">
          <p className="stv-related-kind"><Link2 size={16} aria-hidden="true" /> {relatedKindLabel(related.kind)}</p>
          <dl className="stv-facts">
            {related.restaurantName && (
              <div><dt>{relatedKindLabel(related.kind)}</dt><dd>{related.restaurantName}</dd></div>
            )}
            <div><dt>{text('status')}</dt><dd>{related.statusLive} <span className="stv-live-tag">{text('liveStatus')}</span></dd></div>
            {related.totalCents != null && (
              <div><dt>{text('amount')}</dt><dd>{formatStatementMoney(related.totalCents, related.currencyCode, language)}</dd></div>
            )}
            {related.amountCents != null && (
              <div><dt>{text('amount')}</dt><dd>{formatStatementMoney(related.amountCents, related.currencyCode, language)}</dd></div>
            )}
            {related.paymentStatus && (
              <div><dt>{text('status')}</dt><dd>{related.paymentStatus}</dd></div>
            )}
          </dl>
          {related.detailUrl && (
            <Link className="stv-related-link" to={related.detailUrl}>{text('viewRelated')}</Link>
          )}
        </div>
      );
    }
    if (related.status === 'unavailable') {
      return <p className="stv-muted">{text('relatedUnavailable')}</p>;
    }
    if (related.status === 'external') {
      return (
        <div className="stv-related-linked">
          <p className="stv-related-kind"><Receipt size={16} aria-hidden="true" /> {text('relatedExternal')}</p>
          <dl className="stv-facts">
            <div><dt>{text('reference')}</dt><dd>{related.maskedReference || text('none')}</dd></div>
          </dl>
        </div>
      );
    }
    return <p className="stv-muted">{text('relatedUnsupported')}</p>;
  }

  return (
    <div className="statement-transaction-shell">
      <PageMeta title={text('title')} />
      <Navbar />
      <main className="stv-page">
        <Link className="stv-back" to={statementsPath}>
          <ArrowLeft size={18} aria-hidden="true" /> {text('backToStatements')}
        </Link>

        {loading && (
          <div className="stv-state" role="status"><p>{text('loading')}</p></div>
        )}

        {!loading && error && (
          <div className="stv-state" role="alert">
            <p>{text(error)}</p>
            <button type="button" onClick={load}>{text('retry')}</button>
          </div>
        )}

        {!loading && !error && statement && (
          <>
            <header className="stv-header">
              <ShieldAlert size={28} aria-hidden="true" />
              <div>
                <h1>{text('title')}</h1>
                <p>{text('historicalNote')}</p>
              </div>
            </header>

            <section className="stv-card" aria-label={text('statement')}>
              <dl className="stv-facts">
                <div><dt>{text('document')}</dt><dd className="stv-mono">{data.documentId}</dd></div>
                <div><dt>{text('period')}</dt><dd>{data.period?.from} – {data.period?.to}</dd></div>
                <div><dt>{text('statement')}</dt><dd>{data.product === 'restaurant' ? 'Restaurant Credit' : 'OxSteed Credit'} · {data.currencyCode}</dd></div>
              </dl>
            </section>

            <section className="stv-card" aria-label={text('entryDetails')}>
              <h2>{text('entryDetails')}</h2>
              <dl className="stv-facts">
                <div><dt>{text('postedAt')}</dt><dd>{timestamp(statement.postedAt)}</dd></div>
                <div><dt>{text('type')}</dt><dd>{localizeCreditTransactionType(statement.type, t) || statement.type}</dd></div>
                {statement.description && (
                  <div><dt>{text('description')}</dt><dd>{statement.description}</dd></div>
                )}
                <div><dt>{text('amount')}</dt><dd className="stv-amount">{formatStatementMoney(signedAmount(statement), statement.currencyCode, language)}</dd></div>
                <div><dt>{text('balanceAfter')}</dt><dd>{formatStatementMoney(statement.balanceAfterCents, statement.currencyCode, language)}</dd></div>
                <div><dt>{text('reference')}</dt><dd className="stv-mono">{statement.maskedReference || text('none')}</dd></div>
                {statement.feeReference && (
                  <div><dt>{text('feeReference')}</dt><dd className="stv-mono">{statement.feeReference}</dd></div>
                )}
                {statement.refundReference && (
                  <div><dt>{text('refundReference')}</dt><dd className="stv-mono">{statement.refundReference}</dd></div>
                )}
                <div>
                  <dt>{text('liveStatus')}</dt>
                  <dd>{data.live?.status || text('none')} <span className="stv-live-tag">{text('liveStatus')}</span></dd>
                </div>
                <div><dt>{text('journalId')}</dt><dd className="stv-mono">{statement.journalId}</dd></div>
                <div><dt>{text('journalEntryId')}</dt><dd className="stv-mono">{statement.journalEntryId || text('none')}</dd></div>
              </dl>
              <p className="stv-note">{data.live?.note || text('liveStatusNote')}</p>
            </section>

            <section className="stv-card" aria-label={text('related')}>
              <h2>{text('related')}</h2>
              {renderRelated()}
            </section>

            <section className="stv-card" aria-label={text('reportIssue')}>
              <h2>{text('reportIssue')}</h2>
              {canReport ? (
                <>
                  {reportNotice && <p className="stv-notice" role="status">{text(reportNotice)}</p>}
                  {!reportOpen ? (
                    <button type="button" className="stv-primary" onClick={() => { setReportOpen(true); setReportError(null); }}>
                      <FileWarning size={18} aria-hidden="true" /> {text('reportIssue')}
                    </button>
                  ) : (
                    <form className="stv-report-form" onSubmit={submitReport}>
                      <p>{text('reportBody')}</p>
                      <label className="stv-field">
                        <span>{text('reportReason')}</span>
                        <select value={reportReason} onChange={(e) => setReportReason(e.target.value)} disabled={reporting}>
                          {REPORT_REASONS.map((reason) => (
                            <option key={reason.value} value={reason.value}>{text(reason.labelKey)}</option>
                          ))}
                        </select>
                      </label>
                      <label className="stv-field">
                        <span>{text('reportDetails')}</span>
                        <textarea
                          value={reportDetails}
                          onChange={(e) => setReportDetails(e.target.value)}
                          placeholder={text('reportDetailsPlaceholder')}
                          maxLength={1000}
                          rows={4}
                          disabled={reporting}
                        />
                      </label>
                      {reportError && <p className="stv-error" role="alert">{text(reportError)}</p>}
                      <div className="stv-actions">
                        <button type="submit" className="stv-primary" disabled={reporting}>
                          {reporting ? text('reportSubmitting') : text('reportSubmit')}
                        </button>
                        <button type="button" onClick={() => setReportOpen(false)} disabled={reporting}>
                          {text('reportCancel')}
                        </button>
                      </div>
                    </form>
                  )}
                </>
              ) : (
                <p className="stv-muted">
                  {text('unsupportedCases')} <Link to="/support/escalation">{text('contactSupport')}</Link>
                </p>
              )}
            </section>

            <section className="stv-card" aria-label={text('cases')}>
              <h2>{text('cases')}</h2>
              {cases.length === 0 ? (
                <p className="stv-muted">{text('noCases')}</p>
              ) : (
                <ul className="stv-cases">
                  {cases.map((c) => (
                    <li key={c.caseId} className="stv-case">
                      <span className={`stv-case-status stv-case-status-${String(c.status).replace(/[^a-z_]/g, '')}`}>
                        {text(CASE_STATUS_LABELS[c.status] || 'statusOpen')}
                      </span>
                      <dl className="stv-facts">
                        <div><dt>{text('caseOpened')}</dt><dd>{timestamp(c.openedAt)}</dd></div>
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
