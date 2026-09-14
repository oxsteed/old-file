# OxSteed Credit Code Completion Goal

Revised by user direction on 2026-09-14.

## Objective

Complete and verify all software required for OxSteed Credit's production
readiness, supporting OxSteed as the central credit authority and each restaurant
as an independently accounted credit operator within that network. Preserve the
existing customer, restaurant, and platform functionality while completing the
architecture, financial correctness, user experiences, security, international
support, integrations, and operational tooling.

This is the working engineering objective for this project. Licensing, business
agreements, provider account approval, custody arrangements, hardware purchases,
and other human activities are a later launch phase. They are not criteria for
code completion and must not stop independent engineering work. The app's saved
goal text and status have not been changed by this document.

## Required Software Scope

- Central authority and restaurant accounting: explicit ownership of issued
  value and obligations; separate restaurant subledgers and charts of accounts;
  central and restaurant reserve/funding records; issuance, redemption, clearing,
  settlement, and reconciliation; consolidated and restaurant-level statements.
  Represent external funding evidence without treating a ledger entry as proof
  that external money moved. Specify and test the accounting invariants before
  changing the existing ledger.
- Complete financial workflows: balances, available funds, loads, holds,
  captures, releases, refunds, transfers, adjustments, expiry, disputes, partner
  payables, settlement failures and reversals, and traceable correction entries.
  Preserve restaurant-scoped wallet behavior and enforce eligibility and limits
  atomically on the server.
- Customer, restaurant operator, and Super Admin interfaces: complete connected
  workflows, appropriate role and restaurant isolation, approvals, reports,
  receipts, audit history, emergency suspension, accessible responsive screens,
  localization, and clear loading, empty, failure, and retry states.
- International software support: explicit supported currencies and precision,
  consistent rounding and time handling, configurable country/program policies,
  and currency-safe reporting and settlement. Any supported conversion flow
  needs explicit quotes, rates, fees, expiry, and balanced accounting; unsupported
  conversions must be rejected consistently.
- Security and resilience: authorization, tenant isolation, concurrency safety,
  idempotency and replay defense, immutable financial history, secret handling
  and rotation, fraud/risk controls, bounded resource use, worker recovery,
  provider outage handling, monitoring, and actionable diagnostics.
- External integrations: implement the agreed provider contracts, adapters,
  webhook verification, reconciliation, failure handling, and operator workflows.
  Use isolated test environments and contract fixtures where real credentials
  are unavailable. Record which checks still need a live provider; never present
  fixture results as live verification or ship a success-returning placeholder.
- Delivery and recovery: reproducible production builds, configuration
  validation, migrations and upgrade tests, release identification, health and
  readiness checks, deployment tooling, automated backups, tested restoration,
  and documented recovery and rollback procedures.

## Definition of Code Complete

1. Maintain a requirement-to-evidence matrix covering this scope. Every item
   identifies its implementation, meaningful verification, and remaining gaps.
   Audit the current source; earlier progress summaries are not current proof.
2. Complete every in-scope workflow without TODOs, disconnected interfaces,
   production stubs, or known critical/high-severity defects. Resolve remaining
   defects against explicit acceptance criteria instead of hiding them behind
   a completion percentage.
3. Verify ledger invariants, multi-restaurant isolation, retries, concurrent
   spending, crash recovery, settlement and refund failures using real isolated
   database/cache services where their behavior matters. Passing mocked unit
   tests alone is insufficient.
4. Pass applicable unit, integration, API, browser, regression, security, and
   performance checks against documented workload and resource targets. Verify
   the production artifact, migrations from an existing schema, and restoration
   from a backup in an isolated environment compatible with the MacBook setup.
5. Document exact tested source/artifact identifiers, commands, results, and
   limits. Keep human launch actions and unavailable live-provider checks in a
   separate handoff list. Complete all independently testable code first.

"100%" means all agreed software acceptance criteria are satisfied with evidence;
it does not mean a claim that software can never fail. Code completion and approval
to activate real customer funds are separate milestones. Existing runtime safety
checks remain enforced, including rejection of missing production secrets and
disabled capabilities until properly configured. Missing external access may
defer a specific live check, but must not be used to declare all engineering
blocked while implementation or isolated verification remains possible.
