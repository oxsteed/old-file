# Frontend initialization and render-crash audit

Audit date: October 4, 2026, America/New_York.
Source revision: `f6e5c4dd77d5b7bf9a019d5fd3586768ba51e568`.

## Repair follow-up

The two defects recorded below are now corrected in the local working tree:

- Consulting select-all reads the existing stable-ID catalog,
  `SETUP_ITEMS_GROUPED_KEYS`, instead of an undefined name.
- Business Owner dashboard imports the Lucide `TrendingUp` icon. Launch flags
  remain unchanged; the growth section is not activated by this repair.
- `scripts/frontendCrashRegression.browser-check.cjs` exercises the actual
  components in an isolated Chrome browser. It covers populated/empty/error
  portfolios, service/restaurant/mixed portfolios, both growth branches, and
  consulting select-all/deselect-all/partial-selection/advance in all five locales.
- `scripts/verify-frontend-references.mjs` now checks unresolved bindings and
  direct same-scope eager reads before initialization before `build:ci`.
  Its four regression tests cover missing JSX names, handler references,
  shorthand values, the Messages dependency-array pattern, safe callback
  captures, and safe versus unsafe `typeof` uses.

The browser tests failed before the source fixes: the business boundary caught
`TrendingUp is not defined`, and consulting's real checkbox click could not
change state because its handler threw. Both browser tests now pass. The new
reference check reported the two names before repair and zero findings afterward
(826 non-declaration source files included by the configured program). Existing
messaging/dashboard checks passed 102 tests. `npm run build:ci` completed
successfully, including localization verification, typecheck, production build,
the new reference gate, and verification of 699 emitted assets. No production
data was written by these tests.

This follow-up does not close the unrelated placeholder job-wizard test gap or
claim a comprehensive hook-order lint rule. The original audit record below is
retained as evidence of what was found before these local repairs. No commit,
push, or production deployment has been performed for this follow-up.

## Outcome

Two additional undefined-reference defects were confirmed and reproduced. No
further direct, same-scope use-before-initialization matches were found by the
targeted scan. This is an audit, not a repair release: application code, launch
flags, financial data, production accounts, and deployments were not changed.

| Priority | Area | Finding | Current impact |
| --- | --- | --- | --- |
| P2 | Consulting intake | `handleSelectAll` references nonexistent `SETUP_ITEMS_GROUPED` | Selecting all services fails with a `ReferenceError`; selecting services individually is a separate path |
| P3 | Business Owner dashboard | `TrendingUp` is used without an import | Latent render crash for a populated portfolio if the growth-tools section is enabled; current launch flag is false |
| P2 | Verification | JSX/JavaScript semantic checks are disabled | The normal typecheck does not reject these unresolved JSX/JS references |
| P2 | Regression coverage | A job-wizard test file contains placeholders and is not in the configured client CI test globs | Its claims cannot be counted as executed interaction coverage |

Priorities describe engineering risk, not authorization to activate hidden tools.
The two actual defects are both confirmed with source execution and focused
TypeScript diagnostics, rather than a pattern match alone.

## 1. Consulting intake: select-all action fails

Source: `client/src/pages/ConsultingIntakePage.jsx:320`.

The file declares `SETUP_ITEMS_GROUPED_KEYS` and derives `setupItemsGrouped` from
it. At line 320, the select-all handler instead reads `SETUP_ITEMS_GROUPED`, which
is neither declared nor imported. Step 3 connects its checkbox to this handler
at line 931. The page is registered at `/consulting-intake` in `App.jsx:345`.

Reproduction executed the actual extracted handler and its existing catalog
constant in an isolated VM, with synthetic form state and a no-op setter:

```text
previouslySelected=false -> ReferenceError: SETUP_ITEMS_GROUPED is not defined
previouslySelected=true  -> handler completed
```

Focused semantic diagnostic:

```text
TS2552: Cannot find name 'SETUP_ITEMS_GROUPED'. Did you mean 'setupItemsGrouped'?
```

This is an event-handler failure. It does not imply that React will replace the
entire page with an error boundary; React boundaries do not generally catch
event-handler exceptions. The action itself fails before the state update.

Required correction:

- Use the existing localized `setupItemsGrouped` or the stable-key catalog as
  the source of IDs. Do not match services by translated display labels.
- Test actual select-all and deselect-all interactions with the real component.
- Assert selected IDs are complete and unique, then assert the form can proceed
  to its next step. Repeat with a non-English locale.
- No server, pricing, permission, or launch-scope change is needed.

Not performed: a live production intake submission or a complete browser journey.

## 2. Business Owner dashboard: missing icon import behind a launch gate

Source: `client/src/pages/BusinessOwnerDashboard.jsx:548`.
Imports to correct: the Lucide import at lines 25-29.
Current gate: `client/src/utils/launchScope.js:55`.

The growth section renders `<TrendingUp />`, but the module never imports or
declares `TrendingUp`. The existing `businessHubGrowthTools` value is false, so
the section is currently skipped. An empty portfolio also returns earlier.

Reproduction rendered the actual component with React SSR and a synthetic
loaded business portfolio. Provider/UI dependencies were stubbed; state values
represented the already-loaded branch, and effects/API calls were not run:

```text
growthEnabled=false -> rendered
growthEnabled=true  -> ReferenceError: TrendingUp is not defined
```

Focused semantic diagnostic:

```text
TS2304: Cannot find name 'TrendingUp'.
```

Required correction:

