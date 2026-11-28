// DriverPayoutDetailPage.jsx
//
// Group 14 Slice 5j (747, D-790): the single-payout detail view. The
// driver and ops lists existed with no way to open one payout: no
// endpoint returned a payout with its adjustments, its job disputes, and
// its status timeline. This page is that view, read-only: approval,
// mark-paid, and void stay in the operations workspace. An operations
// user reads through the internal endpoint (driver identity attached);
// everyone else reads through the driver endpoint, which 404s another
// driver's payout. Amounts render through deliveryMoney in the payout's
// currency (USD: payout rows carry no currency column, delivery pricing
// is USD).

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { deliveryMoney, getInternalDriverPayout, getMyDriverPayout } from '../api/delivery';
import { useAuth } from '../context/AuthContext';
import { canAccessOperationsWorkspace } from '../utils/logisticsWorkspaces';
import '../styles/DeliveryPage.css';

export default function DriverPayoutDetailPage() {
  const { t, i18n } = useTranslation();
  const { payoutId } = useParams();
  const { user } = useAuth();
  const [payout, setPayout] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const isOps = canAccessOperationsWorkspace(user);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const load = isOps ? getInternalDriverPayout(payoutId) : getMyDriverPayout(payoutId);
    load
      .then((data) => {
        if (!cancelled) {
          setPayout(data?.payout || null);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.status === 404
          ? t('delivery.driverPayoutDetail.notFound')
          : t('delivery.driverPayoutDetail.loadFailed'));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [payoutId, isOps, t]);

  const money = (cents, currency) => deliveryMoney(cents, i18n.language, currency || 'USD');
  const statusLabel = (value) => t(`logistics.operations.driverPayouts.status${value[0].toUpperCase()}${value.slice(1)}`);
  const fmtDate = (value) => (value ? new Date(value).toLocaleString(i18n.language) : '—');
  const driverName = payout?.driver
    ? ([payout.driver.first_name, payout.driver.last_name].filter(Boolean).join(' ') || payout.driver.email)
    : null;

  return (
    <main className="delivery-page">
      <section className="delivery-panel">
        <p>
          <Link to="/delivery/payouts">{t('delivery.driverPayoutDetail.backToHistory')}</Link>
          {isOps && (
            <>
              {' · '}
              <Link to="/logistics/operations">{t('delivery.driverPayoutDetail.backToOperations')}</Link>
            </>
          )}
        </p>
        <h1>{t('delivery.driverPayoutDetail.title')}</h1>
        {loading && <p role="status">{t('logistics.operations.driverPayouts.loading')}</p>}
        {error && <p role="alert">{error}</p>}
        {!loading && !error && payout && (
          <>
            <p>{t('delivery.driverPayoutDetail.subtitle')}</p>
            <dl>
              <div>
                <dt>{t('delivery.driverPayoutHistory.amountHeader')}</dt>
                <dd><strong>{money(payout.payout_cents, payout.currency)}</strong></dd>
              </div>
              <div>
                <dt>{t('delivery.driverPayoutHistory.statusHeader')}</dt>
                <dd>{statusLabel(payout.status)}</dd>
              </div>
              <div>
                <dt>{t('delivery.driverPayoutHistory.jobHeader')}</dt>
                <dd>
                  {payout.delivery_job_id
                    ? <Link to={`/delivery/jobs/${payout.delivery_job_id}`}>{t('logistics.operations.driverPayouts.job', { reference: payout.job_reference || payout.delivery_job_id })}</Link>
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>{t('delivery.driverPayoutHistory.referenceHeader')}</dt>
                <dd>{payout.payment_reference || '—'}</dd>
              </div>
              {driverName && (
                <div>
                  <dt>{t('delivery.driverPayoutDetail.driver')}</dt>
                  <dd>{driverName}</dd>
                </div>
              )}
              {payout.note && (
                <div>
                  <dt>{t('delivery.driverPayoutDetail.note')}</dt>
                  <dd>{payout.note}</dd>
                </div>
              )}
              <div>
                <dt>{t('delivery.driverPayoutDetail.created')}</dt>
                <dd>{fmtDate(payout.created_at)}</dd>
              </div>
            </dl>
            <h2>{t('delivery.driverPayoutDetail.timelineTitle')}</h2>
            <ol>
              {(payout.timeline || []).map((event) => (
                <li key={`${event.status}-${event.at}`}>
                  {statusLabel(event.status)} · {fmtDate(event.at)}
                  {event.by ? ` · ${t('delivery.driverPayoutDetail.by', { name: event.by })}` : ''}
                </li>
              ))}
            </ol>
            <h2>{t('delivery.driverPayoutDetail.adjustmentsTitle')}</h2>
            {(payout.adjustments || []).length === 0 ? (
              <p>{t('delivery.driverPayoutDetail.adjustmentsEmpty')}</p>
            ) : (
              <ul>
                {payout.adjustments.map((adjustment) => (
                  <li key={adjustment.id}>
                    {t('delivery.driverPayoutHistory.adjustment', {
                      from: money(adjustment.previous_payout_cents),
                      to: money(adjustment.new_payout_cents),
                      reason: adjustment.reason,
                      by: [adjustment.first_name, adjustment.last_name].filter(Boolean).join(' ') || adjustment.adjusted_by_email || t('delivery.ui.unknown'),
                    })}
                    {' · '}
                    {fmtDate(adjustment.created_at)}
                  </li>
                ))}
              </ul>
            )}
            <h2>{t('delivery.driverPayoutDetail.disputesTitle')}</h2>
            {(payout.disputes || []).length === 0 ? (
              <p>{t('delivery.driverPayoutDetail.disputesEmpty')}</p>
            ) : (
              <ul>
                {payout.disputes.map((dispute) => (
                  <li key={dispute.id}>
                    {t(`delivery.detail.disputeSubjects.${dispute.subject}`)} · {t(`delivery.detail.disputeStatuses.${dispute.status}`)} · {fmtDate(dispute.created_at)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </main>
  );
}
