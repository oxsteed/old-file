import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  deriskMerchantCredit,
  formatFoodMoney,
  getMerchantCreditExposure,
} from '../../api/food';
import { apiErrorMessage } from './foodShared';
import { formatCreditDateTime } from '../../lib/creditDateTime';
import { parseCreditMajorAmount } from '../../lib/creditCurrency';
import { useTranslation } from 'react-i18next';

// Phase 5: trial-tier credit cap + FIFO derisking. Trial-tier restaurants
// (no Phase 4 reserve row) are capped at cap_cents of outstanding customer
// credit. When exposure hits the cap, new credit requests are blocked until
// the merchant derisks the oldest balances first (FIFO) by migrating them
// to OxSteed Credit.
export default function RestaurantCreditExposurePanel({ restaurant }) {
  const { t } = useTranslation();
  const restaurantId = restaurant?.id;
  const currency = restaurant?.currency_code || 'USD';
  const [exposure, setExposure] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deriskOpen, setDeriskOpen] = useState(false);
  const [deriskAmount, setDeriskAmount] = useState('');
  const [deriskConfirming, setDeriskConfirming] = useState(false);
  const [deriskWorking, setDeriskWorking] = useState(false);

  const load = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    try {
      const result = await getMerchantCreditExposure(restaurantId);
      setExposure(result || null);
    } catch (error) {
      toast.error(apiErrorMessage(error, t('food.creditCenter.exposure.loadError')));
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => { load(); }, [load]);

  const submitDerisk = async () => {
    const cents = parseCreditMajorAmount(deriskAmount, currency) || 0;
    if (!cents || cents <= 0) {
      toast.error(t('food.creditCenter.exposure.deriskAmountError'));
      return;
    }
    setDeriskWorking(true);
    try {
      const result = await deriskMerchantCredit(restaurantId, { target_cents: cents });
      const migrated = Number(result?.derisked_cents || 0);
      const skippedCount = Array.isArray(result?.skipped) ? result.skipped.length : 0;
      if (migrated > 0) {
        toast.success(
          skippedCount > 0
            ? t('food.creditCenter.exposure.deriskSuccessSkipped', { amount: formatFoodMoney(migrated, currency), count: (result?.migrations || []).length, skipped: skippedCount })
            : t('food.creditCenter.exposure.deriskSuccess', { amount: formatFoodMoney(migrated, currency), count: (result?.migrations || []).length })
        );
      } else {
        toast.error(
          skippedCount > 0
            ? t('food.creditCenter.exposure.deriskNoneSkipped', { count: skippedCount })
            : t('food.creditCenter.exposure.deriskNone')
        );
      }
      setDeriskAmount('');
      setDeriskConfirming(false);
      setDeriskOpen(false);
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, t('food.creditCenter.exposure.deriskError')));
    } finally {
      setDeriskWorking(false);
    }
  };

  const outstanding = Number(exposure?.outstanding_cents || 0);
  const cap = Number(exposure?.cap_cents || 0);
  const trialCapApplies = exposure?.trial_cap_applies !== false;
  const atCapacity = Boolean(exposure?.at_capacity);
  const meterPct = cap > 0 ? Math.min(100, Math.round((outstanding / cap) * 100)) : 0;
  const queue = Array.isArray(exposure?.fifo_queue) ? exposure.fifo_queue : [];
  const deriskCents = parseCreditMajorAmount(deriskAmount, currency) || 0;

  return (
    <section className="fd-section" aria-label={t('food.creditCenter.exposure.kicker')}>
      <div className="fd-credit-manager-head" style={{ marginBottom: '0.75rem' }}>
        <div>
          <p className="fd-credit-manager-kicker">{t('food.creditCenter.exposure.kicker')}</p>
          <p className="fd-card-meta">
            {t('food.creditCenter.exposure.intro')}
          </p>
        </div>
        {trialCapApplies && (
          <button type="button" className="fd-btn fd-btn-sm" onClick={() => { setDeriskOpen((v) => !v); setDeriskConfirming(false); }} data-track-private>
            {deriskOpen ? t('food.common.close') : t('food.creditCenter.exposure.derisk')}
          </button>
        )}
      </div>

      {loading ? (
        <div className="fd-empty">{t('food.creditCenter.exposure.loading')}</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            <div className="fd-card" style={{ flex: '1 1 160px', padding: '0.85rem 1rem' }}>
              <p className="fd-card-meta">{t('food.creditCenter.exposure.outstanding')}</p>
              <strong style={{ fontSize: '1.35rem' }}>{formatFoodMoney(outstanding, currency)}</strong>
            </div>
            <div className="fd-card" style={{ flex: '1 1 160px', padding: '0.85rem 1rem' }}>
              <p className="fd-card-meta">{t('food.creditCenter.exposure.trialCap')}</p>
              <strong style={{ fontSize: '1.35rem' }}>{trialCapApplies ? formatFoodMoney(cap, currency) : '—'}</strong>
            </div>
            <div className="fd-card" style={{ flex: '1 1 160px', padding: '0.85rem 1rem' }}>
              <p className="fd-card-meta">{t('food.creditCenter.exposure.status')}</p>
              <strong style={{ fontSize: '1.1rem', color: !trialCapApplies ? '#64748b' : atCapacity ? '#b42318' : '#15803d' }}>
                {!trialCapApplies ? t('food.creditCenter.exposure.statusReserveEnrolled') : atCapacity ? t('food.creditCenter.exposure.statusAtCapacity') : t('food.creditCenter.exposure.statusWithinCap')}
              </strong>
            </div>
          </div>

          {trialCapApplies ? (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ height: 10, borderRadius: 9999, background: '#f1f5f9', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${meterPct}%`,
                    borderRadius: 9999,
                    background: atCapacity ? '#b42318' : meterPct >= 80 ? '#d97706' : '#15803d',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
              <p className="fd-card-meta" style={{ marginTop: '0.35rem' }}>
                {atCapacity
                  ? t('food.creditCenter.exposure.meterBlocked', { outstanding: formatFoodMoney(outstanding, currency), cap: formatFoodMoney(cap, currency), pct: meterPct })
                  : t('food.creditCenter.exposure.meterText', { outstanding: formatFoodMoney(outstanding, currency), cap: formatFoodMoney(cap, currency), pct: meterPct })}
              </p>
            </div>
          ) : (
            <p className="fd-card-meta" style={{ marginBottom: '1rem' }}>
              {t('food.creditCenter.exposure.reserveEnrolledNote')}
            </p>
          )}

          {deriskOpen && trialCapApplies && (
            <div className="fd-credit-grant-form" style={{ marginBottom: '1rem' }}>
              <strong>{t('food.creditCenter.exposure.deriskTitle')}</strong>
              <p className="fd-card-meta">
                {t('food.creditCenter.exposure.deriskIntro')}
              </p>
              <label>{t('food.creditCenter.exposure.targetAmount', { currency })}
                <input inputMode="decimal" value={deriskAmount} onChange={(event) => { setDeriskAmount(event.target.value); setDeriskConfirming(false); }} placeholder="0.00" />
              </label>
              {deriskConfirming ? (
                <div className="fd-credit-confirm-row">
                  <strong>{t('food.creditCenter.exposure.deriskConfirm', { amount: formatFoodMoney(deriskCents, currency) })}</strong>
                  <button type="button" className="fd-btn fd-btn-sm" disabled={deriskWorking || deriskCents <= 0} onClick={submitDerisk} data-track-private>
                    {deriskWorking ? t('food.creditCenter.exposure.derisking') : t('food.creditCenter.exposure.deriskYes')}
                  </button>
                  <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setDeriskConfirming(false)} data-track-private>{t('food.common.cancel')}</button>
                </div>
              ) : (
                <div>
                  <button type="button" className="fd-btn fd-btn-sm" disabled={deriskCents <= 0} onClick={() => setDeriskConfirming(true)} data-track-private>
                    {t('food.creditCenter.exposure.deriskReview')}
                  </button>
                </div>
              )}
            </div>
          )}

          <p className="fd-section-label">{t('food.creditCenter.exposure.fifoTitle')}</p>
          {queue.length === 0 ? (
            <div className="fd-empty">{t('food.creditCenter.exposure.fifoEmpty')}</div>
          ) : (
            <div className="fd-credit-request-list">
              {queue.map((entry) => (
                <article key={entry.customer_id} className="fd-credit-request-card">
                  <div className="fd-credit-request-main">
                    <div>
                      <strong>{entry.customer_name || t('food.creditCenter.oxsteedCustomer')}</strong>
                      <span>{t('food.creditCenter.exposure.fifoMeta', { account: entry.customer_email || t('food.creditCenter.customerAccount'), date: formatCreditDateTime(entry.oldest_activity_at, t('food.creditCenter.recentFallback')) })}</span>
                    </div>
                    <strong className="fd-credit-request-amount">{formatFoodMoney(Number(entry.balance_cents || 0), currency)}</strong>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
