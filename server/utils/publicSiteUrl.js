/**
 * Canonical public origin for SEO (og:url, canonical, sitemap, JSON-LD).
 * Prefer APP_URL (server) then CLIENT_URL; strip trailing slashes.
 */
function getPublicSiteUrl() {
  const raw = (process.env.APP_URL || process.env.CLIENT_URL || 'https://oxsteed.com').trim();
  if (!raw) return 'https://oxsteed.com';
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'https://oxsteed.com';
  }
}

function absoluteUrl(pathOrUrl) {
  const base = getPublicSiteUrl();
  if (!pathOrUrl) return base;
  const s = String(pathOrUrl).trim();
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  const path = s.startsWith('/') ? s : `/${s}`;
  return `${base}${path}`;
}

module.exports = { getPublicSiteUrl, absoluteUrl };
