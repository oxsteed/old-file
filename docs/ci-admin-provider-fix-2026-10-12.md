# Admin smoke test query provider correction

GitHub CI run [38274228572](https://github.com/oxsteed/old-file/actions/runs/38274228572)
failed in Client smoke tests: 418 of 419 tests passed. The failing admin-provider
fixture expected the missing cookie-consent-provider error, but rendering the
shared navbar first raised `No QueryClient set` from the support-workspace hook.

The production admin app already wraps its routes in `QueryClientProvider`.
Both test fixtures now include that provider, preserving the negative assertion
for missing consent and the positive real two-factor-page/footer rendering check.
The test is also included in `npm run build:ci` so the local build gate covers
this regression. No application behavior, permissions, or deployment settings
changed.

Verification from `client/`:

- `node --test scripts/*.test.mjs`: all 419 tests passed, zero skipped.
- `npm run build:ci`: completed successfully, including the admin provider test,
  localization checks, TypeScript, production build, and emitted-asset checks.
- `git diff --check`: passed.

The correction is pushed through the verified default branch `old-files-claude`.
Local verification is separate from the new GitHub CI run. Deployment is neither
inspected nor awaited for this correction.

## Follow-up CI correction

The next CI run reached browser regressions and exposed the same missing provider
in `customerProfilePreview.browser-check.cjs`: its snapshot renderer invokes the
real navbar/footer while rendering static customer-profile markup. The renderer
now supplies a per-render `QueryClientProvider`, matching the production app's
provider boundary; the browser fixture also wraps its live preview page with a
query client. The focused customer-profile browser test passes locally.
