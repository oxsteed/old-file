# OxSteed Invest API (Track 2)

Date: 2026-11-17. Branch: `feat/oxsteed-invest`. All routes live under
`/api/invest` (router `server/routes/invest.js`, controllers
`server/controllers/investController.js`, domain operations
`server/services/invest/investApi.js`). Money movement stays in
`server/services/invest/settlementService.js` and
`server/services/invest/creditLots.js`; this document covers the authority
and route layer only.

Live activity for real Credit commitments stays behind the live
commitment gate by design. `INVEST_ENABLED` (master) defaults TRUE
(revised 2026-11-17 ~07:58 EST by Emile: everything ships default-on):
every Invest surface, flow, and capability is visible and usable
without a flag flip. The ONE deliberate exception is
`INVEST_COMMITMENTS_ENABLED` (commit, close, proceeds release,
distribute; default off, pilot gate via `INVEST_PILOT_USER_IDS`) until
counsel + partner approve a pilot. The commitment/closing/proceeds/
distribution flows are built COMPLETE but inert behind that gate; no
live commitment is possible while it is off, regardless of UI state.
Every route rechecks the flags server-side.
`ACCESS_INVESTOR_ENFORCEMENT` governs `investor.reporting` only and is
never read as a participation gate.

## Conventions

- Auth: every route starts with `authenticate`. Reviewer routes add
  `requireAdmin` + `requirePermission(<permission>)`. Money routes add
  `rejectImpersonated`.
- Errors: `{ error, code, status }` (shared errorHandler). `AppError` codes
  are listed per route below.
- Idempotency: `POST /opportunities/:id/commitments`,
  `POST /applications`, `POST /opportunities/:id/distributions`, and
  `POST /support-requests` require (first three) or accept (support) an
  `Idempotency-Key` header. A replay returns the original record with
  `replayed: true` and does not duplicate state. A key reused for a
  different record is 409.
- Expected version: reviewer and entity write endpoints accept
  `expectedVersion` and refuse stale reads with 409 (AC-014 pattern:
  the check runs inside the same row lock as the write).
- Status vocabulary: the application lifecycle is draft / submitted /
  in review (`under_review`) / needs information (`needs_information`) /
  approved / declined / withdrawn. Declined is stored as `rejected` in
  `investment_participation_applications` (Track 1 vocabulary, kept) and
  presented as `declined` by the API.
- Suspension: a suspended account keeps ownership, statements, and
  obligations. In production the platform `authenticate` middleware
  refuses suspended accounts on `/api/invest` paths with 403
  `ACCOUNT_SUSPENDED`, which is the defined error for writes. The invest
  controllers additionally enforce the rule at the controller layer:
  reads of the investor's own records stay available in restricted form
  (`suspended: true`, `restrictedRead: true`, no eligible-balance or
  write actions) and writes are refused with 403
  `invest_account_suspended`. The restricted read is reachable through
  the service layer today; letting a suspended investor reach it live
  needs an auth-exemption decision (the `/api/support/` paths are the
  existing exemption pattern) and is still open; it is also recorded as
  an open item in the counsel brief.

## Authority matrix (policy registry)

| Capability | Review permission | Legacy grants | Notes |
|---|---|---|---|
| `investor.participate` | `review_invest_participation` | none | Own reviewer pool; never reuse `review_investor_access`. `investor.reporting` is never a shortcut to participation. |
| `investment_opportunity.publish` | `review_invest_opportunity_publish` | none | Publish requires status `approved`; reviewer cannot be the entity representative. |
| `investment.close` | `review_invest_close` | none | Separate review + execution approvers; neither the entity representative. |
| `investment.release_proceeds` | `review_invest_release_proceeds` | none | Separate authority from close; no single grant authorizes both. |

Document access is explicit per investor x opportunity (live application,
commitment, or position) with visibility `public` / `applicants` /
`committed` / `reviewers`. There is no blanket document capability.
Investment record viewing is by relationship ownership; entity updates
are by delegated entity authority (business owner or an active
`business_members` manager/representative).

The `GET /api/me/access` projection carries the granted invest
capabilities in `personal` (any effective grant, via the generic
resolver projection) and the client-visible flags in `invest`
(`investEnabled`, `investCommitmentsEnabled`, `investPilot`). The flags
are display state only; the routes recheck them server-side.

## Routes

### Directory and opportunity detail

