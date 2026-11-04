# Workspace design and recovery acceptance

The built-app audit passed all six selected browser cases in 107 seconds:

```sh
cd client
node --test --test-concurrency=1 \
  scripts/homeModeRouting.browser-check.cjs \
  scripts/workspaceNavigation.browser-check.cjs \
  scripts/businessOperations.browser-check.cjs \
  scripts/merchantOperationsDesk.browser-check.cjs \
  scripts/pwaOverlayCoordination.browser-check.cjs
```

The homepage case covers fourteen role/viewport combinations. Customers retain
discovery; helpers, owners, and team members enter their authorized work
surface. Delayed route chunks retain navigation. The business cases verify
bookings, messages, overdue invoices, permissions, unavailable counts, and
workspace switching without requesting secondary analytics.

The operations desk retains an unfinished inventory item when switching tools
and when changing to the mobile tool picker. Unauthorized manager links fall
back to an allowed tool. English desktop, dark mode, and Arabic mobile
screenshots were visually reviewed. The overlay case covers mobile and
desktop, RTL, cookies, support, checkout, and deferred updates while editing.

Visual review found that the merchant Home tab used an English fallback in
Arabic. This follow-up adds its label to the English, Spanish, French, Haitian
Creole, and Arabic legacy and common catalogs. The existing operations browser
case now checks the actual rendered tab in each of those five languages.

The updated operations browser case passed, including all five tab labels and
Arabic mobile layout. `npm run build:ci` passed, including localization,
TypeScript, production compilation, and emitted-asset verification.

## Production boundary

The signed-in Chrome account currently opens restaurant onboarding because it
has no restaurant membership. No restaurant was created and no account mode
was changed. A live owner-account workflow remains pending; the passing
synthetic owner/employee checks do not replace it.

Direct quote draft recovery (PR #685) and response-cookie ordering (PR #686)
have focused local coverage and remain subject to their required CI and
production verification. This audit does not mark the eight-item goal complete.
