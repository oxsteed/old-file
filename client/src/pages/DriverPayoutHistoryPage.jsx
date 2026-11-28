// DriverPayoutHistoryPage.jsx
//
// Weekly self-audit 2026-11-04 item 9: the driver-facing payout endpoint
// (GET /delivery/driver-payouts, scoped to the signed-in driver) had zero
// client callers. This is its read-only UI: status filter, paid/pending
// totals, and the payout rows. It moves no money: approval, mark-paid, and
// void stay in the operations workspace. There was no dedicated driver
// home to attach it to (DeliveryPage is customer booking, dispatch is
// ops-guarded), so it lives at /delivery/payouts and is linked from the
// assigned-driver section of the job detail page.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { deliveryMoney, listMyDriverPayouts, downloadDeliveryReceipt } from '../api/delivery';
import '../styles/DeliveryPage.css';

const STATUSES = ['all', 'accrued', 'approved', 'paid', 'voided'];

// G9-B1 (item 492, D-524): the driver list pages like the ops list.
// The page size matches the server default (100); the server total
// drives the pager, and the header totals come from the server over
// the full set, not from the rows on this page.
const PAYOUT_PAGE_SIZE = 100;

export default function DriverPayoutHistoryPage() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState('all');
  const [payouts, setPayouts] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [totals, setTotals] = useState({ paidCents: 0, pendingCents: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Group 9 Slice F (item 493): the dedicated adjustments view is a
  // filter over this same history — only payouts with a persisted
  // adjustment explanation.
  const [adjustmentsOnly, setAdjustmentsOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    listMyDriverPayouts(status === 'all' ? null : status, { limit: PAYOUT_PAGE_SIZE, offset })
      .then((data) => {
        if (cancelled) return;
        const nextTotal = Number(data?.total ?? 0);
        // An action on the last page can empty it; step back to the
        // last non-empty page instead of showing a false-empty list.
        if (nextTotal > 0 && offset >= nextTotal) {
          setOffset(Math.floor((nextTotal - 1) / PAYOUT_PAGE_SIZE) * PAYOUT_PAGE_SIZE);
          return;
        }
        setPayouts(Array.isArray(data?.payouts) ? data.payouts : []);
        setTotal(nextTotal);
        if (data?.totals) {
          setTotals({
            paidCents: Number(data.totals.paidCents || 0),
            pendingCents: Number(data.totals.pendingCents || 0),
          });
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t('logistics.operations.driverPayouts.loadFailed'));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [status, offset, t]);

  // Header totals are the server totals over the full set, not the
  // rows on this page (G9-B1).
  const headerTotals = { paid: totals.paidCents, pending: totals.pendingCents };

  const money = (cents, currency) => deliveryMoney(cents, i18n.language, currency || 'USD');
  const statusLabel = (value) => t(`logistics.operations.driverPayouts.status${value[0].toUpperCase()}${value.slice(1)}`);
  const filterLabel = (value) => (value === 'all'
    ? t('logistics.operations.driverPayouts.filterAll')
    : t(`logistics.operations.driverPayouts.filter${value[0].toUpperCase()}${value.slice(1)}`));
  // Group 9 Slice F (items 493/494/495): adjustments are the persisted
  // explanation rows (what changed, why, by whom, before/after);
  // disputes ride on the payout's job.
  const shown = adjustmentsOnly ? payouts.filter((payout) => (payout.adjustments || []).length > 0) : payouts;
  const adjustmentLabel = (adjustment) => t('delivery.driverPayoutHistory.adjustment', {
    from: money(adjustment.previous_payout_cents),
    to: money(adjustment.new_payout_cents),
    reason: adjustment.reason,
    by: [adjustment.first_name, adjustment.last_name].filter(Boolean).join(' ') || adjustment.adjusted_by_email || t('delivery.ui.unknown'),
  });

  return (
    <main className="delivery-page">
      <section className="delivery-panel">
        <h1>{t('delivery.driverPayoutHistory.title')}</h1>
        <p>{t('delivery.driverPayoutHistory.subtitle')}</p>
        <p><Link to="/delivery/weekly-report">{t('delivery.weeklyReport.link')}</Link></p>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', margin: '1rem 0' }}>
          <div>
            <strong>{money(headerTotals.paid)}</strong>
            <span> {t('delivery.driverPayoutHistory.totalPaid')}</span>
          </div>
          <div>
            <strong>{money(headerTotals.pending)}</strong>
            <span> {t('delivery.driverPayoutHistory.totalPending')}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '1rem 0' }} role="group" aria-label={t('logistics.operations.driverPayouts.filterLabel')}>
          {STATUSES.map((value) => (
            <button
              key={value}
              type="button"
              className={status === value ? 'delivery-button delivery-button--primary' : 'delivery-button delivery-button--secondary'}
              onClick={() => { setStatus(value); setOffset(0); }}
              data-track={`ui.fdc4d46ef9.${1 + STATUSES.indexOf(value)}`}
            >
              {filterLabel(value)}
            </button>
          ))}
          <button
            type="button"
            className={adjustmentsOnly ? 'delivery-button delivery-button--primary' : 'delivery-button delivery-button--secondary'}
            onClick={() => setAdjustmentsOnly(!adjustmentsOnly)}
            data-track="ui.fdc4d46ef9.6"
          >
            {t('delivery.driverPayoutHistory.adjustmentsOnly')}
          </button>
        </div>
        {loading && <p role="status">{t('logistics.operations.driverPayouts.loading')}</p>}
        {error && <p role="alert">{error}</p>}
        {!loading && !error && shown.length === 0 && <p>{adjustmentsOnly ? t('delivery.driverPayoutHistory.adjustmentsEmpty') : t('logistics.operations.driverPayouts.empty')}</p>}
        {!loading && !error && shown.length > 0 && (
          <table className="delivery-table">
            <thead>
              <tr>
                <th>{t('delivery.driverPayoutHistory.jobHeader')}</th>
                <th>{t('delivery.driverPayoutHistory.amountHeader')}</th>
                <th>{t('delivery.driverPayoutHistory.statusHeader')}</th>
                <th>{t('delivery.driverPayoutHistory.referenceHeader')}</th>
                <th>{t('delivery.driverPayoutHistory.dateHeader')}</th>
                <th>{t('delivery.driverPayoutHistory.adjustmentsHeader')}</th>
                <th>{t('delivery.driverPayoutHistory.disputesHeader')}</th>
                <th>{t('delivery.driverPayoutHistory.receiptHeader')}</th>
                <th>{t('delivery.driverPayoutHistory.detailHeader')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((payout) => (
                <tr key={payout.id}>
                  <td>
                    {payout.delivery_job_id
                      ? <Link to={`/delivery/jobs/${payout.delivery_job_id}`}>{t('logistics.operations.driverPayouts.job', { reference: payout.job_reference || payout.delivery_job_id })}</Link>
                      : '—'}
                  </td>
                  <td>{money(payout.payout_cents, payout.currency)}</td>
                  <td>{statusLabel(payout.status)}</td>
                  <td>{payout.payment_reference || '—'}</td>
                  <td>
                    {payout.status === 'paid' && payout.paid_at
                      ? `${t('delivery.driverPayoutHistory.paidOn')} ${new Date(payout.paid_at).toLocaleDateString()}`
                      : new Date(payout.created_at).toLocaleDateString()}
                  </td>
                  <td>
                    {(payout.adjustments || []).length
                      ? payout.adjustments.map((adjustment) => <p key={adjustment.id}>{adjustmentLabel(adjustment)}</p>)
                      : '—'}
                  </td>
                  <td>
                    {(payout.disputes || []).length
                      ? payout.disputes.map((dispute) => <p key={dispute.id}>{t(`delivery.detail.disputeSubjects.${dispute.subject}`)} · {t(`delivery.detail.disputeStatuses.${dispute.status}`)}</p>)
                      : '—'}
                  </td>
                  <td>
                    {payout.delivery_job_id
                      ? <button type="button" className="delivery-button delivery-button--secondary" onClick={() => downloadDeliveryReceipt(payout.delivery_job_id, payout.job_reference)} data-track="ui.fdc4d46ef9.7">{t('delivery.detail.receiptDownload')}</button>
                      : '—'}
                  </td>
                  <td>
                    <Link to={`/delivery/payouts/${payout.id}`}>{t('delivery.driverPayoutHistory.viewDetail')}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && !error && total > 0 && (
          <div className="flex flex-wrap items-center gap-2 my-4" role="navigation" aria-label={t('logistics.operations.driverPayouts.pagerLabel')}>
            <p role="status">
              {t('logistics.operations.driverPayouts.showing', { from: offset + 1, to: Math.min(offset + PAYOUT_PAGE_SIZE, total), total })}
            </p>
            <button
              type="button"
              className="delivery-button delivery-button--secondary"
              disabled={loading || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAYOUT_PAGE_SIZE))}
            >
              {t('logistics.operations.driverPayouts.previous')}
            </button>
            <button
              type="button"
              className="delivery-button delivery-button--secondary"
              disabled={loading || offset + PAYOUT_PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAYOUT_PAGE_SIZE)}
            >
              {t('logistics.operations.driverPayouts.next')}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