| Method and path | Auth | Flags | Notes |
|---|---|---|---|
| `GET /api/invest/opportunities` | authenticate | INVEST_ENABLED | Published only. `?sort=publication_date` (default) or `closing_date`. Neutral sort only; no score, no ranking. `?scope=mine` lists the caller's entity drafts and published raises. Each opportunity carries `entityName`, `entityActivity` (business type), and `entityLocation` (city, state) from the entity business record, so the directory can name the entity without a second lookup. Each row also carries `reservedCents` (pending commitments, never completed funding), `completedCents`, and `investorCount` from one grouped commitment query, so directory progress is accurate without per-card reads. |
| `GET /api/invest/opportunities/:id` | authenticate | INVEST_ENABLED | The eight spec questions with provenance (`entity_provided` / `checked`), funding totals (reserved commitments labeled pending, never completed funding), verification badge, and access-filtered documents. Non-public statuses are visible only to the entity representative or a reviewer (others get 404). |
| `GET /api/invest/opportunities/:id/preview` | authenticate | INVEST_ENABLED | Investor-facing view of a draft, for the entity representative or a reviewer. |

Verification badge: `status` is `verified_items` when a reviewer recorded
verified items at approval, otherwise `not_verified`. The note always
states that verification of a document is not a guarantee of any return.
Nothing in the detail is a forecast.

Errors: `invest_disabled` 503, `invest_opportunity_not_found` 404.

### Entity fundraising

| Method and path | Auth | Notes |
|---|---|---|
| `POST /api/invest/opportunities` | authenticate, entity representative of `businessId` | Private draft. Body: `businessId`, `title`, `purpose`, `targetCents`, `minimumCents`, `deadlineAt` (future), `valuationRule`, `useOfProceeds`, `intermediaryRef`, `details` (`legalDetails`, `financials`, `ownership`, `risks`, `relatedParties`). 201. |
| `PUT /api/invest/opportunities/:id` | authenticate, entity representative | Draft only. Direct edits to a non-draft opportunity are 409 `invest_opportunity_amendment_required`: material changes go through amendments. Client: the draft-edit form at `/invest/entity/raises/:id/edit` (Track 5) reuses the raise-page fields, sends the rendered `expectedVersion`, and shows the investor preview after save. |
| `POST /api/invest/opportunities/:id/submit-for-review` | authenticate, entity representative | Draft to submitted. Submission does NOT publish. |
| `POST /api/invest/opportunities/:id/agreement-versions` | authenticate, entity representative | Body `body` (agreement text). Creates the next version; the opportunity current version moves to it. 201. |
| `GET /api/invest/opportunities/:id/agreement-versions` | authenticate, representative / reviewer / related investor | Version list (id, version number, SHA-256 content hash). No body text is returned here. |

### Participation applications

| Method and path | Auth | Notes |
|---|---|---|
| `POST /api/invest/applications` | authenticate | Idempotency-Key required. Body `opportunityId`, `agreementVersionId` (optional; defaults to the opportunity current version). Creates a draft. Applying never blocks ordinary customer functionality: no account, mode, or grant change, and no global gate is set on the applicant. 201 (200 on replay). |
| `GET /api/invest/applications` | authenticate | The caller's applications. |
| `GET /api/invest/applications/:id` | authenticate | Owner or reviewer. Others get 404. |
| `PATCH /api/invest/applications/:id` | authenticate, owner | Draft or needs-information only. Writes the eligibility section only; identity/authority are reviewer findings and agreement acceptance has its own endpoint. |
| `POST /api/invest/applications/:id/submit` | authenticate, owner | Draft or needs-information to submitted. |
| `POST /api/invest/applications/:id/withdraw` | authenticate, owner | To withdrawn. Blocked with 409 `invest_application_withdraw_blocked` while a live commitment exists. |
| `POST /api/invest/applications/:id/accept-agreement` | authenticate, owner | Accepts the opportunity current agreement version and stamps `agreementAcceptedAt`. Separate from the other sections by design. |
| `POST /api/invest/applications/:id/review` | requireAdmin + `review_invest_participation` | Body `decision`: `approved`, `declined`, or `needs_information`; `identityVerified`, `authorityVerified`, `reviewNote`, `expectedVersion`. Approval requires identity and authority verification (409 otherwise). The reviewer cannot be the applicant (403 `invest_application_self_review`). `needs_information` requires a note and returns the application for more information. |

Errors: `invest_application_opportunity_not_published` 409,
`invest_application_agreement_stale` 409,
`invest_application_idempotency_conflict` 409,
`invest_application_version_conflict` 409.

### Commit flow

