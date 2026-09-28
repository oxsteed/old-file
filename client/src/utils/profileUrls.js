// Canonical public profile URLs, vanity-slug aware.
// When a profile has claimed a slug, its canonical URL is the short form
// (/h/:slug, /b/:slug); otherwise it falls back to the ID-based URL.

export function helperProfilePath({ id, profileSlug, slug } = {}) {
  const resolved = profileSlug || slug;
  if (resolved) return `/h/${resolved}`;
  return `/helpers/public/${id}`;
}

export function businessProfilePath({ id, businessId, profileSlug, profile_slug, slug } = {}) {
  const resolved = profileSlug || profile_slug || slug;
  if (resolved) return `/b/${resolved}`;
  return `/businesses/public/${businessId ?? id}`;
}

export function helperProfileUrl(profile, origin) {
  const base = origin || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}${helperProfilePath(profile)}`;
}

export function businessProfileUrl(profile, origin) {
  const base = origin || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}${businessProfilePath(profile)}`;
}
