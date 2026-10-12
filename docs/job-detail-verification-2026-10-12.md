# Job detail layout and next steps

Implemented in the web client on 2026-10-12. Shared navbar/footer, server APIs,
permissions, payment policies, and cancellation confirmation components remain
in place. Job/account changes reset the page state; outdated job/bid responses
cannot replace the current viewer's data.

## Result

- Full-width summary with labeled budget and single location/urgency/type display.
- Compact supporting details and participant information. Date-only schedules
  retain their calendar date instead of shifting to the previous local day.
- Desktop content/action columns; mobile summary, next step, content, details.
- Owners see bids first. Helpers see combined requirements/skills before the
  bid form or their own bid. Media retains proportional, uncropped contents.
- Viewer/status model chooses one primary next step. Existing mutation handlers,
  acceptance terms, direct-payment recording, cancellation acknowledgments and
  review eligibility remain connected to their existing components and APIs.
- Signed-in, nonempty, normalized IDs determine ownership/assignment; owner
  precedence prevents a helper-role owner from bidding on their own job.
- Authenticated bids are not requested for guests or after the old page unmounts.
  Loading, failed/malformed responses, successful empty results, and existing
  bids are distinct. The bid form is withheld until a successful check.
- Owner totals use `job.bid_count`, with a partial-list notice when fewer bids
  were returned. Other bidders see their own server-filtered records only.
- Theme tokens, logical RTL spacing, associated form labels, visible focus and
  44px controls. Image viewer supports Escape, RTL-aware arrows, contained focus
  and return to its opener. Existing native audio/video controls remain.
- 43 new labels/messages plus the corrected accepting-bids status have matching
  legacy/common-namespace translations in
  English, Spanish, French, Haitian Creole and Arabic.

## Verification

Commands run from `client/`:

- `npm run test:job-detail`: 8 behavioral/localization tests passed. Owner,
  helper, Helper Pro, broker, incomplete helper, assigned helper, other viewer
  and guest cases; all known statuses plus an unknown status; ownership guards;
  bid-check failures; existing bids including withdrawn/rejected; cancellation
  gates; total/visible counts; skill destinations and malformed fields.
- `npm run test:job-detail-browser`: passed in headless installed Chrome. Real
  page, job/bid hooks, image viewer, acceptance/payment/cancellation/review
  components rendered against synthetic APIs. Supporting reputation/history,
  materials, report and preferred-helper components are fixture substitutes;
  navbar language/theme/mode/business controls are substitutes in this fixture.
  Dedicated navbar/footer fixtures below cover those controls separately.
- Browser layout matrix: 90 combinations (owner/helper/guest × en/fr/ar ×
  light/dark × 320/390/768/1360/1600px). Checked overflow, wrapping of long
  titles/descriptions, touch targets, full-width summary and mobile order.
  Inspected captured dark desktop English/mobile Arabic and light desktop
  French/mobile English images visually. Posting expiry uses a localized
  calendar date; the French published status explicitly means open to bids.
- Browser interactions: bid/form section focus; helper discovery with/without
  skill IDs; existing-bid management; onboarding route; bid loading/error/retry
  and malformed responses; failed/successful submissions; assignment including
  informational policy-fetch failure; start and completion; direct-payment
  amount/party/source payload; both cancellation acknowledgment gates and the
  existing cancellation APIs; optional cancellation reason/Escape/focus return;
  completed/closed review dialogs; guest sign-in return path; old job/account
  responses; delayed bid completion after logout; gallery native-button
  activation, image-only arrows across audio/video, Tab/Shift+Tab, Escape,
  focus return and Arabic arrow direction; budget variants and missing fields;
  loading/error shell with navbar/footer and retry.
- `npm run test:navbar-navigation-browser`: passed, 90 layout combinations plus
  mode switching, workspace selection, unread badges and disclosure interactions.
- `npm run test:footer-navigation-browser`: passed, 120 layouts plus account-scoped
  support membership, cookie settings and synthetic invitation flows.
- `npm run verify:i18n` and `git diff --check`: passed.
- Final `npm run build:ci`: passed. 285 tests passed, zero failures/skips;
  required regressions, localization and TypeScript passed. Vite built
  successfully and `verify:dist-assets` validated all 770 emitted assets.

All write/API scenarios above use synthetic data. No production job, bid,
payment or cancellation was submitted. Automated keyboard/layout evidence is
not a human screen-reader or production deployment verification.

## Delivery

GitHub reports `old-files-claude` as the repository default branch for
`oxsteed/old-file`; origin was synchronized before committing. Only files for
this change and this verification record are included. Deployment status is
reported separately; do not wait or poll for deployment.