- Import the existing Lucide `TrendingUp` icon.
- Keep the growth-tools launch flag unchanged.
- Add render tests for loading, empty, and populated portfolios, with the growth
  section both disabled and enabled in fixtures. Include service and restaurant
  portfolios to cover their different action cards.

This is a latent source defect, not a claim that current business dashboards are
all down. No production feature flag was changed to reproduce it.

## 3. Why the normal checks miss this class of failure

`client/tsconfig.json:26-27` has `allowJs: true` but `checkJs: false`. TypeScript
includes JavaScript files without performing their normal semantic checks.
Vite can compile an undeclared JSX component or variable into code that fails
only when the affected render/action branch runs. A build passing is therefore
not proof that every interface branch can render.

The configured CI contains client tests, browser checks, localization checks,
typecheck, and a production build. It does not currently have a dedicated
undefined-reference or React-hook-order lint gate.

Recommended durable prevention:

1. Add a bounded, scope-aware CI check for unresolved JS/JSX identifiers and
   unsafe initialization order. Distinguish lazy closures from eager hook
   arguments and dependency arrays; avoid flagging valid callback captures.
2. Enforce React hook-order rules for components and custom hooks.
3. Cover real render branches: loading -> loaded, empty -> populated, optional
   data failure, account mode changes, and enabled/disabled launch gates.
4. Add interaction tests for event handlers; SSR cannot exercise click failures.
5. Keep current messaging/customer-dashboard render regressions and the
   restaurant loading/navigation browser regression in CI.
6. Use a controlled rollout for broader `checkJs` adoption. A full ad hoc
   semantic pass exhausted the default Node heap during this audit; do not turn
   it on globally and assume the resulting job will be practical or clean.

## 4. Job-wizard coverage is overstated by an inactive placeholder file

Source: `client/src/__tests__/PostJobPageStep4.test.js`.

The file contains 14 unconditional `expect(true).toBe(true)` assertions. A render
helper is declared, but none of the listed tests calls it. Its Jest/testing-library
format is outside the current configured `scripts/*.test.mjs` and
`scripts/*.browser-check.cjs` test commands. This file was inspected, not run.

The finding is a coverage gap, not evidence that posting a job currently crashes
or that no other job tests exist.

Required follow-up:

- Replace placeholders with assertions against a mounted, real job wizard.
- Put executable tests into the test paths the client CI actually runs.
- Exercise review-step entry, editing/back navigation, validation, successful
  synthetic posting, and failed/retry responses.
- Assert no render/page errors across transitions; never post synthetic jobs
  against production for this regression coverage.

## Audit methods and false positives

The repository has 823 JS/JSX/TS/TSX files under `client/src`. AST-based passes
covered these source files, including admin pages, public/customer pages,
components, contexts, hooks, and utilities. Test-framework globals were excluded
when identifying production unresolved-reference candidates.

Checks performed:

- TypeScript symbol lookup for direct lexical reads before declaration,
  including hook dependency arrays and selected eager initialization callbacks.
- AST search for hooks after early returns in the same function.
- AST search for hook calls inside conditional expressions/statements and loops.
- Scope-aware unresolved-identifier candidates, filtering property names,
  destructuring aliases, intrinsic JSX tags, and test-framework globals.
- Manual source review and execution of both confirmed defect paths.
- Focused semantic diagnostics for the two affected pages.

The initial early-return scan returned three candidates that were all valid
`return useContext(...)`, `return useMemo(...)`, or `return useCallback(...)`
expressions. They are not hooks reached after an earlier return. No unsafe
candidate remained from that pass, and the conditional-hook pass found none.

The only remaining production unresolved-name candidate besides the two defects
was `typeof BarcodeDetector` in `Dashboard.jsx:2283`. This is an intentional
feature-detection guard; an absent global in `typeof` is safe and was excluded
from findings.

To validate the initialization scanner itself, it was run against both versions
of `MessagingWorkspace.jsx` without changing the checkout:

```text
before f6e5c4dd -> conversations dependency read before initialization at line 79
current source -> no matching initialization read
```

## Tests actually run

```sh
cd client
node --test scripts/messengerClientFixes.test.mjs scripts/messengerShell.test.mjs scripts/messengerDock.test.mjs scripts/dashboardQuickLinks.test.mjs
node --test scripts/restaurantRender.browser-check.cjs
node /tmp/oxsteed-render-audit-reproduce.cjs
```

Results:

- Messaging/dashboard checks: 102 passed, 0 failed, 0 skipped.
- Restaurant browser regression: 1 passed, 0 failed, 0 skipped. Verified loading
  -> menu, search, missing restaurant, and return navigation with isolated fixtures.
- Defect reproduction harness: confirmed both ReferenceErrors and their safe
  comparison branches. It made no production requests or outbound writes.
- The attempted full `checkJs` pass failed with Node heap exhaustion. It is not
  recorded as successful verification.

Temporary evidence logs:

- `/tmp/oxsteed-render-audit-tests.log`
- `/tmp/oxsteed-render-audit-restaurant.log`
- `/tmp/oxsteed-render-audit-reproduce.cjs`

## Boundaries of this conclusion

This targeted audit is not a certification of every route, permission, payload,
integration, or business workflow. Static scans do not fully follow indirect
calls, cross-module/circular initialization, dynamic globals, or every runtime
data shape. The focused tests do not replace an authenticated all-role browser
matrix or malformed-API/optional-provider failure tests.

No further matching direct initialization/hook-order defect was found in this
scan. Two separate undefined-reference defects remain to fix, and the prevention
gaps above remain until implemented and exercised in CI.
