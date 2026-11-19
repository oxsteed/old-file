# Phase 0: persona roadmap verdicts re-verified against merged tip 861dc0373

- **Date:** 2026-11-19. Read-only verification; nothing built in this pass except this file and `persona-roadmap-decisions.md`.
- **Base:** `fix/persona-roadmap-1000` at `861dc0373` ("Merge pull request #804 from oxsteed/codex/persona-signup-flow"). Tip confirmed by `git rev-parse` in the worktree before each slice started.
- **What this tip is:** `1898dcf03` + the 59-commit PR #804 build (`1f929c499`) + Codex's 3 post-pause commits (`993a2d522`, `f7a6f155c`, `e52bb04e6`). It does NOT contain the remediation branch `8b5810e65` (deleted, never merged): none of its 10 reverts and none of its 8 forward commits are in this tree.
- **Method:** four parallel read-only slices (A 1-150, B 151-450, C 451-750, D 751-1000), each re-reading its groups' decisive code at this tip. Slice reports: `workspace/goals/enterprise-audit-remediation/hidden_files/self-audit-2026-11-19-roadmap-merged-tip-861dc0373-slice-{A,B,C,D}.md`. Coordinator spot-checked the load-bearing claims firsthand (policyRegistry helper requirements, activation.js dead branch, requireAccess escape hatch, key commits in range, the five 2026111909xxxx migrations, deliveryDriverAdmission, createBusinessTopup, requirePayoutReader, R-3 env fallback).
- **Scale:** EXISTS = core loop works end to end; PARTIAL = core machinery exists but the front door or a major leg is broken/missing; MOSTLY MISSING = infrastructure exists nearby but the persona has no working path; MISSING = nothing for the persona as sold.

## Verdict table

| # | Group | Items | 1898dcf03 | 8b5810e65 (deleted) | **861dc0373 (merged tip)** |
|---|---|---|---|---|---|
| 1 | Customer | 1-50 | PARTIAL | PARTIAL | **PARTIAL** |
| 2 | Household delegate | 51-100 | MISSING | MISSING | **MOSTLY MISSING** |
| 3 | Recipient and sponsor | 101-150 | MISSING | MISSING | **MOSTLY MISSING** |
| 4 | Helper/provider | 151-200 | PARTIAL | EXISTS | **PARTIAL** |
| 5 | Business owner | 201-250 | PARTIAL | PARTIAL | **PARTIAL** |
| 6 | Business team member | 251-300 | PARTIAL | PARTIAL | **PARTIAL** |
| 7 | Property manager | 301-350 | MOSTLY MISSING | PARTIAL | **PARTIAL** |
| 8 | Restaurant owner/manager | 351-400 | PARTIAL | PARTIAL | **PARTIAL** |
| 9 | Restaurant team member | 401-450 | PARTIAL | PARTIAL | **PARTIAL** |
| 10 | Driver/shipper | 451-500 | PARTIAL | PARTIAL | **PARTIAL** |
| 11 | Consultant | 501-550 | PARTIAL | PARTIAL | **PARTIAL** |
| 12 | Equipment owner/renter | 551-600 | EXISTS | EXISTS | **EXISTS** |
| 13 | Franchise operator | 601-650 | PARTIAL | PARTIAL | **PARTIAL** |
| 14 | Credit participant/cashier | 651-700 | MOSTLY MISSING | MOSTLY MISSING | **MOSTLY MISSING** |
| 15 | Bookkeeper/auditor/reporting user | 701-750 | MOSTLY MISSING | PARTIAL | **PARTIAL** |
| 16 | Partner/affiliate/supplier | 751-800 | MOSTLY MISSING | MOSTLY MISSING | **MOSTLY MISSING** |
| 17 | Learner/mentor/workforce | 801-850 | MOSTLY MISSING | MOSTLY MISSING | **MOSTLY MISSING** |
| 18 | Reviewer/provisioning approver | 851-900 | PARTIAL | PARTIAL | **PARTIAL** |
| 19 | Support/moderation/operations | 901-950 | PARTIAL (split) | PARTIAL | **PARTIAL (split)** |
| 20 | Integration owner/service actor | 951-1000 | MISSING | MISSING | **MISSING** |

