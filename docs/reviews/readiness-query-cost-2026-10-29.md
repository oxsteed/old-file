# Targeted schema readiness lookup - 2026-10-29

Requirement 1 remains open. The next schema-guard deployment exposed new
public 503s and five-second probe timeouts during its image build, before the
new container took traffic. Preserve the complete monitor report at
`verification-2026-10-28-web-continuity/public-continuity-schema.json` in the
chat artifacts. A short zero-failure observation from the previous release
was insufficient to accept deployment continuity.

A read-only production comparison identified recurring schema-check overhead.
The existing information_schema query returned the five required columns in
1,588/324/162 ms. A catalog join returned the same five in 80/58/52 ms. A more
targeted attribute lookup returned five in 7,477/92/41 ms; the first sample also
included connection/scheduling delay and must not be omitted. These are
wall-clock observations on a loaded host, not isolated SQL benchmark results
or proof that this query alone caused the outages. The Colima VM reported
six CPUs, about 5.8 GiB RAM, no swap, CPU queue pressure and memory stalls.

The replacement query resolves only the fixed public relations and indexed
attributes needed by the readiness contract. Missing relations, missing or
dropped columns still fail closed. It uses bound table/column names, an explicit
public qualifier, and no schema override in production. Database, Redis,
migrations, financial activation, realtime, worker and shutdown checks retain
their existing behavior. No cached success or longer health-check tolerance is
introduced.

Five focused suites pass 31 tests, including real PostgreSQL in the explicitly
disposable operations database. The integration creates only its own random
schema and drops it afterwards; the production connection is never used by
the tests. Complete columns pass; dropped columns and a removed relation are
reported as missing. Unit checks pin the public qualifier, indexed lookup,
parameter bindings and dropped-column predicate.

Required next evidence: all four PR checks, live publication, a monitored
normal replacement and rejected candidate under the final runtime, and an
old-document navigation. Automatic deployment remains held until these pass.
