import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, FileText, X } from 'lucide-react';
import { getArchiveDocument } from '../../api/creditStatements';
import { formatStatementMoney } from '../../lib/creditStatementFormat';
import { registerDialog, unregisterDialog, isTopDialog } from '../attention/dialogStack';
import './StatementPreviewModal.css';

// Product keys as returned by GET /api/statements/center.
const CREDIT_PRODUCTS = new Set(['oxsteed', 'restaurant']);
const PREVIEW_ACTIVITY_LIMIT = 5;

function focusableElements(root) {
  if (!root) return [];
  return [...root.querySelectorAll(
    'a[href], button:not([disabled]), select:not([disabled]), textarea:not([disabled]), '
    + 'input:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

function monthLabel(period, language) {
  // '2026-09' -> 'September 2026'. Falls back to the raw value.
  if (!period) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(String(period));
  if (!match) return String(period);
  try {
    return new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
  } catch {
    return String(period);
  }
}

function dateLabel(value, language) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
  }
}

function periodRangeLabel(period, language) {
  if (!period) return null;
  if (typeof period === 'string') return monthLabel(period, language);
  const from = period.from ? dateLabel(period.from, language) : null;
  const to = period.to ? dateLabel(period.to, language) : null;
  if (from && to) return `${from} – ${to}`;
  return from || to;
}

// Normalize the archived document into a compact preview: period, totals with
// product-correct labels, and a short recent-activity list. Labels stay in the
// product's own accounting vocabulary (balance/credits/debits for credit,
// payable/earned/settled for helpers, outstanding/invoiced/collected for
// settlement and business).
function extractPreview(document, product) {
  const doc = document || {};
  const currency = doc.currencyCode || doc.currency || null;
  const period = doc.period || null;
  if (CREDIT_PRODUCTS.has(product) || product === 'restaurant_settlement') {
    const transactions = Array.isArray(doc.transactions) ? doc.transactions : [];
    return {
      currency,
      period,
      totals: [
        { key: 'opening', amountCents: doc.openingBalanceCents },
        { key: 'credits', amountCents: doc.totalCreditsCents },
        { key: 'debits', amountCents: doc.totalDebitsCents },
        { key: 'closing', amountCents: doc.closingBalanceCents },
      ],
      activity: transactions.slice(0, PREVIEW_ACTIVITY_LIMIT).map((tx) => ({
        id: String(tx.id || `${tx.date}-${tx.balanceAfterCents}`),
        date: tx.date || null,
        label: tx.description || tx.type || '',
        amountCents: Number(tx.creditCents || 0) - Number(tx.debitCents || 0),
      })),
    };
  }
  if (product === 'helper_earnings') {
    const earnings = Array.isArray(doc.earnings) ? doc.earnings : [];
    return {
      currency,
      period,
      totals: [
        { key: 'payable', amountCents: doc.openingPayableCents, note: 'opening' },
        { key: 'earned', amountCents: doc.postedEarningsCents },
        { key: 'settled', amountCents: doc.settledPayoutsCents },
        { key: 'payable', amountCents: doc.closingPayableCents, note: 'closing' },
      ],
      activity: earnings.slice(0, PREVIEW_ACTIVITY_LIMIT).map((row, index) => ({
        id: String(row.jobId || row.recordedAt || `earning-${index}`),
        date: row.effectiveDate || row.completedAt || null,
        label: row.title || '',
        amountCents: Number(row.helperPayoutCents || 0),
      })),
    };
  }
  // business
  const receivables = doc.receivables || {};
  const movements = Array.isArray(receivables.movements) ? receivables.movements : [];
  return {
    currency,
    period,
    totals: [
      { key: 'outstanding', amountCents: receivables.openingOutstandingCents, note: 'opening' },
      { key: 'invoiced', amountCents: receivables.invoicedCents },
      { key: 'collected', amountCents: receivables.collectedOrAdjustedCents },
      { key: 'outstanding', amountCents: receivables.closingOutstandingCents, note: 'closing' },
    ],
    activity: movements.slice(0, PREVIEW_ACTIVITY_LIMIT).map((row, index) => ({
      id: String(row.sourceHistoryId || index),
      date: row.effectiveDate || row.recordedAt || null,
      label: row.description || '',
      amountCents: Number(row.invoicedCents || 0) - Number(row.collectedOrAdjustedCents || 0),
    })),
  };
}

function PreviewBody({ product, scope, language, text }) {
  const [state, setState] = useState({ status: scope?.latestDocumentId ? 'loading' : 'empty', document: null });

  useEffect(() => {
    if (!scope?.latestDocumentId) {
      setState({ status: 'empty', document: null });
      return;
    }
    let active = true;
    setState({ status: 'loading', document: null });
    getArchiveDocument(scope.latestDocumentId)
      .then((document) => {
        if (!active) return;
        if (!document) throw new Error('Empty document');
        setState({ status: 'ready', document });
      })
      .catch(() => {
        if (active) setState({ status: 'error', document: null });
      });
    return () => { active = false; };
  }, [scope?.latestDocumentId]);

  const money = (amountCents, currency) => {
    if (amountCents == null || !currency) return text('unavailable');
    return formatStatementMoney(Number(amountCents), currency, language);
  };

  if (state.status === 'loading') {
    return <div className="spm-state" role="status">{text('loading')}</div>;
  }
  if (state.status === 'error') {
    return <div className="spm-state" role="alert">
      <p>{text('loadError')}</p>
      <button type="button" className="spm-btn" onClick={() => setState({ status: 'loading', document: null })}>
        {text('retry')}
      </button>
    </div>;
  }

  const preview = state.status === 'ready' ? extractPreview(state.document, product) : null;
  const currency = preview?.currency || scope?.currency || null;
  const periodText = periodRangeLabel(preview?.period || scope?.latestPeriod, language);

  return <div className="spm-summary">
    {periodText && <p className="spm-period"><strong>{text('period')}:</strong> {periodText}</p>}
    {preview ? <>
      <dl className="spm-totals">
        {preview.totals.map((total, index) => <div key={`${total.key}-${index}`}>
          <dt>{text(total.key)}{total.note ? ` (${text(total.note)})` : ''}</dt>
          <dd><bdi>{money(total.amountCents, preview.currency)}</bdi></dd>
        </div>)}
      </dl>
      <h3 className="spm-activity-heading">{text('recentActivity')}</h3>
      {!preview.activity.length ? <p className="spm-muted">{text('noActivity')}</p> : <ul className="spm-activity">
        {preview.activity.map((row) => <li key={row.id}>
          <span className="spm-activity-date">{dateLabel(row.date, language) || text('unavailable')}</span>
          <span className="spm-activity-label"><bdi>{row.label || text('unavailable')}</bdi></span>
          <bdi className="spm-activity-amount">{money(row.amountCents, preview.currency)}</bdi>
        </li>)}
      </ul>}
    </> : <>
      <p className="spm-muted" role="note"><strong>{text('noStatement')}</strong> {text('noStatementBody')}</p>
      {scope?.summary && <dl className="spm-totals">
        {Object.entries(scope.summary)
          .filter(([, value]) => value && typeof value === 'object' && value.currency)
          .map(([key, value]) => <div key={key}>
            <dt>{text(key)}</dt>
            <dd><bdi>{money(value.amountCents, value.currency)}</bdi></dd>
          </div>)}
      </dl>}
    </>}
    {currency == null && preview == null && <p className="spm-muted">{text('unavailable')}</p>}
  </div>;
}

function ModalContent({ dialogId, dialogRef, titleId, product, productLabel, scope, fullPageUrl, onClose }) {
  const { t, i18n } = useTranslation('credit');
  const language = (i18n.resolvedLanguage || i18n.language || 'en').split(/[-_]/)[0];
  const text = (key, options = {}) => t(`statements.preview.${key}`, options);
  const navigate = useNavigate();

  // Focus trap + Escape, scoped to the topmost dialog so a nested dialog keeps
  // keyboard control while open.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!isTopDialog(dialogId)) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === 'Tab') {
        const els = focusableElements(dialogRef.current);
        if (els.length === 0) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [dialogId, dialogRef, onClose]);

  const onBackdropMouseDown = (event) => {
    if (event.target === event.currentTarget) onClose();
  };

  return <div className="spm-backdrop" onMouseDown={onBackdropMouseDown}>
    <div ref={dialogRef} className="spm-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <div className="spm-header">
        <div className="spm-header-text">
          <p className="spm-eyebrow"><FileText size={14} aria-hidden="true" />{text('title')}</p>
          <h2 id={titleId} className="spm-title">{productLabel}{scope?.label && scope.label !== productLabel ? ` — ${scope.label}` : ''}</h2>
          {scope?.currency && <p className="spm-subtitle"><bdi>{scope.currency}</bdi></p>}
        </div>
        <div className="spm-header-actions">
          <button type="button" className="spm-btn spm-btn-primary" onClick={() => navigate(fullPageUrl)}>
            <ExternalLink size={15} aria-hidden="true" />{text('openFullPage')}
          </button>
          <button type="button" className="spm-btn spm-btn-icon" onClick={onClose} aria-label={text('close')}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="spm-body">
        <PreviewBody product={product} scope={scope} language={language} text={text} />
      </div>
    </div>
  </div>;
}