**Counts at the merged tip: 1 EXISTS, 13 PARTIAL, 5 MOSTLY MISSING, 1 MISSING.**
Was at 1898dcf03: 1 EXISTS, 11 PARTIAL, 5 MOSTLY MISSING, 3 MISSING.
Four verdicts moved, all upward: G2 and G3 MISSING to MOSTLY MISSING, G7 and G15 MOSTLY MISSING to PARTIAL. No verdict moved down, but Helper did NOT reach EXISTS as it did on the deleted remediation branch, because the merged tree carries the PR's looser G-1 variant (see below).

## Sharpest findings

1. **G-1 is enforced on the merged tree, but in the PR's looser form, and this is the single most consequential difference from the deleted remediation branch.** `activationFor` + resolver `activation_incomplete` + projection + ApplicationsPage gating are real. But Codex commit `993a2d522` removed `payout_setup` from `helper.offer_services` (`server/services/access/policyRegistry.js:71`, now only `identity_verified` and `helper_terms`, with a "circular gate" comment) and added the `allowActivationIncomplete` escape hatch (`server/middleware/requireAccess.js:43,85,206-208`, wired into `helperProfile.js:22`). Verified firsthand: a helper with identity + terms but no W-9 and no Connect account can bid and accept bookings, because the work gates never check payout evidence (`server/services/helperOnboarding.js:50-65`). The helper W-9/Didit branch in `activation.js:104-113` is now dead code for `helper.offer_services`. The remediation's AC-025 hold does not exist here. This needs Emile's call before any deploy: restore `payout_setup` with per-route carve-outs (remediation design) or accept identity+terms-only activation.
2. **Correction to slice C:** slice C states the G-1 design "keeps payout_setup in the registry (the PR's removal was correctly not merged)". That is wrong. The removal IS in the merged tree: commit `993a2d522` is in `1898dcf03..861dc0373`, and `policyRegistry.js` at the tip shows only `identity_verified` and `helper_terms` for `helper.offer_services`. Slices A, B, and D agree, and the coordinator verified it firsthand. Do not plan from slice C's sentence.
3. **The merged tree is NOT the remediation branch; the 10 reverts never landed.** G-6/G-7, G-18, G-20, G-22, G-36, G-37, R-1, R-3, R-5, R-6 are all present in their build form. Any plan built from the 8b5810e65 verdicts must be re-based on this file. Conversely, the remediation's forward fixes (G-1 hardening, Track C/E CI provisioning, invest test fix, R-4 backfill strengthening) are NOT in this tree except where the build already contained them.
4. **G-6/G-7 are API-real, UI-thin, and undelivered in the places that matter.** Book-for-another columns, recipient view/cancel/notify, and the token status page exist, but no client code sends `recipientUserId`/`siteContactUserId`, no server code delivers the status link to the site contact, the site contact has no chat admission, and the migration's "carries onto jobs" promise has no implementing code.
5. **R-3 is env-gated, not fixed by default.** Top-up settlement falls back to actorType `system` unless `OXSTEED_CREDIT_SERVICE_ADMIN_ID` is set in Coolify (`server/services/oxsteedCreditTopupService.js:415-447`, loud warning logged), and fails on databases with migration 487 applied. Business-funded and Stripe-paid top-ups still fail to credit until Emile sets that value.
6. **R-4 backfill is present but weaker than the remediation's.** Its existing-row check keys only on the per-territory subject and misses the legacy `self` row (duplicate grant for legacy holders); its franchise evidence is the newest launched application only, so a two-territory operator gets one territory backfilled.
7. **G-36 is closed for admins, not for the support agent it was sold to.** The read-only booking detail is real, but it 403s non-admin roles and the support-agent workspace has zero links to it.
8. **G-4's execution leg is the common hole.** Provisioning requests are real, visible, decidable rows, but the service header states plainly that a decision "grants nothing by itself". Approving a partner, staff, or service-account request provisions nothing, and no service-account credential step exists at all.
9. **G-11 remainder: location members get no workspace links at all.** The wrong link is gone, but the resolver still projects locations with no `shortcuts`/`navigation` arrays, so `organizationLinks` yields zero links.

## Foundation gate status at the merged tip

