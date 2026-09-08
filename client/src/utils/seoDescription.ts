/** Meta description for public profiles - keep in sync with server/utils/seoProfileDescription.js */
export function buildPublicProfileDescription(params: {
  displayName: string;
  tagline?: string;
  bio?: string;
  city?: string;
  state?: string;
  entityLabel?: 'helper' | 'business';
}): string {
  const {
    displayName,
    tagline,
    bio,
    city,
    state,
    entityLabel = 'helper',
  } = params;
  const area = [city, state].filter(Boolean).join(', ') || 'your area';
  const name = (displayName || 'This profile').trim() || 'OxSteed member';

  const t = (tagline || '').trim();
  if (t) {
    const lead = t.length > 140 ? `${t.slice(0, 137)}…` : t;
    return `${lead} - Book ${name} on OxSteed in ${area}.`.slice(0, 320);
  }

  const b = (bio || '').replace(/\s+/g, ' ').trim();
  if (b) {
    const excerpt = b.length > 130 ? `${b.slice(0, 127)}…` : b;
    return `${excerpt} - Hire ${name} (${area}) on OxSteed.`.slice(0, 320);
  }

  if (entityLabel === 'business') {
    return `${name} is a verified local business on OxSteed in ${area}. View services, reviews, and get in touch.`.slice(0, 320);
  }
  return `${name} offers local services on OxSteed in ${area}. View skills, reviews, and request a quote.`.slice(0, 320);
}

export function getPublicSiteUrl(): string {
  const v = (import.meta as ImportMeta & { env?: { VITE_PUBLIC_SITE_URL?: string } }).env
    ?.VITE_PUBLIC_SITE_URL;
  if (v && /^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      return `${u.protocol}//${u.host}`;
    } catch {
      /* fall through */
    }
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'https://oxsteed.com';
}

/** Turn a site-relative or absolute URL into an absolute URL for og:image / JSON-LD. */
export function toAbsoluteUrl(href: string | undefined | null): string {
  const base = getPublicSiteUrl();
  if (!href) return `${base}/icons/icon-512.png`;
  const s = String(href).trim();
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  const path = s.startsWith('/') ? s : `/${s}`;
  return `${base}${path}`;
}