function ModalShell(props) {
  const dialogId = useId();
  const dialogRef = useRef(null);
  const titleId = `${dialogId}-title`;
  const returnFocusRef = useRef(null);

  useEffect(() => {
    const id = `statement-preview-${dialogId}`;
    registerDialog(id);
    returnFocusRef.current = document.activeElement;
    // Move focus into the dialog; return it when the modal unmounts.
    const frame = requestAnimationFrame(() => {
      const els = focusableElements(dialogRef.current);
      (els[0] || dialogRef.current)?.focus?.();
    });
    return () => {
      cancelAnimationFrame(frame);
      unregisterDialog(id);
      const returnTo = returnFocusRef.current;
      if (returnTo && typeof returnTo.focus === 'function') {
        try { returnTo.focus({ preventScroll: true }); } catch { /* noop */ }
      }
    };
  }, [dialogId]);

  return <ModalContent dialogId={`statement-preview-${dialogId}`} dialogRef={dialogRef} titleId={titleId} {...props} />;
}

// Dashboard-preserving statement preview: a large dialog on desktop,
// full-screen on mobile. Backdrop click and Escape close it; focus is trapped
// and returned to the invoking control; background scroll locks via the shared
// dialog stack. "Open full page" navigates to the product's statements page.
export default function StatementPreviewModal({
  open,
  onClose,
  product,
  productLabel,
  scope = null,
  fullPageUrl,
}) {
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <ModalShell
      product={product}
      productLabel={productLabel}
      scope={scope}
      fullPageUrl={fullPageUrl}
      onClose={onClose}
    />,
    document.body,
  );
}
