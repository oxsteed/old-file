// Shared OxSteed Food UI bits. The logo is the same OxSteed mark used in the
// main navbar - the Food experience reuses the brand identity by design.
import React from 'react';
import { useTranslation } from 'react-i18next';

export function FoodLogo({ size = 32 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="512" height="512" rx="88" fill="#16213e" />
      <path d="M 40 285 A 218 218 0 0 1 173 55 L 211 26 A 178 178 0 0 0 80 279 Z" fill="#F97316" />
      <path d="M 228 40 A 218 218 0 0 1 457 173 L 486 211 A 178 178 0 0 0 233 80 Z" fill="#F97316" />
      <path d="M 472 228 A 218 218 0 0 1 339 457 L 301 486 A 178 178 0 0 0 433 233 Z" fill="#F97316" />
      <path d="M 284 472 A 218 218 0 0 1 55 339 L 26 301 A 178 178 0 0 0 279 433 Z" fill="#F97316" />
      <circle cx="256" cy="256" r="145" fill="#F97316" />
      <text x="256" y="236" textAnchor="middle" dominantBaseline="middle" fontFamily="Arial Black, Arial, Helvetica, system-ui, sans-serif" fontWeight="900" fontSize="90" fill="#FFFFFF">OxS</text>
      <polyline points="131,305 172,305 184,295 194,268 204,326 214,297 224,305 381,305" fill="none" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function FoodBrand({ size = 32, label }) {
  const { t } = useTranslation();
  const resolvedLabel = label || t('nav.localFoodDirectory', { defaultValue: 'Local Food Directory' });
  return (
    <span className="fd-brand-badge">
      <FoodLogo size={size} />
      <span className="fd-brand-food">{resolvedLabel}</span>
    </span>
  );
}

// food_orders.status -> i18n suffix (avoids raw DB strings in the UI).
export const FOOD_STATUS_KEYS = {
  received: 'food.status.received',
  accepted: 'food.status.accepted',
  preparing: 'food.status.preparing',
  ready: 'food.status.ready',
  completed: 'food.status.completed',
  cancelled: 'food.status.cancelled',
  refunded: 'food.status.refunded',
};

// Shared API error extractor (was copy-pasted across the food pages).
export function apiErrorMessage(err, fallback) {
  const message = err?.response?.data?.error?.message
    || err?.response?.data?.message
    || err?.response?.data?.error;
  return typeof message === 'string' ? message : fallback;
}

// Connection-state pill for operational screens (KDS, queue board, merchant
// live orders). Staff should never stare at a silently-stale board.
export function FoodConnBadge({ ok, okLabel = 'LIVE', badLabel = 'RECONNECTING…' }) {
  return (
    <span
      role="status"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.06em',
        background: ok ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
        color: ok ? '#4ade80' : '#f87171',
        border: `1px solid ${ok ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`,
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 7, height: 7, borderRadius: '50%', background: ok ? '#22c55e' : '#ef4444' }}
      />
      {ok ? okLabel : badLabel}
    </span>
  );
}

// Elapsed-minute urgency tier for kitchen tickets (mirrors the iOS KDS
// FoodUrgency helper): on-time -> watch (amber) -> late (red).
export function foodTicketUrgency(createdAt, { warnAfterMin = 10, lateAfterMin = 20 } = {}) {
  const elapsedMin = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
  if (elapsedMin >= lateAfterMin) return { tier: 'late', elapsedMin, color: '#ef4444' };
  if (elapsedMin >= warnAfterMin) return { tier: 'watch', elapsedMin, color: '#f59e0b' };
  return { tier: 'ontime', elapsedMin, color: null };
}
