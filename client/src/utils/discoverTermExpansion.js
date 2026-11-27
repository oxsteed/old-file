/**
 * Trade / category synonym expansion for the command palette.
 *
 * This mirrors `server/controllers/discoverController.js` exactly (same
 * SYNONYM_GROUPS, same normalize/expand algorithm) so the palette and
 * Discover agree on what "plumber" also means. The server stays the source
 * of truth for ranking; this module is only the client's local copy for
 * scoring palette entries. A parity test pins the two literals together:
 * if the server groups change, this file must change with them.
 */

/** Trade / category synonyms for broader matching (v1 heuristic). */
export const SYNONYM_GROUPS = [
  ['plumber', 'plumbing', 'pipes', 'drain'],
  ['electric', 'electrical', 'wiring', 'outlet'],
  ['hvac', 'heating', 'cooling', 'air conditioning', 'ac repair', 'furnace'],
  ['clean', 'cleaning', 'maid', 'housekeeping'],
  ['landscape', 'landscaping', 'lawn', 'mowing'],
  ['paint', 'painting', 'painter'],
  ['roof', 'roofing', 'gutter'],
  ['move', 'moving', 'movers', 'relocation'],
  ['carpent', 'carpentry', 'woodwork', 'trim'],
  ['weld', 'welding', 'metalwork'],
  ['pest', 'exterminator', 'rodent'],
  ['pressure wash', 'power wash', 'pressure washer'],
];

export function normalizeQuery(q) {
  return String(q || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 200);
}

export function expandSearchTerms(raw) {
  const n = normalizeQuery(raw).toLowerCase();
  if (!n) return [];
  const tokens = n.split(/[^a-z0-9+]+/).filter((t) => t.length >= 2);
  const out = new Set();
  for (const t of tokens) {
    out.add(t);
    for (const group of SYNONYM_GROUPS) {
      if (group.some((g) => t.includes(g) || g.includes(t))) {
        group.forEach((g) => out.add(g));
      }
    }
  }
  return [...out].slice(0, 12);
}
