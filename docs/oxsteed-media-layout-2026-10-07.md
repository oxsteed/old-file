# OxSteed Media layout: first implementation pass

## Problem and resulting behavior

The `/media/` feed nested the global site navigation and footer inside the
narrow Media content column. The signed-in navigation extended beyond the
viewport, while a large promotional banner and repeated compose buttons pushed
the timeline down. The empty feed looked like a landing page.

Media now owns one shared page shell. Desktop uses a navigation rail, a central
timeline, and links to the real restaurant, helper, and job directories. Phones
use the five-tab navigation bar. The timeline has a compact Home header, a
compose entry, a Latest label, and a modest empty state. Its footer is replaced
with compact legal/support links in the desktop rail. The post-detail route also
uses the shared shell rather than nesting another global page shell.

The shell retains language and theme controls and an accessible return link to
OxSteed. Navigation and new feed text are translated in en/es/fr/ht/ar; generated
locale namespaces/shards are produced by the existing catalog script. Styles
use the shared theme tokens and logical properties for Arabic.

The assistant and support launchers clear the bottom navigation at phone and
tablet widths. The assistant panel opens above Media navigation; these changes
are scoped to Media routes.

## Scope relative to the locked product definition

This change implements the page layout. It does not establish completion of the
Media MVP. The current upload verification and public-video safety gates remain
in effect. No payments, paid promotion, fabricated posts, or engagement rankings
are introduced. Directory discovery links are not a claim that nearby ranking
or every linked-card action is implemented.

Next action: audit the existing posting, media rendering, five post actions,
linked-card behavior, local Spaces, notifications, and identity permissions
against the locked MVP definition, then implement the missing behavior with
focused server/browser checks. Keep follows, Relevant sort, live counts, and
the additional entity types in their later release scope.

## Verification performed

Verified in a writable checkout at `C:\Temp\oxsteed-media-design-20261008`,
starting from `0e0a5963f530130d48c5920390f7c8df119eac81`.

- `git diff --check`: passed.
- `npm run verify:i18n`: passed, including five-language key parity.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run build:ci`: attempted; its existing frontend-reference fixture tests
  fail on Windows before the build. Their override map uses native Windows
  paths while TypeScript requests normalized paths. This layout change does not
  modify or bypass that validation. The full Linux CI run must confirm it.
- `node media-preview.cjs`: temporary browser check against the production build
  with isolated API fixtures. Passed at 320, 390, 640, 700, 768, 1024, and 1440 pixels;
  no horizontal overflow, correct mobile/desktop navigation, one main landmark,
  no large footer, correct Home selection with a trailing slash, empty/populated
  feeds, error/retry, Arabic RTL, dark theme, and no uncaught page errors.
  Also checked assistant-button clearance and opening/closing the assistant
  above the mobile navigation, with AI capability enabled in the fixture.
  Service workers were disabled in this fixture test so mocked API requests
  could not be intercepted by the worker.

## Live verification

The initial layout commit `1549bd25822361f7b7df88b73d6a62593cbb9d66` was pushed
to `old-files-claude`. The real `/media/` page served the new fingerprinted
`MediaShell-DKcU0bzS.js`, `MediaFeedPage-BDAUcNAe.js`, and
`MediaStyles-qC66_-FI.css` and loaded the public feed. `/ready` reported ready.
The temporary `node media-live-check.cjs` browser check passed at 320, 390, 768,
and 1440 pixels with one main landmark, no footer, no overflow, and no uncaught
page errors. The public feed returned no posts, so real populated-feed and
upload/publication checks are still unavailable.

CI run [37715586794](https://github.com/oxsteed/old-file/actions/runs/37715586794)
passed the full client/server verification and PostgreSQL migration rehearsal
for that initial layout commit.

The assistant-spacing follow-up `4530efc4aabfe3aa2edd0867222318624254b161`
also deployed. The live page loaded `MediaShell-FQTe1Sez.js`,
`MediaFeedPage-CcrxGLN0.js`, and `MediaStyles-CpOujqsV.css`. The live browser
check passed at 320, 390, 640, 700, 768, and 1440 pixels, including assistant
clearance and opening/closing its panel. Search and Spaces also retained the
single shared shell and fit the phone viewport. `/ready` remained ready and the
feed returned zero posts. The follow-up's full client/server verification and
PostgreSQL migration rehearsal passed in
[37716165736](https://github.com/oxsteed/old-file/actions/runs/37716165736).

## Activity tabs

`/media/notifications` now renders the existing authenticated notification
feed inside the Media shell. It supports unread counts, mark-all-as-read, row
read state, refresh, empty/loading states, and the existing notification API.
`/media/messages` embeds the existing conversation workspace so inbox search,
filters, conversation threads, archive actions, and realtime refresh continue to
use the established messaging system while the Media rail and bottom tabs stay
visible.

Both pages remain behind the existing authentication, identity, onboarding, and
Media launch gates. Their new copy is localized across all five catalogs.

The Media shell also uses the real OxSteed logo in its header and a compact
footer card with the full legal links, cookie settings, copyright, support email,
and phone contact. The footer stays above the mobile tab bar with safe-area
spacing on phones.
