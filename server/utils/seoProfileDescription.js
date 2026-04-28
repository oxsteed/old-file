/**
 * Meta description for public helper/business profiles (server prerender + parity with client).
 * Prefers tagline/headline, then bio excerpt, then a long-tail fallback. Max ~320 chars safe for meta.
 */
function buildPublicProfileDescription({
  displayName,
  tagline,
  bio,
  city,
  state,
  entityLabel = 'helper',
}) {
  const area = [city, state].filter(Boolean).join(', ') || 'your area';
  const name = String(displayName || 'This profile').trim() || 'OxSteed member';

  const t = String(tagline || '').trim();
  if (t) {
    const lead = t.length > 140 ? `${t.slice(0, 137)}…` : t;
    return `${lead} — Book ${name} on OxSteed in ${area}.`.slice(0, 320);
  }

  const b = String(bio || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (b) {
    const excerpt = b.length > 130 ? `${b.slice(0, 127)}…` : b;
    return `${excerpt} — Hire ${name} (${area}) on OxSteed.`.slice(0, 320);
  }

  if (entityLabel === 'business') {
    return `${name} is a verified local business on OxSteed in ${area}. View services, reviews, and get in touch.`.slice(0, 320);
  }
  return `${name} offers local services on OxSteed in ${area}. View skills, reviews, and request a quote.`.slice(0, 320);
}

module.exports = { buildPublicProfileDescription };
