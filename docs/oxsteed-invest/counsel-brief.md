# Counsel brief: OxSteed Invest (discussion draft)

Date: 2026-11-17. Branch: `feat/oxsteed-invest` (off default `2d8a4f19`).
Status: DISCUSSION DRAFT, NOT LEGAL ADVICE.

**This document is not legal advice, and it is not a legal opinion.**
It was prepared by the engineering team to give qualified counsel a
complete, accurate description of what OxSteed has built, what it
proposes to do, and what it has assumed, so counsel can confirm, strike,
or correct each point. Nothing in this brief authorizes live investment
activity.

**Counsel has not been identified or confirmed. No legal approval
exists.** No lawyer has reviewed this product, this brief, or the
settlement model described here. Legal approval must come from qualified
counsel, not from this brief and not from the engineering team. Live
investment activity (real Credit commitments, closing, proceeds release,
and distributions) stays disabled behind `INVEST_COMMITMENTS_ENABLED`
(default off) until counsel and the registered intermediary approve a
pilot. That gate is a deliberate design decision, not a formality: no
live commitment is possible while it is off, regardless of what the user
interface shows.

Companion documents: `docs/oxsteed-invest/SETTLEMENT_ASSUMPTIONS.md`
(assumptions A1-A8), `docs/oxsteed-invest/schema.md` (tables and ledger
model), `docs/oxsteed-invest/api.md` (routes and authority matrix),
`docs/oxsteed-invest/existing-investor-review.md` (what the pre-existing
"investor" reporting surface is and is not), and
`docs/oxsteed-invest/credit-origin-verification.md` (why the pre-existing
Credit ledger could not decide eligibility, and the lot model built to
fix it). The product spec is sections 1-13 of the build brief at
`~/workspace/goals/oxsteed-invest/hidden_files/build-brief-2026-11-17.md`
(not in the repo).

## 1. What OxSteed is proposing

OxSteed is a services marketplace. OxSteed Invest would let a person, or
an authorized representative of an organization, invest eligible
OxSteed Credit in approved fundraising opportunities published by
eligible entities (businesses) on OxSteed, and receive a revenue-share
interest in that entity's future revenue. The investor-facing method is
Credit only, always. The investor never touches fiat in the OxSteed
flow: no card, bank, or crypto checkout for investments exists in this
build, and none may be added as a silent fallback.

## 2. Investors invest in eligible entities, not in OxSteed

This is the locked model and the point most likely to be misunderstood:

- The investment is in the entity that published the opportunity
  (the business raising capital), not in OxSteed, Inc. or any OxSteed
  affiliate. No investor acquires equity, debt, or a revenue share in
  OxSteed itself through this product.
- There is no separate platform-investor persona. An investor is an
  ordinary OxSteed customer (or an authorized representative of an
  organization customer) who applies, is approved, and commits Credit
  to an entity opportunity. Applying never blocks ordinary customer
  functionality.
- The pre-existing "investor" surface on OxSteed is reporting about
  OxSteed the platform (KPIs, revenue, franchise pipeline) under the
  `investor.reporting` capability, governed by
  `ACCESS_INVESTOR_ENFORCEMENT`. That surface is retained and is
  unchanged by this build. It is NOT participation, and nothing in
  this build converts a reporting grant, a legacy `investor` mode, or
  an "Investor" account-type label into participation access.
  Participation needs its own application, eligibility check, and
  grant under the `investor.*` namespace (`investor.participate`),
  decided separately. The review that established this separation is
  `existing-investor-review.md` (18 items: 11 keep, 6 adapt,
  1 deprecate; the deprecated item, `GET /investor-summary`, which
  presented platform fee revenue as if it were investment, has been
  removed).
- The directory of opportunities is neutrally sorted (by publication
  date or closing date). There is no "best investment" score or
  ranking. Opportunity pages answer eight questions, distinguish
  entity-provided information from reviewer-checked information, and
  carry a verification badge that describes only what a reviewer
  recorded as verified at approval. The badge and the page never imply
  a guarantee of any return, and nothing in the product is a forecast.

## 3. Proposed investment structure (conditional, one structure only)

- **United States only.** Opportunities are US entities and US
  investors only (`country_code` is `US` only, enforced in the data
  model). No cross-border launch is contemplated in this build.
- **Revenue share as the first and only structure.** The agreement an
  investor accepts is a revenue-share agreement with the entity. No
  equity, debt, convertible, or second structure exists in this build.
