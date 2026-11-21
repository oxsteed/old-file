# Persona signup coverage

Signup is customer-first. A selected persona records a descriptive intent and
routes the verified account to the owning admission mechanism; it never grants
capability, membership, staff authority, workspace access, or investment
participation.

| Catalog family | Signup intent | Admission mechanism | Verified next step | Protected access |
| --- | --- | --- | --- | --- |
| Customer | `find_help` | Baseline customer access | Personal Home | Customer actions only |
| Helper | `offer_services` | Platform-reviewed application | Helper application | Only after approval and activation |
| Business owner | `run_business` | Platform-reviewed application | Business application | Only after approval and payout/setup requirements |
| Business team | `join_business_team` | Organization invitation or membership approval | Enter the organization's code at `/vortex` | Only after authorized redemption or approval for that organization |
| Restaurant owner | `run_restaurant` | Platform-reviewed application | Restaurant application | Only after approval and restaurant activation |
| Restaurant team | `join_restaurant_team` | Organization invitation or membership approval | Enter the restaurant team's code at `/vortex` | Business membership and restaurant location assignments remain independently enforced |
| Logistics and delivery | `ship_goods` | Platform-reviewed application | Logistics application | Only after effective logistics access |
| Consultant | `consult` | Platform-reviewed application | Consultant application | Only after approval and activation |
| Equipment owner | `list_equipment` | Platform-reviewed application | Equipment application | Only after approval and payout/setup requirements |
| Franchise | `franchise` | Domain-owned territory enrollment | Program/status handoff | No tools until territory assignment |
| Investor reporting | `request_reporting` | Platform-reviewed reporting request | Reporting application | Reporting only; never investment participation |
| Credit participant | `join_credit` | Domain-owned Credit enrollment | Apply at `/credit/apply` with an eligible business or helper profile | Existing eligibility, review, and activation gates apply |
| Partner or affiliate | `join_partner` | Domain-owned partner enrollment | Program/status handoff | No attribution tools until approval |
| Workforce and learning | `join_workforce` | Domain-owned program enrollment | Learn/program handoff | No professional tools until enrollment |
| Reviewer | `request_reviewer` | Internal staff provisioning | Staff support handoff | No staff shell from signup |
| Support agent | `request_support` | Internal staff provisioning | Staff support handoff | No staff shell from signup |
| Operations staff | `request_operations` | Internal staff provisioning | Staff support handoff | No staff shell from signup |
| Device or service account | `request_device` | Nonhuman credential provisioning | Administrator handoff | No human navbar or human authority |

The client coverage list is derived from `PERSONA_NAVIGATION_CATALOG`, and the
signup test asserts that every one of its 18 families has exactly one intent.
Unknown or forged privileged values still normalize to `find_help` on the
server.

The Vortex and Credit handoffs remain available under Settings → Applications
for the verified account that chose the intent. The handoff does not redeem
an invitation or submit an application.

The original database constraint only stored the first four intents.
`20261119081037_expand_signup_intent_storage.sql` expands storage to normalized
intent identifiers. The policy registry still controls which values signup
accepts and whether the next step opens a platform application.


## Goal-first entry (PR #805 follow-up)

The default signup chooser emphasizes Hire local help, Offer services, and Run
a business. “More ways to use OxSteed” expands the other 15 catalog paths.
All 18 catalog families retain their original admission mechanisms. This is a
display grouping; neither the grouping nor a URL hint creates authority.

Supported `goal` or `intent` values can identify a catalog family ID or its
signup intent. Recognized legacy `mode` links still work. A valid preselection
shows the selected goal immediately above personal details, with Change goal
available; changing it focuses the selected choice and expands specialized
choices when needed. Unknown or privileged legacy hints cannot select new
access. A specialized saved draft reopens the relevant group. A different
explicit goal preserves typed contact details but discards an incompatible
pending registration token and verification state.