| Method and path | Auth | Flags | Notes |
|---|---|---|---|
| `POST /api/invest/opportunities/:id/commitments` | authenticate | INVEST_ENABLED + INVEST_COMMITMENTS_ENABLED | Idempotency-Key required. Body `applicationId`, `amountCents`, `agreementVersionId`, `riskAcknowledged: true`. The service rechecks eligibility at commit inside the reservation transaction (eligible lots, overfill guard, opportunity lock). 201 (200 on replay). |
| `POST /api/invest/commitments/:id/cancel` | authenticate | INVEST_ENABLED | Owner only. Reserved commitments only; the Credit reservation is released back to the original lots. |
| `GET /api/invest/commitments/:id` | authenticate | INVEST_ENABLED | Owner, reviewer, or entity representative. Others get 404. |

The commit response carries the review-screen data: `commitment`,
`replayed`, and `review` with the exact amount, valuation rule,
itemized fees (`fees: []`, `feesTotalCents: 0`; no investor fees are
charged in this build and no fee is invented), a rights summary linked
to the controlling agreement (version id, number, SHA-256 hash),
`status: 'pending'` with a pending-not-completed note, cancellation
terms, risk acknowledgement, and the exact agreement version accepted.
A commitment records the exact agreement version id and number; a
stale version is 409 `invest_commitment_agreement_stale`, and a missing
risk acknowledgement is 400
`invest_commitment_risk_acknowledgement_required`.

Errors: `invest_commitments_disabled` 503,
`invest_idempotency_required` 400,
`invest_commitment_application_not_approved` 409,
`invest_insufficient_eligible_credit` 409,
`invest_commitment_overfill` 409.

### My investments

| Method and path | Auth | Notes |
|---|---|---|
| `GET /api/invest/me` | authenticate | Sections: `pending` (reserved commitments), `completed`, `cancelled`, `positions`, `applications`, `updates` (published, plus overdue), `distributions`, `agreements` (versions accepted), `amendments` (proposed/effective), `reconfirmationRequired`, `support`, `eligibleCreditCents`, `walletAvailableCents`. Never a live portfolio market value. Suspended callers get the restricted read (see Suspension above). |

### Reviewer queue, closing, proceeds, distributions

| Method and path | Auth | Notes |
|---|---|---|
| `GET /api/invest/review-queue` | requireAdmin | Capability-scoped: the caller only sees the queues their own review permission covers (`?type=applications|opportunities|closing|proceeds`). Super-admins see all. No permission: 403 `invest_review_not_permitted`. |
| `POST /api/invest/opportunities/:id/review` | requireAdmin + `review_invest_opportunity_publish` | Body `action`: `claim` (submitted to under_review), `approve` (under_review to approved, with `verificationSummary.verifiedItems`), `decline` (under_review back to submitted, with `note`). `expectedVersion` checked. |
| `POST /api/invest/opportunities/:id/publish` | requireAdmin + `review_invest_opportunity_publish` | Approved only, with an agreement version; stamps `publishedAt`. The entity representative cannot publish their own opportunity (403 `invest_opportunity_self_publish`). |
| `POST /api/invest/opportunities/:id/closing-conditions/approve` | requireAdmin + `review_invest_close` | Records the approver of the closing conditions. The entity representative cannot approve their own conditions (403 `invest_close_self_approval`). |
| `POST /api/invest/opportunities/:id/closing-approvals` | requireAdmin + `review_invest_close` | Body `stage`: `review` or `execution`; `decision`, `note`. Execution requires an approved review first, and the two approvers must differ (403 `invest_close_same_approver`). |
| `POST /api/invest/opportunities/:id/close` | requireAdmin + `review_invest_close`, commitments flag | All-or-nothing close; only the approved execution approver may execute it (403 `invest_close_executor_mismatch`). Target, approved closing conditions, and both approvals are enforced in the service. |
| `POST /api/invest/opportunities/:id/release-proceeds` | requireAdmin + `review_invest_release_proceeds`, commitments flag | Blocked until the opportunity is closed with approved closing conditions (409 `invest_proceeds_blocked`). The entity representative cannot release their own proceeds (403 `invest_proceeds_self_release`). |
| `POST /api/invest/opportunities/:id/distributions` | requireAdmin + `review_invest_release_proceeds`, commitments flag | Idempotency-Key required. Body `positionId`, `userId`, `amountCents`. The distribution is credited as Credit with a traceable journal transaction and a `distribution` lot. |

### Q and A, updates, amendments, documents

