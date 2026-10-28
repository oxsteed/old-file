# Shared font asset repair

Part of requirement 4 in the eight-improvement goal. Production CSS retained
14 unresolved `../assets/fonts/*.woff2` URLs. Those URLs did not point to emitted
assets, so declaring the intended font family could still render a platform
fallback. Vite warned during compilation, but the asset verifier checked only
manifest entries and missed the unresolved URLs.

The public and admin entries now import the shared font stylesheet directly.
This lets Vite resolve its relative URLs before emitting the shared CSS, rather
than passing them through the Tailwind stylesheet import. All 14 existing font
files are now fingerprinted assets. Font families, weights, Unicode ranges,
licenses and `font-display: swap` are retained; fonts load as needed rather than
through new eager preloads. A restaurant-profile rule that aliased Instrument
Serif to local Georgia is removed so it uses the same actual shared face.

The asset verifier now checks local font URLs inside emitted CSS as well as
manifest references. Before the repair, the new verifier failed against the
existing production build on `instrument-serif-0.woff2`. After the repair:

- `npm run build:ci` passed, including localization, TypeScript, production
  compilation and validation of 1,112 emitted assets. There are no unresolved
  font-URL warnings in that build.
- `node --test scripts/fontAssets.browser-check.cjs` passed ten built-app
  combinations: restaurant discovery, restaurant profile, Direct, Messages and
  business workspace; English desktop/light and Arabic mobile/dark for each.
- Each case loaded actual normal/italic Instrument Serif, regular/bold Inter,
  and Work Sans faces with accented Latin text. Font requests returned 200 from
  local fingerprinted assets. The checks require loaded faces, not merely a
  successful `document.fonts.check` fallback, and catch the Georgia alias.
- Each case fits the viewport, retains the expected direction and has no page
  errors. Screenshots of Food, Direct, Messages and workspace were reviewed.
- The browser regression joins CI's existing browser-file glob. No user-facing
  copy, locale keys, external font service or tracking keys were added.

This repairs a shared rendering defect. It does not complete the remaining
header/form/theme consolidation, keyboard audit or live publication checks
required by the broader design goal.
