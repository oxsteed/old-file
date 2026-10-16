/**
 * guideRegistry.js - Visual SOP library guide registry.
 *
 * Data-driven by design: the coverage-audit worker's docs/sop/coverage-matrix.json
 * output slots into this registry later (areas, guide records, handbooks) without
 * touching the renderer or the pages.
 *
 * GUIDE CONTENT CONTRACT: content workers write guide data files at
 * client/src/sop/guides/<family>/<guide-id>.js (families: account, hiring,
 * helper-work, business-work, restaurants, financial, logistics, other), each a
 * default export of one guide object matching the model.js schema. The
 * coordinator provides a single contract file at client/src/sop/guides/index.js
 * exporting GUIDES (array), GUIDES_BY_ID (object keyed by guide id), and AREAS.
 * Until that file exists, the registry falls back to the local samples in
 * samples.js. The guarded import below keeps build:ci green with or without it.
 *
 * Guide BODY content is English-only. UI chrome strings live in the `sop`
 * i18n namespace.
 */

import { validateGuide, validateHandbook } from './model.js';
import { SAMPLE_AREAS, SAMPLE_GUIDES, SAMPLE_HANDBOOKS } from './samples.js';

// ---------------------------------------------------------------------------
// Content contract loading (guarded: works with or without guides/index.js)
// ---------------------------------------------------------------------------

// No top-level await: some test harnesses bundle this module to CJS, where
// top-level await is a build error. import.meta.glob is statically resolved
// by Vite (absent file yields {}); everywhere else the call throws and the
// samples below are used.
let contractModule = null;
try {
  const matched = import.meta.glob('./guides/index.js', { eager: true });
  contractModule = matched['./guides/index.js'] || null;
} catch {
  contractModule = null;
}

function contractList(value, fallback) {
  return Array.isArray(value) && value.length > 0 ? value : fallback;
}

// ---------------------------------------------------------------------------
// Areas / guides / handbooks
// ---------------------------------------------------------------------------

/**
 * Product areas. Titles and descriptions are guide metadata (English-only,
 * like guide bodies); the surrounding chrome labels ("Area", "Audience") are
 * localized via the `sop` i18n namespace.
 */
export const AREAS = contractList(contractModule?.AREAS, SAMPLE_AREAS);

export function getArea(slug) {
  return AREAS.find((area) => area.slug === slug) || null;
}

/** All guides currently in the registry. Content workers append via guides/index.js. */
export const GUIDES = contractList(contractModule?.GUIDES, SAMPLE_GUIDES);

/** Guides keyed by guide id (from the contract file when present). */
export const GUIDES_BY_ID =
  contractModule?.GUIDES_BY_ID && typeof contractModule.GUIDES_BY_ID === 'object'
    ? contractModule.GUIDES_BY_ID
    : Object.fromEntries(GUIDES.map((guide) => [guide.id, guide]));

/**
 * Role handbooks: ordered reading lists. guideIds MAY reference guides that
 * are not published yet; renderers must skip or placeholder them gracefully.
 */
export const HANDBOOKS = contractList(contractModule?.HANDBOOKS, SAMPLE_HANDBOOKS);

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
 * Provisional route -> guide id map for contextual "Step-by-step guide"
 * buttons. Content workers extend this as guides ship. Routes with no guides
 * yet map to an empty array and the button renders nothing there.
 */
const ROUTE_GUIDE_MAP = {
  '/jobs/new': ['post-a-job'],
  // /post-job is the live job-posting route (PostJobPage); /jobs/new is kept
  // as a provisional alias target for inbound links.
  '/post-job': ['post-a-job'],
  '/helpers': [],
  '/login': ['sign-in-to-oxsteed'],
  '/join': [],
  '/wallet': [],
  '/messages': [],
  '/restaurants': [],
  '/logistics': [],
};

export function guidesForRoute(pathname) {
  const normalized = String(pathname || '').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  const ids = ROUTE_GUIDE_MAP[normalized] || [];
  return ids.map(getGuideById).filter(Boolean);
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
