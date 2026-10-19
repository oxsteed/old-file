import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Checkout promo code input (decision 2). Codes are validated and redeemed
 * server-side; this shows the quoted discount or the server's promo_* error.
 */
export default function PromoCodeField({
  value, onChange, error = null, discountCents = 0, formatMoney, labelStyle, hintStyle, inputStyle,
}) {
  const { t } = useTranslation();
  const hasDiscount = !error && Number(discountCents) > 0 && String(value || '').trim().length > 0;
  const statusId = error ? 'food-promo-error' : hasDiscount ? 'food-promo-applied' : undefined;
  return (
    <div className="food-promo-field">
      <label htmlFor="food-promo-code" style={labelStyle}>
        {t('food.restaurant.promoCode')}{' '}
        <span style={hintStyle}>({t('food.restaurant.optional')})</span>
      </label>
      <input
        id="food-promo-code"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder={t('food.restaurant.promoPlaceholder')}
        maxLength={40}
        dir="ltr"
        autoComplete="off"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={statusId}
        style={{ ...inputStyle, marginBottom: statusId ? 6 : 20, textTransform: 'uppercase' }}
      />
      {error && (
        <p id="food-promo-error" role="alert" data-testid="food-promo-error"
          style={{ color: '#b91c1c', fontSize: 13, margin: '0 0 20px', overflowWrap: 'anywhere' }}>
          {t(`food.restaurant.promoErrors.${error}`, { defaultValue: t('food.restaurant.promoErrors.generic') })}
        </p>
      )}
      {hasDiscount && (
        <p id="food-promo-applied" role="status" data-testid="food-promo-applied"
          style={{ color: '#15803d', fontSize: 13, fontWeight: 600, margin: '0 0 20px', overflowWrap: 'anywhere' }}>
          {t('food.restaurant.promoApplied', { amount: formatMoney ? formatMoney(discountCents) : String(discountCents) })}
        </p>
      )}
    </div>
  );
}
