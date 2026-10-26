# Monday cost and performance audit implementation

Scope: the 24 findings in the supplied Monday audit. Status below describes
source implementation, not production deployment or live-provider acceptance.
The existing collection, campaign, accounting and gift-delivery activation gates
remain in force. No real email, SMS, verification or paid-model requests were
sent during verification.

## Finding matrix

| # | Source result | Evidence / remaining boundary |
|---|---|---|
| 1 | Implemented | Shared `guardedFetch` covers shared chat, profile/support chat, staff drafts, agreements, Learn, triage and catalog callers, including their paid OpenAI fallbacks. Translation's HTTPS adapter shares the reservation/settlement service. |
| 2 | Implemented | Atomic Redis reservations in integer microdollars, model bands, full input/history size, image allowance and output limits; provider `usage.cost` settles exactly once. Older v1 spending is included when initializing today's v2 counter. Production fails closed without shared budget storage. |
| 3 | Mitigated; approval workflow remains | Audiences above the configured cap are rejected before expansion. Default 1,000 recipients, operator-configurable up to 10,000. The checked recipient IDs are frozen so concurrent CRM growth cannot bypass the cap. Oversized scheduled campaigns return to draft. A dedicated per-broadcast approval UI/API is not implemented. |
| 4 | Implemented | Nightly ClickHouse rows process in chunks of 250. Eligibility, policy contexts, geography, existing intents and missing job projections are batched. Sorted consent locks, fresh locked policy/consent checks and profile upserts happen per chunk. Classification remains per genuinely unclassified job. |
| 5 | Implemented | Weekly summaries use stable UUID keyset pages of 100 and concurrency five. Existing weekly notification idempotency remains. |
| 6 | Implemented | Reengagement uses stable UUID keyset pages of 100 and concurrency five. Existing opt-out filters, delivery identities and marketing contact accounting remain. Business ownership is read from businesses rather than the nonexistent business_owner role enum. |
| 7 | Mitigated; async pipeline remains | One Truth caches public column metadata for 60 seconds and enriches linked candidates rather than all 5,000 inputs. It still materializes up to 5,000 candidates on the request path; a durable asynchronous investigation workflow remains necessary for complete enterprise scans. |
| 8 | Implemented | Empty screen outboxes, activity relays and notice campaigns skip transactional/fenced work. Writer checks Redis consumer-group pending count and lag before taking a DB fence. Screen interval is two seconds; growth writer ten, relay fifteen and notices thirty seconds. |
| 9 | Implemented | Notification consumers share a store, request and socket lifecycle per authenticated account and scope. The two Media consumers no longer independently poll. Global and Media-scoped counts remain separate for correctness. |
| 10 | Implemented | Didit creation locks the user, reuses known pending sessions and stores resumable URL/token data encrypted. Responses follow transaction completion. Terminal status updates clear stored session credentials. Legacy pending sessions without stored resume data return their existing identity without creating another paid session. |
| 11 | Implemented | Explicit support categories skip unnecessary model triage, except detected safety/urgency language. Triage work uses a bounded hashed single-flight cache. Draft reuse is scoped by business, conversation, requesting staff member, language and exact source content, with an indexed content hash and conversation lock. |
| 12 | Implemented | Learn stores a successful title/category/intro/model hash. Unchanged content skips inference; changed content can run again. Within a process, concurrent work for one guide shares the in-flight task. |
| 13 | Implemented | An atomic per-session update enforces 60 seconds between guest verification sends and at most five sends per session, before invalidating an old code or sending another email. |
| 14 | Implemented | Lifecycle SMS reserves at most two sends per order, user and database day, before contacting Twilio. Ambiguous failures retain the reservation. In-app/email channels and financial state are unaffected. Old counters are deleted by the retention job. |
| 15 | Implemented | Digest pages have stable UUID ordering and a queue-ID high-water mark. Bounded preparation feeds batches of at most 100 through the existing Resend batch sender. Rows are marked sent only after batch acceptance; failed pages do not starve later users. |
| 16 | Implemented | SQLite keeps a pending-total row, initialized from historical backlog once and maintained transactionally by insert/upload triggers. Each new sale reads one balance instead of parsing the backlog under its write lock. |
| 17 | Implemented | Cloud cash replay is limited to 50 queued sales per call. LAN upload sends up to 100 completed sales together and marks them uploaded only after all identities are acknowledged. Lost responses remain retryable with existing sale identities. |
| 18 | Implemented | Silent-assignment scans exclude assignments already marked stale for the current silence window, ordered oldest first. |
| 19 | Implemented | Both food tracking surfaces stop automatic refresh after terminal status and gate background refresh on visibility. Socket updates remain, with a thirty-second recovery interval for active visible orders. Order details also stop after terminal status. |
| 20 | Implemented | Navbar's recurring thirty-second timer is removed. Counts refresh on initial load, socket events/reconnect and visibility/focus return. Notification count reads the shared store. |
| 21 | Implemented | Dashboard and Navbar coalesce simultaneous notification/conversation list reads using an account-scoped five-second snapshot cache. Distinct jobs, restaurant wallets and Credit accounts remain separate authorized requests. |
| 22 | Implemented | Provider organisation/account metadata is cached for sixty seconds on the credential object used across a posting batch, keyed by provider/company/path. Financial posts and reconciliation journal reads are never cached. |
| 23 | Implemented | Mobile push fanout selects at most fifty enabled devices, ordered by most recently updated. |
| 24 | Implemented | The existing signed Resend webhook now handles gift-card terminal delivery events, clearing worker leases so stale polls cannot overwrite the event. Status polling is bounded to eight attempts and twenty-four hours. Unknown outcomes require operator review. |

