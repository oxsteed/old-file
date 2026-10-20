/**
 * Support chat links: show internal routes as a full site address
 * (oxsteed.com/post-job) while navigating inside the SPA.
 *
 * The model writes bare routes ("Post a Job (/post-job)") or, sometimes, full
 * https://oxsteed.com/... URLs. Both become internal links whose visible text
 * is "<host><path>" without the scheme, where <host> is the host the user is
 * actually on (staging and dev show their own host). Links to other sites
 * stay external and unchanged.
 *
 * Pure (no React, no DOM access beyond an optional window lookup) so it is
 * unit-tested with node --test.
 */

export const PRODUCTION_HOSTS = ['oxsteed.com', 'www.oxsteed.com'];

function configuredSiteUrl() {
  try {
    return import.meta.env?.VITE_PUBLIC_SITE_URL || '';
  } catch {
    return '';
  }
}

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

/** Host shown in link text: the current page host, else the configured public site, else oxsteed.com. */
export function siteHost({ location = typeof window !== 'undefined' ? window.location : undefined, siteUrl = configuredSiteUrl() } = {}) {
  const current = location?.host ? String(location.host).toLowerCase() : '';
  return current || hostOf(siteUrl) || PRODUCTION_HOSTS[0];
}

/** Hosts whose URLs are treated as in-app links. */
export function internalHosts({ host, siteUrl = configuredSiteUrl() } = {}) {
  const set = new Set(PRODUCTION_HOSTS);
  if (host) set.add(String(host).toLowerCase());
  const configured = hostOf(siteUrl);
  if (configured) set.add(configured);
  return set;
}

/** Collapse leading slashes so a path can never become protocol-relative. */
export function safeInternalPath(path) {
  const p = String(path || '/');
  return p.startsWith('/') ? `/${p.replace(/^\/+/, '')}` : `/${p}`;
}

/** Visible text for an internal route: "oxsteed.com/post-job" (host only for "/"). */
export function displayRoute(path, host) {
  const p = safeInternalPath(path);
  return p === '/' ? host : `${host}${p}`;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TRAILING_PUNCT = /[.,;:!?)\]]+$/;

function splitTrail(raw) {
  const trimmed = raw.replace(TRAILING_PUNCT, '');
  return [trimmed, raw.slice(trimmed.length)];
}

/**
 * Split plain text into text / internal / external segments.
 *   { type: 'text', text }
 *   { type: 'internal', path, display, raw }
 *   { type: 'external', href, display, raw }
 * Trailing sentence punctuation is returned as a following text segment.
 */
export function linkSegments(text, { host = siteHost(), siteUrl } = {}) {
  const src = String(text ?? '');
  const hosts = internalHosts({ host, siteUrl });
  const hostAlt = [...hosts].sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
  // 1: full http(s) URL. 2: scheme-less internal host (oxsteed.com/post-job). 3: bare route.
  const regex = new RegExp(
    `(https?:\\/\\/[^\\s<>"'\`]+)|((?:${hostAlt})(?:\\/[^\\s<>"'\`]*)?)|(\\/[A-Za-z0-9][\\w\\-./%?=&#:]*)`,
    'gi',
  );
  const out = [];
  let last = 0;
  let m;
  const pushText = (s) => {
    if (!s) return;
    const prev = out[out.length - 1];
    if (prev && prev.type === 'text') prev.text += s;
    else out.push({ type: 'text', text: s });
  };
  const pushInternal = (path, raw, trail) => {
    const p = safeInternalPath(path);
    out.push({ type: 'internal', path: p, display: displayRoute(p, host), raw });
    pushText(trail);
  };
  while ((m = regex.exec(src)) !== null) {
    const prev = m.index > 0 ? src[m.index - 1] : '';
    pushText(src.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) {
      const [trimmed, trail] = splitTrail(m[1]);
      let url = null;
      try { url = new URL(trimmed); } catch { /* not a URL */ }
      if (!url) { pushText(m[1]); continue; }
      if (hosts.has(url.host.toLowerCase())) {
        pushInternal(`${url.pathname}${url.search}${url.hash}`, trimmed, trail);
      } else {
        out.push({ type: 'external', href: trimmed, display: trimmed, raw: trimmed });
        pushText(trail);
      }
    } else if (m[2] !== undefined) {
      // Not part of an email address, a subdomain or a longer word.
      if (/[\w.@-]/.test(prev)) { pushText(m[2]); continue; }
      const [trimmed, trail] = splitTrail(m[2]);
      const slash = trimmed.indexOf('/');
      pushInternal(slash === -1 ? '/' : trimmed.slice(slash), trimmed, trail);
    } else {
      // Fraction guard: 50/50, and/or — the char before a route must not be alnum.
      if (/[A-Za-z0-9]/.test(prev)) { pushText(m[3]); continue; }
      const [trimmed, trail] = splitTrail(m[3]);
      if (!trimmed || trimmed === '/') { pushText(m[3]); continue; }
      pushInternal(trimmed, trimmed, trail);
    }
  }
  pushText(src.slice(last));
  return out;
}

/** Plain-text form (transcripts, handoff prefill): internal routes shown as host + path. */
export function displayRoutesInText(text, opts) {
  return linkSegments(text, opts).map((s) => (s.type === 'text' ? s.text : s.display)).join('');
}
