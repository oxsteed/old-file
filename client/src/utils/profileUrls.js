// Canonical public profile URLs, vanity-slug aware.
// Helper profiles resolve to the main profile page (/helpers/:id), using the
// vanity slug when one is claimed.

export function helperProfilePath({ id, profileSlug, slug } = {}) {
  const resolved = profileSlug || slug;
  if (resolved) return `/helpers/${resolved}`;
  return `/helpers/${id}`;
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
