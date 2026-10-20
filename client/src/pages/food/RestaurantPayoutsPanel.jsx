import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { createRestaurantPayoutAccount, disconnectRestaurantPayoutAccount, formatFoodMoney, getRestaurantPayoutStatus, getWalletPayoutBalance, listWalletPayouts, requestWalletPayout } from '../../api/food';
import { parseCreditMajorAmount } from '../../lib/creditCurrency';
import { apiErrorMessage } from './foodShared';

function Pill({ ready, children }) { return <span className={`fd-status-pill fd-payout-${ready ? 'ready' : 'pending'}`}>{children}</span>; }

function WalletPayoutsSection({ restaurantId, t, f }) {
  const [balance, setBalance] = useState(null);
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [amount, setAmount] = useState('');
  const [requesting, setRequesting] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true); setError(false);
    try {
      const [bal, hist] = await Promise.all([getWalletPayoutBalance(restaurantId), listWalletPayouts(restaurantId, { limit: 20 })]);
      if (request !== sequence.current) return;
      setBalance(bal); setPayouts(Array.isArray(hist) ? hist : []);
    } catch { if (request === sequence.current) { setBalance(null); setError(true); } }
    finally { if (request === sequence.current) setLoading(false); }
  }, [restaurantId]);
  useEffect(() => { load(); return () => { sequence.current++; }; }, [load]);
  const cents = parseCreditMajorAmount(amount, balance?.currencyCode || 'USD');
  const valid = balance?.processorEnabled !== false && Number.isSafeInteger(cents) && cents > 0 && cents >= Number(balance?.minPayoutCents || 0) && cents <= Number(balance?.balanceCents || 0);
  const submitRequest = async () => {
    if (!valid || requesting) return;
    setRequesting(true);
    try {
      const key = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await requestWalletPayout(restaurantId, { amountCents: cents }, key);
      toast.success(t('food.merchant.payouts.requestSubmitted', 'Payout requested. An admin will review it.'));
      setAmount(''); await load();
    } catch (err) { toast.error(apiErrorMessage(err, t('food.merchant.payouts.requestError', 'Could not request the payout.'))); }
    finally { setRequesting(false); }
  };
  return <section className="fd-wallet-payouts" aria-label={t('food.merchant.payouts.walletTitle', 'Wallet earnings')}>
    <h3>{t('food.merchant.payouts.walletTitle', 'Wallet earnings')}</h3><p className="fd-card-meta">{f('walletHint')}</p>
    {loading ? <p role="status">{t('food.common.loading', 'Loading')}</p> : error ? <div className="fd-finance-notice fd-finance-error" role="alert"><p>{f('walletUnavailable')}</p><button className="fd-btn fd-btn-secondary" onClick={load} type="button" data-track="ui.374063ed56.1">{t('food.common.retry', 'Retry')}</button></div> : balance && <>
      <strong className="fd-payout-balance">{formatFoodMoney(balance.balanceCents, balance.currencyCode)}</strong>
      <form onSubmit={e => { e.preventDefault(); submitRequest(); }} data-track="ui.374063ed56.2" data-track-private>
        {balance.processorEnabled === false && <p className="fd-finance-notice" role="status">{f('walletPaused')}</p>}
        <label htmlFor={`wallet-payout-${restaurantId}`}>{f('requestAmount', { currency: balance.currencyCode })}</label>
        <div className="fd-row" style={{ gap: '.5rem', flexWrap: 'wrap' }}><input id={`wallet-payout-${restaurantId}`} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} aria-describedby={`wallet-min-${restaurantId}`} disabled={requesting} /><button type="submit" className="fd-btn" disabled={requesting || !valid} data-track="ui.374063ed56.3">{requesting ? t('food.merchant.payouts.requesting', 'Requesting…') : t('food.merchant.payouts.requestPayout', 'Request payout')}</button></div>
        <p id={`wallet-min-${restaurantId}`} className="fd-card-meta">{t('food.merchant.payouts.minPayout', 'Minimum payout: {{amount}}', { amount: formatFoodMoney(balance.minPayoutCents, balance.currencyCode) })} · {f('availableLimit')}</p>
      </form>
      <details className="fd-finance-advanced"><summary>{f('recentPayouts')}</summary>{payouts.length ? payouts.map(p => <div key={p.id} className="fd-payout-status-grid"><div className="fd-row" style={{ justifyContent: 'space-between', gap: '.75rem' }}><span>{formatFoodMoney(p.amount_cents, p.currency_code)}</span><Pill ready={p.status === 'completed'}>{t(`food.merchant.payouts.status.${p.status}`, p.status)}</Pill></div></div>) : <p className="fd-card-meta">{f('noPayouts')}</p>}</details>
    </>}
  </section>;
}