- **Regulation Crowdfunding via a registered intermediary
  (PROPOSED, conditional).** The proposal is to conduct the offering
  under Regulation Crowdfunding through a registered intermediary
  (broker-dealer or funding portal). This has NOT been validated: no
  intermediary has been identified, no agreement exists, and counsel
  has not confirmed that Reg CF fits a Credit-funded revenue share.
  One structure only: if revenue share cannot support the Credit
  model, the obstacle must be documented and an alternative presented
  for a separate decision. The structure must never be silently
  changed.
- **Agreement version control.** Each opportunity carries versioned
  agreement text (SHA-256 content hash per version). A commitment
  records the exact agreement version id and number accepted; a stale
  version is refused at commit time. Material changes to a published
  opportunity go through a controlled amendment process: the entity
  proposes the amendment, investors are notified, and each investor
  must reconfirm (accepting the new agreement version) before their
  still-reserved commitment moves to it. Completed commitments never
  move. There is deliberately NO reviewer effective/reject step for
  amendments in this build: the API offers draft-to-proposed only,
  and the controlled process is notice plus reconfirmation. Whether a
  reviewer gate on amendments is required is a question for counsel
  (question 14 below).
- **No promise of return.** The product makes no promise of
  distributions, cash redeemability of Credit, or principal
  protection, anywhere.

## 4. OxSteed's role in facilitating the process

OxSteed provides the marketplace surface and the records; it does not
hold investor funds and does not itself conduct the offering:

- **Directory and disclosure surface.** OxSteed publishes the
  opportunity directory and detail pages, the investor application,
  the commit flow with its pre-confirmation review screen (exact
  amount, valuation rule, itemized fees, rights summary linked to the
  controlling agreement, pending-not-completed status, cancellation
  terms, risk acknowledgement, exact agreement version), and "My
  investments" (pending, completed, cancelled, updates,
  distributions, agreements, support).
- **Entity fundraising.** An entity representative (owner, manager,
  or authorized representative of a business) creates a private draft
  raise, previews it as an investor would see it, and submits it for
  review. Submission does NOT publish. Publication is a separate
  reviewer step (admin permission `review_invest_opportunity_publish`,
  not a registry capability), and the entity
  representative cannot publish their own opportunity. Entity
  ownership alone cannot publish.
- **Review and approval.** Platform reviewers hold separate review
  permissions for participation (`review_invest_participation`),
  opportunity publication (`review_invest_opportunity_publish`),
  closing (`review_invest_close`), and proceeds release
  (`review_invest_release_proceeds`). Closing and proceeds release are
  under SEPARATE authorities: no single grant authorizes both, no
  entity representative may approve their own opportunity, closing
  requires separate review and execution approvers who must differ,
  and the executor of a close must be the approved execution
  approver. No self-approval anywhere.
- **Recordkeeping.** OxSteed keeps the investment subledger (an
  immutable journal; UPDATE and DELETE are rejected by database
  triggers, corrections are new compensating entries), the agreement
  versions and acceptance evidence, the eligibility rechecks, and a
  full audit of reviewer and financial actions. Staff never edit
  totals directly; every category total is a sum over the subledger.
- **What OxSteed does not do in this build.** OxSteed does not hold
  investor funds directly, does not operate an escrow account, does
  not move fiat, does not set the offering terms, does not verify the
  entity's financial statements independently (see the verification
  limitation in section 7), and does not provide investment advice.
  There is no partner integration, no fiat movement, and no external
  call in this build: the settlement records described in section 6
  record an expectation of partner action, not partner action itself.

## 5. Credit-only contribution requirement

Credit-only is a HARD line set by the founder and is not negotiable
inside this build:

- Every commitment is funded exclusively with eligible OxSteed
  Credit. There is no fiat, card, bank, or crypto investor checkout,
  and no fallback payment method.
- If the regulated partner cannot support Credit-only settlement in
  the shape described in section 6, the build stops: the blocker is
  documented, live commitments stay disabled, and no unauthorized
  fallback is built. This is an explicit design rule, not an
  engineering preference.
- No investor fees are defined in this build. The commit review screen
  shows an empty fee itemization (`fees: []`, `feesTotalCents: 0`); no
  fee is invented. If an intermediary fee schedule is defined, it must
  be added explicitly, never silently.

## 6. Credit funding, custody, settlement, and proceeds release

This section states the best-guess settlement model the engineering
team built. Every assumption below is UNVALIDATED: none has been
confirmed by counsel or by a partner, and if counsel or the partner
answers differently, the money flows get reworked. The assumptions are
numbered A1-A8 in `SETTLEMENT_ASSUMPTIONS.md` and cited in code
comments at every place that depends on them.

