# Persona explorer: proposed integration slice 2

Target: oxsteed/old-file, feat/persona-foundation.
Base: fe38b3c480f26e55271cd51b64b10e25d37b1359.

## Changes

Adds a read-only component below the existing /how-it-works hub content, inside PageShell's existing main landmark. Trailing slash is accepted. Other paths do not render it. The shared-shell integration intentionally uses a small path-specific condition rather than modifying the much larger guide page; it adds a static client import, so this slice does not claim a bundle-size optimization. Existing story-role selectors and navigation remain unchanged.

The component offers translated-text search, family/evidence filters, reset-to-search focus, result announcements, native controls and unique instance IDs. Styles use logical properties, responsive grids, inherited fonts, visible focus and established theme variables. No custom motion is added. No persona selection, enrollment, approval badge, investment link or signup action is provided. Source paths are not rendered.

Copy is provided for en/es/fr/ht/ar. One feature-scoped source projects equal resources into the legacy translation.personaExplorer path and the explicit personaExplorer namespace, following the repository's existing single-source projection pattern. The large monolithic JSON catalogs and global bootstrap are unchanged. The feature registers both resource forms when mounted; no global initialization lifecycle is started. Unsupported locales show an explicitly English, LTR section. Translation quality still needs human review.

## Actual verification

Node v20.20.1: node --test client/src/features/personas/personaExplorer.test.mjs in an isolated workspace. Nine tests passed, zero failed. Tests cover five-language key/placeholder parity, all 90 localized persona labels, deterministic locale fallback, legacy/namespace equality and independent cloning, repeat installation, combined filters, and source contracts for controls and host placement.

The catalog test input and original PageShell were verified against Git blob SHAs 63e23b76d6ed070738a4840edec431b584477ccd and c3a438999b28c21fe645fd3901f3cd7b8dc0813c, respectively. The catalog is unchanged.

React, react-dom, Babel parser and Playwright are unavailable in this runner. JSX was not compiled or rendered. Source-contract assertions are NOT browser, accessibility or screen-reader tests. No Node 22 run, full clone/dependency installation, npm run build:ci, browser verification, automated accessibility scan, database check or CI execution occurred. No production readiness claim is made.

Before merge, run both persona test files with Node 22, run npm run build:ci in client/, and verify /how-it-works and its trailing-slash form in all five languages, light/dark themes, narrow widths and Arabic RTL. Verify filter/reset/focus/live-region behavior, leaving and returning to the hub, unchanged navigation, and absence on /how-it-works/food, /dashboard and admin routes. Confirm final bundle size and human translation review. Review the initial evidence paths against current source before treating their classifications as verified implementation coverage.

No server authorization, Credit accounting, investment gates, migrations, deployment or production flags change. Full child-persona inventory and investment-domain validation remain separate work. No pull request, merge or deployment is authorized by this proposed commit.
