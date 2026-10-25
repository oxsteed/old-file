# Demand & Sales Engine: acceptance items 10–16

This is the outstanding acceptance scope as of 2026-10-25, not a launch
approval. Collection, campaign delivery, partner adapters, prospect outreach
and policy-notice delivery remain default-off. Do not set review flags to
make an empty dashboard appear populated.

| Item | Existing software | Evidence required to close |
| --- | --- | --- |
| 10. Policies | Twenty upcoming privacy/notice drafts and a content digest manifest; existing cookie and public policy pages | Final reviewed English text; professional review of all 20 languages and native-speaker legal review in en/es/fr/ht/ar; compare current/upcoming privacy, cookie disclosures, signup, settings and notices for purpose, choice, recipients, retention and effective-date consistency. Archive reviewed content hashes and reviewer references. Machine drafts and matching section counts do not prove equivalent meaning. |
| 11. Native companion apps | `/api/activity/config` and `/batch` accept ios/android surfaces; shared push-open route; partial native-open reporting | Shipping iOS and Android tap handlers, approved deep links, Offers notification controls and permission/consent-aware tracking. Record app versions, cold/warm/background tap results, account-switch/withdrawal behavior and release adoption. The Terminal Swift package in this repository is not the companion app. See [activity contract](activity-contract.md). |
| 12. Production stores | Replicated ClickHouse migrations, dedicated growth Redis client and a staging Compose topology | Two ClickHouse replicas across separate failure domains, three Keeper members with quorum, dedicated persistent Redis with a replica, private TLS endpoints, durable disks, access controls and named operations ownership. Prove actual replication and recovery. A single Mac running all containers is a rehearsal, not production fault isolation. |
| 13. Classification | Rules/Ollama pipeline, review queue, diagnostic evaluator and strict acceptance mode | Human-labelled, approved-source gold data: 300 per vertical per language. Run against reviewed active taxonomy and pinned model on the GPU host; retain dataset hash, provenance/review references, comparable baseline, report and model/prompt identity. Require `acceptance.pass`, ≥90% overall, ≥85% each language and no >2-point qualifying-intent regression. Synthetic tests do not close this item. |
| 14. Partners | Default-off Amazon adapter, bounded feeds/postbacks, prospect provenance/suppression storage | Approved current provider terms/accounts and product/feed rights; verified sandbox callbacks, reversals and duplicate handling; licensed prospect-source approval, permitted purposes, provenance and suppression rehearsal. Record provider-issued acceptance evidence. Local mocks cannot accept a contract. |
| 15. Privacy and operations | Export/erasure paths, consent locks, retention rules and backup/restore operation jobs | Run the populated isolated rehearsal below, retain dated evidence, then verify the deployed topology independently. Production-like backup encryption, restore, failover and performance are still unverified. |
| 16. Launch approval | Fail-closed rollout, adult eligibility checks, immutable notice batches and computed effective date | Legal/DPIA/LIA and jurisdiction review, reviewed adult-eligibility evidence, approved notices/content hashes, approved delivery quota and provider acceptance. Explicitly start the reviewed notice plan and wait until the later of its quoted date and 14 days after the last accepted notice send. Zero accepted sends never establish an effective date. Use existing settings approval controls only after all required gates close. |

## Populated isolated rehearsal

Use disposable named resources under the existing isolated harness. Preserve
production stores, uploads and backups. Keep every collection/delivery switch
off outside the isolated fixture. Record the source commit, migrated schema,
resource topology, commands, timestamps, assertions and artifact hashes.

1. Populate synthetic eligible/ineligible adults, internal/minor exclusions,
   consent/notice/unknown jurisdictions, GPC and sale/share denials. Include
   activity, classified interests, segments, targeting, delivered history,
   conversions and suppressions. Establish expected export/delete/retain counts.
2. Export each subject from populated Postgres, Redis and ClickHouse. Verify
   ownership, completeness, explicit cap errors and absence of private props.
3. Withdraw consent while batches/outbox/writer leases and campaign deliveries
   are in flight. Reclaim stale leases; prove denied subjects cannot be inserted
   or sent after withdrawal. Confirm unrelated subjects continue normally.
4. Erase and replay queued work. Verify physical ClickHouse removal and stream
   cleanup, preserved denials, purpose-limited retained records and accurate
   audit counts. Verify retention expiry on both replicas, including aggregates.
5. Create an encrypted backup, restore into an isolated target and rerun rights
   checks, including reapplication of erasures since the backup. Retain evidence
   of encryption, recovery point/time and no reintroduction of erased subjects.
6. Stop one ClickHouse replica, one Keeper member and the Redis primary in turn.
   Prove quorum, read/write recovery, no lost acknowledged events, bounded
   duplicate handling and eventual replica convergence. Measure sustained
   5,000 events/second under the approved resource budget; local unit tests do
   not establish throughput or recovery capacity.

Operations commands and current limitations are in the
[ClickHouse runbook](clickhouse-runbook.md). Human/provider approvals and live
infrastructure evidence must be supplied by their owners, not manufactured as
test fixtures. The software acceptance check does not change runtime settings.
