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
