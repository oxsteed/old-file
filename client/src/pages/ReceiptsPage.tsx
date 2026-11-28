import React, { useEffect, useMemo, useState } from 'react';
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
  const [total, setTotal] = useState(0);
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Group 14 Slice 5j (746, D-789): archive filters. Year/month narrow the
  // paid-on date; kind narrows the receipt type; q searches the title and
  // invoice number server-side. A month without a year is not offered: the
  // server rejects it, so the month select stays disabled until a year
  // is picked.
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [kind, setKind] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    const years: number[] = [];
    for (let y = current; y >= 2020; y -= 1) years.push(y);
    return years;
  }, []);
  const monthOptions = useMemo(
    () => Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: new Date(2026, i, 1).toLocaleDateString(locale, { month: 'long' }) })),
    [locale],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    receiptsApi.listReceipts({ year, month, kind, q, limit, offset })
      .then((page) => {
        if (!cancelled) {
          setReceipts(page.receipts);
          setTotal(page.total);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [year, month, kind, q, limit, offset]);

  const resetPage = () => setOffset(0);
  const pageCount = total === 0 ? 0 : Math.ceil(total / limit);
  const pageNumber = total === 0 ? 0 : Math.floor(offset / limit) + 1;

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

        <form
          className="receipts-filters"
          onSubmit={(e) => { e.preventDefault(); resetPage(); setQ(searchInput.trim()); }}
        >
          <label className="receipts-filter">
            {t('receipts.filterYear')}
            <select value={year} onChange={(e) => { setYear(e.target.value); setMonth(''); resetPage(); }} aria-label={t('receipts.filterYear')}>
              <option value="">{t('receipts.filterAllYears')}</option>
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </select>
          </label>
          <label className="receipts-filter">
            {t('receipts.filterMonth')}
            <select value={month} disabled={!year} onChange={(e) => { setMonth(e.target.value); resetPage(); }} aria-label={t('receipts.filterMonth')}>
              <option value="">{t('receipts.filterAllMonths')}</option>
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label className="receipts-filter">
            {t('receipts.filterKind')}
            <select value={kind} onChange={(e) => { setKind(e.target.value); resetPage(); }} aria-label={t('receipts.filterKind')}>
              <option value="">{t('receipts.filterAllKinds')}</option>
              <option value="tool_rental">{t('receipts.kindToolRental')}</option>
              <option value="helper_job">{t('receipts.kindHelperJob')}</option>
            </select>
          </label>
          <label className="receipts-filter">
            {t('receipts.filterSearch')}
            <input type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder={t('receipts.filterSearchPlaceholder')} aria-label={t('receipts.filterSearch')} />
          </label>
          <button type="submit" className="booking-action-btn booking-action-invoice">
            {t('receipts.filterApply')}
          </button>
          {(year || month || kind || q) && (
            <button
              type="button"
              className="booking-action-btn"
              onClick={() => { setYear(''); setMonth(''); setKind(''); setSearchInput(''); setQ(''); resetPage(); }}
            >
              {t('receipts.filterClear')}
            </button>
          )}
        </form>
        {total > 0 && (
          <p className="receipts-count">{t('receipts.count', { count: total })}</p>
        )}

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
        ) : !failed && receipts.length === 0 && total === 0 ? (
          <div className="receipts-empty">
            <Receipt size={30} aria-hidden="true" />
            <p className="receipts-empty-kicker">{(year || month || kind || q) ? t('receipts.noMatchesTitle') : t('receipts.emptyTitle')}</p>
            <p className="receipts-empty-copy">{(year || month || kind || q) ? t('receipts.noMatchesBody') : t('receipts.emptyBody')}</p>
          </div>
        ) : (
          <>
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
          {pageCount > 1 && (
            <div className="receipts-pagination">
              <button type="button" className="booking-action-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
                {t('receipts.prevPage')}
              </button>
              <span>{t('receipts.pageOf', { page: pageNumber, pages: pageCount })}</span>
              <button type="button" className="booking-action-btn" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
                {t('receipts.nextPage')}
              </button>
            </div>
          )}
          </>
        )}
      </div>
    </PageShell>
  );
}
