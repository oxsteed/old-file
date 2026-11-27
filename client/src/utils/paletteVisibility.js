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
