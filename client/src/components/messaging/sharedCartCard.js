/**
 * Formatting helpers for the shared-cart message card.
 * Kept DOM-free so they can be unit tested with node --test.
 */

export function formatSharedCartTotal(totalCents, currency) {
  const amount = (Number(totalCents) || 0) / 100;
  const code = /^[A-Za-z]{3}$/.test(String(currency || ''))
    ? String(currency).toUpperCase()
    : 'USD';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export function sharedCartHref(att) {
  const token = att && att.share_token ? String(att.share_token) : '';
  if (token) return `/shared-cart/${token}`;
  const url = String((att && att.url) || '');
  const match = url.match(/\/shared-cart\/([A-Za-z0-9_-]+)/);
  if (match) return `/shared-cart/${match[1]}`;
  return url;
}

export function sharedCartCardData(att, cardItemsTemplate) {
  const count = Number((att && att.item_count) || 0);
  return {
    name: (att && att.cart_name) || '',
    items: String(cardItemsTemplate || '').replace('{{count}}', String(count)),
    total: formatSharedCartTotal(att && att.total_cents, att && att.currency),
    href: sharedCartHref(att),
  };
}
