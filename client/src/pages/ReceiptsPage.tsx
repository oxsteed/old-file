import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader, Receipt } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { receiptsApi } from '../api/receipts';
import './ReceiptsPage.css';

// Group 1 (Customer), item 23 — receipt vault (G1-A2, checkpoint 3).
// One consolidated list of the customer's paid bookings and jobs: paid
// tool rentals and captured/released job payments, newest first.
// Unpaid and cancelled items never appear: a vault row is proof of
// payment. Amounts come from the server, scoped to the requesting
// customer; a stranger's vault is empty by construction.
function fmtMoney(amount: number | null | undefined, currency: string | undefined): string {
  if (amount == null || Number.isNaN(Number(amount))) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
      maximumFractionDigits: 2,
    }).format(Number(amount));
  } catch {
    return `${Number(amount).toFixed(2)} ${(currency || 'usd').toUpperCase()}`;
  }
}

function fmtDate(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface ReceiptRow {
  kind: 'tool_rental' | 'helper_job';
  id: string;
  bookingId?: string | null;
  jobId?: string | null;
  title: string;
  amount: number;
  currency: string;
  status: string;
  paidAt: string | null;
  startDate?: string;
  endDate?: string;
  invoiceNumber?: string | null;
}

export default function ReceiptsPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    receiptsApi.listReceipts()
      .then((rows) => {
        if (!cancelled) setReceipts(rows);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <PageShell>
      <PageMeta
        title={t('receipts.title')}
        description={t('receipts.subtitle')}
      />
      <div className="receipts-container">
        <div className="receipts-hero">
          <p className="receipts-eyebrow">{t('receipts.title')}</p>
          <h1 className="receipts-title">{t('receipts.title')}</h1>
          <p className="receipts-subtitle">{t('receipts.subtitle')}</p>
          <Link to="/my-bookings" className="booking-action-btn booking-action-invoice">
            {t('receipts.backToBookings')}
          </Link>
        </div>

        {failed && (
          <div className="receipts-error">
            <AlertCircle className="w-5 h-5" />
            <p>{t('receipts.loadFailed')}</p>
          </div>
        )}

        {loading ? (
          <div className="receipts-loading">
            <Loader className="animate-spin w-8 h-8" />
            <p>{t('common.loading')}</p>
          </div>
        ) : !failed && receipts.length === 0 ? (
          <div className="receipts-empty">
            <Receipt size={30} aria-hidden="true" />
            <p className="receipts-empty-kicker">{t('receipts.emptyTitle')}</p>
            <p className="receipts-empty-copy">{t('receipts.emptyBody')}</p>
          </div>
        ) : (
          <ul className="receipts-list">
            {receipts.map((r) => (
              <li key={r.id} className="receipts-row" data-testid={`receipt-${r.id}`}>
                <div className="receipts-row-main">
                  <span className="receipts-kind">
                    {r.kind === 'tool_rental' ? t('receipts.kindToolRental') : t('receipts.kindHelperJob')}
                  </span>
                  <h2 className="receipts-row-title">{r.title}</h2>
                  <span className="receipts-row-meta">
                    {t('receipts.paidOn')}: {fmtDate(r.paidAt, locale)}
                    {r.invoiceNumber ? ` · ${t('receipts.invoice')}: ${r.invoiceNumber}` : ''}
                  </span>
                </div>
                <div className="receipts-row-side">
                  <span className="receipts-amount">{fmtMoney(r.amount, r.currency)}</span>
                  {r.jobId && (
                    <Link to={`/jobs/${r.jobId}`}>{t('receipts.viewJob')}</Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