| Gate | Status | Phase 1 consequence |
|---|---|---|
| G-1 activation | Enforced, restored with per-route carve-outs (commit `35efeaa9b`: `payout_setup` required again; Connect onboarding route carved out; profile tightened to the full gate) | Done; no gate work needed |
| G-6/G-7 book-for-another + site-contact | Built (commit `632b1ba25`: booking by id/email, status-link delivery via `sendNotification`, 7-day tokens, accept/decline/revoke, site-contact scoped read + chat admission, jobs carry-over) | Done; recipient-pays-through-own-instrument deferred |
| G-8 read-only finance scope | Closed (commit `7eca48d09`: credit archive honors the live `statements.view` override; expired/revoked overrides read nothing; G-19 boundary kept; link minting stays owner/manager-only) | Done; no gate work needed |
| G-46 driver onboarding gate | Closed (`deliveryDriverAdmission.js`, legacy OR `logistics.ship`) | No gate work needed |
| G-9/G-10 phantom capabilities | Closed by removal (`credit.participate`, `partner.attribute`, `workforce.learn` gone); `investor.participate` generic minting closed | No gate work needed |
| G-2/G-3 handoffs | Closed for all intents (team to `/vortex` + invite link, credit to `/credit/apply`, franchise to `/franchise/apply`, partner to `/affiliate`, workforce to `/learn`, staff/device to Applications with a visible request) | No gate work needed |
| G-4 provisioning records | Records real and decidable; execution leg missing | Build issuance or keep requests as records only |
| G-13 landing | Customer-first kept by design; workspace discoverable via notice + shortcuts | Decision only (item 49) |
| G-15/G-16 arrival/no-show/rework | Live on jobs; booking-level reschedule still absent | Booking reschedule design (item 14) |
| G-17 properties entity | Real `properties` table + `property_id` scoping | Delegation-by-site + units need a product decision |
| G-18 manager payout drafts | Present in tree (manager drafts + reads, owner confirms) | No gate work needed |
| G-20 business refunds | Present in tree (queues into Money Approvals dual-approval) | Verify the approvals queue end to end before calling it done |
| G-22 business-funded Credit | Present in tree (funder's own card, not a business payment method) | Funding-source decision (D-11) |
| G-26 multi-territory franchise | Closed (per-territory grants) | No gate work needed |
| G-36 support booking detail | Present for admins; support-agent path missing | Build the agent path or accept admin-only |
| R-1/R-5 | Present in tree (not reverted) | R-5 needs the B-1 non-reconfirmed call; R-1 needs the commitments-gate call |
| R-3 top-up actor | Present, env-gated | Coolify value needed (finding 5) |
| R-6 flags UI + escrow caller | Present in tree | No gate work needed |

## What Phase 1 starts from

Phase 1 does NOT start from zero and does NOT start from the 8b5810e65 verdicts. It starts from this file. The build order is the foundation gates first (G-1 decision, G-6/G-7 legs, G-8 archive leg), then the 20 groups in roadmap order. Groups with the least remaining work: Equipment (thin edges only), Customer (landing decision, booking reschedule, 26-35 tail), Helper (G-1 helper bar + item 152 inbox), Business owner (continuity 241-245 only). Groups needing a model decision before any code: Household delegate, Recipient/sponsor, Property manager (delegation/units), Consultant (practitioner surface), Credit participant (plain-customer enrollment), Partner (enrollment), Learner (mentor/assessment/cohorts), Integration owner (service-account model).

## Open decisions for Emile (carried into Phase 1)

- G-1 helper bar: restore `payout_setup` with per-route carve-outs, or accept identity+terms-only activation.
- R-3: set `OXSTEED_CREDIT_SERVICE_ADMIN_ID` in Coolify, or top-ups keep failing on migrated DBs.
- R-5 / Domain 7 B-1: what happens to non-reconfirmed commitments when an amendment goes effective (live in the merged tree, uncalled).
- R-1: Invest distributions dual approval is live in the merged tree; confirm it stays, given the commitments gate.
- G-19: is a location-filtered settlement ever derivable, or is option B (scoped sales view + HQ-only note) the answer for item 381.
- G-25: does a plain customer ever enroll as a Credit participant, or is the persona merchant/helper-only.
- G-22 funding source: is the funder's own card acceptable as "business-funded", or is a business payment method required.
- Consultant practitioner surface: build self-serve application/proposal/conflict, or accept admin-mediated consulting.
- G-45: are platform-wide-labeled KPIs acceptable for position holders, or must KPIs be truly position-scoped.
- Property delegation: membership-to-property assignment model + units table, or property stays a scoping filter on business-level workflow.
- helperProfile gate: already loosened by 993a2d522; keep the setup gate or tighten back to full activation.
