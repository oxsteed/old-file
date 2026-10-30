# Deployment continuity final acceptance

Scope: web replacement availability, rejected candidates, retained assets, and
realtime reconnection. Background/schema releases remain separately coordinated.

## Realtime shutdown correction

The old shutdown used `namespace.local.disconnectSockets(true)`. That sends a
Socket.IO namespace DISCONNECT packet; clients classify it as `io server
disconnect` and disable automatic reconnection. HTTP continuity alone therefore
did not establish uninterrupted live updates.

Use Socket.IO's server close lifecycle instead. It closes the old process's
transports and adapter, without a cluster-wide disconnect or namespace eviction.
Clients receive a transport closure and automatically reconnect to the successor.
The regression uses a real client, shuts down the old server, starts a replacement
at the same address, and proves reconnection without a manual connect call.
It also checks that adapter/cluster disconnect operations are never invoked.

Validation: the new regression fails against the old source with `io server
disconnect`; all 22 tests across realtime integration, adapter readiness, and
application runtime pass with the fix. Production acceptance remains pending
until this PR passes all four CI jobs, merges, and its rollout is measured.

## Overlapping readiness probes

PR #653 passed the four required CI jobs and merged as `f7a3484e0`.
The disposable installed-controller rehearsal passed slow startup (100 requests),
failed readiness (185), and cancelled startup (55), with zero failures and
complete cleanup. Production rejection remains a failed acceptance: deployment
`w6eltouuaiwxu1x7jc41ryud` retained the old container, but the public monitor
recorded 32 failed responses. A repeat (`rbz7wyqazsolkmwu5ucmmb2p`) recorded
three more. Both rejected candidates were removed and `/ready` restored.

The old app logged a readiness database connection timeout during the first
window. During the repeat, direct readiness remained 200 but one observation
took 2.1 seconds. Independent Docker, proxy, and monitoring probes repeat the
same database work concurrently under startup pressure. Share an unfinished
readiness observation per pool/Redis pair, releasing it as soon as it settles.
This retains no successful cache. Each caller reads current traffic, shutdown,
worker, and realtime state after the shared dependency check; control-plane
callers retain their explicit traffic-state policy.

Four focused suites pass 36 tests, including overlapping observations, fresh
failure after success, and withdrawal while dependency work is pending.
This is a load reduction, not evidence that production continuity has passed.
Repeat monitored rejection and promotion after CI and publication.
