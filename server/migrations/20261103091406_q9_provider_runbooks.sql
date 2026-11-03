-- Q9 provider runbooks (Track D, 2026-11-03).
--
-- The M3 runbook registry is the ops_runbooks table (migration 648) with
-- its read/write API in server/routes/serviceOps.js and
-- server/controllers/serviceOpsController.js. There is no file-based
-- runbook registry in the repo, so these runbooks are seeded into that
-- table, in its exact format: code (lowercase slug), title, category,
-- body. Inserts are idempotent (ON CONFLICT ON code DO NOTHING) so
-- re-running this migration, or an operator editing a runbook through
-- the API afterwards, never creates duplicates or clobbers edits.
-- Categories come from the controller allowlist: incident, deployment,
-- safety, vendor, compliance.
--
-- Each runbook covers detection, immediate containment, fail-closed
-- behavior, and recovery verification, in that order.
--
-- NOTE on the ops_runbook_history trigger (migration 99983): it fires on
-- every ops_runbooks insert and writes an admin_audit_log row with
-- admin_id = NEW.updated_by. A migration-time seed has no admin actor,
-- and admin_audit_log.admin_id is NOT NULL with a foreign key to
-- users(id), so leaving updated_by NULL fails the migration and no
-- real user row exists to point at on a fresh database. The seed
-- therefore inserts with the trigger disabled and then writes the
-- version snapshots itself (the same rows the trigger would have
-- written), so seeded runbooks still have version history. The
-- migration file itself is the audit record for the seed.

