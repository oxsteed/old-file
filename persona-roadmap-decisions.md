# Persona roadmap build — product decisions taken on audit defaults

Anchored at merged tip `861dc0373`. Emile can flip any of these; each entry records what was decided, why, and what flips it. Live investment commitments stay DISABLED throughout; nothing here enables them.

This file supersedes the version written for the deleted remediation branch (`8b5810e65`, never merged). Entries marked CORRECTED differ from that version because the merged tree differs from the remediation branch: the 10 reverts never landed, and the remediation's forward fixes are not in this tree.

## Verified on the merged tree (carried, unchanged in substance)

- **D-3. Phantom capabilities removed, not registered (G-9).** `credit.participate`, `partner.attribute`, `workforce.learn` have zero non-test hits in server or client; the three families link from the customer baseline menu promising no grant. Flip: register any of them as a real registry capability with grant/activation rules, and the nav entries become grant-backed.
- **D-4. Generic `investor.participate` requests closed (G-10).** `applicantMayRequest: false`; participation only via the per-opportunity invest flow. Flip: none — re-opening the generic path would mint participation grants with zero checks.
- **D-5. Investor reporting destination is `/investments` (G-34).** Canonical destination. Residue: `/investor/dashboard` still exists and the login page still navigates there. Flip: change the canonical link in one place (`invest.js` / nav) and update the test; remove the old route only by a separate call.
- **D-6. Everyone still lands on customer Discovery (G-13, half-closed by design).** Landing is customer-first; the approved workspace is discoverable via `PersonaWorkspaceNotice` on the landing, not via a persona landing redirect. Flip: wire `ModeHomeRoute` to navigate to a backed persona primary.
- **D-7. Franchise royalty reports show accrual status, computed royalty stays (G-38).** Per-agreement `accrualStatus` is carried in the franchisee report; the numbers are still computed from sales. Flip: switch the report to read accrual records only.
- **D-8. Location-scoped finance is reports, not settlement (G-19, option B).** Store-scoped managers get `location_reports` in the statement center with an explicit HQ-only settlement note and zero settlement numbers. Flip: build a location-scoped settlement statement read (needs the derivability decision first).

## CORRECTED for the merged tree (differs from the remediation version)

- **D-1. Activation is enforced, but in the PR's looser form (G-1).** `activationFor(capability, userId)` resolves each requirement against real evidence; the resolver returns `activation_incomplete` and the projection carries an `activation` map; ApplicationsPage gates USE-NOW links on it. Approval still mints the grant, but the grant alone no longer authorizes use. CORRECTED: on this tree the helper bar is identity + terms only. Codex commit `993a2d522` removed `payout_setup` from `helper.offer_services`, so the remediation's AC-025 hold (bid held until W-9 + Connect complete) does not exist here, and the helper W-9/Didit branch in `activation.js` is dead code for that capability. Flip: restore `payout_setup` as a helper requirement with per-route carve-outs (the remediation design), or accept identity+terms-only activation. Needs Emile's call before any deploy.
- **D-2. `payout_setup` is NOT a helper activation requirement on this tree (G-1).** The remediation version kept it and carved it out per-route. On the merged tree the PR branch removed it globally from `helper.offer_services`; it survives only for `business.own`, `consultant.accept_paying_clients`, and `tool_owner.list_equipment`. The per-route carve-out is the ALTERNATIVE Emile can order, not the live design. Flip: see D-1.
- **D-9. `helperProfile` routes are already under the setup gate (default: KEEP, pending Emile).** The remediation version kept profile/buffer/gallery routes under the full activation gate. On the merged tree Codex `993a2d522` wired `requireHelperSetupCapability` (`allowActivationIncomplete`) into them, so a helper mid-onboarding passes on a bare grant. Flip: tighten back to the full gate, or keep the loosened gate.

## Present in the merged tree (no longer rebuild decisions)

These were "to be decided / held" on the remediation line because that branch reverted them. They are live in this tree; the decisions now are whether to keep, fix, or call them, not whether to rebuild them.

- **G-18 restaurant manager payout drafts + reads:** present (manager drafts + reads, owner confirms, admin executes). Keep unless Emile re-applies the revert rationale.
- **G-20 business-initiated refunds:** present (queues into the Money Approvals dual-approval queue; requester never executes). Depends on the approvals queue working end to end.
- **G-37 provider transfer:** present (transfer + offboarding reassign).
- **G-36 support booking detail:** present for admins only (read-only, payment internals redacted). The support-agent path is still missing; that is the open item, not the read itself.
- **R-6 moderation-flags UI + escrow-confirmation caller:** present.
- **R-1 Invest distributions dual approval:** present in the tree. Needs the commitments-gate call: confirm it stays, given live commitments are disabled.
- **R-5 amendment reconfirmation:** present in the tree. Needs the Domain 7 B-1 call: what happens to non-reconfirmed commitments when an amendment goes effective.
- **R-3 top-up settlement actor:** present in env-gated form. Settlement posts as actorType `system` and fails on migrated DBs unless `OXSTEED_CREDIT_SERVICE_ADMIN_ID` is set in Coolify. Needs that config value, not a rebuild.

## Open decisions (Phase 1 input — build proceeds on the default below unless Emile says otherwise)

- **D-10. Household delegate / recipient / sponsor model (G-6/G-7).** The build's primitive is live (recipient columns, recipient view/cancel/notify, token status page), but the UI can only attach a name/phone, the status link is never delivered by the server, and there is no acceptance, consent, scope, expiry, or revocation. Defaults to record when the track lands: recipient needs an account vs token link; who can see the booking; who is liable; sponsor pays via a separate payment instrument, deposit charged to the booker.
- **D-11. Business-funded Credit (G-22).** Present in the tree: owner/manager initiates, names a member, funds from the funder's own card with a reason, audit record kept. Default: that same shape. Open: is the funder's own card acceptable as "business-funded", or is a business payment method required.
- **D-15. Support booking detail agent path (G-36).** The read exists for admins. Default if built: extend the read to the support-agent role (non-admin) with the same redaction, surfaced from the support workspace. Flip: keep admin-only.
- **D-19. Plain-customer Credit enrollment (G-25).** Apply + status path exist for merchant/helper applicants only. Default: persona is merchant/helper-only until Emile calls otherwise; a plain customer still cannot enroll.
- **D-20. Consultant practitioner surface.** No self-serve application, proposal, or conflict flow exists; consulting is admin-mediated end to end. Default: build the practitioner-owned surface in the consultant group unless Emile accepts admin-mediated consulting.
- **D-21. Position-scoped KPIs (G-45).** Franchise dataset is position-scoped; KPI endpoint returns platform-wide totals, labeled as such. Default: labeled platform-wide is acceptable for now. Flip: scope KPIs per position.
- **D-22. Statement archive gating (G-8 remainder).** Business finance routes are code-gated, but the statement archive is still manager-gated. Default: accept the expirable `DELEGATED_STATEMENT_READ` override as the auditor path. Flip: extend code-gating to `memberFinanceReadStanding`.
- **D-23. Property delegation model (G-17 remainder).** The `properties` table and `property_id` scoping are real; no membership-to-property assignment model and no `units` table exist. Default: property stays a scoping filter on business-level workflow until Emile calls the delegation model.
- **D-24. Location settlement derivability (G-19).** Option B (scoped sales view + HQ-only note) is the live answer. Default: keep it. Flip: build a derivable location settlement (needs a data-model decision first).

## Decisions to record as tracks land

Each Phase 1/2 track agent must append its product-decision items here (what, why, what Emile can flip) before its final receipt. No silent defaults.
