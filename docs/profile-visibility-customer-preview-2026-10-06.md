# Profile Visibility: customer-layout snapshot

## Operator workflow

Each directory row now offers two separate actions:

- **Inspect content**: the existing moderation content panel, including owner-unlisted sections, FAQs, reviews, policies, and published menu modifiers.
- **Preview customer view**: a read-only visual snapshot rendered by the actual helper, business, or restaurant page components. Choose desktop (1280px) or mobile (390px), light/dark theme, and restaurant menu/info section and menu category using controls outside the snapshot.

Current visibility remains visible above either mode. Inspecting a hidden or
owner-unlisted profile does not publish, restore, or change it. The selected
directory profile is the target; the logged-in operator is not impersonated.
The customer snapshot uses guest navigation, not the operator's account state.

## Isolation and authorization

Both modes reuse the authenticated, permission-gated, audited
`/api/admin/profile-visibility/:type/:id/preview-content` endpoint. Public
eligibility filters and no-store responses are unchanged. There is no new
unauthenticated endpoint, query-parameter bypass, or production write.

The visual renderer calls `renderToStaticMarkup`, never mounts the public page.
Effects, tracking, socket subscriptions, API calls, payment initialization, and
customer event handlers do not run. Restaurant Stripe initialization now uses
the pure loader and occurs in the mounted customer page's effect only.

Static markup is sanitized: scripts, forms, media players, embedded frames,
navigation destinations, event attributes, unsafe image URLs, and API image
sources are removed. Controls are disabled. Valid cover-image CSS is retained
only after URL validation; the navbar's fixed responsive CSS is shared from
its original source. Trusted application styles are reused for the layout.

The result is an iframe `srcdoc` with an empty sandbox attribute: no scripts,
same-origin access, forms, popups, or navigation permissions. Its restrictive
CSP additionally blocks scripts, connections, forms, and nested frames. No
application-wide CSP or frame restriction was relaxed. Passive application
styles, fonts and permitted images can load. The browser sandbox behavior is
documented by [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox).

Closing or changing the selected profile invalidates pending responses;
switching inspection modes reuses the already-authorized payload. Rendering
errors show an unavailable message instead of retaining another profile.

## Explicit limits

This is a visual inspection tool, not a live session or transaction simulator.
Ordering, checkout, payments, messaging, booking, saving, sharing, navigation,
accordions and other in-frame controls are disabled. Live media feeds,
availability checks, maps, dynamic pricing and reliability/reputation panels
are not simulated. Helper maps and live panels have omission labels instead
of permanent loading indicators. Use content inspection for details behind
interactive controls. Use isolated test accounts/environments for real flows.

The snapshot reflects the fetched profile content and current deployed page
templates. It is not evidence that production checkout, messaging or media
delivery works. Restore/hide still requires the existing separate safeguards.

The business page's shared normalizer now consumes the existing public API's
top-level services, gallery, reviews and hours; previously those arrays were
not wired to its display fields. This correction applies to the live public
page as well as its snapshot.

## Verification

- Full client `npm run build:ci`: localization, source-reference contracts,
  TypeScript, production build and emitted-asset verification.
- `customerProfilePreview.browser-check.cjs`: actual public page components,
  all three profile types, UUID helper identity, mobile/desktop dimensions,
  light/dark and Arabic RTL, menu/info/category switching, business content,
  unsafe URL/HTML/CSS handling and snapshot failure. Instrumented API, fetch,
  WebSocket, Stripe loader and storage writes must remain unused. Sandbox DOM
  access is denied; API URLs are not requested. Works without a prior build.
- `profileVisibility.browser-check.cjs`: selected-profile dialog lifecycle,
  new customer-preview action, inspection-mode switching without refetch,
  stale-response cancellation and failed content loading.
- Related restaurant card-form browser regression and theme contracts.
- Existing server preview/visibility/workstreams A/B: 4 suites, 84 tests pass.
- Complete client browser matrix: 13 passed, 2 credential-dependent checks
  skipped; no failures. Production build verified 731 emitted assets.

Local Chrome screenshots were inspected for all three mobile layouts. This
does not replace checking the feature after production deployment.
