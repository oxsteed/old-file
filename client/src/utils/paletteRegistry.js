/**
 * Curated palette registries: the pages the projection navigation does not
 * render, and the application actions. Pure data (no imports), so both the
 * lazy palette module and the Discover page can consume them without
 * pulling in the admin layout.
 */

// Pages the app offers that the projection navigation does not render.
// The palette index itself is derived from the navigation (palette item 1,
// D-721): buildPaletteIndex takes every nav destination first, then adds
// these extras only for paths the nav does not already cover. An extra
// with `requires` still shows only when the projection offers one of those
// destinations. labelKey reuses existing `nav.*` keys where they exist;
// the rest live under `commandPalette.pages.*` in every locale.
export const CLIENT_PAGE_EXTRAS = [
  { id: 'page:bookings', path: '/my-bookings', labelKey: 'commandPalette.pages.bookings', keywordsKey: 'commandPalette.keywords.bookings' },
  { id: 'page:browse-jobs', path: '/jobs', labelKey: 'nav.browseJobs', keywordsKey: 'commandPalette.keywords.browseJobs' },
  { id: 'page:calendar', path: '/calendar', labelKey: 'nav.calendar', keywordsKey: 'commandPalette.keywords.calendar' },
  { id: 'page:food', path: '/food', labelKey: 'commandPalette.pages.food', keywordsKey: 'commandPalette.keywords.food' },
  { id: 'page:tool-rentals', path: '/tool-rentals', labelKey: 'commandPalette.pages.toolRentals', keywordsKey: 'commandPalette.keywords.toolRentals' },
  { id: 'page:direct', path: '/direct', labelKey: 'commandPalette.pages.direct', keywordsKey: 'commandPalette.keywords.direct' },
  // Universal finder step 1: the Discover entry points at the live /discover
  // route (the homepage submit has since PR #815). While discoverEverything
  // is off, the launch-redirect filter below hides it and /jobs stays
  // reachable through the browse-jobs entry.
  { id: 'page:discover', path: '/discover', labelKey: 'commandPalette.pages.discover', keywordsKey: 'commandPalette.keywords.discover' },
  { id: 'page:invoices', path: '/invoices', labelKey: 'commandPalette.pages.invoices', keywordsKey: 'commandPalette.keywords.invoices' },
  { id: 'page:disputes', path: '/disputes', labelKey: 'commandPalette.pages.disputes', keywordsKey: 'commandPalette.keywords.disputes' },
  // Universal finder step 1: `requires` lists projection-derived
  // destinations; the entry shows only when the projection offers one of
  // them. /logistics itself is not a nav destination (only its buyer and
  // organizer pages are), so it stays a gated extra.
  { id: 'page:logistics', path: '/logistics', labelKey: 'nav.logistics', keywordsKey: 'commandPalette.keywords.logistics', requires: ['/logistics/buyer', '/logistics/organizer'] },
  { id: 'page:activity', path: '/activity', labelKey: 'commandPalette.pages.activity', keywordsKey: 'commandPalette.keywords.activity' },
];

export const CLIENT_ACTIONS = [
  { id: 'action:new-booking', path: '/helpers', labelKey: 'commandPalette.actions.newBooking', keywordsKey: 'commandPalette.keywords.newBooking' },
  { id: 'action:new-job', path: '/post-job', labelKey: 'commandPalette.actions.newJob', keywordsKey: 'commandPalette.keywords.newJob' },
  { id: 'action:new-quote', path: '/quote-request', labelKey: 'commandPalette.actions.newQuote', keywordsKey: 'commandPalette.keywords.newQuote' },
  { id: 'action:order-food', path: '/food', labelKey: 'commandPalette.actions.orderFood', keywordsKey: 'commandPalette.keywords.orderFood' },
  { id: 'action:open-wallet', path: '/wallet', labelKey: 'commandPalette.actions.openWallet', keywordsKey: 'commandPalette.keywords.openWallet' },
  { id: 'action:get-support', path: '/support', labelKey: 'commandPalette.actions.getSupport', keywordsKey: 'commandPalette.keywords.getSupport' },
];