An `invite` link takes priority over unrelated goals. It starts the customer
account and then opens invitation review after email verification, without
asking the user to select a team again. Existing verified users enter that
review directly. The client carries only the invitation ID; the existing
server invitation API checks account match, expiry, scope, and acceptance.
Missing or unavailable invitations offer Applications recovery and no accept
button. Signup and selecting a goal never accept an invitation automatically.

The same chooser is used by standalone and embedded signup. New strings are
present in both catalog structures for en/es/fr/ht/ar. Native disclosure,
keyboard operation, selected-choice focus, admission status announcements, and
visible descriptions are retained on narrow and RTL layouts.

Verification is recorded against the commit containing this section. Local
synthetic browser coverage exercises all 18 direct goals, specialized discovery,
saved drafts, legacy and explicit intent links, new-account invitation review,
and existing-account invitation review. Server authority and production
invitation delivery are not established by synthetic browser fixtures. No
production change or deployment is part of this follow-up.

Local verification for the goal-first follow-up:

- From `client/`, `node --test scripts/signupPersonas.test.mjs scripts/signupValidation.test.mjs`: 9 passed (0.97s).
- `npm run build:ci`: passed, 1,247 emitted assets validated; production bundling 1m33s.
- `node --test client/scripts/signup.browser-check.cjs`: six journeys passed; the new all-catalog journey timed out on a fixture click targeting the visually hidden radio. Corrected the test to activate the visible card.
- `node --test --test-name-pattern='goal-first|invitation entry' client/scripts/signup.browser-check.cjs`: both passed (24.23s), including all 18 direct goals, incompatible-draft recovery, new/existing-account invitations, and invalid invitation recovery. The entire browser file was not repeated after that test-only click correction.
- Desktop/mobile/embedded light/dark screenshots and Arabic RTL were inspected. These are synthetic-browser checks, not a human screen-reader or production acceptance pass.
- Growth instrumentation check: 1,033 eligible files, 3,085 named interactions, full coverage. `git diff --check` passed.
- Reconciled remote CI-fixture commit `5bc1409993ff300ae00c0dacc68d74d5a4d35b0d` with a fast-forward before delivery; it changes server tests only. Those suites were not rerun for this client-only follow-up.

## Signup CI regression repair

At `b58b7e7155f8aef8c2c72948529bddbf856c7852`, GitHub run
`44853005375` failed the client smoke job in
`progressiveAccessModeRetirement.test.mjs`. The source assertion expected
`intentForLegacyMode` and inline preset initialization in JoinPage even though
that logic now belongs to `signupEntryForParams`. The repaired test checks that
JoinPage uses the shared entry resolver, exercises legacy customer/helper/owner/
driver/investor intent mapping, and rejects self-selection of privileged or
unknown legacy values. Existing no-role-switch and intent-only payload guards
remain. No application runtime or authorization behavior changes in this fix.

Focused retirement and persona tests: 10 passed (0.58s). Full CI smoke command
and result are recorded below. A production build is not repeated for this
test-only change; the application build at `b58b7e715` passed both locally and
in GitHub CI. Remote CI for the repair commit remains separate evidence.

From `client/`, `node --test scripts/*.test.mjs`: all 943 passed, no skips or cancellations (19.27s). `git diff --check` passed.

### Source-suite CI follow-up

Run `44853568362` at `b6d7b1fb01dbf123b5570508a2e9f4e580c7199b`
passed client smoke tests, then failed the separate `Client src unit tests`
step: `utils/legacyDeepLinks.test.mjs` also required the old inline parser.
That assertion now verifies JoinPage delegates to the shared resolver and tests
every recognized legacy join alias against its indexed intent. Both CI unit
groups were run together locally: all 1,132 tests across 206 files passed,
no skips or cancellations (32.94s). No application runtime change; the existing
successful client build remains applicable. Remote CI for the new repair commit
is separate from these local results.

The full `node --test client/scripts/signup.browser-check.cjs` rerun passed all seven journeys (96.92s), including responsive/RTL/embedded layouts, application recovery, all 18 goal deep links, saved drafts, and invitation acceptance. `git diff --check` passed.
