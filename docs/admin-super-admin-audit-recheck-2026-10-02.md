# Admin and Super-Admin Audit Recheck

Date: October 2, 2026  
Repository: `oxsteed/old-file`  
Branch: `old-files-claude`  
Base revision checked: `fe9779cc913d7d5b20d6304aad050fb435f4ea8b`  
Worktree status: additional local changes are present and have not been pushed by this recheck.

## Decision

The code-level repair pass is healthy, but this is not a production certification. The branch now has stronger authorization boundaries, safer workflow transitions, and passing server/client verification. Live authenticated browser evidence, disaster recovery evidence, and several scale/operational redesigns still require the production-like environment and owned infrastructure described below.

## Evidence collected

- Server suite: **333 suites passed, 3 skipped; 3,522 tests passed, 46 skipped** after the follow-up edits. The focused profile-visibility recheck also passes: 30 tests passed.
- Client `npm run build:ci`: **passed** after the follow-up client changes, including i18n verification, type checking, production Vite build, and verification of 724 emitted assets.
- Client `npm run verify:i18n`: **passed** after adding the new mode-policy history and career pagination strings to all five locales; the script still reports pre-existing translation debt elsewhere, but no parity or interpolation failure.
- Admin route matrix: **136 routes, no violations**. Every route resolves to one credential policy, every manifest grant is server-enforced, and no phantom anonymous route was found.
- Profile bulk recovery: the focused recheck passes **30 tests**. Stale `processing` claims now retain the canonical payload, expose a permissioned admin recovery list, and can be reclaimed and replayed without repeating completed item mutations. Migration `654_profile_visibility_recovery.sql` must apply before this UI is deployed.
- Mode-policy controls: the protected console now exposes server-derived enforcement coverage and a version-checked, reason-required rollback action. Rollbacks create a new immutable revision and audit row instead of rewriting history.
- Authenticated browser matrix: **2 scenarios skipped** because `OXSTEED_E2E_BASE_URL` and authenticated storage state/test credentials are not configured in this checkout. This is an evidence gap, not a pass.
- Live readiness check at `https://oxsteed.com/ready`: status `ready`; migrations **648/648**, zero pending/unexpected migrations; database, Redis, realtime, workers, traffic, shutdown, credit ledger, and credit rail reported healthy.
- Live release metadata still reports `gitSha`, `imageDigest`, and `deploymentId` as null. Coolify must provide those deploy-time variables before release provenance is auditable from `/ready`.

## Repairs completed in this recheck

### Authorization and admin navigation

- Added missing grant guards to admin routes and matching navigation entries so pages do not appear reachable when their APIs require a grant.
- Added and enforced the `manage_financials` permission for treasury mutations while retaining `view_financials` for reads.
- Enforced delegated permission grants at request time, including grantor authority, expiry, revocation, and global-scope behavior. Regional scope loading now respects global and delegated grants without widening a regional assignment.
- Updated the route matrix contract and browser-facing route assertions to cover the guarded page shape.

### Workflow and integrity controls

- Treasury ownership checks now tolerate PostgreSQL BIGINT values returned as strings without weakening entity ownership validation.
- Mode approval decisions now require a rejection reason, enforce valid state transitions, and reject stale concurrent decisions instead of overwriting a newer state.
- Profile-visibility bulk hides now preflight active work even for small batches and recheck it before each effect.
- Unsupported content-removal targets are rejected instead of being reported as successfully removed.
- Super-dashboard flagged-job filtering is null-safe.
- One Truth suspect discovery is bounded at 5,000 users and reports truncation instead of allowing an unbounded request to grow with the entire user table.

### Configuration and operational lifecycle

