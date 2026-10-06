# Profile visibility dialog repair

The page rendered its impact, restore-checklist, and timeline dialogs on initial
load because the local `Modal` component ignored their `open` props. With no
selected target, the label fallback became "Profile". These overlays blocked
the directory; the timeline endpoint itself remained scoped to the selected
profile type and ID. The earlier label fallback did not repair this lifecycle.

The modal now returns no UI or keyboard/focus handlers when closed. Conditional
preview and schedule callers retain their default-open behavior. A callback ref
prevents API responses and other rerenders from resetting focus inside an open
dialog. Closing restores focus to the row that opened it.

Verification on 2026-10-06:

- The new `profileVisibility.browser-check.cjs` failed before the repair with
  three dialogs on initial load, then passed after it. It exercises selected
  profile identity and timeline request scope, Escape and Close, focus return,
  checklist-to-confirmation, impact, preview, and schedule without live writes.
- `node --test scripts/*.browser-check.cjs`: 12 passed, 2 skipped because the
  authenticated environment was not configured, 0 failed.
- `npm run build:ci`: passed, including localization, typecheck, production
  build, and validation of 729 emitted assets. The first run exposed eight
  missing Work Agreement translation keys from recent commits; these were
  supplied in all five locales before the successful rerun.

The browser fixture uses the actual React page with synthetic API responses.
It does not establish production deployment or live hide/restore acceptance.