ALTER TABLE ops_runbooks DISABLE TRIGGER ops_runbook_history;
INSERT INTO ops_runbooks (code, title, category, body) VALUES
('provider-outage-stripe', 'Provider outage: Stripe', 'vendor', $rb$
# Stripe outage

## Detection
- Stripe API errors spike: 502/503/429 from Stripe calls, webhook delivery delays, or transfer and dispute calls timing out.
- Symptoms that point at Stripe rather than OxSteed: Stripe status shows an incident, multiple unrelated Stripe call sites fail at once, and local database and Redis checks pass.
- Confirm before acting: run one read-only Stripe check (retrieve a known transfer or dispute) from the server environment. One failed call is not an outage; a pattern across call sites is.

## Immediate containment
- Stop initiating new Stripe money movements: do not queue new settlement payouts, do not retry failed transfers by hand, and do not mark settlements paid manually to "catch up". A manual mark-paid without a Stripe transfer creates a ledger record that contradicts reality.
- Leave in-flight settlements alone. Payouts in status initiated are owned by the transfer webhook confirmation path; voiding or disputing those settlements strands the payout reservation.
- Tell support the exact customer-facing wording: payments and payouts through Stripe are delayed, no money has been lost, and no action is needed from customers. Do not promise a time.
- Keep the webhook endpoint up. Stripe retries webhooks; a down endpoint turns a delay into lost confirmations.

## Fail-closed behavior (already built, do not work around it)
- Settlement payout initiation fails closed: no Stripe transfer, no payout state change, and the settlement stays approved and unpaid until Stripe recovers.
- Webhook confirmation fails closed: if the transfer cannot be verified against Stripe, the webhook errors so Stripe retries, instead of marking a settlement paid on unverified evidence.
- Chargeback evidence staging failures are recorded as reconciliation exceptions and retried by the deadline job; the auto-submit safety net still applies once Stripe recovers, subject to evidence deadlines.

## Recovery verification
- Confirm Stripe status is green and the read-only check passes.
- Reconcile before resuming: list settlements in payout status initiated and verify each transfer id against Stripe; list settlements approved but unpaid and confirm none was manually marked paid during the outage.
- Resume in order: first let webhook retries confirm in-flight payouts, then queue new payouts through the normal maker-checker path. Do not bulk-retry failed transfers; each payout goes through its own approval and its deterministic idempotency key.
- Check the reconciliation exceptions queue for chargeback evidence items that failed during the outage and confirm each dispute is still within its evidence deadline. Escalate any item past deadline to the operations lead immediately.
- Close the incident only when: Stripe is green, in-flight payouts are confirmed or failed with a recorded reason, no settlement is both marked paid and missing a Stripe transfer, and the chargeback exception queue is clear or owned.
$rb$),
('provider-outage-database', 'Provider outage: database (PostgreSQL)', 'incident', $rb$
# Database outage (PostgreSQL)

## Detection
- API errors spike with database connection or query errors, health checks fail, and unrelated features fail at once.
- Distinguish a database outage from a single slow query: check connection counts, active locks, and replication lag if available. A single stuck migration or advisory lock looks like an outage to one feature but not to all.
- Confirm before acting: check the database host is reachable from the app host and that the connection pool is not exhausted by a runaway worker.

## Immediate containment
- Do not restart the database blindly and do not kill connections by hand unless a single session is identified as the blocker. A blind restart loses in-flight transactions and turns a slowdown into data uncertainty.
- If the database is read-only or unreachable, stop the writers: pause background jobs that write (settlement cycle, backfill sweeper, renewal workers) so they do not burn retry attempts or park rows as failed. The backfill sweeper already skips work while the rail is frozen; freezing the rail is the clean way to stop money writers.
- Preserve evidence: capture the slow query log, lock list, and connection counts before any restart. Without them, the same outage recurs uninvestigated.
- Tell support: the platform is unavailable or degraded, no money movement is being processed, and customers should retry later. Do not promise that in-flight payments completed.

## Fail-closed behavior (already built, do not work around it)
- Money transactions are atomic: a failed transaction rolls back rather than posting half a ledger entry. Never hand-edit ledger rows to "fix" an outage.
- Pending actions stay pending: a checker decision that cannot commit does not move money, and the pending row remains for a later decision within its expiry window.
- Settlement period overlap and idempotency checks run inside transactions with advisory locks, so concurrent retries cannot create duplicate settlements once the database returns.

## Recovery verification
- Confirm the database accepts connections, replication (if any) is caught up, and no long-running transaction from the outage window is still holding locks.
- Run the readiness check and the credit reconciliation for the outage window before resuming money writers. Investigate every difference; do not write off a difference as outage noise.
- Resume writers in order: read paths first, then background jobs, then money writers. Re-enable the rail only after reconciliation is clean.
- Check parked backfill rows: rows parked as failed during the outage are operator work, not automatic work. Review them through the backfill queue before requeueing, and record who requeued them.
- Close the incident only when: reconciliation is clean, parked rows are owned, no duplicate settlements or ledger entries appeared, and the root cause note (with the captured lock and query evidence) is recorded.
$rb$),
('provider-outage-redis', 'Provider outage: Redis', 'incident', $rb$
# Redis outage

## Detection
- Cache errors, session or rate limiter failures, job lock failures, and realtime or queue delays, while database-backed reads still work.
- Distinguish Redis being down from Redis being slow: check connectivity, memory pressure, and eviction counts. A full Redis that evicts keys looks like random failures, not a clean outage.
- Confirm before acting: check Redis responds to a ping from the app host and that the failure is not a single misconfigured client.

## Immediate containment
- Do not flush Redis to "fix" it. A flush destroys sessions, locks, rate limiter state, and cached data at once, and turns a partial outage into a full one.
- Job locks deserve special care: fenced jobs (chargeback deadline, backfill sweeper, settlement cycle) rely on locks to avoid duplicate runs. If locks are unreliable, pause those jobs rather than letting two instances run the same money job twice.
- Rate limiters backed by Redis fail open or closed depending on the limiter; assume the mutation limiter is degraded and tell admins to avoid bulk money actions until Redis recovers. Do not disable limiters permanently to work around the outage.
- Tell support: logins, realtime updates, or background processing may be degraded, while core data is safe in the database. Give the degraded feature list, not a blanket "site is down".

## Fail-closed behavior (already built, do not work around it)
- Money truth lives in PostgreSQL, not Redis. A Redis loss never creates, deletes, or alters a ledger entry, settlement, or pending action.
- Pending actions, idempotency keys, and audit events are database rows. Losing Redis does not lose a pending approval or replay a money movement.
- Where a job lock cannot be acquired, the job skips its run instead of running unlocked. That skip is the safe behavior; do not force the job.

## Recovery verification
- Confirm Redis responds, memory is below pressure thresholds, and eviction counts have stopped climbing.
- Check for duplicate job effects during the outage window: duplicate chargeback submissions, duplicate backfill replays, and duplicate settlement cycle runs. The deterministic idempotency keys should have prevented duplicates; verify rather than assume.
- Warm up gradually: resume background jobs one at a time and watch error rates before resuming the next.
- Close the incident only when: Redis is stable, job runs are clean for one full cycle each, no duplicate money effects are found, and sessions and rate limiters behave normally.
$rb$),
('provider-outage-ai', 'Provider outage: AI provider', 'vendor', $rb$
# AI provider outage

## Detection
- AI features fail (chat drafts, tagging, summaries) while the rest of the platform works, and provider API errors or timeouts spike.
- Distinguish a provider outage from a prompt or quota problem: check provider status, error codes (rate limit versus authentication versus service unavailable), and whether all AI call sites fail or only one feature.
- Confirm before acting: run one minimal provider call from the server environment. An authentication error is a credential problem, not an outage, and follows the credential rotation path instead.

## Immediate containment
- Degrade AI features to their non-AI fallback, not to silence. Chat and support drafts fall back to human-written handling; tagging falls back to untagged with a manual review queue. Never present a cached or guessed AI answer as fresh.
- Stop retrying failed AI calls in a tight loop. Back off, and cap retries, so a provider outage does not turn into a rate limit ban that outlasts the outage.
- Queue, do not drop, user-visible AI work that must happen (for example support draft generation). Dropped work is invisible; queued work is recoverable.
- Tell support: AI-assisted features are temporarily unavailable and human handling applies. Do not promise AI answers will arrive later unless they are actually queued.

## Fail-closed behavior (already built, do not work around it)
- AI is never on the money path. No payment, payout, settlement, refund, or compliance decision requires an AI response, so an AI outage cannot block or alter money movement.
- AI output is advisory: drafts, tags, and summaries are reviewed by a human before they reach a customer or affect a record. Never let an AI response write directly to a ledger, a compliance decision, or a customer notification during an outage.
- If an AI feature has no safe fallback, disable that feature visibly (with a clear unavailable message) rather than serving degraded output that looks complete.

## Recovery verification
- Confirm the provider is green, authentication works, and a minimal call succeeds with normal latency.
- Drain the queued AI work in order and check a sample of outputs for quality before resuming live AI responses. A provider that returns after an outage sometimes returns degraded models or stale behavior.
- Check for user impact during the outage: messages that went unanswered, drafts that were never generated, and tags that were skipped. Assign owners to clear that backlog; do not bulk-close it.
- Close the incident only when: the provider is stable, the queue is drained or owned, sampled outputs are good, and no AI output reached a customer unchecked during the outage.
$rb$)
ON CONFLICT (code) DO NOTHING;
ALTER TABLE ops_runbooks ENABLE TRIGGER ops_runbook_history;
INSERT INTO ops_runbook_versions (runbook_id, version, snapshot)
SELECT id, version, to_jsonb(r) FROM ops_runbooks r
WHERE code IN ('provider-outage-stripe', 'provider-outage-database', 'provider-outage-redis', 'provider-outage-ai')
ON CONFLICT DO NOTHING;
