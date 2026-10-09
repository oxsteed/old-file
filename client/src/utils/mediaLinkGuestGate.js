const VIEW_CTAS = new Set(['view']);

export function mediaLinkRequiresLogin(link) {
  if (!link?.available || !link?.canonical_url) return false;
  const cta = String(link.cta || '').trim().toLowerCase();
  return !VIEW_CTAS.has(cta);
}
