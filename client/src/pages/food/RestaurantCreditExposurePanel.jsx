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

// Phase 5: trial-tier credit cap + FIFO derisking. Trial-tier restaurants
// (no Phase 4 reserve row) are capped at cap_cents of outstanding customer
// credit. When exposure hits the cap, new credit requests are blocked until
// the merchant derisks the oldest balances first (FIFO) by migrating them
// to OxSteed Credit.
export default function RestaurantCreditExposurePanel({ restaurant }) {
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
      toast.error(apiErrorMessage(error, 'Unable to load credit exposure.'));
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => { load(); }, [load]);

  const submitDerisk = async () => {
    const cents = parseCreditMajorAmount(deriskAmount, currency) || 0;
    if (!cents || cents <= 0) {
      toast.error('Enter a derisk amount greater than zero.');
      return;
    }
    setDeriskWorking(true);
    try {
      const result = await deriskMerchantCredit(restaurantId, { target_cents: cents });
      const migrated = Number(result?.derisked_cents || 0);
      const skippedCount = Array.isArray(result?.skipped) ? result.skipped.length : 0;
      if (migrated > 0) {
        toast.success(
          `Derisked ${formatFoodMoney(migrated, currency)} to OxSteed Credit across ${(result?.migrations || []).length} customer(s).` +
          (skippedCount > 0 ? ` ${skippedCount} skipped.` : '')
        );
      } else {
        toast.error(
          skippedCount > 0
            ? `No balances could be derisked (${skippedCount} skipped).`
            : 'No balances available to derisk.'
        );
      }
      setDeriskAmount('');
      setDeriskConfirming(false);
      setDeriskOpen(false);
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Unable to derisk credit.'));
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
    <section className="fd-section" aria-label="Credit exposure">
      <div className="fd-credit-manager-head" style={{ marginBottom: '0.75rem' }}>
        <div>
          <p className="fd-credit-manager-kicker">Credit exposure</p>
          <p className="fd-card-meta">
            Trial-tier cap on outstanding customer credit. When exposure reaches the cap,
            new credit requests are blocked until you derisk the oldest balances first.
          </p>
        </div>
        {trialCapApplies && (
          <button type="button" className="fd-btn fd-btn-sm" onClick={() => { setDeriskOpen((v) => !v); setDeriskConfirming(false); }} data-track-private>
            {deriskOpen ? 'Close' : 'Derisk'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="fd-empty">Loading credit exposure…</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            <div className="fd-card" style={{ flex: '1 1 160px', padding: '0.85rem 1rem' }}>
              <p className="fd-card-meta">Outstanding exposure</p>
              <strong style={{ fontSize: '1.35rem' }}>{formatFoodMoney(outstanding, currency)}</strong>
            </div>
            <div className="fd-card" style={{ flex: '1 1 160px', padding: '0.85rem 1rem' }}>
              <p className="fd-card-meta">Trial cap</p>
              <strong style={{ fontSize: '1.35rem' }}>{trialCapApplies ? formatFoodMoney(cap, currency) : '—'}</strong>
            </div>
            <div className="fd-card" style={{ flex: '1 1 160px', padding: '0.85rem 1rem' }}>
              <p className="fd-card-meta">Status</p>
              <strong style={{ fontSize: '1.1rem', color: !trialCapApplies ? '#64748b' : atCapacity ? '#b42318' : '#15803d' }}>
                {!trialCapApplies ? 'Reserve enrolled' : atCapacity ? 'At capacity' : 'Within cap'}
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
                {formatFoodMoney(outstanding, currency)} of {formatFoodMoney(cap, currency)} ({meterPct}%)
                {atCapacity && ' — new credit requests are blocked until exposure drops below the cap.'}
              </p>
            </div>
          ) : (
            <p className="fd-card-meta" style={{ marginBottom: '1rem' }}>
              This restaurant is enrolled in the pre-purchase credit reserve: issuance is capped
              at the reserve balance, so the trial cap does not apply.
            </p>
          )}

          {deriskOpen && trialCapApplies && (
            <div className="fd-credit-grant-form" style={{ marginBottom: '1rem' }}>
              <strong>Derisk oldest balances (FIFO)</strong>
              <p className="fd-card-meta">
                Migrates the oldest customer balances to OxSteed Credit until the target is covered.
                Each customer is made whole in OxSteed Credit before their restaurant balance is zeroed;
                held funds and non-USD balances are left untouched.
              </p>
              <label>Target amount ({currency})
                <input inputMode="decimal" value={deriskAmount} onChange={(event) => { setDeriskAmount(event.target.value); setDeriskConfirming(false); }} placeholder="0.00" />
              </label>
              {deriskConfirming ? (
                <div className="fd-credit-confirm-row">
                  <strong>Derisk {formatFoodMoney(deriskCents, currency)} of oldest balances?</strong>
                  <button type="button" className="fd-btn fd-btn-sm" disabled={deriskWorking || deriskCents <= 0} onClick={submitDerisk} data-track-private>
                    {deriskWorking ? 'Derisking…' : 'Yes, derisk'}
                  </button>
                  <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setDeriskConfirming(false)} data-track-private>Cancel</button>
                </div>
              ) : (
                <div>
                  <button type="button" className="fd-btn fd-btn-sm" disabled={deriskCents <= 0} onClick={() => setDeriskConfirming(true)} data-track-private>
                    Review derisk
                  </button>
                </div>
              )}
            </div>
          )}

          <p className="fd-section-label">Oldest balances (FIFO queue)</p>
          {queue.length === 0 ? (
            <div className="fd-empty">No outstanding customer balances.</div>
          ) : (
            <div className="fd-credit-request-list">
              {queue.map((entry) => (
                <article key={entry.customer_id} className="fd-credit-request-card">
                  <div className="fd-credit-request-main">
                    <div>
                      <strong>{entry.customer_name || 'OxSteed customer'}</strong>
                      <span>{entry.customer_email || 'Customer account'} · oldest activity {formatCreditDateTime(entry.oldest_activity_at, 'Recently')}</span>
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
