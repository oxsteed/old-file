// Restaurant customer top-up eligibility panel: lets the restaurant owner
// apply for OxSteed approval so customers can add money to their restaurant
// wallet with a card. Renders inside the merchant Payouts tab, below the
// payouts panel. The application is rejected server-side unless the
// restaurant has payouts connected, so a 409 surfaces a prompt to connect
// payouts first (with a link back to the Payouts tab).
import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  applyRestaurantTopupEligibility,
  getRestaurantTopupEligibility,
} from '../../api/food';
import { apiErrorMessage } from './foodShared';

const PAYOUTS_NOT_CONNECTED = 'restaurant_topup_payouts_not_connected';
const PAYOUTS_NOT_READY = 'restaurant_topup_payouts_not_ready';

const STATUS_TONE = {
  approved: 'ready',
  pending: 'pending',
  rejected: 'attention',
  suspended: 'attention',
  not_applied: 'pending',
};

function Pill({ tone, children }) {
  return (
    <span className={`fd-status-pill${tone ? ` fd-payout-${tone}` : ''}`} style={{ textTransform: 'none' }}>
      {children}
    </span>
  );
}

export default function RestaurantTopupEligibilityPanel({ t: tProp, restaurant, restaurantId: restaurantIdProp, onGoToPayouts }) {
  const { t: tHook } = useTranslation();
  const t = tProp || tHook;
  const restaurantId = restaurantIdProp ?? restaurant?.id;

  const [eligibility, setEligibility] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [payoutsBlock, setPayoutsBlock] = useState(null);

  const load = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    setError('');
    try {
      const data = await getRestaurantTopupEligibility(restaurantId);
      setEligibility(data?.eligibility || null);
    } catch (err) {
      setError(apiErrorMessage(err, t('restaurantTopups.merchant.loadFailed', 'Could not load top-up status.')));
    } finally {
      setLoading(false);
    }
  }, [restaurantId, t]);

  useEffect(() => { load(); }, [load]);

  const apply = async () => {
    if (!restaurantId || applying) return;
    setApplying(true);
    setPayoutsBlock(null);
    try {
      const result = await applyRestaurantTopupEligibility(restaurantId);
      setEligibility(result?.eligibility || null);
      toast.success(t('restaurantTopups.merchant.applied', 'Application submitted. OxSteed will review it shortly.'));
    } catch (err) {
      const code = err?.response?.data?.code;
      if (code === PAYOUTS_NOT_CONNECTED) {
        setPayoutsBlock('not_connected');
      } else if (code === PAYOUTS_NOT_READY) {
        setPayoutsBlock('not_ready');
      } else {
        toast.error(apiErrorMessage(err, t('restaurantTopups.merchant.applyFailed', 'Could not submit the application. Please try again.')));
      }
    } finally {
      setApplying(false);
    }
  };

  const status = eligibility?.status || 'not_applied';
  const decisionReason = eligibility?.decisionReason || null;

  const statusCopy = {
    not_applied: t('restaurantTopups.merchant.statusNotApplied', 'Not enabled'),
    pending: t('restaurantTopups.merchant.statusPending', 'Under review'),
    approved: t('restaurantTopups.merchant.statusApproved', 'Enabled'),
    rejected: t('restaurantTopups.merchant.statusRejected', 'Not approved'),
    suspended: t('restaurantTopups.merchant.statusSuspended', 'Suspended'),
  }[status] || status;

  return (
    <div style={{ marginTop: '2rem', borderTop: '1px solid var(--fd-border, #e5e7eb)', paddingTop: '1.5rem' }}>
      <h3>{t('restaurantTopups.merchant.title', 'Customer top-ups')}</h3>
      <p className="fd-card-meta">
        {t('restaurantTopups.merchant.subtitle', 'Let customers add money to their restaurant wallet with a card. OxSteed reviews each restaurant before enabling this.')}
      </p>

      {loading && (
        <p className="fd-card-meta" aria-busy="true">{t('food.common.loading', 'Loading')}</p>
      )}

      {!loading && error && (
        <div className="fd-order-feed-error" role="alert">
          {error}{' '}
          <button type="button" onClick={load}>{t('food.common.retry', 'Retry')}</button>
        </div>
      )}

      {!loading && !error && (
        <div style={{ marginTop: '0.75rem' }}>
          <div className="fd-row" style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <Pill tone={STATUS_TONE[status]}>{statusCopy}</Pill>
          </div>

          {status === 'pending' && (
            <p className="fd-card-meta" style={{ marginTop: '0.5rem' }}>
              {t('restaurantTopups.merchant.statusPendingCopy', 'Your application is under review. Customers cannot add money yet.')}
            </p>
          )}

          {status === 'approved' && (
            <p className="fd-card-meta" style={{ marginTop: '0.5rem' }}>
              {t('restaurantTopups.merchant.statusApprovedCopy', 'Customers can add money to their wallet for this restaurant.')}
            </p>
          )}

          {(status === 'rejected' || status === 'suspended') && decisionReason && (
            <p className="fd-card-meta" style={{ marginTop: '0.5rem' }}>
              {t('restaurantTopups.merchant.decisionReason', 'Reason: {{reason}}', { reason: decisionReason })}
            </p>
          )}

          {(status === 'not_applied' || status === 'rejected' || status === 'suspended') && (
            <div className="fd-row" style={{ gap: '0.5rem', marginTop: '0.75rem' }}>
              <button type="button" className="fd-btn fd-btn-sm" onClick={apply} disabled={applying}>
                {applying
                  ? t('restaurantTopups.merchant.applying', 'Submitting…')
                  : status === 'not_applied'
                    ? t('restaurantTopups.merchant.apply', 'Enable customer top-ups')
                    : t('restaurantTopups.merchant.reapply', 'Re-apply')}
              </button>
            </div>
          )}

          {payoutsBlock && (
            <div className="fd-order-feed-error" role="alert" style={{ marginTop: '0.75rem' }}>
              <strong style={{ display: 'block', marginBottom: '0.25rem' }}>
                {t('restaurantTopups.merchant.payoutsRequiredTitle', 'Connect payouts first')}
              </strong>
              <span>
                {payoutsBlock === 'not_connected'
                  ? t('restaurantTopups.merchant.payoutsRequiredCopy', 'Customer top-ups send money into a wallet the restaurant must be able to withdraw. Connect a payout account before applying.')
                  : t('restaurantTopups.merchant.payoutsNotReadyCopy', 'Your payout account is connected but onboarding is not complete. Finish the Stripe onboarding steps, then apply again.')}
              </span>{' '}
              <button type="button" onClick={() => onGoToPayouts && onGoToPayouts()}>
                {t('restaurantTopups.merchant.goToPayouts', 'Go to Payouts')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
