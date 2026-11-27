/**
 * Projection-gated visibility for command palette destinations.
 *
 * Pure module (no React, no API, no admin layout) so it is unit-testable
 * with plain `node --test`. The palette index is projection-only: a page
 * entry carrying `requires` shows only when at least one of its required
 * destinations is present in the navigation the access projection derives
 * (the same destinations the navbar renders). Entries without `requires`
 * are the customer baseline and the application entries, and stay visible
 * to every signed-in account.
 *
 * Fail-closed: while the projection is loading, failed, or absent,
 * deriveAdaptiveNavigation returns the customer baseline, so gated pages
 * are hidden until the projection says otherwise. This mirrors the nav's
 * G-41 rule; it never invents access.
 */
import { deriveAdaptiveNavigation } from './personaNavigation.js';

/** The set of destinations the projection-derived navigation offers. */
export function paletteAllowedDestinations(projection) {
  const nav = deriveAdaptiveNavigation(projection);
  return new Set([...nav.primary, ...nav.account].map((item) => item.to));
}

/**
 * Whether a palette page entry is visible for the allowed destinations.
 * `requires` is a list of destination paths; any one match shows the entry.
 */
export function isPalettePageVisible(entry, allowedDestinations) {
  if (!entry || !Array.isArray(entry.requires) || entry.requires.length === 0) return true;
  return entry.requires.some((to) => allowedDestinations.has(to));
}

/**
 * Palette page entries derived from the projection navigation (palette
 * item 1, D-721). Every destination the navbar renders for this
 * projection becomes a palette page, so a page the user can see is always
 * findable. Returns the raw nav entries ({id, to, labelKey}); the
 * registry maps them to labeled items. Deduplicated by destination; a
 * nonhuman or not-ready projection yields the customer baseline the nav
 * itself renders (fail closed per D-614).
 */
export function derivePalettePages(projection) {
  const nav = deriveAdaptiveNavigation(projection);
  const seen = new Set();
  const pages = [];
  for (const item of [...nav.primary, ...nav.account]) {
    if (!item || typeof item.to !== 'string' || !item.to.startsWith('/')) continue;
    if (seen.has(item.to)) continue;
    seen.add(item.to);
    pages.push({ id: `page:${item.id}`, to: item.to, labelKey: item.labelKey });
  }
  return pages;
}
