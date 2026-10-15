# Logistics refactor completion - 2026-10-15

Base reviewed: `old-files-claude` at `03dd7126c8185e358552420ce87580a86edb1752`.
Scope: close the remaining implementation gaps in `logistics-refactor-spec.md`.

## Changes

| Gap | Result |
| --- | --- |
| Repeated checkout could create multiple processor charges | Subject locks reserve an installment before intent creation; another key resumes the same in-flight card attempt. Changing methods while reserved is rejected. Provider creation failures retain durable recovery state. |
| Higher accepted quotes could not collect a remaining balance | Quote-scoped settled uniqueness and server-calculated outstanding amounts allow the same method to collect only the accepted revision's delta. Publishing a revision is blocked while payment is in flight. |
| Interrupted checkout could become stranded | Checkout restores the attempt, method, amount, and original idempotency key. Unconfirmed attempts can be cancelled. Legacy pending Credit attempts resume atomically; settled retries do not debit again. Existing checkout query aliases remain supported. |
| Duplicate historic Stripe charges could not enter refund review | Superseded Stripe attempts are refundable through the existing two-distinct-admin workflow. They never count toward fulfillment funding. |
| Funding gates trusted stale paid totals | Migration 883 adds verified net funding, subtracting proposed, approved, executing, and processed refunds. Placement and release check the latest accepted quote and net funding under locks. Fully prepaid orders with zero final installments are supported. |
| Staff could not complete finance handoffs through the interface | Operations Finance supports buyer quote drafting/publication, deposit-window opening, placement approvals, reconciliation notes, and funding exceptions. Existing staff permissions remain server-enforced. Resolving a queue item does not establish payment success. |
| Allocation previews lacked a corresponding full page | `/logistics/allocations/:id` renders the allocation details directly. Preview instances reset when the selected record changes. |
| Stale account reads and unsaved drafts | Logistics route boundaries remount on account/mode/record changes. Campaign drafts use the shared unsaved-change guard. |
| Inconsistent presentation and localization | Shared theme-based surfaces, readable secondary actions, status pills, logical spacing, focus styles, and touch targets. All 20 Logistics locale trees match between legacy and namespaced catalogs. New staff labels and payment/quote notifications are translated. Missing statuses display a neutral dash. |
| Recovery was not scheduled or enforced in CI | The existing stuck-attempt sweep runs every 15 minutes. CI runs both real PostgreSQL Logistics suites against a separate disposable service and rejects skipped integration cases. |

## Validation

- Fresh disposable PostgreSQL migration through 883 passed. Migration rehearsal passed **860/860** migrations, including idempotency/checksum verification.
- `LOGISTICS_CREDIT_PAY_TEST_DATABASE_URL=... npx jest logistics --runInBand --json ...`: **21 suites / 360 tests passed**, no skips. The integration-result assertion also passed.
- After moving payment notifications after transaction commit, focused completion, double-debit, and webhook regressions passed: **3 suites / 42 tests**.
- `node --test client/scripts/logisticsCompletion.browser-check.cjs`: passed. Real React components with synthetic accounts, orders, API responses, and providers; 80 combinations of four pages, five widths (320/390/768/1360/1600), two themes, French and Arabic RTL. Covers previews/Escape/focus containment, quote creation/publication, outstanding-balance checkout, original-key resume, unsaved drafts, and account switches during delayed reads. Checks overflow, untranslated labels, and secondary-action visibility. Screenshots were inspected locally.
- `client`: locale verification, typecheck, and `npm run build:ci` passed. Legacy/namespaced Logistics trees and navigation-label types were checked for all 20 languages.
- Broad server run: 668 suites passed initially. Five failing suites subsequently passed with disposable PostgreSQL and local FFmpeg configured (including the corrected Credit replay fixture). One unrelated Media assertion remains locally unavailable: without FFprobe, the documented 16:9 fallback yields 1280x720 instead of the fixture's 960x720. CI installs FFmpeg/FFprobe. This is not a green full-server claim.
- `git diff --check` passed.

These are local checks, not proof of remote CI, live processor acceptance, a human screen-reader pass, or production deployment.

## Release and operations

- Apply **883_logistics_installment_revisions.sql** with the normal migration runner. The number was checked against the default branch and open PRs before use.
- Preserve the existing activation gates: `LOGISTICS_PAYMENTS_ENABLED` defaults off; `LOGISTICS_CREDIT_PAY_ENABLED` requires `1`. No production gate, participant, rail, secret, or balance was changed by this work.
- Before activation, Operations must verify the Stripe merchant/webhook configuration, an explicitly approved USD Logistics Credit participant and agreement, the Credit rail, accounting ownership, and reconciliation procedures. Use the existing runtime secret store for provider configuration.
- Every installment still requires the buyer's explicit confirmation. No mixed funding, unattended saved-card charges, FX, supplier/carrier payout automation, or single-admin Logistics refund override was introduced.
- Publication, approvals, and queue resolutions are explicit staff actions. The scheduled sweep creates review work; it does not automatically pay or refund.
- Production rollout and operational acceptance remain separate. Do not wait for deployment to finish this implementation task.
