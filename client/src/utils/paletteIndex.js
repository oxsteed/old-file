/**
 * The shared palette index: pages and actions, derived from the access
 * projection navigation plus the curated registries. Pure of the admin
 * layout, so both the lazy palette module (commandPaletteItems.js) and the
 * Discover page can build the same index. One implementation, two doors.
 */
import { getLaunchRedirect } from './launchScope';
import { paletteAllowedDestinations, isPalettePageVisible, derivePalettePages } from './paletteVisibility';
import { CLIENT_PAGE_EXTRAS, CLIENT_ACTIONS } from './paletteRegistry';

/**
 * Build the client palette's pages and actions for a projection.
 * Review P1-222: don't offer pages the launch scope redirects away
 * (e.g. /discover while discoverEverything is off).
 * Palette item 1 (D-721): the page index is derived from the projection
 * navigation, the same navigation the navbar renders. Every nav
 * destination becomes a palette page with the nav's own label, so a page
 * the user can see is always findable. A missing or not-ready projection
 * fails closed to the customer baseline (D-614). Curated extras fill only
 * the paths the nav does not render; an extra carrying `requires` still
 * shows only when the projection offers one of those destinations.
 */
export function buildPaletteIndex(t, projection) {
  const allowed = paletteAllowedDestinations(projection);
  const pages = [];
  const seen = new Set();
  for (const entry of derivePalettePages(projection)) {
    if (getLaunchRedirect(entry.to)) continue;
    const label = t(entry.labelKey);
    seen.add(entry.to);
    pages.push({
      id: entry.id,
      path: entry.to,
      label,
      keywords: `${label} ${entry.to}`,
      group: 'pages',
    });
  }
  for (const entry of CLIENT_PAGE_EXTRAS) {
    if (seen.has(entry.path) || getLaunchRedirect(entry.path)) continue;
    if (!isPalettePageVisible(entry, allowed)) continue;
    seen.add(entry.path);
    pages.push({
      id: entry.id,
      path: entry.path,
      label: t(entry.labelKey),
      // Palette item 2 (D-722): keywords are localized strings from the
      // catalog, resolved here; English is the i18n fallback (fallbackLng).
      keywords: t(entry.keywordsKey),
      group: 'pages',
    });
  }
  // D-612: actions are application entries (post a job, order food, get
  // support). They stay visible to every account, un-gated, so a user can
  // always find the way in to something they cannot do yet.
  const actions = CLIENT_ACTIONS.map((entry) => ({
    id: entry.id,
    path: entry.path,
    label: t(entry.labelKey),
    keywords: t(entry.keywordsKey),
    group: 'actions',
  }));
  return { pages, actions };
}
