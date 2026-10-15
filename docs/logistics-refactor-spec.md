# OxSteed Logistics Refactor

## Summary

Refactor all Logistics interfaces into a consistent, task-focused experience: public browsing, Buyer, Organizer, Business Procurement, Distributor, Operations, Compliance, and Admin.

Keep the four customer workspaces separate. Replace the oversized marketing homepage with a practical campaign browsing hub. Redesign the underlying workflows and add buyer payments through Stripe and eligible OxSteed Credit.

OxSteed collects payments and handles refunds. Organizers coordinate campaigns. Supplier and carrier payouts remain outside this release.

## Experience and navigation

- Use the site's shared typography, content widths, cards, theme tokens, buttons, and responsive patterns. Replace hardcoded colors and scattered inline styles with scoped Logistics components.
- Keep the shared navbar/footer and existing admin shell. Replace repeated workspace tile grids with compact, permission-aware navigation.
- Make `/logistics` a browsing hub: compact introduction, campaign search, lane/status filters, results, and clear links to organizing and business procurement. Keep explanatory content below the useful actions.
- Share campaign browsing between the homepage and `/logistics/campaigns`, preserving filters, pagination, and scroll position. Remove simulated campaigns from live empty states.
- Give each workspace an actionable overview, authoritative counts, recent activity, and one clear next step. Distinguish unavailable data from zero activity.
- Open campaign, request, order, shipment, and allocation previews in accessible modals. Include Close and Open full page. Direct URLs render full pages; longer forms and checkout use full pages. Preserve return context after authentication or checkout.
- Apply the same structure to sourcing, quotes, procurement programs, finance, inventory, distribution, disputes, compliance, suppliers, lanes, pricing, and internal access administration.
- Support keyboard operation, focus containment/return, Escape dismissal, unsaved-change confirmation, 44px targets, RTL, and floating-assistant clearance.

## Workflow and payment rules

### Campaigns and fulfillment

- Implement the missing `/logistics/campaigns/new` flow. Organizers create drafts, submit them, and receive approval or revision requests. Authorized Operations staff approve publication after applicable lane, supplier, and compliance checks.
- Keep approval state separate from fulfillment state. Apply server-side capability, ownership, business-membership, verification, and lane checks to every mutation.
- Consolidate duplicate transition definitions into the existing Logistics state-machine service. Validate transitions transactionally; return available actions and blockers to the UI.
- Pledges remain unpaid commitments. Once minimum demand is met, staff opens a deposit window with explicit deadlines and an approved quote.
- Supplier placement requires sufficient deposit-funded quantity to meet the minimum, plus required approvals. At deadline, insufficient funding creates an exception for staff resolution; it does not silently advance the campaign.
- Collect each buyer's balance before releasing their goods. Track partial receipts, shortages, allocations, delivery failures, claims, and resolution without treating them as successful completion.
- Preserve existing account-access fixes: Logistics eligibility must not block Settings, authorized Statements, Support, or verification.

### Collections and pricing

- Support USD Stripe payments and eligible USD OxSteed Credit. Each installment uses one method; no mixed funding, automatic currency conversion, or unattended saved-card charges.
- Buyers explicitly confirm both deposit and final payment. Preserve the current 30% deposit default, while displaying and enforcing the approved campaign/order percentage.
- Store versioned quotes with itemized costs, payment schedule, deadlines, and cancellation terms. Require acceptance before collecting against a new or increased quote; never alter already-posted transactions.
- Add a `logistics` Credit spend surface using existing participant, agreement, rail, freeze, balance, and ledger safeguards. Resolve an explicitly approved OxSteed business participant; do not reuse Restaurant Credit accounts or invent a default merchant.
- Store amounts in integer minor units. Use durable payment attempts, idempotency keys, transactional accounting, signed Stripe webhooks, and reconciliation. Browser redirects or manually entered processor references cannot establish payment success.
- Record buyer payments and supplier obligations separately. Do not describe ordinary payments as escrow or automate outbound supplier settlement.

### Refunds and exceptions

- Every refund requires staff review. One admin proposes; a different admin approves with fresh authentication. New Logistics refunds have no self-approval or single-admin bypass.
- Support explicit full or partial refunds, capped by the remaining refundable amount. Recheck payment, dispute, currency, and authorization gates at execution.
- Return funds to the original source. Mark refunds successful only after processor confirmation or a committed Credit reversal.
- Remove the existing ability to establish a processed refund merely by editing status or `stripe_refund_id`.
- Provide failed-payment recovery, pending/refund-failed states, reconciliation queues, and localized notifications. Missing funding or missed minimums create review cases rather than promises of automatic refunds.

## Interfaces and implementation sequence

1. **Foundation and browsing:** shared layout/navigation, route repairs, searchable campaign APIs, safe public visibility, modal routing, and accurate loading/error states.
2. **Workspaces and workflows:** migrate all customer/internal/admin screens; implement draft submission and approval, server-derived capabilities, guarded transitions, and operational handoffs.
3. **Payments and finance:** buyer checkout, Credit integration, quotes, refund approvals, reconciliation, statements/activity references, and notifications.
4. **Completion and release:** compatibility checks, localization, browser verification, migration rehearsal, and delivery evidence.

Extend existing `/api/logistics` and admin APIs rather than creating a parallel subsystem. Add explicit commands for campaign submission/approval, checkout, payment status, refund proposal/approval, and reconciliation. Keep existing response fields and routes compatible where possible.

Use additive migrations for approval history, quote acceptance, payment attempts, webhook deduplication, and refund decisions. Select migration numbers from the fresh base and open PRs. Preserve historical records; incomplete legacy payment records require reconciliation and cannot be assumed paid.

Update client API exports and every affected browser fixture. Localize new and revised copy across all 20 supported languages, preserving legacy/namespaced parity and editing English textually.

## Verification and delivery

- Test guests, buyers, organizers, business members, distributors, operators, compliance reviewers, and admins, including unauthorized access and account/business changes.
- Cover all lifecycle transitions, approval/rejection, minimum-demand and funding failures, expired windows, revised quotes, missing fields, partial fulfillment, and stale requests.
- Test both payment methods, insufficient funds, disabled rails, concurrent checkout, duplicate/out-of-order webhooks, timeouts, retries, refunds, disputes, and reconciliation. Prove no duplicate debit/refund and no self-approved Logistics refund.
- Verify modal/direct-page parity, retained filters, keyboard interaction, and layouts at 320, 390, 768, 1360, and 1600px in light/dark themes, including French and Arabic RTL.
- Run focused client/server regressions, affected browser checks, migration rehearsal against an isolated database, and client `npm run build:ci`. Preserve the recent locale-build memory fix.
- Deliver sequential, reviewable PRs against the freshly verified default branch. Preserve unrelated work and record validation for each stage.
- Keep new payment automation disabled until merchant configuration and reconciliation checks pass. Report local validation, remote CI, and deployment separately; do not wait for deployment.

Completion changes, verification evidence, and release requirements: [2026-10-15 completion record](logistics-refactor-completion-2026-10-15.md).
