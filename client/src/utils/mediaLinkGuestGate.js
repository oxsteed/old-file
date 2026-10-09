const TRANSACTIONAL_CTAS = new Set(['order', 'book', 'pay', 'rent', 'apply']);

export function mediaLinkRequiresLogin(link) {
  if (!link?.available || !link?.canonical_url) return false;
  const cta = String(link.cta || '').trim().toLowerCase();
  return TRANSACTIONAL_CTAS.has(cta);
}
