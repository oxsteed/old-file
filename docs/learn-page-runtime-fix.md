# Learn page initialization crash

## Incident and repair (2026-10-03)

The production `/learn` route displayed the generic error boundary. Chrome
reported `ReferenceError: Cannot access 'y' before initialization` in
`LearnModePage-DZssoXbG.js`.

The guide URL synchronization effect referenced `activeGuides` in its dependency
array before the `const activeGuides = useMemo(...)` declaration. Dependency
arrays are evaluated immediately during render, so even visitors without a guide
query parameter crashed. Move that effect after the catalog declaration while
preserving its URL synchronization and remote-only guide handling.

`client/scripts/learnRender.test.mjs` renders the real component with isolated
app dependencies. It exercises `/learn`, search results, an expanded guide deep
link, and a search with no matching guides. The ordinary CI smoke-test glob
includes this test.

## Verification

- Before the repair: `node --test scripts/learnRender.test.mjs` reproduced
  `Cannot access 'activeGuides' before initialization`.
- After the repair: `node --test scripts/learnRender.test.mjs
  scripts/learnDeepReviewFixes.test.mjs` passed all 12 tests. The final render
  test, including the no-results case, also passed separately.
- Windows checkout line endings initially caused unrelated existing messenger
  and theme tests to fail. CSS line endings were normalized only in the temporary
  checkout; no CSS content changes are included in the repair.
- `npm run build:ci` passed its localization and TypeScript checks but the local
  Vite build failed on Windows: extensionless `./SharedCartCard` resolves to
  `sharedCartCard.js`, which has no default export, rather than `SharedCartCard.jsx`.
  This existing filename collision is unrelated to the Learn repair. Linux CI
  must verify the production build after the push.
- Post-push CI and live browser verification remain pending at this checkpoint.
  A passing build alone does not establish that the production route has received
  the repaired bundle.
