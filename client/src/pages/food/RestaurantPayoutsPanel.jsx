// Restaurant payouts panel: lets the restaurant owner connect a Stripe
// Express account so the restaurant can receive payouts, resume onboarding,
// see payout status (enabled/pending, next payout ETA), and disconnect.
// Wired into the merchant page by the coordinator; do not import elsewhere
// without checking the merchant tab gating.
import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  createRestaurantPayoutAccount,
  disconnectRestaurantPayoutAccount,
  formatFoodMoney,
  getRestaurantPayoutStatus,
} from '../../api/food';
import { apiErrorMessage } from './foodShared';

function Pill({ tone, children }) {
  return (
    <span className={`fd-status-pill${tone ? ` fd-payout-${tone}` : ''}`} style={{ textTransform: 'none' }}>
      {children}
    </span>
  );
}

export default function RestaurantPayoutsPanel({ t: tProp, restaurant, restaurantId: restaurantIdProp }) {
  const { t: tHook } = useTranslation();
  const t = tProp || tHook;
  const restaurantId = restaurantIdProp ?? restaurant?.id;

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    setError('');
    try {
      const data = await getRestaurantPayoutStatus(restaurantId);
      setStatus(data);
    } catch (err) {
      setError(apiErrorMessage(err, t('food.merchant.payouts.loadError', 'Could not load payout status.')));
    } finally {
      setLoading(false);
    }
  }, [restaurantId, t]);

  useEffect(() => { load(); }, [load]);

  const startOnboarding = async () => {
    if (!restaurantId || connecting) return;
    setConnecting(true);
    try {
      // return_path is sanitized server-side to same-origin paths only.
      const data = await createRestaurantPayoutAccount(restaurantId, { return_path: '/food/merchant' });
      const url = data?.url || data?.onboarding_url;
      if (url) {
        window.location.href = url;
        return;
      }
      // Account was already set up; refresh what we show.
      await load();
      toast.success(t('food.merchant.payouts.connected', 'Payouts connected'));
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.payouts.connectError', 'Could not start payout setup. Please try again.')));
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!restaurantId || disconnecting) return;
    const confirmed = window.confirm(t('food.merchant.payouts.disconnectConfirm', 'Disconnect payouts for this restaurant? Future payouts will stop until you reconnect.'));
    if (!confirmed) return;
    setDisconnecting(true);
    try {
      await disconnectRestaurantPayoutAccount(restaurantId);
      toast.success(t('food.merchant.payouts.disconnected', 'Payout account disconnected.'));
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.payouts.disconnectError', 'Could not disconnect payouts. Please try again.')));
    } finally {
      setDisconnecting(false);
    }
  };

  const formatNextPayout = (next) => {
    if (!next) return t('food.merchant.payouts.noScheduledPayout', 'No payout scheduled yet.');
    const amount = formatFoodMoney(next.amount, (next.currency || 'usd').toUpperCase());
    if (next.arrival_date) {
      const date = new Date(next.arrival_date);
      const formatted = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
      return t('food.merchant.payouts.nextPayoutDetail', '{{amount}} arriving {{date}}', { amount, date: formatted });
    }
    return amount;
  };

  const connected = !!status?.connected;
  const onboarded = connected && !!status?.stripe_connect_onboarded;
  const chargesReady = connected && !!status?.stripe_connect_ready;
  const payoutsReady = connected && !!status?.stripe_connect_payouts_ready;
  const needsAttention = connected && (!onboarded || !chargesReady || !payoutsReady);

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h3>{t('food.merchant.payouts.title', 'Payouts')}</h3>
      <p className="fd-card-meta">{t('food.merchant.payouts.subtitle', 'Connect a Stripe account so this restaurant can receive payouts for its orders.')}</p>

      {loading && (
        <p className="fd-card-meta" aria-busy="true">{t('food.common.loading', 'Loading')}</p>
      )}

      {!loading && error && (
        <div className="fd-order-feed-error" role="alert">
          {error}{' '}
          <button type="button" onClick={load}>{t('food.common.retry', 'Retry')}</button>
        </div>
      )}

      {!loading && !error && !connected && (
        <div className="fd-row" style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginTop: '0.75rem' }}>
          <Pill tone="pending">{t('food.merchant.payouts.notConnected', 'Not connected')}</Pill>
          <p className="fd-card-meta" style={{ margin: 0 }}>
            {t('food.merchant.payouts.notConnectedHint', 'Set up payouts to receive money from orders directly to your bank account.')}
          </p>
          <button type="button" className="fd-btn fd-btn-sm" onClick={startOnboarding} disabled={connecting}>
            {connecting ? t('food.merchant.payouts.connecting', 'Opening Stripe…') : t('food.merchant.payouts.connect', 'Connect payouts')}
          </button>
        </div>
      )}

      {!loading && !error && connected && (
        <div style={{ marginTop: '0.75rem' }}>
          <div className="fd-row" style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <Pill tone={onboarded ? 'ready' : 'pending'}>
              {onboarded
                ? t('food.merchant.payouts.connected', 'Payouts connected')
                : t('food.merchant.payouts.onboardingIncomplete', 'Onboarding incomplete')}
            </Pill>
            <Pill tone={payoutsReady ? 'ready' : 'pending'}>
              {payoutsReady
                ? t('food.merchant.payouts.payoutsEnabled', 'Payouts enabled')
                : t('food.merchant.payouts.payoutsPending', 'Payouts pending')}
            </Pill>
          </div>

          {needsAttention && (
            <div className="fd-row" style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginTop: '0.75rem' }}>
              <p className="fd-card-meta" style={{ margin: 0 }}>
                {t('food.merchant.payouts.onboardingIncompleteHint', 'Finish the Stripe onboarding steps to start receiving payouts.')}
              </p>
              <button type="button" className="fd-btn fd-btn-sm" onClick={startOnboarding} disabled={connecting}>
                {connecting ? t('food.merchant.payouts.connecting', 'Opening Stripe…') : t('food.merchant.payouts.continueOnboarding', 'Continue onboarding')}
              </button>
            </div>
          )}

          {!needsAttention && (
            <p className="fd-card-meta" style={{ marginTop: '0.5rem' }}>
              {t('food.merchant.payouts.nextPayout', 'Next payout: {{detail}}', { detail: formatNextPayout(status?.next_payout) })}
            </p>
          )}

          <div className="fd-row" style={{ gap: '0.5rem', marginTop: '0.75rem' }}>
            <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={load} disabled={loading}>
              {t('food.merchant.payouts.refresh', 'Refresh status')}
            </button>
            <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={disconnect} disabled={disconnecting}>
              {disconnecting ? t('food.merchant.payouts.disconnecting', 'Disconnecting…') : t('food.merchant.payouts.disconnect', 'Disconnect payouts')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