## Budget policy and operational notes

The budget rates are deliberately conservative reservation ceilings, not a
maintained vendor price list. Defaults, in USD per million input/output tokens:
economy 5/20, standard 20/100, unknown 100/200. Operators can set exact-model
pairs with `OPENROUTER_MODEL_BUDGET_RATES`; keep these at or above the provider's
maximum applicable rates. Input estimation uses UTF-8 bytes plus an allowance
of 65,536 tokens per image; it includes history. The provider's reported
`usage.cost` is authoritative for settlement. Missing usage and ambiguous
network/HTTP failures retain the reservation. Consequently temporary failures
can exhaust the daily allowance conservatively. Paid streaming is rejected
until it has an accounting-aware implementation.

See [OpenRouter usage accounting](https://openrouter.ai/docs/use-cases/usage-accounting)
for the provider response contract. Reservations prevent concurrent estimated
commitments from overshooting the allowance; estimates cannot guarantee a
vendor invoice ceiling if configured rates understate actual charges.

New schema is append-only migration `99988_cost_performance_controls.sql`.
It adds encrypted pending-session data, successful Learn hash metadata, guest
send counters, expiring SMS budgeting rows, lookup indexes and terminal Didit
credential cleanup. Apply migrations before starting the updated workers.

## Verification

- Client: `npm --prefix client run build:ci`, including frontend-reference,
  localization, TypeScript, production build and emitted-asset verification.
- Server: 308 tests passed across 36 targeted Jest suites, followed by focused
  checks of the final edits. Coverage includes affected controllers/services, consent
  boundaries, budget races, keyset digest continuation past 1,000 recipients,
  cache deduplication, authorization and existing financial behavior.
- LAN and migration-script checks: 17 tests passed.
  `node --test scripts/restaurant-store-hub.test.cjs` verifies outage,
  restart, idempotent replay, print acknowledgement and lost batch responses.
- Redis: a disposable loopback-only Redis instance handled 150 concurrent
  reservation attempts. The cap held, previous v1 spending was preserved and
  concurrent duplicate settlement released funds once. The instance was removed.
- Database: all 1,008 migrations passed on a fresh disposable PostGIS database,
  followed by a complete second pass checking checksums and guard behavior. Production data is not
  used for fixtures. Weekly, reengagement and digest SQL also executed against
  the migrated schema. A rolled-back fixture confirmed the SMS cap and
  terminal Didit credential cleanup trigger.

Remaining acceptance: remote CI/deployment confirmation, provider sandbox
sessions/webhooks, realistic multi-store/load benchmarks and production metrics.
No measured dollar saving or latency percentage is claimed from unit tests.
