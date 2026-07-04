// Merchant coupon / promotion management (B5).
import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  createFoodPromotion,
  formatFoodMoney,
  listMerchantFoodPromotions,
  updateFoodPromotion,
} from '../../api/food';
import { apiErrorMessage } from './foodShared';

function discountLabel(promo) {
  if (promo.discount_percent != null) return `${promo.discount_percent}% off`;
  if (promo.discount_cents != null) return `${formatFoodMoney(promo.discount_cents)} off`;
  return '—';
}

export default function PromotionsPanel({ t, restaurant }) {
  const [promotions, setPromotions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: '',
    title: '',
    description: '',
    discountType: 'percent',
    discountPercent: '10',
    discountCents: '',
    minSubtotalCents: '0',
    validUntil: '',
    maxUses: '',
  });

  const load = useCallback(() => {
    listMerchantFoodPromotions(restaurant.id).then(setPromotions).catch(() => setPromotions([]));
  }, [restaurant.id]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.code.trim() || !form.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim(),
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        minSubtotalCents: Number(form.minSubtotalCents) || 0,
        validUntil: form.validUntil || undefined,
        maxUses: form.maxUses !== '' ? Number(form.maxUses) : undefined,
      };
      if (form.discountType === 'percent') {
        payload.discountPercent = Number(form.discountPercent) || 0;
      } else {
        payload.discountCents = Math.round(Number(form.discountCents || 0) * 100);
      }
      await createFoodPromotion(restaurant.id, payload);
      toast.success(t('food.merchant.promoCreated', 'Promotion created'));
      setForm({
        code: '',
        title: '',
        description: '',
        discountType: 'percent',
        discountPercent: '10',
        discountCents: '',
        minSubtotalCents: '0',
        validUntil: '',
        maxUses: '',
      });
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.promoError', 'Could not create promotion')));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (promo) => {
    setSaving(true);
    try {
      await updateFoodPromotion(restaurant.id, promo.id, { isActive: !promo.is_active });
      toast.success(t('food.common.saved'));
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.promoError', 'Could not update promotion')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h3>{t('food.merchant.promotionsTitle', 'Coupons & promotions')}</h3>
      <p className="fd-card-meta">
        {t('food.merchant.promotionsHint', 'Create codes customers enter at checkout on mobile, kiosk, or POS.')}
      </p>

      {promotions.length > 0 && (
        <ul className="fd-setup-steps">
          {promotions.map((promo) => (
            <li key={promo.id} className={`fd-setup-step ${promo.is_active ? 'fd-complete' : ''}`}>
              <span>
                <strong>{promo.code}</strong>
                {' — '}
                {promo.title}
                {' · '}
                {discountLabel(promo)}
                {promo.use_count > 0 && ` · ${promo.use_count} uses`}
                {!promo.is_active && ` · ${t('food.merchant.promoInactive', 'inactive')}`}
              </span>
              <button
                type="button"
                className="fd-btn fd-btn-sm fd-btn-secondary"
                disabled={saving}
                onClick={() => toggleActive(promo)}
              >
                {promo.is_active
                  ? t('food.merchant.deactivatePromo', 'Deactivate')
                  : t('food.merchant.activatePromo', 'Activate')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="fd-row" style={{ flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.75rem' }}>
        <div className="fd-field" style={{ flex: '1 1 100px' }}>
          <label htmlFor="fd-promo-code">{t('food.merchant.promoCode', 'Code')} *</label>
          <input
            id="fd-promo-code"
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
            placeholder="SUMMER10"
            required
          />
        </div>
        <div className="fd-field" style={{ flex: '1 1 160px' }}>
          <label htmlFor="fd-promo-title">{t('food.merchant.promoTitle', 'Title')} *</label>
          <input
            id="fd-promo-title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
          />
        </div>
        <div className="fd-field" style={{ flex: '0 1 120px' }}>
          <label htmlFor="fd-promo-type">{t('food.merchant.promoType', 'Discount')}</label>
          <select
            id="fd-promo-type"
            value={form.discountType}
            onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value }))}
          >
            <option value="percent">{t('food.merchant.promoPercent', 'Percent')}</option>
            <option value="fixed">{t('food.merchant.promoFixed', 'Fixed amount')}</option>
          </select>
        </div>
        {form.discountType === 'percent' ? (
          <div className="fd-field" style={{ flex: '0 1 80px' }}>
            <label htmlFor="fd-promo-pct">%</label>
            <input
              id="fd-promo-pct"
              type="number"
              min={1}
              max={100}
              value={form.discountPercent}
              onChange={(e) => setForm((f) => ({ ...f, discountPercent: e.target.value }))}
            />
          </div>
        ) : (
          <div className="fd-field" style={{ flex: '0 1 100px' }}>
            <label htmlFor="fd-promo-amt">{t('food.merchant.promoAmount', 'Amount ($)')}</label>
            <input
              id="fd-promo-amt"
              type="number"
              min={0}
              step={0.01}
              value={form.discountCents}
              onChange={(e) => setForm((f) => ({ ...f, discountCents: e.target.value }))}
            />
          </div>
        )}
        <div className="fd-field" style={{ flex: '0 1 100px' }}>
          <label htmlFor="fd-promo-min">{t('food.merchant.promoMinSubtotal', 'Min subtotal (¢)')}</label>
          <input
            id="fd-promo-min"
            type="number"
            min={0}
            value={form.minSubtotalCents}
            onChange={(e) => setForm((f) => ({ ...f, minSubtotalCents: e.target.value }))}
          />
        </div>
        <div className="fd-field" style={{ flex: '0 1 130px' }}>
          <label htmlFor="fd-promo-until">{t('food.merchant.promoValidUntil', 'Valid until')}</label>
          <input
            id="fd-promo-until"
            type="date"
            value={form.validUntil}
            onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
          />
        </div>
        <button type="submit" className="fd-btn fd-btn-sm" disabled={saving} style={{ alignSelf: 'flex-end' }}>
          {saving ? t('food.common.saving') : t('food.merchant.addPromo', 'Add promotion')}
        </button>
      </form>
    </div>
  );
}
