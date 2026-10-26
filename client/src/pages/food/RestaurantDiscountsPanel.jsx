// F-15: the restaurant's own POS discounts. There are no platform-wide
// discount codes; staff without POS manage rights can apply only the active
// discounts listed here. Discounts marked "needs manager approval", or above
// the owner's approval threshold, ask for a manager PIN at the register.
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { formatFoodMoney } from '../../api/food';
import { apiErrorMessage } from './foodShared';

const EMPTY = { code: '', name: '', kind: 'percent', value: '', maxDiscount: '', minSubtotal: '', requiresApproval: false };

function toCents(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

export default function RestaurantDiscountsPanel({ t, restaurant }) {
  const restaurantId = restaurant?.id;
  const currency = restaurant?.currency_code || 'USD';
  const isOwner = restaurant?.effective_role === 'owner';
  const [definitions, setDefinitions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const initialThreshold = restaurant?.settings?.posApprovalPolicy?.discountAboveCents;
  const [threshold, setThreshold] = useState(
    initialThreshold === null || initialThreshold === undefined ? '' : String(Number(initialThreshold) / 100)
  );
  const [savingThreshold, setSavingThreshold] = useState(false);

  const load = useCallback(() => {
    if (!restaurantId) return;
    setLoading(true);
    api.get(`/restaurants/${restaurantId}/pos/discount-definitions`)
      .then((r) => setDefinitions(Array.isArray(r.data?.discountDefinitions) ? r.data.discountDefinitions : []))
      .catch(() => setDefinitions([]))
      .finally(() => setLoading(false));
  }, [restaurantId]);

  useEffect(() => { load(); }, [load]);

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const value = form.kind === 'percent' ? Math.round(Number(form.value)) : toCents(form.value);
    const maxDiscountCents = toCents(form.maxDiscount);
    const minSubtotalCents = toCents(form.minSubtotal);
    if (!form.code.trim() || !form.name.trim() || !Number.isFinite(value) || value < 1
      || Number.isNaN(maxDiscountCents) || Number.isNaN(minSubtotalCents)) {
      toast.error(t('restaurantDiscounts.invalid'));
      return;
    }
    setSaving(true);
    try {
      await api.post(`/restaurants/${restaurantId}/pos/discount-definitions`, {
        code: form.code.trim(),
        name: form.name.trim(),
        kind: form.kind,
        value,
        max_discount_cents: maxDiscountCents,
        min_subtotal_cents: minSubtotalCents ?? 0,
        requires_approval: form.requiresApproval,
      });
      setForm(EMPTY);
      toast.success(t('restaurantDiscounts.saved'));
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurantDiscounts.saveError')));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (definition) => {
    try {
      await api.patch(`/restaurants/${restaurantId}/pos/discount-definitions/${definition.id}`, {
        is_active: !definition.is_active,
      });
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurantDiscounts.saveError')));
    }
  };

  const saveThreshold = async () => {
    const cents = toCents(threshold);
    if (Number.isNaN(cents)) {
      toast.error(t('restaurantDiscounts.invalid'));
      return;
    }
    setSavingThreshold(true);
    try {
      await api.patch(`/restaurants/${restaurantId}/publishing`, {
        settings: { posApprovalPolicy: { discountAboveCents: cents } },
      });
      toast.success(t('restaurantDiscounts.saved'));
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurantDiscounts.saveError')));
    } finally {
      setSavingThreshold(false);
    }
  };

  const describe = (d) => (d.kind === 'percent'
    ? t('restaurantDiscounts.percentValue', { value: d.value })
    : formatFoodMoney(d.value, currency));

  return (
    <div className="fd-discounts-panel">
      <p className="fd-card-meta">{t('restaurantDiscounts.intro')}</p>

      {loading ? (
        <p className="fd-card-meta" role="status">{t('food.common.loading')}</p>
      ) : definitions.length === 0 ? (
        <p className="fd-card-meta">{t('restaurantDiscounts.empty')}</p>
      ) : (
        <ul className="fd-list" aria-label={t('restaurantDiscounts.listLabel')}>
          {definitions.map((d) => (
            <li key={d.id} className="fd-list-row" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{d.name}</strong> <bdi dir="ltr">({d.code})</bdi> · {describe(d)}
                {d.max_discount_cents != null && <> · {t('restaurantDiscounts.maxShort', { amount: formatFoodMoney(d.max_discount_cents, currency) })}</>}
                {d.min_subtotal_cents > 0 && <> · {t('restaurantDiscounts.minShort', { amount: formatFoodMoney(d.min_subtotal_cents, currency) })}</>}
                {d.requires_approval && <> · {t('restaurantDiscounts.needsApproval')}</>}
                {!d.is_active && <> · <em>{t('restaurantDiscounts.inactive')}</em></>}
              </span>
              <button
                type="button"
                className="fd-btn fd-btn-secondary fd-btn-sm"
                onClick={() => toggleActive(d)}
                data-track="restaurant_discount_toggle_active"
              >
                {d.is_active ? t('restaurantDiscounts.deactivate') : t('restaurantDiscounts.activate')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="fd-discount-form" aria-label={t('restaurantDiscounts.addTitle')}>
        <h4>{t('restaurantDiscounts.addTitle')}</h4>
        <div className="fd-row">
          <div className="fd-field" style={{ flex: 1 }}>
            <label htmlFor="fd-disc-code">{t('restaurantDiscounts.code')}</label>
            <input id="fd-disc-code" dir="ltr" value={form.code} onChange={set('code')} maxLength={80} required pattern="[A-Za-z0-9][A-Za-z0-9_\-]*" />
          </div>
          <div className="fd-field" style={{ flex: 2 }}>
            <label htmlFor="fd-disc-name">{t('restaurantDiscounts.name')}</label>
            <input id="fd-disc-name" value={form.name} onChange={set('name')} maxLength={160} required />
          </div>
        </div>
        <div className="fd-row">
          <div className="fd-field" style={{ flex: 1 }}>
            <label htmlFor="fd-disc-kind">{t('restaurantDiscounts.kind')}</label>
            <select id="fd-disc-kind" value={form.kind} onChange={set('kind')}>
              <option value="percent">{t('restaurantDiscounts.kindPercent')}</option>
              <option value="fixed">{t('restaurantDiscounts.kindFixed')}</option>
            </select>
          </div>
          <div className="fd-field" style={{ flex: 1 }}>
            <label htmlFor="fd-disc-value">{form.kind === 'percent' ? t('restaurantDiscounts.valuePercent') : t('restaurantDiscounts.valueAmount')}</label>
            <input id="fd-disc-value" inputMode="decimal" value={form.value} onChange={set('value')} required />
          </div>
          <div className="fd-field" style={{ flex: 1 }}>
            <label htmlFor="fd-disc-max">{t('restaurantDiscounts.maxDiscount')}</label>
            <input id="fd-disc-max" inputMode="decimal" value={form.maxDiscount} onChange={set('maxDiscount')} />
          </div>
          <div className="fd-field" style={{ flex: 1 }}>
            <label htmlFor="fd-disc-min">{t('restaurantDiscounts.minSubtotal')}</label>
            <input id="fd-disc-min" inputMode="decimal" value={form.minSubtotal} onChange={set('minSubtotal')} />
          </div>
        </div>
        <label className="fd-check" htmlFor="fd-disc-approval">
          <input id="fd-disc-approval" type="checkbox" checked={form.requiresApproval} onChange={set('requiresApproval')} />
          {' '}{t('restaurantDiscounts.requiresApproval')}
        </label>
        <button type="submit" className="fd-btn" disabled={saving} data-track="restaurant_discount_create">
          {saving ? t('food.common.saving') : t('restaurantDiscounts.add')}
        </button>
      </form>

      <div className="fd-field" style={{ marginTop: 16 }}>
        <label htmlFor="fd-disc-threshold">{t('restaurantDiscounts.thresholdLabel')}</label>
        <p className="fd-card-meta">{isOwner ? t('restaurantDiscounts.thresholdHint') : t('restaurantDiscounts.thresholdOwnerOnly')}</p>
        <div className="fd-row" style={{ alignItems: 'flex-end' }}>
          <input
            id="fd-disc-threshold"
            inputMode="decimal"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            disabled={!isOwner}
            placeholder={t('restaurantDiscounts.thresholdNone')}
          />
          {isOwner && (
            <button
              type="button"
              className="fd-btn fd-btn-secondary fd-btn-sm"
              onClick={saveThreshold}
              disabled={savingThreshold}
              data-track="restaurant_discount_threshold_save"
            >
              {savingThreshold ? t('food.common.saving') : t('restaurantDiscounts.saveThreshold')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
