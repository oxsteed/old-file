/** Published English end-user guides. Shared by pages, contextual help and PDF generation. */

import { validateGuide, validateHandbook } from './model.js';
import { GUIDES, GUIDES_BY_ID, AREAS } from './guides/index.js';
export { GUIDES, GUIDES_BY_ID, AREAS };
export function getArea(slug) { return AREAS.find(area => area.slug === slug) || null; }
export const HANDBOOKS = ['customer','helper','business','restaurant','logistics'].map(role => ({
  role, title: `${role.charAt(0).toUpperCase()+role.slice(1)} handbook`,
  guideIds: GUIDES.filter(guide => guide.audiences.includes(role)).map(guide => guide.id),
}));

export function suggestedAudience(user) {
  const mode = user?.default_mode || user?.role || '';
  if (mode.includes('restaurant')) return 'restaurant';
  if (mode.includes('business')) return 'business';
  if (mode.includes('logistics')) return 'logistics';
  if (['helper','helper_pro','broker'].includes(mode)) return 'helper';
  return mode === 'customer' ? 'customer' : null;
}

export function getHandbook(role) {
  return HANDBOOKS.find((handbook) => handbook.role === role) || null;
}

// ---------------------------------------------------------------------------
// Registry access
// ---------------------------------------------------------------------------

export function getGuideById(id) {
  return GUIDES_BY_ID[id] || null;
}

export function getGuide(area, slug) {
  return GUIDES.find((guide) => guide.area === area && guide.slug === slug) || null;
}

export function getGuidesByArea(area) {
  return GUIDES.filter((guide) => guide.area === area);
}

export function guideUrl(guide) {
  return `/how-it-works/${guide.area}/${guide.slug}`;
}

export function handbookUrl(role) {
  return `/how-it-works/handbooks/${role}`;
}

/**
 * Keyword search across guide titles, goals, areas, steps, and recovery text.
 * Matching is case-insensitive; every query token must match somewhere.
 */
export function searchGuides(query, { audience = null, area = null } = {}) {
  const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return GUIDES.filter((guide) => {
    if (audience && !guide.audiences.includes(audience)) return false;
    if (area && guide.area !== area) return false;
    if (tokens.length === 0) return true;
    const haystack = [
      guide.title,
      guide.goal,
      guide.area,
      ...guide.audiences,
      ...guide.steps.map((step) => `${step.title} ${step.body} ${step.expectedResult}`),
      ...guide.recovery.map((entry) => `${entry.problem} ${entry.solution}`),
    ]
      .join(' ')
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

// ---------------------------------------------------------------------------
// Contextual route mapping
// ---------------------------------------------------------------------------

/**
 * Resolve real documented route patterns, including workspace and dashboard aliases.
 * Guides suggest the current audience without changing account mode.
 */
function routePattern(href) {
  if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return null;
  return href.split(/[?# ]/)[0].replace(/\/+$/, '') || '/';
}
function matchesRoute(pattern, pathname) {
  const a = pattern.split('/'); const b = pathname.split('/');
  return a.length === b.length && a.every((part,index) => part.startsWith(':') || part === b[index]);
}
export function guidesForRoute(pathname, user) {
  const requested = routePattern(pathname);
  const normalized = requested === '/helper-dashboard' ? '/dashboard' : requested?.replace(/^\/business\/[^/]+\/workspace(?:\/[^/]+)?$/, '/business-hub');
  if (!normalized || /^\/(how-it-works|admin|investor|impersonate)(\/|$)/.test(normalized)
    || normalized.startsWith('/support/agent') || normalized.startsWith('/logistics/operations')) return [];
  const audience = suggestedAudience(user);
  const matches = GUIDES.filter(guide => {
    const paths = [...(guide.siteLinks || []).map(link => link.href),
      ...(guide.sources || []).filter(source => source.type === 'route').map(source => source.ref),
      ...guide.steps.flatMap(step => step.screenshots.map(shot => shot.screen))];
    return paths.some(href => {const pattern = routePattern(href); return pattern && matchesRoute(pattern, normalized);});
  });
  const relevance = guide => guide.steps.filter(step=>step.screenshots.some(shot=>{const pattern=routePattern(shot.screen);return pattern&&matchesRoute(pattern,normalized);})).length;
  return matches.sort((a,b) => relevance(b)-relevance(a) || Number(!!audience && b.audiences.includes(audience))-Number(!!audience && a.audiences.includes(audience)) || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------------
// Registry self-check
// ---------------------------------------------------------------------------

/**
 * Validate the whole registry: every guide against the model and every
 * handbook record. Returns { guides: [...errors], handbooks: [...errors] }.
 */
export function validateRegistry() {
  const guideErrors = [];
  for (const guide of GUIDES) {
    for (const error of validateGuide(guide, { guides: GUIDES })) {
      guideErrors.push(error);
    }
  }
  const handbookErrors = [];
  for (const handbook of HANDBOOKS) {
    for (const error of validateHandbook(handbook)) {
      handbookErrors.push(error);
    }
  }
  return { guides: guideErrors, handbooks: handbookErrors };
}
