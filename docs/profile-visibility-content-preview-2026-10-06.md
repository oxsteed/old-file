# Authenticated profile visibility content preview

## Root cause and change

The old Preview button fetched visibility metadata but embedded the public
canonical page in an iframe. Hidden and owner-unlisted profiles were correctly
rejected by public data endpoints, and production CSP did not permit the
same-origin frame. Successful metadata lookup did not mean content loaded.

The UI now renders a dedicated read-only content panel from
`GET /api/admin/profile-visibility/:type/:id/preview-content`. The route requires
administrator authentication, enforced admin 2FA, and the global
`manage_profile_visibility` permission (or super-admin access). Responses are
`private, no-store`. Access is recorded as `profile_visibility_previewed` in
the admin audit log; audit failure prevents content disclosure.

Shared helper/business/restaurant serializers retain their field allowlists.
Separate internal admin entry points allow inspection of hidden, unlisted,
inactive, and incomplete profiles; deleted records remain excluded. Public
entry points always use the public eligibility filters. No request query,
body, header, role, or extra handler argument can turn on admin preview there.
No global CSP or framing protection was weakened.

The panel displays profile text, photos, location, ratings, and hours. Helpers
and businesses include services, gallery, FAQs, policies, and recent reviews;
businesses include team members. Restaurants include published menu items,
allergens, availability, and modifier options. Draft/archived menu items and
quarantined media are not exposed. Money follows the currency's minor-unit
precision, including JPY. Owner-disabled sections are labeled explicitly.

This is an operator content inspection, not a pixel-identical customer page
or a simulation of ordering, payments, messaging, or live media feeds. It does
not fetch the restaurant review feed or live media feed. Those interactive
surfaces are not represented as empty content. Visibility changes remain a
separate, confirmed action. Text is escaped; image URLs reject non-HTTP(S)
schemes. Request sequencing prevents closed or switched previews from being
overwritten by stale responses. Failures show an unavailable state, not an
empty successful preview; closing and reopening retries the fetch.

## Verification

- `server`: focused Jest coverage for profile visibility, preview, workstreams
  A/B, restaurant public visibility/menu, and food controller behavior:
  seven suites, 136 tests passed.
- `client`: `npm run build:ci` (localization, references, typecheck, production
  build, emitted asset verification).
- `client`: `node --test scripts/*.browser-check.cjs`; isolated real React
  preview tests cover all three profile types, selected identity, hidden and
  unlisted content, JPY pricing, mobile overflow, escaped markup/unsafe URLs,
  failed requests, stale responses, and no mutations.
  Full browser run: 12 passed, two authenticated-environment checks skipped,
  zero failed. The focused preview test was rerun successfully after adding
  JPY and mobile assertions.

Authenticated production verification is still required after deployment:
open Preview on a hidden business, an unlisted helper, and a hidden restaurant;
confirm the selected content/identity, close it, and confirm public endpoints
still reject those profiles. No production profiles were hidden/restored or
financial activity initiated during local verification.