### 6.1 How Credit eligibility is decided (the lot model)

The pre-existing Credit ledger kept one fungible balance per customer
per currency with no record of origin, so eligibility could not be
decided at all (`credit-origin-verification.md`, verdict: CANNOT).
Track 1 built a lot model alongside the existing journal, without
touching the journal, hash chain, locking, or `reserved_cents`
invariant:

- Every wallet inflow is tagged to exactly one lot, which keeps its
  source and restrictions for its whole life. Sources: `purchased`,
  `earned`, `promotional`, `referral`, `borrowed`, `adjustment`,
  `distribution`, `unknown`.
- Eligible at launch, in practice: **purchased settled Credit only.**
  The brief allows earned settled plus approved Credit, but there is
  no earned issuance path and no ledger definition of earned approval,
  so no earned lot can exist yet; the eligible set is purchased
  settled only until an earned issuance path is defined and built.
  Promotional, referral, borrowed, disputed, frozen, and restricted
  Credit are NOT eligible. A disputed lot contributes only its
  unencumbered remainder. An `unknown` lot is ineligible by default
  and is never silently reclassified; reclassification requires an
  admin attestation with actor, reason, and evidence reference.
- Existing balances were backfilled as `purchased` settled lots only
  where a provably completed top-up exists, capped at the still
  untagged balance, and `unknown` for the remainder. No balance was
  assumed eligible that the records cannot prove.
- Spend allocation is deterministic: oldest settled eligible lot
  first. A commitment records exactly which lots and amounts it
  consumed. Eligibility is computed inside the reservation
  transaction under the same row locks as the reservation, so the
  check and the hold cannot race; concurrent requests cannot overspend
  a balance or overfill an opportunity, and retried requests cannot
  duplicate a commitment (idempotency keys, unique per commitment).
- Known limit, stated plainly: ordinary spending does not yet allocate
  lots, so a partial ordinary spend does not reduce specific lots. The
  lot view and the wallet balance stay consistent because the eligible
  available amount is capped by the wallet available balance, and the
  backfill invariant (sum of lot remaining equals the wallet balance)
  is checked by reconciliation. Lot-aware ordinary spending is later
  work, not part of this build.
