# Fundraiser persona — product specification

**Status:** specified, not built. No code in this document; implementation follows later, sliced as in §14.

**Branch / PR:** `feat/persona-group4-rest`, [PR #809](https://github.com/oxsteed/old-file/pull/809). Specified 24 November 2026 (America/New_York) from Emile's decisions in chat that day.

**Decisions:** D-413…D-422 in `persona-roadmap-decisions.md` (this file references them in place). Emile can flip any of them on review; each decision records what flips it.

**Relationship to existing investment work:** this persona is new. It is not `investor.reporting` and it is not `investor.participate`. Live investment *commitments* on the existing Invest path stay disabled (`INVEST_COMMITMENTS_ENABLED`, default off; decisions-file header and D-408). Fundraiser investment and loan *campaign types* are likewise disabled per country until Emile enables them after legal review (D-418). Nothing in this spec turns those flags on.

---

## 1. Purpose and principles

The Fundraiser persona lets an approved organizer raise money for a specific cause — a real-estate project, a business acquisition, helping people, or any other cause an admin-managed campaign type allows. Access is invite-only. A campaign is visible only to invited or otherwise eligible users; there is no public browse or Discovery listing (D-419).

Money moves in only two ways (D-420):

1. **OxSteed Credit** — a hold on the backer's Credit, captured into the organizer's Credit balance only when the campaign's funding rule and (if used) milestone approval allow it. This is the only instantly confirmed method.
2. **Proof of an external payment** — the backer records a payment made outside OxSteed and must attach proof. It stays pending and does not count as confirmed funds until the organizer (and, above a threshold, an admin) confirms receipt. Refunds of these payments happen off-platform; OxSteed only records the outcome.

There is no card or bank processing on the campaign path. Stripe, ACH, and similar rails already in the repo are not used to take or send campaign contributions.

Standing rules that apply throughout:

- Persona labels grant no authority. Access is always enforced on the server (same rule as the rest of the persona roadmap).
- Credit approvals, campaign-type approvals, persona approvals, campaign approvals, and oversight actions that freeze or wind a campaign down need **two distinct super-admins**, with a reason logged for each decision. There is no single-admin break-glass (D-416). This follows the Credit maker-checker rule in `server/services/oxsteedCreditPendingActionService.js` (self-approval is `403 credit_self_approval_forbidden`) and the retirement of `credit_single_admin_self_approval` in `server/migrations/20261110104200_retire_credit_single_admin_break_glass.sql`.
- UI copy lands in all 20 locale files under `client/src/locales/` (`ar`, `bn`, `de`, `en`, `es`, `fr`, `hi`, `ht`, `id`, `it`, `ja`, `ko`, `pt`, `ru`, `sw`, `th`, `tr`, `ur`, `vi`, `zh`). At least `en`, `es`, `fr`, `ht`, and `ar` are translated; `ar` and `ur` must be RTL-safe. Notification copy follows the existing `server/utils/i18n.js` pattern (translated titles/bodies at least in those five languages).
- New notification types are registered in `server/utils/notificationTypeCatalog.js` and sent through `server/services/notificationService.js`. The prefs-toggle suite (`server/__tests__/notificationsPrefsToggles.db.test.js`) must stay green.
- Migrations are named `YYYYMMDDHHMMSS_name.sql`, additive and idempotent, matching recent files such as `server/migrations/20261124180200_credit_location_period_reviews.sql`.
- No paid outside vendors for this work: identity stays on Didit, email stays on the existing Resend path, and there is no new payment processor.

---

## 2. Getting access (D-413, D-414, D-415, D-416)

### 2.1 Invite only

The Fundraiser persona is not a public Join card. It follows the same admission idea as private investor reporting: `investor-reporting` in `client/src/utils/signupPersonas.js` is `public: false` with `admission: 'admin_invite'`, and `investor.reporting` in `server/services/access/policyRegistry.js` sets `applicantMayRequest: false` so the public access-request flow cannot mint the capability.

The new capability is `fundraiser.organize` (name may be adjusted at implementation, but the contract is the same):

- `applicantMayRequest: false`. A generic `POST` to the progressive-access request routes (`server/routes/progressiveAccess.js`) must 403, same as `access_request_not_available` in `server/services/access/accessService.js`.
- Not listed in `SIGNUP_PERSONAS` (the public Join picker). It may appear in the internal catalog the way investor reporting does, so tests can prove the admission contract exists, but a URL `goal` or `intent` must not grant it.
- A legacy mode, a UI label, or an `investor.reporting` / `investor.participate` grant grants nothing here.

Who may send a named invite:

- An OxSteed super-admin, or
- A user who already holds an **approved** `fundraiser.organize` grant (status `approved`, not pending, suspended, or revoked).

Invites are named: a specific account or email, not an open link that anyone can redeem. An invite expires after **14 days** if it is not accepted, matching staff team invites (`server/jobs/staffInviteExpiryJob.js`, migrations `946_staff_invites_onboarding.sql` and `99907_staff_invite_expiry_status.sql`). Expired and revoked rows are kept for audit, not deleted. The inviter can revoke a still-pending invite. Accepting an expired or revoked invite is rejected.

The invitee must already have (or create) an OxSteed account, then accept the invite, complete identity verification, and submit an application. Until two distinct super-admins approve that application, the persona shows as pending in the UI and **the server grants no organizer routes, no campaign-create rights, and no invite-sending rights**.

### 2.2 Inviter quota and accountability (D-414)

Every non-platform inviter has a quota, stored and enforced on the server:

| Limit | Default | Notes |
|---|---|---|
| Outstanding pending invites | 10 | Count of `pending` invites not yet accepted, expired, or revoked |
| Accepted / approved invitees in a rolling 12 months | 25 | Counts invitees who accepted, including those later rejected or revoked |
| Active invite-sending privilege | on | Can be suspended by two distinct super-admins |

Platform super-admins are not bound by the numeric caps; every invite they send is still logged. Defaults are configurable by two-admin oversight, not hard-coded forever.

Accountability: if an invitee is later rejected or revoked **for fraud** (or a comparable integrity finding recorded on the application or grant), that event counts against the inviter. A second fraud-linked invitee in 12 months automatically suspends that inviter's invite privilege pending two-admin review. A fraudulent invitee does not automatically revoke the inviter's own Fundraiser grant; that is a separate oversight action.

### 2.3 Identity verification (D-415)

The invitee must pass **fresh, verified** Didit identity before the application can be submitted. Skipping Didit is not enough.

Reuse `server/utils/diditGate.js`:

- `isDiditVerificationFresh` — Didit approvals are valid for two years from the provider-approved time; missing or malformed timestamps fail closed.
- For this persona, `didit_enforcement_required` is set (or the Fundraiser gate calls the verified+fresh path directly). `isDiditIdentitySatisfied` then requires `didit_status === 'verified'` and a fresh `didit_verified_at`. `didit_status === 'skipped'` does not pass.
- Session and status stay on the existing routes in `server/routes/didit.js` (`POST /session`, `GET /status`). The live webhook remains `webhookController.diditWebhook`.

Verification is re-checked at application submit, at campaign submit, and — for investment and loan money models — at contribution time. If Didit has gone stale, the action is blocked until the user verifies again.

### 2.4 Application

After accepting the invite and passing Didit, the invitee submits an application covering:

- Who they are (legal name as verified, any organizing entity, country of residence / formation, contact).
- Cause focus (free text plus optional tags; this is not a campaign-type picker — types are chosen later, per campaign).
- Track record (prior raises, relevant work, references; attachments allowed).
- Acknowledgements: they understand that approval is of the persona, not of any campaign, and that each campaign is approved separately.

Attachments use the existing upload path: multer + `server/middleware/validateFileUpload.js`, malware scan via `server/services/fileScanService.js` (ClamAV when configured; fail closed for this evidence the same way dispute / franchise evidence should — a 503 when scanning is required and unavailable). Storage follows the private vault pattern already used for franchise evidence in `server/controllers/franchiseController.js` (`uploadFile` under a private prefix, storage keys stripped from payloads, downloads as short-lived signed URLs).

The applicant may withdraw a submitted application that has not yet been fully decided. A rejected applicant may be invited again; the new application is a new row.

### 2.5 Two-admin approval of the persona (D-416)

Two **distinct** super-admins must approve the application. Each decision records: admin id, decision (`approve` / `reject`), reason (required, max 2000 characters), timestamp, IP, and correlation id.

- Self-approval is a hard 403 (same contract as `credit_self_approval_forbidden`).
- The first approval leaves the application `under_review`. The second distinct approval moves it to `approved` and is the only step that mints the `fundraiser.organize` grant.
- A single reject at any time rejects the application. The grant is not minted. Both the applicant and the inviter are notified.
- There is no amount threshold, environment flag, or "only one super-admin exists" bypass.

Persona-application approvals live in Fundraiser tables (see §9). They do **not** reuse `oxsteed_credit_pending_actions`, which is the Credit money-movement and licence-oversight queue (`server/services/oxsteedCreditPendingActionService.js` and `server/services/creditCompliance/oversightActions.js`). The *rules* are the same; the *queue* is separate. Actual Credit holds, captures, and releases for contributions still go through `server/services/oxsteedCreditService.js` (`createCreditHold`, `captureCreditHold`, `releaseCreditHold` / `releaseHoldReservation`) and the Credit ledger (`oxsteed_credit_accounts`, `oxsteed_credit_holds`, `reserved_cents`).

Until the grant is `approved`, any organizer API is 403/404 as appropriate. A UI badge or nav entry must not be treated as authorization.

A later suspension or revocation of the grant also requires two distinct super-admins and a reason. Suspension freezes invite-sending and new campaign creation immediately; live campaigns are queued for oversight (freeze or wind-down, §8) rather than silently continuing unsupervised.

---

## 3. Campaign types (D-417, D-418, D-421)

### 3.1 Dynamic, admin-managed records

Campaign types are **not** a hard-coded list of three causes. Super-admins create and edit types so new causes (medical, education, church building, community projects, and so on) can be added without a code change (D-417).

Each type is a versioned record. A live or approved campaign **pins the type version it was approved under**. Editing a type always writes a new version; existing campaigns do not silently pick up new rules.

Creating a type, or publishing a new version, needs two distinct super-admins and a reason, same rule as §2.5. A draft type version is invisible to organizers until it is fully approved and marked `active`.

### 3.2 Fields on a type version

- **Name, description, and icon**, localized in all 20 locales. Missing translations fall back to `en` at read time; the approving admins should not publish a version that lacks `en`, `es`, `fr`, `ht`, and `ar`.
- **Money model** — the only fixed enum, because each model has different payout, refund, and legal rules: `donation` | `investment` | `loan` | `reward`.
- **Required documents and custom fields** — a schema of document slots (for example a deed and an appraisal, or proof of who benefits) and typed custom fields the organizer must fill when creating a campaign of this type.
- **Allowed countries** — ISO country codes where this type may be used. Empty means nowhere (fail closed).
- **Limits** — maximum goal (per currency), maximum campaign duration, per-backer cap. Optional minimum goal (defaults to the stated goal when the funding rule is all-or-nothing).
- **Funding rule** — `all_or_nothing` (default, D-421) or `keep_what_raised`.
- **Milestone-based release** — on or off. When on, captured Credit is released to the organizer in milestone tranches after proof is approved (see §5). When off, all-or-nothing captures the full held amount to the organizer once the goal is met (or, for keep-what-raised, at the deadline or on an approved early close).
- **Update cadence** — required organizer updates (for example every 14 days while the campaign is live, and after each milestone). Missed updates raise a red flag (§8).
- **Eligibility to organize** — `all_approved_fundraisers` or `admin_selected` (an allow-list of approved organizers).
- **Accepted contribution methods** — `credit`, `external_proof`, or `both`. A type may restrict investment or loan campaigns to Credit only.
- **Per-country enablement** for `investment` and `loan` (D-418).
- **External-proof admin-review threshold** — override for the platform default (see §4.2).
- **Who may view and back** — `campaign_invitees_only` or `campaign_invitees_plus_eligible` (eligible = users an admin or the organizer has marked eligible for this type or campaign). Never `public`.

### 3.3 Investment and loan types stay off until enabled (D-418)

`investment` and `loan` types are disabled in every country until a two-admin oversight action enables that type in that country. The enablement record stores the country, the type, the two admin ids, the reasons, and a pointer to the legal clearance Emile attaches. Donation and reward types may be enabled per country as soon as the type version is approved.

This is deliberate. Campaigns that promise a return are usually treated as securities offerings (in the United States, Regulation Crowdfunding or Regulation D, typically requiring a registered funding portal or broker-dealer, investor limits, and specific disclosures). Lending may need a lending licence. Emile handles the legal side. The code keeps a per-model rules hook and a per-country flag so those types can be turned on later without a redesign. **This spec does not enable them anywhere.**

This stays aligned with the decisions-file header: "Live investment commitments stay DISABLED throughout; nothing here enables them."

---

## 4. Campaigns (D-419)

### 4.1 Each campaign is approved on its own

An approved Fundraiser grant is not a blanket permission to raise money. Each campaign is submitted and approved separately by two distinct super-admins, with reasons logged.

Required fields at submit:

- Campaign type (the approved, enabled-in-country version to pin).
- Goal amount and currency (currency must be one the Credit ledger already supports; default follows the existing Credit currency, `CREDIT_CURRENCY`, typically USD).
- Deadline (within the type's maximum duration).
- Use-of-funds breakdown (line items that sum to the goal).
- Documents and custom fields required by the pinned type version.
- Failure outcome, consistent with the type's funding rule (for all-or-nothing: holds are released and external proofs are marked failed / to be refunded off-platform; for keep-what-raised: confirmed funds stay, pending holds follow the type's close rule).

The organizer may save drafts. Submit is blocked unless Didit is still fresh and the organizer's grant is `approved`.

### 4.2 Material edits re-trigger approval

Once a campaign is approved, a **material** edit returns it to `pending_reapproval` and needs two distinct super-admins again before it can stay or go live. Material fields are: goal, currency, deadline, use-of-funds, documents, funding rule, milestone plan, accepted methods, visibility list that *widens* eligibility, and any custom field the type marks as material.

Non-material edits (typographical corrections in the public description that do not change money terms, adding a required update, attaching extra non-required supporting files) may be made without re-approval and are still audit-logged.

A campaign that is already `live` and has confirmed or held contributions cannot change its funding rule, money model, or currency at all. A goal *increase* is a material edit. A goal *decrease* below already confirmed-plus-held funds is rejected.

### 4.3 Visibility

Campaigns are not listed in public Discovery, search, or unauthenticated browse. A user can open a campaign only if the server says they are:

- the organizer,
- a super-admin with the Fundraiser oversight permission,
- invited to that campaign, or
- marked eligible for that campaign or its type.

A 404, not a 403, is returned to everyone else, so existence cannot be probed (same fail-closed listing style already used in location-scoped Credit reconciliation, D-391). Share links redeem only for a signed-in eligible user and do not bypass the server check.

---

## 5. Contributions (D-420)

### 5.1 OxSteed Credit

This is the only instantly confirmed method.

Flow:

1. The backer, eligible and signed in, pledges an amount within the type's per-backer cap and their available Credit (`balance_cents - reserved_cents` on `oxsteed_credit_accounts`, as already computed in `server/services/oxsteedCreditAdminService.js` and `server/services/oxsteedCreditReservationService.js`).
2. The server opens a Credit hold through `createCreditHold` / `createCreditHoldInTransaction` in `server/services/oxsteedCreditService.js`, posting to `oxsteed_credit_holds` and incrementing `reserved_cents`. The hold's `reference_type` / `reference_id` point at the contribution. Insufficient funds fail closed (`credit_insufficient_funds` or the existing equivalent).
3. The contribution is `held` and counts toward the campaign's **confirmed** Credit total immediately (the funds are reserved, not yet captured to the organizer).
4. Capture (`captureCreditHold`) runs only when the funding rule allows it:
   - All-or-nothing, no milestones: when the confirmed Credit total reaches the goal (and any other type gates pass). All held Credit for that campaign is captured to the organizer's Credit account in the same campaign currency.
   - All-or-nothing, with milestones: when the goal is met, funds remain held / captured into a campaign pool and are released to the organizer as each milestone is approved (see §6). Implementation may use a campaign-owned Credit account or an equivalent reservation so organizer available balance does not jump ahead of approved milestones.
   - Keep-what-raised: at the deadline, or on an approved early close, held Credit is captured (and then milestone-released if that flag is on).
5. If the campaign fails, is cancelled, or is wound down, every active hold is released automatically (`releaseCreditHold` / `releaseHoldReservation`). The backer's available Credit is restored. No two-admin step is required for this automatic release — it is the funding rule executing — but the release is audit-logged. Manual Credit *adjustments* outside this rule still go through `server/controllers/agentCreditAdjustmentController.js` (distinct proposer and approver, no amount bypass).

Holds that would expire under the generic Credit hold TTL must be extended or reauthorized for the campaign's remaining life so an in-flight pledge cannot silently drop. Reuse `reauthorizeCreditHold` rather than inventing a second hold primitive.

Credit journal entries and compliance audit rows stay on the existing Credit rails (`oxsteed_credit_audit_events` via `server/services/creditCompliance/audit.js` `insertComplianceAudit`). The Fundraiser audit log points at the same hold / capture / release ids.

### 5.2 Proof of an external payment

The backer records a contribution they paid outside OxSteed (bank transfer, check, mobile money, or similar) and **must** attach proof (receipt, transfer confirmation, screenshot). Fields: method, amount, currency, date, payer name, reference number, and the proof file.

- The file is virus-scanned like other evidence (`validateFileUpload.js` + `fileScanService.js`). A missing file is rejected (`evidence_file_required` or a Fundraiser-specific equivalent).
- Status starts as `pending_organizer`. It does **not** count toward confirmed funds. The campaign progress bar shows it in a separate **pending** total.
- The organizer confirms or rejects receipt. Confirm moves the contribution to `confirmed` (or `pending_admin` if the amount is at or above the review threshold). Reject requires a reason; the backer is notified and may file a concern.
- Above a configurable threshold (platform default **100000 cents / $1,000 USD**, overridable on the type version), an admin must also review the proof before it becomes `confirmed`.
- Disputes go to Trust & Safety: the backer's "report a concern" action writes a moderation / T&S case. Reuse the existing flag path in `server/routes/moderation.js` (`POST /flag` → `moderationController.flagContent` → `moderation_queue`) with a Fundraiser-specific `target_type` / context, and surface those rows in the Fundraiser admin queue as well as the existing moderation flag list (`GET /api/admin/moderation-flags`).
- Because OxSteed never held that money, **refunds happen directly between organizer and backer**. The platform only records the outcome (`refund_recorded`, amount, date, method, optional proof). A recorded refund moves the contribution out of confirmed totals.

### 5.3 Progress

Every campaign view shows two figures, never mixed into one number:

- **Confirmed** — captured or held Credit (held Credit is reserved and is counted as confirmed pledge for goal progress) plus organizer-and-admin-confirmed external payments.
- **Pending** — external proofs awaiting organizer or admin confirmation.

The goal check for all-or-nothing uses **confirmed** funds only. Pending external proofs cannot tip a campaign over the line.

### 5.4 What is out of scope on this path

No campaign contribution may be taken or paid out by card, Stripe Checkout, bank debit, or any new processor. Existing Credit top-up (`server/controllers/oxsteedCreditTopupController.js`) and withdrawal / cash-out paths remain the way a user funds or leaves Credit, and they keep their own gates and two-admin rules. A backer who needs Credit to pledge uses those existing doors first.

---

## 6. Organizer dashboard

The organizer (grant `approved`) sees only their own campaigns:

- Progress against the goal, with confirmed and pending shown separately, plus time remaining.
- Backer list (identity as allowed by privacy rules; amounts; method; status). External-proof rows show confirm / reject actions.
- Required updates on the type's cadence. The organizer posts an update (text, optional scanned attachments). A missed cadence raises a red flag and notifies the organizer and the admin queue. Backers see the update feed.
- Milestone release requests, when the type uses milestones: the organizer submits proof that the milestone is done; two distinct super-admins (or a documented one-admin-plus-organizer rule — **default is two distinct super-admins**, D-416) approve the release; then the corresponding Credit is captured / released to the organizer. Rejected proof stays unpaid and the organizer may resubmit.
- Receipts for confirmed contributions (Credit ledger receipt for Credit; recorded confirmation for external).
- Refund recording for external contributions, and visibility into automatic Credit releases.
- An end-of-campaign report: totals, use of funds versus plan, outstanding milestones, open concerns. Required before a campaign can move to `closed`.

The organizer cannot see Trust & Safety's private notes, other organizers' campaigns, or admin reasons beyond the decision and the reason they are allowed to be told.

---

## 7. Backer experience

An eligible backer sees:

- A clear **risk summary** generated from the pinned type version and money model (donations can be lost; investments and loans can lose principal; keep-what-raised versus all-or-nothing; milestone status). Investment and loan summaries must be written so they can later hold legally required disclosures without a schema change.
- The organizer's **verification badge** (Didit-verified, persona approved) — the badge is informational; the server still enforces eligibility.
- Use-of-funds breakdown and document list (downloads as signed URLs).
- The update feed and milestone status.
- Their own contribution status, receipts, and refund status (Credit release vs. off-platform refund recorded).
- A **report a concern** control that opens a T&S case (§5.2).

Backers cannot browse other campaigns they are not eligible for. They cannot see other backers' private details.

---

## 8. Admin oversight

Super-admins with the Fundraiser oversight permission get queues for:

- Persona applications awaiting a first or second decision.
- Campaign types and type versions awaiting a first or second decision.
- Campaigns and material edits awaiting a first or second decision.
- High-value external proofs awaiting admin review.
- Open T&S concerns.
- Red flags:
  - Material goal or deadline changes (including attempts blocked by the server).
  - Missed update cadence.
  - Many distinct backers sharing one device or session identifier. Record the request's existing device / session identifiers already available on authenticated requests; do not build a new tracking vendor. A configurable threshold (default: 5 distinct backers on one device in one campaign) raises the flag for review, it does not auto-freeze.

Actions:

- **Freeze** a live campaign: no new pledges, no captures except as needed to preserve holds, updates still allowed. Two distinct super-admins, reason required.
- **Wind-down**: cancel or close the campaign, automatically release all active Credit holds back to backers, mark pending external proofs failed, and require the organizer to record off-platform refunds for already-confirmed external payments. Two distinct super-admins, reason required. Pattern, not reuse, of Credit platform wind-down in `server/services/creditCompliance/windDownService.js` (that service is for orderly redemption of the whole Credit rail; campaign wind-down is scoped to one campaign and must not freeze the Credit rail).
- Suspend or revoke a Fundraiser grant (§2.5), and suspend an inviter's invite privilege (§2.2).

Every approval, reject, freeze, wind-down, confirm, refund record, and flag is written to an audit log. Money movements also write `oxsteed_credit_audit_events`. Platform admin actions also write `admin_audit_log` (existing writer in `server/controllers/adminController.js`; chain verification in `server/jobs/adminAuditChainVerification.js`). Reasons, actor ids, and before/after state are required on oversight actions, same spirit as `insertComplianceAudit`.

---

## 9. Data model sketch

Suggested tables (names may be adjusted; all new, additive, idempotent migrations). Do not overload Credit pending-action rows for persona or type approval.

| Table | Role |
|---|---|
| `fundraiser_invites` | Named invite: inviter, invitee (user id and/or email), status (`pending`, `accepted`, `expired`, `revoked`), expiry, timestamps, audit columns. |
| `fundraiser_invite_quotas` | Per-inviter caps and privilege status; platform admins may have a null (unlimited) numeric cap. |
| `fundraiser_applications` | Identity snapshot, cause focus, track record, Didit status at submit, status, inviter id. |
| `fundraiser_application_reviews` | One row per admin decision; unique `(application_id, admin_id)`; reason required. Application approves only when two distinct `approve` rows exist. |
| `fundraiser_grants` | Server-side grant for `fundraiser.organize` (`pending`, `approved`, `suspended`, `revoked`). The persona label is derived from this, never the other way around. May instead be a row in the existing access-grant store if `policyRegistry.js` is extended — either way the server is the source of truth. |
| `fundraiser_campaign_types` | Stable type id, current published version pointer, money model, archived flag. |
| `fundraiser_campaign_type_versions` | Immutable version payload (localized copy, schema, limits, funding rule, methods, cadence, eligibility, country enablement snapshot). |
| `fundraiser_campaign_type_reviews` | Two-distinct-admin decisions to publish a version. |
| `fundraiser_type_country_enablements` | For `investment` / `loan` (and optionally donation/reward): country, type, enabled flag, two-admin provenance. |
| `fundraiser_type_organizers` | Allow-list when eligibility is `admin_selected`. |
| `fundraiser_campaigns` | Organizer, pinned `type_version_id`, goal, currency, deadline, funding rule copy, status, visibility policy, failure outcome. |
| `fundraiser_campaign_reviews` | Two-distinct-admin decisions for submit and for each material-edit round. |
| `fundraiser_use_of_funds` | Line items; sum constrained to the goal at submit. |
| `fundraiser_campaign_documents` | Vault storage keys, type-slot, virus-scan result; keys never returned raw. |
| `fundraiser_campaign_eligibilities` | Users invited or marked eligible to view/back a campaign. |
| `fundraiser_milestones` | Schedule, amounts, status, proof pointers. |
| `fundraiser_milestone_reviews` | Two-distinct-admin release decisions. |
| `fundraiser_updates` | Cadence posts; `due_at` / `posted_at` for missed-update flags. |
| `fundraiser_contributions` | Backer, campaign, method (`credit` \| `external_proof`), amounts, currency, status, Credit `hold_id` when applicable, device/session identifier used only for the red-flag count. |
| `fundraiser_external_proofs` | Mandatory attachment metadata, method, reference, dates, organizer decision, admin decision. |
| `fundraiser_refund_records` | Off-platform refund outcomes for external contributions; Credit releases are ledger events, referenced here by `hold_id` / transaction id only. |
| `fundraiser_concerns` | T&S cases, or a documented pointer into `moderation_queue`. |
| `fundraiser_audit_events` | Hash-chained or append-only actions on invites, applications, types, campaigns, contributions, flags, freezes. Money still also writes `oxsteed_credit_audit_events`. |

Indexes to plan: unique pending invite per (inviter, invitee, campaign-or-persona scope); contribution idempotency keys; hold id uniqueness; campaign eligibility lookups; queue filters by status.

---

## 10. API surface sketch

All routes are authenticated except where noted. Authorization is server-side. Prefix is indicative (`/api/fundraiser/...` and `/api/admin/fundraiser/...`).

**Invites and admission**

- `POST /api/fundraiser/invites` — admin or approved organizer; enforces quota.
- `GET /api/fundraiser/invites` — the caller's sent and (for the invitee) received invites.
- `POST /api/fundraiser/invites/:id/revoke`
- `POST /api/fundraiser/invites/:id/accept`
- `POST /api/fundraiser/applications` — Didit-fresh required; attach documents via the upload middleware.
- `GET /api/fundraiser/applications/mine`
- `POST /api/fundraiser/applications/:id/withdraw`
- `GET /api/admin/fundraiser/applications` and `POST /api/admin/fundraiser/applications/:id/decide` — two-distinct-admin, reason required.

**Types**

- `GET /api/fundraiser/types` — approved organizers see published, country-enabled types they are eligible to use.
- `GET|POST /api/admin/fundraiser/types` and `POST /api/admin/fundraiser/types/:id/versions`
- `POST /api/admin/fundraiser/types/versions/:id/decide`
- `POST /api/admin/fundraiser/types/:id/country-enablements` — two-admin; the only way to turn on `investment` / `loan` in a country.

**Campaigns**

- `POST /api/fundraiser/campaigns` (draft), `POST /api/fundraiser/campaigns/:id/submit`, `PATCH` for edits (material vs not enforced on the server).
- `GET /api/fundraiser/campaigns/:id` — 404 if the caller is not eligible.
- `GET /api/fundraiser/campaigns` — the caller's organized, invited, or eligible campaigns only. No unauthenticated list.
- `POST /api/admin/fundraiser/campaigns/:id/decide`
- `POST /api/fundraiser/campaigns/:id/eligibilities` — invite or mark eligible users.
- `POST /api/fundraiser/campaigns/:id/updates`
- `POST /api/fundraiser/campaigns/:id/milestones/:milestoneId/request-release`
- `POST /api/admin/fundraiser/milestones/:id/decide`
- `POST /api/admin/fundraiser/campaigns/:id/freeze` and `.../wind-down`

**Contributions**

- `POST /api/fundraiser/campaigns/:id/contributions/credit` — creates the hold; idempotent.
- `POST /api/fundraiser/campaigns/:id/contributions/external` — multipart proof required.
- `POST /api/fundraiser/contributions/:id/confirm-receipt` — organizer (and admin route for threshold review).
- `POST /api/fundraiser/contributions/:id/refund-record` — organizer records an off-platform refund.
- `POST /api/fundraiser/campaigns/:id/concerns` — report a concern.
- `GET /api/fundraiser/contributions/mine`

Admin list/detail endpoints sit under `/api/admin/fundraiser/...` for each queue in §8.

Credit hold/capture/release are **not** re-implemented as new ledger primitives; Fundraiser services call `oxsteedCreditService.js`. Admin Credit adjustments stay on `agentCreditAdjustmentController.js`.

---

## 11. Notifications

Register each type in `server/utils/notificationTypeCatalog.js` (a dedicated group, e.g. `fundraiser`). Suggested types:

| Type | When |
|---|---|
| `fundraiser_invite_received` | Named invite is sent |
| `fundraiser_invite_expired` | Sweep expires a pending invite |
| `fundraiser_invite_revoked` | Inviter or admin revokes |
| `fundraiser_application_submitted` | To applicant and to the admin queue (admin channel as existing staff notices do) |
| `fundraiser_application_decision` | Approved or rejected, with the reason the applicant is allowed to see |
| `fundraiser_inviter_accountability` | Inviter notified when an invitee is rejected/revoked for fraud, or when invite privilege is suspended |
| `fundraiser_type_published` | Organizer-eligible users may be notified when a type they can use is published (optional, default off) |
| `fundraiser_campaign_submitted` | Organizer + admin queue |
| `fundraiser_campaign_decision` | Approved, rejected, or material-edit re-approval |
| `fundraiser_campaign_live` | Organizer + eligible backers |
| `fundraiser_pledge_held` | Backer, Credit hold succeeded |
| `fundraiser_pledge_captured` | Backer and organizer, Credit captured / milestone released |
| `fundraiser_pledge_released` | Backer, automatic Credit release on fail/cancel/wind-down |
| `fundraiser_external_pending` | Organizer, a proof awaits confirmation |
| `fundraiser_external_confirmed` | Backer |
| `fundraiser_external_rejected` | Backer, reason included |
| `fundraiser_update_posted` | Eligible backers |
| `fundraiser_update_missed` | Organizer + admin flag |
| `fundraiser_milestone_requested` | Admin queue |
| `fundraiser_campaign_frozen` | Organizer + backers with active pledges |
| `fundraiser_campaign_wound_down` | Organizer + backers |
| `fundraiser_concern_opened` | T&S / admin queue; not the other party until T&S decides |
| `fundraiser_grant_suspended` | Organizer |

Copy: titles and bodies in at least en, es, fr, ht, and ar, RTL-safe for ar (and ur if used). Prefer a dedicated templates module in the same style as `server/utils/businessTeamNotificationTemplates.js`.

---

## 12. State machines

### 12.1 Invite

`pending` → `accepted` | `expired` | `revoked`

Accepted is terminal for the invite row; the application then carries the work. A revoked or expired invite cannot be accepted. Resend creates a new invite and restarts the 14-day window, subject to quota.

### 12.2 Application and grant

Application: `draft` → `submitted` → `under_review` → `approved` | `rejected`

Also: `submitted` or `under_review` → `withdrawn` (applicant). `approved` is written only when the second distinct approval is recorded, and that same transaction mints grant status `approved`.

Grant: `approved` → `suspended` → `approved` (lift) or `revoked`. `revoked` is terminal. Suspension and revocation require two distinct super-admins and a reason.

### 12.3 Campaign

`draft` → `submitted` → `under_review` → `approved` → `live` → `successful` | `failed` | `cancelled`

Side paths:

- `approved` or `live` → `pending_reapproval` on a material edit → `approved` / `live` (if already live and pledges exist, it may stay frozen to new pledges until re-approved) or remain as decided.
- `live` → `frozen` → `live` | `wound_down`.
- `successful` (goal met / keep-what-raised closed) may remain `disbursing` while milestones complete, then `closed` once the final report is accepted.
- `failed`, `cancelled`, and `wound_down` release Credit holds automatically and then move to `closed` after the final report (or an admin waiver of the report).

Illegal jumps are 409 with a specific code, same style as franchise corrective-action transitions (D-333).

### 12.4 Contribution

Credit: `creating` → `held` → `captured` | `released`. Partial captures for milestones may leave a remainder `held` or move through `partially_captured` then `captured`. `released` is terminal (funds returned to the backer).

External: `pending_organizer` → `pending_admin` (if at or above threshold) or `confirmed` | `rejected`. `confirmed` → `refund_recorded`. `rejected` is terminal unless T&S reopens it. `disputed` can be entered from `pending_organizer`, `pending_admin`, or `confirmed` when a concern is filed; T&S resolution writes `confirmed`, `rejected`, or `refund_recorded`.

---

## 13. Edge cases

- **Quota vs. concurrent invites:** serialize cap checks per inviter so two concurrent sends cannot both pass the same remaining quota (same lesson as the proposer cap in `agentCreditAdjustmentController.js`).
- **Idempotent Credit pledges:** reuse the Credit hold idempotency key path already in `oxsteedCreditService.js` (`findExistingCreditHoldForReplay` / `assertHoldIdempotencyReplayMatches`). A retried request must not double-reserve.
- **Race to the goal:** all-or-nothing capture is serialized per campaign. A pledge that would exceed a per-backer cap is rejected; a pledge that arrives after the campaign is no longer `live` is rejected; a Credit pledge that arrives after the goal is already met is rejected (or, if the type later allows overfunding, that is a new decision).
- **Currency mismatch:** contribution currency must match the campaign currency. External proofs in another currency are rejected, not silently converted.
- **Stale Didit mid-campaign:** organizer updates and new campaign submits are blocked until re-verification. Existing holds are not auto-released solely because Didit went stale.
- **Organizer grant suspended while live:** new pledges stop; existing holds stay held; oversight decides freeze vs. wind-down. The organizer cannot confirm external proofs while suspended.
- **Organizer confirms their own fake external proof:** admin-review threshold, device flags, and T&S concerns are the controls; confirmed external funds never move through OxSteed, so the confirmed total must not be treated as Credit in the ledger.
- **Goal decrease below confirmed funds:** 409, no partial silent shrink.
- **Hold expiry during a long campaign:** reauthorize until the deadline or the contribution is captured or released; a sweeper extends or flags, it does not quietly expire a live pledge.
- **Two admins, one person, two accounts:** "distinct" means two distinct user ids that both currently hold super-admin. Implementation must not treat a single person with two logins as two people if the repo already has a stronger identity link; if it does not, the user-id rule is the enforceable bar, and a note goes to oversight when the same Didit identity sits behind both admins.
- **Investment type submitted in a disabled country:** 403/409 at campaign submit, even if the type exists.
- **Public crawlers and sitemaps:** campaign URLs are noindex and unauthenticated fetches 404.
- **Malware in proof or documents:** reject the upload; do not store a dirty buffer. If the scanner is required and down, 503, same as `validateFileUpload.js`.
- **Partial milestone rejection:** only the requested tranche stays unpaid; previously approved tranches are not clawed back automatically. Clawback is a separate two-admin Credit adjustment.

---

## 14. Suggested build slicing (later)

No implementation in this change. When Emile says to build, stay on PR #809 and slice roughly as follows:

1. **Admission.** Tables for invites, quotas, applications, reviews, grants. Capability `fundraiser.organize` in `policyRegistry.js` with `applicantMayRequest: false`. Didit-fresh gate. Two-admin decide endpoints. Catalog / Join picker stays private. Notifications for invite and application. Tests for quota, expiry, self-approval 403, skip-Didit rejected, label-grants-nothing.
2. **Campaign types.** Versioned types, two-admin publish, 20-locale copy fields, country enablement (all investment/loan rows start disabled). Organizer type list.
3. **Campaigns.** Draft/submit/approve, material-edit re-approval, eligibility, 404-for-strangers, pinned type version. Donation types only in the first countries Emile enables.
4. **Credit contributions.** Hold, goal progress, all-or-nothing capture, automatic release on fail/cancel, reauthorization, receipts. No new payment rail.
5. **External proofs.** Upload + scan, organizer confirm, admin threshold, pending vs confirmed progress, off-platform refund records, T&S concern hook.
6. **Organizer dashboard + backer view.** Updates and missed-update flags, milestone requests, risk summary, verification badge, report-a-concern.
7. **Admin oversight.** Remaining queues, red flags (including multi-backer device), freeze and campaign wind-down with automatic Credit releases, audit trail hooked to `admin_audit_log` and `oxsteed_credit_audit_events`.
8. **Hardening and launch gate.** i18n in all 20 locales, notification catalog sync, sweeper jobs (invite expiry, missed updates, hold reauth), and a launch that offers **donation (and reward, if a type is published) only**. Investment and loan remain disabled per country until legal clearance (D-418).

---

## 15. Open legal items (Emile owns; engineering flags only)

These are not engineering defaults to "just turn on":

- Whether a given `investment` campaign is a securities offering (US Reg CF, Reg D, or another regime) and whether OxSteed would need to be a registered funding portal or to partner with a broker-dealer.
- Investor caps, accreditation, and required disclosures per country.
- Lending / consumer-credit licences for the `loan` model.
- Charitable solicitation and tax-receipt rules for `donation` campaigns, per state and country.
- Whether holding Credit pledges for a campaign interacts with stored-value / e-money rules already covered by Credit compliance (`server/services/creditCompliance/*`).
- Marketing and general-solicitation limits, given that campaigns are invite-only and not publicly browsable (that restriction is also a product control, not by itself a legal opinion).
- Cross-border contributions and currency.
- Record-keeping and audit-retention periods beyond the platform's existing admin-audit chain.

Engineering will keep the per-model and per-country flags, disclosure slots, and eligibility hooks ready. **Emile handles legal. No country enablement for investment or loan ships without his go-ahead.**

---

## 16. Grounding — existing paths this spec reuses

| Concern | Where it already lives |
|---|---|
| Didit gate, freshness, skip vs verified | `server/utils/diditGate.js`, `server/routes/didit.js` |
| Invite-only persona admission | `client/src/utils/signupPersonas.js`, `server/services/access/policyRegistry.js` (`investor.reporting`, `applicantMayRequest: false`), `server/routes/progressiveAccess.js`, `server/services/access/accessService.js` |
| Two-distinct-admin, no break-glass | `server/services/oxsteedCreditPendingActionService.js`, `server/controllers/agentCreditAdjustmentController.js`, `server/migrations/20261110104200_retire_credit_single_admin_break_glass.sql`, `server/services/creditCompliance/oversightActions.js` |
| Credit holds, capture, release, reserved balance | `server/services/oxsteedCreditService.js`, `server/services/oxsteedCreditReservationService.js`, `oxsteed_credit_holds` / `oxsteed_credit_accounts` (foundation in `server/migrations/421_oxsteed_credit_foundation.sql`) |
| Credit compliance audit | `server/services/creditCompliance/audit.js` |
| Admin audit log + chain job | `admin_audit_log`, `server/controllers/adminController.js`, `server/jobs/adminAuditChainVerification.js` |
| Upload + malware scan | `server/middleware/validateFileUpload.js`, `server/services/fileScanService.js`, vault `uploadFile` in `server/controllers/franchiseController.js` |
| T&S / content flag queue | `server/routes/moderation.js`, `server/controllers/moderationController.js`, `moderation_queue` |
| Staff invite expiry pattern | `server/jobs/staffInviteExpiryJob.js` |
| Platform-wide Credit wind-down (do not reuse for a single campaign) | `server/services/creditCompliance/windDownService.js` |
| Notification catalog + send | `server/utils/notificationTypeCatalog.js`, `server/services/notificationService.js`, `server/utils/i18n.js` |
| 20 locales | `client/src/locales/{ar,bn,de,en,es,fr,hi,ht,id,it,ja,ko,pt,ru,sw,th,tr,ur,vi,zh}.json` |
| Access labels are not authority | Progressive access grants; persona roadmap standing rule |

---

*End of specification. Implementation starts only when Emile says to build, on PR #809.*