- Country-pack JSON configuration can no longer shadow canonical code, name, status, locale, currency, or timestamps; update requests containing reserved keys are rejected.
- Franchise activation now requires an approved application, signed or waived agreement, completed training, ready launch status, and every checklist item completed or waived. It returns actionable conflict codes and does not create a business prematurely.
- Corporate department defaults reject unknown permission codes before deleting existing defaults, preventing silent privilege loss caused by typos or stale catalogs.
- Platform approval middleware now fails closed with a retryable 503 when its authorization state cannot be verified; protected actions no longer bypass approval during a database or service failure.
- Mode policy edits now validate the registered action inventory and application-schema shape, require the current `updated_at` version, reject stale concurrent edits, and record a durable policy-version binding for new approvals. Migration `651_mode_policy_versions.sql` must apply before this path is deployed.
- Bulk profile visibility now claims an idempotency key before side effects, rejects payload reuse, releases claims when approval is missing, and can reclaim abandoned processing claims. Migration `652_profile_visibility_idempotency_claims.sql` must apply before this path is deployed.
- Bulk profile visibility now records each successful item outcome transactionally with its profile mutation and audit row. A lost response can replay completed items without repeating the mutation; migration `653_profile_visibility_item_outcomes.sql` must apply before this path is deployed.
- Platform hiring now requires a super-admin or an active global `manage_operations` grant, employer opening and applicant lists are bounded with pagination, nested career history is capped, and application creation, withdrawal, interview scheduling, stage changes, offer creation, and offer decisions keep their related events and downstream membership changes atomic. The employer UI provides load-more controls.
- Country-pack reads now fail closed when the registry database is unavailable instead of advertising the built-in US fallback as active. Callers receive an explicit retryable unavailable response.
- Public Terms now resolve the durable live draft/version from PostgreSQL after the existing seed is established, so admin publication state is connected to the public acceptance document. Database availability is required for this publication path.

## Findings that are now stale in the prior report

The original report was written against revision `e7ac941...` and should not be used as current line-level evidence. In addition to the repairs above, the current branch already contains fixes for several formerly reported items, including the order transaction-helper call shape, omitted quote-currency preservation, support claim atomicity, template authorization, and search entity-grant filtering. Reconfirm these from the current revision rather than applying the old line references blindly.

## Remaining code and design work

These are the remaining items that should stay open in the engineering backlog:

1. **One Truth needs a real investigation pipeline.** The 5,000-user cap prevents an unbounded request, but it is not complete coverage. Move candidate generation to an indexed, versioned background job with persisted progress, case assignment, and explicit coverage boundaries.
2. **Mode-policy migrations and enforcement decisions need live verification.** Coverage reporting and controlled rollback are now code-complete. Migration `651_mode_policy_versions.sql` still needs live application, and missing-policy behavior must be explicitly reviewed for every newly registered action rather than relying on a generic default.
3. **Careers still needs a durable outbox/state machine for external side effects.** Database state, events, and business membership provisioning are now transactional across the core hiring mutations, but email/push/calendar/provider notifications need retryable outbox delivery and a visible failure queue.
4. **Worldwide workforce scope needs a complete operating model.** The current grants are safer, but country/region ownership, reviewer assignment, conflict-of-duty rules, effective dates, access recertification, and distributed revocation still need scale testing and product workflows.

## Infrastructure and live-environment gates

These cannot be honestly closed by source edits alone:

- Configure authenticated browser test base URL and storage state, then run the route, permission, responsive, RTL, theme, and reduced-motion matrix against the deployed revision.
- Rehearse migrations against a production-like populated PostgreSQL database, including rollback/recovery evidence and an upgrade from the previous deployed revision.
- Demonstrate backup completion and a restore into an independent environment. Cloudflare R2 object storage does not by itself provide compute or database failover.
- Provide independent compute/database failure domains, shared realtime presence/fanout, worker ownership and lease-loss tests, connection budgets, query timeouts, and representative six-million-user load fixtures before claiming worldwide readiness.
- Set Coolify release metadata variables so `/ready` identifies the deployed Git SHA, image digest, and deployment ID.
- Complete provider-console configuration and live checks for external integrations such as AWS Location key restrictions and Stripe/webhook/account-connect status.

## Recommended release disposition

The code is suitable for continued controlled deployment after review of the local diff and the normal migration/deployment gates. It should not be labeled “fully ready for 3,500 employees and 6 million users” until the remaining code items have owners and acceptance tests, and the live browser, restore, migration-upgrade, release-provenance, and scale evidence is captured.
