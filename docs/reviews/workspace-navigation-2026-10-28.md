# Workspace navigation download reduction

Requirement 2 of the eight-improvement goal. Opening the business workspace
previously imported profile, business creation, product, pricing, and member
permission editors before any of them was used. Six editors now load on demand,
following the surrounding workspace's existing lazy-panel pattern. Existing
role and launch gates remain in place.

The workspace header and tab strip stay outside the panel loading boundary.
The two editor dialogs have their own cancelable loading boundary, using
existing localized copy and theme classes. Keyboard focus stays on Cancel
while loading; Escape cancels, and closing restores the previous focus.

## Local verification

- `npm run build:ci` passed, including localization, TypeScript, production
  compilation and validation of 1,110 emitted assets.
- `npm run test:workspace-navigation-browser` exercises the production build
  with synthetic API data in English desktop/light and Arabic mobile/dark.
  It checks all six editors stay out of the overview's requests, holds a real
  profile chunk while switching tabs, opens the loaded profile, cancels and
  reopens a delayed creation dialog, checks keyboard containment/Escape, and
  checks viewport fit and no page errors. A team account directly requesting
  Profile does not download or render the editor and can select Team. No
  business writes are submitted.
- The same browser file is included by CI's existing
  `scripts/*.browser-check.cjs` glob.
- `node scripts/measureWorkspaceNavigation.mjs` walks the built manifest's
  static JavaScript dependencies, excluding the already-loaded application
  shell and unopened dynamic imports. Before/after:

| Additional workspace JavaScript | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Raw bytes | 263,445 | 171,809 | 91,636 (34.8%) |
| Sum of individually gzipped assets | 66,818 | 40,747 | 26,071 (39.0%) |
| Static assets outside the shell | 27 | 11 | 16 |

The baseline was measured from the pre-change build; its workspace source is
unchanged between `6a0b8298` and this branch's base `1e584da3`. The raw and gzip
figures are build measurements, not observed network transfer or proof of a
site-wide latency reduction. Local cold/warm browser timing is diagnostic only:
unthrottled localhost, synthetic responses, and the current host workload.
Production transition timing, slower networks, and the wider navigation audit
remain open. This source change has not yet been merged or live verified.

CI initially rejected the loading-dialog Cancel control's `data-track="private"`
value because it appeared as a new tracking key. The control now uses the
project's actual privacy exclusion, `data-track-private`. The instrumentation
check passes with full coverage, no annotations required, and unchanged key
registries. No telemetry payload or tracking key was added.

## Follow-up observed during verification

The existing team tab fallback can select Media after a forbidden Profile deep
link, even though the Media panel requires owner/manager access. This behavior
comes from the unchanged tab selection and rendering gates. Repair that
operational landing behavior under requirement 6, with authoritative task data
and permission scenarios, rather than broadening editor access.