- **Carry-forward defect affecting settlement readiness (not fixed,
  needs the founder's call):** live top-up lot creation is broken on
  a migrated database. `completeCreditTopupFromWebhook` posts the load
  as actor `system`, and migration 487 rejects that actor. Until it is
  fixed, new purchased lots come from the backfill only; a live
  top-up that completes does not create a purchased lot, so its value
  cannot be proven eligible for a commitment. This is recorded here
  because it directly affects whether newly purchased Credit can fund
  a commitment at pilot time.

### 6.2 Assumptions A1-A8 and their validation status

| # | Assumption | Status |
|---|---|---|
| A1 | Investor-facing method is Credit only, always. No fiat leg, no silent fallback. | UNVALIDATED (founder hard line; counsel/partner must confirm it is supportable at all) |
| A2 | At commitment, eligible Credit is RESERVED (a real `oxsteed_credit_reservations` row plus lot allocations in `investment_commitment_lots`): unavailable for ordinary spending, not yet an investment position. Atomic transaction plus idempotency key. | UNVALIDATED |
| A3 | Reserved Credit maps to a monetary reference value at the Credit reference rate in force at reservation (stored per commitment as `credit_reference_rate`; this build records 1 Credit cent as 1 USD cent until counsel or the partner defines the rate source). The regulated partner holds the corresponding monetary value in escrow from commitment through closing. OxSteed holds no investor funds directly; the Credit reservation is the investor-facing mirror of the partner escrow hold. The `investment_settlements` rows of kind `escrow_expectation` record that expectation as `pending_partner_confirmation`; there is no partner integration, no fiat movement, and no external call in this build. | UNVALIDATED |
| A4 | Closing is all-or-nothing: target plus deadline plus conditions plus a separate closing approval, enforced in the settlement service, not the caller. On close, reservations complete (Credit debited, becomes an investment position under the exact agreement version accepted) and proceeds release to the entity goes through the partner settlement flow and is recorded in the subledger (entity proceeds awaiting release, then released). Proceeds cannot release before approved closing conditions. | UNVALIDATED |
| A5 | If closing does not occur (target missed, conditions fail, cancellation), reservations are released back to the ORIGINAL balance classification and restrictions. This build implements that by releasing the lot allocations without touching lot balances. | UNVALIDATED |
| A6 | Distributions: the entity pays through the partner; the investor is credited back as Credit through the approved settlement flow, with a traceable record (journal transaction, `distribution` lot, settlement row, subledger entry). No promise of distributions, cash redeemability, or principal protection. | UNVALIDATED |
| A7 | What this model does NOT assume: that an internal ledger transfer alone satisfies custody or settlement; that Credit is redeemable for cash; any guaranteed return. Nothing in this build treats the journal entries as proof of partner custody. | UNVALIDATED (a framing assumption; counsel must confirm the records and copy cannot be read as custody claims) |
| A8 | Eligibility is purchased settled only in practice (earned issuance is undefined; see 6.1). | UNVALIDATED (depends on the earned-issuance definition in question 11) |

### 6.3 Who holds monetary value at each stage (as built)

- **At commitment:** the investor's Credit is reserved in the
  investment subledger (pending reservations). Under A3, the partner
  holds the corresponding monetary value in escrow; OxSteed holds no
  investor funds directly. In this build there is no partner, so the
  escrow leg is an expectation record only, and no live commitment can
  occur while the commitments gate is off.
- **At closing:** reservations complete into investment positions;
  entity proceeds move to `awaiting_release`, then `released`, only
  after approved closing conditions and the separate closing
  approvals. Proceeds release goes through the partner settlement
  flow and is recorded in the subledger.
- **On failed closing or cancellation:** reservations are released
  back to the original lots (A5); the investor's Credit returns to
  its original classification and restrictions.
- **On distribution:** the entity pays through the partner and the
  investor is credited back as Credit (A6).

## 7. Investor and entity eligibility

- **Investor application.** A customer applies per opportunity: five
  sections kept separate (identity/authority, eligibility,
  opportunity requirements, confidential-document access, agreement
  acceptance). Approval requires identity verification and authority
  verification, recorded as reviewer findings; the reviewer cannot be
  the applicant. Agreement acceptance is a separate step from the
  other sections and stamps the exact version accepted.
- **Eligibility rechecked twice.** Eligibility is checked at
  application, rechecked at commit inside the reservation
  transaction, and rechecked again at closing. A commitment cannot be
  created from an unapproved application, and a stale agreement
  version is refused.
- **Entity eligibility.** The entity is a business on OxSteed whose
  representative is authorized (owner, manager, or authorized
  representative). The raise collects legal details, purpose, target,
  minimum, deadline, use of proceeds, financials, ownership, risks,
  and related parties, and requires an intermediary reference.
  Related-party relationships are collected and flagged for
  reviewers; whether related-party investment is restricted, and how,
  is a question for counsel.
- **Verification limitation (stated plainly).** The verification badge
  reflects entity-supplied information plus reviewer-recorded checks
  only. There is NO independent verification workflow in this build:
  no third-party verification of financials, identity documents, or
  entity claims beyond what a platform reviewer records at approval.
  The badge describes what was verified and never implies a
  guarantee. Whether independent verification is required before any
  live offering is a question for counsel.
- **Document access.** Confidential material is access-filtered per
  investor and opportunity (visibility `public` / `applicants` /
  `committed` / `reviewers`); cross-entity and cross-investor access
  is refused (404 resource hiding). File bytes are not served by the
  investment API; `storageRef` is an opaque reference returned only
  to callers who pass the check.
- **Suspension.** A suspended account keeps ownership, statements,
  and obligations: suspension never erases them. The invest
  controllers enforce a restricted read of the investor's own records
  (`suspended: true`, `restrictedRead: true`, no eligible-balance or
  write actions) and refuse writes. **Open item:** letting a suspended
  investor reach that restricted read live needs an
  authentication-exemption decision (the `/api/support/` paths are
  the existing exemption pattern); the platform `authenticate`
  middleware currently refuses suspended accounts on `/api/invest`
  paths with 403. No exemption has been invented here; the decision
  is open and is also a question for counsel (question 17).
- **Investment limits.** No per-investor Reg CF investment limit is
  computed in this build. Whether limits apply, and how they are
  calculated against Credit commitments, is a question for counsel
  (question 12).

## 8. Cancellation, unsuccessful closing, distributions, complaints, and recordkeeping

- **Cancellation by the investor.** A reserved commitment can be
  cancelled by its owner; the Credit reservation is released back to
  the original lots (A5). An application cannot be withdrawn while a
  live commitment exists. The commit review screen states the
  cancellation terms before confirmation, and the commitment status is
  `pending`, not completed, until closing.
- **Unsuccessful closing.** If the target is missed, the deadline
  passes, or the closing conditions fail, the opportunity does not
  close and reservations are released to the original classification.
  Closing is all-or-nothing (A4); there is no partial closing in this
  build.
- **Distributions.** After closing, the entity reports on a schedule;
  missed updates are shown overdue and never disappear. Distributions
  are credited back to the investor as Credit through the settlement
  flow (A6), with a journal transaction, a `distribution` lot, a
  settlement row, and a subledger entry. No live portfolio market
  value is shown anywhere: there is no defensible methodology for
  one in this build.
- **Complaints and support.** Investment support requests are written
  to the existing support surface (`support_tickets` plus
  `support_messages`, the same tables the general support flow
  writes), linked by metadata, with `complaint` mapped to high
  priority. Investors reach support from "My investments" and from
  the opportunity page.
- **Recordkeeping.** The investment subledger is immutable
  (append-only; corrections are compensating entries). Agreement
  versions, acceptance evidence, eligibility rechecks, reviewer
  decisions, closing approvals, and financial actions are all
  recorded with actor and timestamp. Every financial event is
  intended to reconcile across the Credit journal, the investment
  subledger, and the settlement records; that reconciliation is a
  spec acceptance criterion and is tested, but it has not been
  validated against a real partner settlement.
- **Pause without destroying records.** An opportunity can be paused;
  pausing preserves all records, commitments, and obligations.

## 9. Responsibilities assigned to any regulated partner

Until a partner is identified, these are proposed assignments for
counsel and the partner to confirm or correct. Nothing here is agreed:

- Hold the monetary value corresponding to reserved Credit in escrow
  from commitment through closing (A3), and confirm the hold to
  OxSteed so the `escrow_expectation` records can move from
  `pending_partner_confirmation` to confirmed.
- Conduct the offering under Regulation Crowdfunding as the registered
  intermediary (broker-dealer or funding portal), including whatever
  investor education, acknowledgement, disclosure, and filing duties
  that role carries.
- Receive entity proceeds at closing and release them to the entity
  only after OxSteed's approved closing conditions are met, and
  confirm each release.
- Receive entity distribution payments and route them back so the
  investor can be credited in Credit, with a traceable record.
- Hold and return escrowed value on failed closing or cancellation,
  in whatever form the custody arrangement requires (which may not be
  a release to original lots; see A5).
- Define, with counsel, the Credit reference rate: what 1 Credit cent
  is worth in monetary terms, who sets the rate, and when it is fixed.
- Define, with counsel, any intermediary fee schedule; fees are
  currently undefined and none are charged.

## 10. What is built, what is not built, and what stays open

Built complete (behind the flags): the investor directory and detail
pages, the application and commit flows with the pre-confirmation
review screen, "My investments", entity fundraising (private draft,
preview, submission, published-opportunity management, Q and A,
updates, amendments with notice and reconfirmation, documents,
agreement versions), the Credit lot model and investment subledger,
the `investor.*` authority matrix, closing and proceeds release under
separate authorities, distributions credited as Credit, and
complaint/support routes. Live activity stays disabled by design.

Not built, or open, and therefore not to be assumed by counsel:

1. No counsel identified or confirmed; no legal approval exists.
2. No registered intermediary identified; no partner agreement; no
   partner integration, escrow account, or fiat movement.
3. No investor fees defined; no fee schedule.
4. No independent verification workflow (badge reflects
   entity-supplied plus reviewer-recorded checks only).
5. No earned-Credit issuance path; eligible set is purchased settled
   only in practice (A8).
6. Live top-up lot creation is broken on a migrated database
   (actor `system` rejected by migration 487; see 6.1). New purchased
   lots come from the backfill only until fixed.
7. Suspended-account restricted read needs an authentication-exemption
   decision to be reachable live (see section 7).
8. No reviewer effective/reject step for amendments: the API offers
   draft-to-proposed only; the controlled process is notice plus
   reconfirmation. Whether a reviewer gate is required is question 14.
9. The opportunity-review decline note is stored in
   `verification_summary.reviewNote` because opportunities have no
   dedicated review-note column.
10. No per-investor Reg CF investment-limit computation.
11. No lot-aware ordinary spending (partial ordinary spends do not
    reduce specific lots; see 6.1).
12. No tax leg for distributions (withholding, reporting).
13. The draft-edit form (edit a private draft raise) exists in the
    client; direct edits are draft-only and a non-draft edit is
    refused with 409 `invest_opportunity_amendment_required`.

## 11. Questions for counsel

1. **Is the Credit-reservation-as-mirror-of-partner-escrow model
   supportable?** Specifically: can an investor-facing hold of
   OxSteed Credit, with the partner holding the corresponding monetary
   value in escrow, constitute a valid commitment under Regulation
   Crowdfunding, or must funds move at commitment rather than at
   closing?
2. **Who holds monetary value at each stage, and under what custody
   arrangement?** At commitment, at closing, on failed closing or
   cancellation, and on distribution: who is the custodian, what
   account holds the value, and what happens if that custodian fails?
3. **Are distributions credited back as Credit permissible?** May an
   investor's revenue-share distribution be paid in OxSteed Credit
   rather than fiat, and if so, under what conditions and disclosures?
   What changes if distributions must be paid in fiat?
4. **What must the intermediary be, and what must it do?** Must it be
   a broker-dealer or a funding portal, and what are its duties for
   investor education, acknowledgements, disclosures, filings, and
   handling of funds in a Credit-funded offering?
5. **What are the recordkeeping duties?** Which records must OxSteed
   keep, for how long, in what form, and who must be able to inspect
   them? Does the immutable subledger as built satisfy them?
6. **What are the complaint-handling duties?** What must the
   complaint route, response times, escalation, and recordkeeping be,
   and who bears them: OxSteed, the intermediary, or the entity?
7. **What changes if the partner cannot support Credit-only?** If no
   partner can hold value against a Credit reservation, or if
   Credit-only settlement is not supportable, what is the compliant
   alternative, and does it require a new founder decision on the
   Credit-only hard line?
8. **Is the Credit contribution itself a regulated act?** Does issuing,
   holding, reserving, or redeeming OxSteed Credit in this context
   implicate money transmission, money services business, or
   securities law, and does Credit itself risk being treated as a
   security?
9. **Does Regulation Crowdfunding permit a non-cash contribution
   medium?** Is a revenue-share interest "purchased" with Credit a
   purchase price Reg CF recognizes, and what disclosures must state
   that the consideration is Credit, not cash?
10. **What defines the Credit reference rate?** This build records
    1 Credit cent as 1 USD cent. Who must set the rate, what source
    governs it, when is it fixed (reservation, closing, or
    distribution), and what must investors be told about it?
11. **What counts as eligible Credit?** The build admits purchased
    settled Credit only, because earned issuance is undefined. What
    would "earned settled plus approved" need to mean in ledger terms
    for earned Credit to be eligible, and may promotional, referral,
    or borrowed Credit ever be eligible?
12. **Do per-investor investment limits apply, and how are they
    calculated?** Under Reg CF, what limits apply to an investor
    committing Credit, how are they measured (income, net worth,
    prior commitments), and who enforces them?
13. **What entity eligibility and disclosure duties apply?** What
    must an entity disclose (financials, ownership, risks, related
    parties, bad-actor checks, Form C or equivalent), who verifies it,
    and is independent verification required before a live offering?
14. **Is a reviewer gate required on amendments?** The build's
    controlled amendment process is notice plus investor
    reconfirmation, with no reviewer effective/reject step. Is that
    sufficient for material changes, or must a reviewer approve an
    amendment before it takes effect?
15. **What cancellation and refund rights and timing apply?** What
    must the investor's cancellation window be, how quickly must
    value be returned on cancellation or failed closing, and in what
    form must it be returned (original Credit classification, new
    issuance, or fiat)?
16. **What is the tax treatment of Credit distributions?** Are
    distributions taxable events, is withholding required, and what
    reporting (to the investor, to the authorities) must OxSteed, the
    intermediary, or the entity perform?
17. **What must happen for a suspended investor?** May a suspended
    investor reach a restricted read of their own investment records,
    statements, and obligations while writes are refused, and what
    authentication exemption, if any, is needed for that read to be
    reachable live?
18. **What are the marketing and communications restrictions?** What
    may the opportunity directory, detail pages, and entity updates
    say and not say (general solicitation, testimonials, projections,
    "best investment" language), and does the neutral sort satisfy
    them?
19. **What happens if the intermediary or partner fails?** Who holds
    the escrowed value, who returns it, and what notice and
    recordkeeping duties arise on partner insolvency or termination?
20. **What state-law requirements apply?** The launch is US-only:
    which state securities (blue-sky), money transmission, or consumer
    protection requirements apply, and do they change the
    Credit-only or escrow design?
