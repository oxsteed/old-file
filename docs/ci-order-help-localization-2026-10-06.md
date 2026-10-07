# Order help localization CI repair — 2026-10-06

CI run 37564420251 failed in `npm run build:ci` because `OrderDetailsPage.jsx`
referenced `orders.helpTitle`, `orders.helpSent`, and `orders.helpPlaceholder`
without catalog entries. Added these keys to the existing translation namespace
in all five legacy catalogs (en/es/fr/ht/ar). The order keys are not mirrored in
an optional namespace; generated locale shards are produced by the build.

Verification in a clean Windows checkout:
- `npm --prefix client ci --no-audit --no-fund`: passed.
- `node scripts/verify-i18n.mjs` in client: passed; all 21,710 static calls resolve,
  with catalog key and interpolation parity across all five languages.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run verify:dist-assets`: passed; 750 emitted assets verified.
- `node scripts/noDuplicateJsonKeys.test.mjs`: passed.
- `git diff --check`: passed.
- `npm run build:ci`: attempted; stopped at existing frontendReferences fixture
  assertions on Windows (zero findings). These fixtures passed in the failed
  Linux CI run, which reached the localization gate. Complete Linux verification
  must be confirmed in the new Actions run after push.

No production runtime or deployment verification was performed for this catalog
repair. The next action is to confirm both jobs in the new CI run succeed.
