// Shared OxSteed Food UI bits. The logo is the same OxSteed mark used in the
// main navbar - the Food experience reuses the brand identity by design.
import React from 'react';

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

export function FoodBrand({ size = 32, label = 'Restaurants' }) {
  return (
    <span className="fd-brand-badge">
      <FoodLogo size={size} />
      <span>
        OxSteed <span className="fd-brand-food">{label}</span>
      </span>
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
