# Public restaurant reservation card

Built from integration commit `93a1f92d7e83e44e5fbd8b615a3b6bd13dc374e4` on
`codex/restaurant-reservation-design`, separately from consultant PR #806.

The shared public reservation component now uses two short steps: visit details,
then contact details. It keeps store selection, party size, arrival/departure,
phone or email, and optional notes. The review summary allows editing the visit
without losing contact details. Visible labels, native datetime controls,
keyboard focus on step changes, inline recoverable errors, and clear pending
confirmation replace the unstyled form. Restaurant acceptance is still required;
this UI does not invent availability, reserve a table directly, or change server
authorization and reservation policies.

New copy is present in both legacy and namespaced catalogs for en/es/fr/ht/ar.
Styling uses semantic light/dark and action tokens. Both public-page placements
use the same component and independent accessible IDs.

Verification against the commit containing this document:

- `npm --prefix client run build:ci`: passed; 1,247 emitted assets verified.
- `node --test client/scripts/reservationRequest.browser-check.cjs`: passed (8.22s); synthetic APIs, 320px dark, 420px light, 360px Arabic RTL, keyboard, range/contact validation, archived-store exclusion, edit preservation, request retry, UTC payload conversion, pending receipt, and another request. Generated screenshots were visually inspected.
- `npm --prefix server test -- __tests__/restaurantHosting.test.js`: 27 passed (1.07s); existing server unit coverage with mocked dependencies, not a live restaurant acceptance test.
- Growth instrumentation check: full named-interaction coverage. `git diff --check` passed.

GitHub CI is separate verification. No production requests, merge, or deployment
were performed. The local dependency symlink is excluded from the commit.