export default function RestaurantPayoutsPanel({ t: tProp, restaurant, restaurantId: restaurantIdProp }) {
  const { t: tHook, i18n } = useTranslation();
  const { t: financeT } = useTranslation('common');
  const t = tProp || tHook;
  const f = (key, options) => financeT(`merchantFinance.${key}`, options);
  const restaurantId = restaurantIdProp ?? restaurant?.id;
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    if (!restaurantId) return;
    const request = ++sequence.current;
    setLoading(true); setError(''); setStatus(null);
    try { const data = await getRestaurantPayoutStatus(restaurantId); if (request === sequence.current) setStatus(data); }
    catch (err) { if (request === sequence.current) setError(err?.response?.data?.code === 'feature_disabled' ? 'disabled' : 'unavailable'); }
    finally { if (request === sequence.current) setLoading(false); }
  }, [restaurantId]);
  useEffect(() => { load(); return () => { sequence.current++; }; }, [load]);
  const startOnboarding = async () => {
    if (!restaurantId || connecting || loading || error || status?.status_unavailable) return;
    setConnecting(true);
    try {
      // Return directly to this restaurant and the finance tab. The server
      // keeps only the allowed same-origin merchant parameters.
      const business = restaurant?.business_id;
      const return_path = `/restaurants/merchant?${business ? `business=${encodeURIComponent(business)}&` : ''}tab=payouts`;
      const data = await createRestaurantPayoutAccount(restaurantId, { return_path });
      const url = data?.url || data?.onboarding_url;
      if (url) { window.location.href = url; return; }
      await load(); toast.success(t('food.merchant.payouts.connected', 'Payouts connected'));
    } catch (err) { toast.error(apiErrorMessage(err, t('food.merchant.payouts.connectError', 'Could not start payout setup. Please try again.'))); }
    finally { setConnecting(false); }
  };
  const disconnect = async () => {
    if (!restaurantId || disconnecting || !window.confirm(t('food.merchant.payouts.disconnectConfirm', 'Disconnect payouts for this restaurant? Future payouts will stop until you reconnect.'))) return;
    setDisconnecting(true);
    try { await disconnectRestaurantPayoutAccount(restaurantId); toast.success(t('food.merchant.payouts.disconnected', 'Payout account disconnected.')); await load(); }
    catch (err) { toast.error(apiErrorMessage(err, t('food.merchant.payouts.disconnectError', 'Could not disconnect payouts. Please try again.'))); }
    finally { setDisconnecting(false); }
  };
  const connected = !!status?.connected;
  const verified = status?.status_verified !== false && !status?.status_unavailable;
  const ready = connected && verified && !!status?.stripe_connect_payouts_ready;
  const needsAttention = connected && (!status?.stripe_connect_onboarded || !status?.stripe_connect_ready || !ready);
  const next = status?.next_payout;
  const arrival = next?.arrival_date ? new Date(next.arrival_date) : null;
  return <div className="fd-payout-panel">
    <h3>{f('bank')}</h3><p className="fd-card-meta">{f('bankDescription')}</p>
    {loading && <p role="status">{t('food.common.loading', 'Loading')}</p>}
    {!loading && (error || !verified) && <div className="fd-finance-notice" role={error === 'disabled' ? 'status' : 'alert'}>
      <strong>{f(error === 'disabled' ? 'paymentsPaused' : 'statusUnavailable')}</strong><p>{f(error === 'disabled' ? 'paymentsPausedHint' : 'statusUnavailableHint')}</p>
      {error !== 'disabled' && <button type="button" className="fd-btn fd-btn-secondary" onClick={load} data-track="ui.374063ed56.4">{t('food.common.retry', 'Retry')}</button>} <Link to="/support">{f('contactSupport')}</Link>
    </div>}
    {!loading && !error && verified && <>
      <Pill ready={ready}>{ready ? t('food.merchant.payouts.payoutsEnabled', 'Payouts enabled') : connected ? t('food.merchant.payouts.onboardingIncomplete', 'Onboarding incomplete') : t('food.merchant.payouts.notConnected', 'Not connected')}</Pill>
      {connected && <ul className="fd-payout-status-grid">{[['stripe_connect_onboarded', 'identitySetup'], ['stripe_connect_ready', 'cardPayments'], ['stripe_connect_payouts_ready', 'bankTransfers']].map(([key, label]) => <li key={key}><span>{f(label)}</span><strong>{f(status[key] ? 'ready' : 'needsSetup')}</strong></li>)}</ul>}
      {(!connected || needsAttention) ? <div className="fd-finance-notice"><p>{f('stripeHandoff')}</p><button type="button" className="fd-btn" disabled={connecting} onClick={startOnboarding} data-track="ui.374063ed56.5">{connecting ? t('food.merchant.payouts.connecting', 'Opening Stripe…') : connected ? t('food.merchant.payouts.continueOnboarding', 'Continue onboarding') : t('food.merchant.payouts.connect', 'Connect payouts')}</button></div> : <p className="fd-card-meta">{next ? t('food.merchant.payouts.nextPayoutDetail', '{{amount}} arriving {{date}}', {amount: formatFoodMoney(next.amount, (next.currency || 'USD').toUpperCase()), date: arrival && !Number.isNaN(arrival.getTime()) ? arrival.toLocaleDateString(i18n.language) : '—'}) : t('food.merchant.payouts.noScheduledPayout', 'No payout scheduled yet.')}</p>}
      <button type="button" className="fd-btn fd-btn-secondary" onClick={load} data-track="ui.374063ed56.6">{t('food.merchant.payouts.refresh', 'Refresh status')}</button>
      {connected && <details className="fd-finance-advanced"><summary>{f('accountControls')}</summary><p className="fd-card-meta">{t('food.merchant.payouts.disconnectConfirm', 'Disconnect payouts for this restaurant? Future payouts will stop until you reconnect.')}</p><button type="button" className="fd-btn fd-btn-danger" disabled={disconnecting} onClick={disconnect} data-track="ui.374063ed56.7">{disconnecting ? t('food.merchant.payouts.disconnecting', 'Disconnecting…') : t('food.merchant.payouts.disconnect', 'Disconnect payouts')}</button></details>}
    </>}
  </div>;
}

export function RestaurantWalletPayoutsPanel({ restaurantId }) {
  const { t } = useTranslation();
  const { t: financeT } = useTranslation('common');
  return <WalletPayoutsSection key={restaurantId} restaurantId={restaurantId} t={t} f={(key, options) => financeT(`merchantFinance.${key}`, options)} />;
}
