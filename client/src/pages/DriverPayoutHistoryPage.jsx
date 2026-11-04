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

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { deliveryMoney, listMyDriverPayouts } from '../api/delivery';
import '../styles/DeliveryPage.css';

const STATUSES = ['all', 'accrued', 'approved', 'paid', 'voided'];

export default function DriverPayoutHistoryPage() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState('all');
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    listMyDriverPayouts(status === 'all' ? null : status)
      .then((data) => {
        if (cancelled) return;
        setPayouts(Array.isArray(data?.payouts) ? data.payouts : []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t('logistics.operations.driverPayouts.loadFailed'));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [status, t]);

  const totals = useMemo(() => {
    let paid = 0;
    let pending = 0;
    for (const payout of payouts) {
      const cents = Number(payout.payout_cents) || 0;
      if (payout.status === 'paid') paid += cents;
      else if (payout.status === 'accrued' || payout.status === 'approved') pending += cents;
    }
    return { paid, pending };
  }, [payouts]);

  const money = (cents, currency) => deliveryMoney(cents, i18n.language, currency || 'USD');
  const statusLabel = (value) => t(`logistics.operations.driverPayouts.status${value[0].toUpperCase()}${value.slice(1)}`);
  const filterLabel = (value) => (value === 'all'
    ? t('logistics.operations.driverPayouts.filterAll')
    : t(`logistics.operations.driverPayouts.filter${value[0].toUpperCase()}${value.slice(1)}`));

  return (
    <main className="delivery-page">
      <section className="delivery-panel">
        <h1>{t('delivery.driverPayoutHistory.title')}</h1>
        <p>{t('delivery.driverPayoutHistory.subtitle')}</p>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', margin: '1rem 0' }}>
          <div>
            <strong>{money(totals.paid)}</strong>
            <span> {t('delivery.driverPayoutHistory.totalPaid')}</span>
          </div>
          <div>
            <strong>{money(totals.pending)}</strong>
            <span> {t('delivery.driverPayoutHistory.totalPending')}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '1rem 0' }} role="group" aria-label={t('logistics.operations.driverPayouts.filterLabel')}>
          {STATUSES.map((value) => (
            <button
              key={value}
              type="button"
              className={status === value ? 'delivery-button delivery-button--primary' : 'delivery-button delivery-button--secondary'}
              onClick={() => setStatus(value)}
            >
              {filterLabel(value)}
            </button>
          ))}
        </div>
        {loading && <p role="status">{t('logistics.operations.driverPayouts.loading')}</p>}
        {error && <p role="alert">{error}</p>}
        {!loading && !error && payouts.length === 0 && <p>{t('logistics.operations.driverPayouts.empty')}</p>}
        {!loading && !error && payouts.length > 0 && (
          <table className="delivery-table">
            <thead>
              <tr>
                <th>{t('delivery.driverPayoutHistory.jobHeader')}</th>
                <th>{t('delivery.driverPayoutHistory.amountHeader')}</th>
                <th>{t('delivery.driverPayoutHistory.statusHeader')}</th>
                <th>{t('delivery.driverPayoutHistory.referenceHeader')}</th>
                <th>{t('delivery.driverPayoutHistory.dateHeader')}</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((payout) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
