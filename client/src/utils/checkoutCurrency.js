/**
 * checkoutCurrency.js — which currency a checkout renders in.
 *
 * The PaymentIntent total is authoritative, so its currency wins when
 * present; the cart session currency is next; USD is the fallback for
 * carts that carry no currency (carts are USD-only today). Amounts render
 * through the shared formatMoney so a non-USD intent shows its own
 * currency instead of a hardcoded "$".
 */
import { normalizeCurrency, DEFAULT_CURRENCY } from '../shared/money.js';

export function resolveCheckoutCurrency({ intent, session } = {}) {
  return (
    normalizeCurrency(intent?.currency) ||
    normalizeCurrency(session?.currency) ||
    DEFAULT_CURRENCY
  );
}