| Method and path | Auth | Notes |
|---|---|---|
| `POST /api/invest/opportunities/:id/questions` | authenticate | Applicant or investor in a published opportunity only. 201. |
| `GET /api/invest/opportunities/:id/questions` | authenticate | Representative, reviewer, or related investor. |
| `POST /api/invest/opportunities/:id/questions/:questionId/answer` | authenticate, entity representative | Answers an open question. |
| `POST /api/invest/opportunities/:id/updates` | authenticate, entity representative | Body `title`, `body`, `dueAt`. Draft. 201. |
| `GET /api/invest/opportunities/:id/updates` | authenticate | Representative/reviewer see all; related investors see published and overdue. Missed updates surface as `overdue` (computed from `due_at` on read) and never disappear. |
| `POST /api/invest/opportunities/:id/updates/:updateId/publish` | authenticate, entity representative | Draft or overdue to published. |
| `POST /api/invest/opportunities/:id/amendments` | authenticate, entity representative | Body `changes` (object), `newAgreementVersionId` (optional). Draft. 201. |
| `GET /api/invest/opportunities/:id/amendments` | authenticate | Representative, reviewer, or related investor. |
| `POST /api/invest/opportunities/:id/amendments/:amendmentId/propose` | authenticate, entity representative | Draft to proposed; sets `noticeSentAt` and requires a future `reconfirmationDeadlineAt`. This is the investor notice step. |
| `POST /api/invest/opportunities/:id/amendments/:amendmentId/reconfirm` | authenticate, investor with a live application | Accepts the amendment's new agreement version on the live application and moves any still-reserved commitments to it. Completed commitments never move. |
| `POST /api/invest/opportunities/:id/documents` | authenticate, entity representative | Body `title`, `storageRef`, `visibility` (`public`, `applicants`, `committed`, `reviewers`), `confidential`. 201. |
| `GET /api/invest/opportunities/:id/documents` | authenticate | Access-filtered list (see below). |
| `GET /api/invest/documents/:id` | authenticate | Single document with the explicit per-investor x opportunity access check; cross-entity and cross-investor access is 404 (resource hiding). |

Document access: staff reviewers and the entity representative see all
documents for the opportunity; `public` is visible to any authenticated
caller who may view the opportunity; `applicants` needs a live
application; `committed` needs a reserved/completed commitment or an
active position. File bytes are not served here; `storageRef` is the
opaque storage reference, returned only to callers who pass the check.

### Support

| Method and path | Auth | Notes |
|---|---|---|
| `POST /api/invest/support-requests` | authenticate | Body `opportunityId` and/or `commitmentId`, `category` (`complaint` maps to high priority), `subject`, `details`. Writes to the existing support surface (`support_tickets` + `support_messages`, the same tables `POST /api/support-reports` writes), linked by metadata (`invest_support`, `invest_opportunity_id`, `invest_commitment_id`). Idempotent on a UUID `Idempotency-Key` header (stored as `client_request_id`). 201 (200 on replay). |
| `GET /api/invest/support-requests` | authenticate | The caller's investment support tickets. |

## Removed endpoint

`GET /investor-summary` (admin only, `server/routes/payments.js:44`,
`getInvestorSummary` in `server/controllers/paymentController.js`) was
REMOVED. It returned captured platform fees as `total_invested_cents`
and open jobs as `active_opportunities`, which is the wrong model under
the locked decisions (investing means Credit committed to entity
opportunities). Verified by grep over `client/src` and `server`: no
client caller existed besides the route and controller, and no test
referenced it. There is no replacement yet; subledger aggregates over
the investment tables are the future replacement if one is wanted.

## Schema changes (Track 2)

One migration: `20261117124812_invest_track2_authority.sql`.

- `investment_opportunities.details` JSONB: legal details, financials,
  ownership, risks, related parties (validated server-side to those keys).
- `investment_opportunities.verification_summary` JSONB plus
  `verified_at` / `verified_by`: what a reviewer verified at approval.
- `investment_opportunities.published_at`: directory publication-date sort.
- `investment_participation_applications` status CHECK gains
  `needs_information` (the specified lifecycle state Track 1 did not store).

Two lifecycle fixes in `participation.js`: an application sent back for
information can now be updated and resubmitted (both paths previously
required draft, which made `needs_information` a dead end).

## Open questions for Tracks 3-4 and Emile

- Should a suspended investor reach the restricted `/api/invest/me`
  read live (needs an `authenticate` exemption like `/api/support/`), or
  does the platform-wide 403 stand? The controller layer is ready either
  way.
- The decline note for an opportunity review is stored in
  `verification_summary.reviewNote` because opportunities have no
  review-note column; a dedicated column is cleaner if the review UI
  needs it.
- No investor fees are defined yet, so the commit review screen shows an
  empty fee itemization. If an intermediary fee schedule is defined, it
  must be added here, never silently.
- The verification badge can only describe what a reviewer records at
  approval. There is no independent verification workflow yet.
- Live top-up lot creation is blocked by the known top-up completion
  defect (Track 1 carry-forward blocker, needs Emile's call). Tests use
  backfill-created lots; nothing in this layer works around it.
