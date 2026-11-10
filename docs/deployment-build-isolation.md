# Prebuilt images for uninterrupted web replacements

Production is an 8 GiB Mac with a roughly 5.8 GiB Colima VM. The old web app
remaining healthy did not guarantee availability: compilation on that same VM
caused readiness database timeouts and delegated-worker observation timeouts.
A dedicated builder capped at one CPU, 2,300 MiB RAM, and one build step reduced
contention, but did not pass acceptance: deployment `ssfwefxfcliir0zvfe5oauca`
recorded nine failed requests across 1,093 samples. Preserve those failed results.
Its old browser document still navigated successfully and live updates reconnected
in about one second. Resource caps alone are not the production solution.

## Release path

`Verified web image` builds native ARM64 images on GitHub's ARM runner, after the
four required CI jobs pass. Only a successful default-branch CI event or an
explicit default-branch workflow dispatch can publish. A dispatch verifies the
commit's checks or its exact merged PR's checks. No fork workflow receives
package credentials. Runtime secrets are never passed to the image build; the
four public Vite settings use separately configured repository build secrets.

The image workflow publishes `ghcr.io/oxsteed/old-file-web` and a receipt containing
its immutable manifest digest, source commit, architecture and workflow ID.
The package is public, matching the public source repository and existing public
browser configuration. Runtime credentials are excluded by the Docker build
context and are supplied only when the container starts. Anonymous access to
the exact digest is verified before promotion; no user token is copied to Coolify.

```sh
gh workflow run web-image.yml --repo oxsteed/old-file --ref old-files-claude
node scripts/promote-prebuilt-web.cjs --run <successful-image-workflow-id>
```

Promotion verifies the workflow, artifact receipt, current default branch,
required CI checks, pulled image digest, ARM64 architecture and OCI revision.
It then queries only migration markers in a read-only transaction, using the
healthy web app or, during recovery, the uniquely identified healthy combined
app. The exact candidate image compares those markers to
its SQL catalog and checksum policy without a network, credentials or volumes.
Missing migrations hold the release before Coolify settings or the queue are
changed. Other marker conflicts require investigation and an explicit retry.
The image workflow checks that the packaged checker detects an empty schema
before publishing the release receipt.
Only then does it select Coolify's image buildpack, pin the registry manifest
digest and queue a rolling web replacement. Coolify pulls that immutable public
digest directly; no production source build can occur. The old release stays serving until the candidate passes
`/ready`. The script waits for the exact queue result and public runtime identity.
It refuses a conflicting deployment or an older source commit.

`--redeploy` explicitly repeats the current verified image for continuity
rehearsals. Normal invocation skips an already-current healthy release.
`--recover` can restore an unavailable web app using a verified image for the
exact commit already serving public traffic from the healthy combined app:

```sh
node scripts/promote-prebuilt-web.cjs --run <serving-release-image-run-id> --recover
```

Recovery verifies the same image and migration evidence as a normal promotion.
It requires no healthy web replica and keeps the combined app in service.
The old combined runtime continues owning background jobs during web
promotion. A normal web image cannot migrate production storage. For additive
schema releases, review `deploy/web-schema-bridge.json` against the exact
serving commit and image, and record the hashes of the complete migration
delta. The bridge workflow rejects any unreviewed SQL change. Before running
the bounded schema transaction, the observer checks the old worker owner and
installs the same compatibility hashes on it. Rehearse the reviewed SQL on an
isolated restore before merging the schema release. The observer reads the
plan from the verified candidate commit and checks it against the immutable
bridge receipt.

After one verified manual promotion, install the single automatic controller:

```sh
node scripts/install-web-release-observer.cjs --install
```

The user LaunchAgent checks for successful image receipts once a minute, locks
against overlapping releases, and records each attempted run. A release waiting
for migrations or a healthy schema source is rechecked every five minutes and
can be superseded by a newer image receipt. The startup schema check still runs against the replacement's
own database configuration. A failed run requires inspection before an explicit
retry or a new image run. The observer's
installed bundle and state live under `~/Library/Application Support/OxSteed/web-release`.
Independent Coolify push triggers remain disabled; this observer owns promotion.
A failed remote build/pull never queues a replacement. Keep image receipts and
prior known-good images for diagnosis and recovery.

Combined runtimes hold a PostgreSQL advisory ownership lock on one pool
session. A replacement can start in `combined-standby` without registering
consumers. However, Coolify 4.6.0 forcibly stops the old Compose services before
starting the replacements. The November 9 deployment of `2f98890` returned
503 on 13 homepage and 13 readiness samples over approximately 52 seconds
during that worker replacement. The web/schema promotion preceding it passed.

The observer retains the current worker. It allows client, documentation,
workflow, and listed observer-file changes to promote independently after
verification. A release that needs a different server or schema records
`worker_release_requires_rolling_target` before queuing a web or schema
replacement. Keep this gate until a rolling worker target has demonstrated
standby startup, single ownership, and safe recovery of a failed candidate.

In the November 3 host rehearsal, the candidate-side checker ran in a
disposable networkless Colima container. With the live image's migration
catalog it accepted the production markers. With the default-branch catalog
at `d89274619` it reported 18 pending markers and no conflicting markers.
The rehearsal used local read-only mounts for the checker and comparison
catalog. It did not queue a replacement or apply any migrations, and public
`/ready` still identified the serving release afterward.

Docker documents [explicit builder selection](https://docs.docker.com/build/builders/)
and [container builder limits](https://docs.docker.com/build/builders/drivers/docker-container/).
The installed Coolify controller was also inspected to verify that the image
buildpack invokes rolling promotion without its source build method.

The release workflow uses the same v7 checkout as repository CI. The legacy
unconfigured `old-file-v3` gitlink makes v4 checkout with immediate credential
cleanup fail before any image builds. The fresh hosted runner and `.git`
Docker-context exclusion keep checkout credentials outside the image.

The installed Docker containerd image store reports an index digest as image ID,
while classic Docker reports a configuration digest. Promotion accepts only
identities in the verified index/platform/configuration chain, together with the
expected ARM64 architecture and OCI source revision. The first strict config-ID
assumption rejected a correct image before queuing; its failed observation is
retained. No identity check is bypassed.

## Container shutdown boundary

The 2026-10-30 recovery rehearsal caught a readiness timeout and a roughly
ten-second realtime reconnect gap even though the image-only successful and
rejected-candidate rehearsals had no failed sampled HTTP requests. The old
`dumb-init -- npm start` process tree did not deliver a usable drain window:
an isolated container exited in 130 ms without reaching Node's SIGTERM handler.
Direct Node unit tests had not exercised this production process boundary.

The container now runs `sh scripts/start-container.sh`: schema preparation and
asset synchronization must both succeed, then `exec node index.js` replaces the
shell. dumb-init supervises Node directly and waits for its drain. The combined
runtime retains its existing preparation semantics; web-only preparation remains
read-only. The application's readiness withdrawal and five-second web drain
remain unchanged.

`scripts/verify-container-shutdown.cjs --image <image> [--context colima]` runs
the built image's actual ENTRYPOINT/CMD with three synthetic startup boundaries,
no network, no runtime credentials and no production volumes. It requires Node's
SIGTERM handler to finish a two-second drain, and requires schema/asset failure
to prevent app startup. The old image fails this check; the corrected startup
passed with a 2,134 ms drain and both failed-preparation scenarios. The ARM image
workflow runs this against each built image before issuing its release receipt.
These isolated checks do not replace the remaining live handoff acceptance.

## Readiness failover during withdrawal

The corrected process drained for five seconds and kept HTML/Food/API requests
available, but a public `/ready` probe could still select the retiring instance
before the next private health check removed it. That instance correctly returned
503 with `traffic=false` and `shutdown=false`; this is not a failed dependency
and must not be hidden by changing its readiness result.

`node scripts/configure-web-readiness.cjs --check` prepares managed Coolify
labels for exact `/ready` GET/HEAD routes only. `--apply` saves those desired
labels for the next verified rolling replacement without changing any running
container. The original routers, TLS, middleware and private `/ready` health
checks remain intact. Traefik 3.7's status-aware retry permits up to three
attempts on 503, with 100 ms initial backoff and a 1.5 second budget. Each reply
still comes from an actual backend; if every backend is unready the result stays
503. No ordinary API route or write request receives this middleware.

Run `node --test scripts/configure-web-readiness.test.cjs` for route/guard
regressions. `node scripts/rehearse-readiness-retry.cjs --image <existing-image>`
uses the installed proxy image and synthetic Node servers on an internal,
disposable network with no production environment, data or volumes. It verifies
healthy failover, bounded genuine failure, and no API/write replay. Its backend
health checks are disabled deliberately to hold a stale backend in rotation and
to keep exact request counts free of unrelated Docker health probes.

See the versioned [Traefik retry configuration](https://doc.traefik.io/traefik/v3.7/reference/routing-configuration/http/middlewares/retry/).

## Confirm a timed-out background probe on a serving replica

During the November 3 replacement, the serving web replica reported a failed
background readiness observation and briefly returned 503. A timed-out
background probe now gets one immediate confirmation attempt, capped at
1.5 seconds, only when the web replica is already serving with a prior healthy
result. The observation stays coalesced. An explicit unhealthy response or a
failed confirmation withdraws readiness. New candidates still need a
successful initial observation.

Three related Jest suites passed 34 tests. An isolated HTTP rehearsal using
the production readiness evaluator sampled 112 successful readiness requests
while recovering from eight injected timeouts. An explicit unhealthy response
and two successive timeouts each produced 503. The earlier three proxy 503s
occurred before candidate startup and had no upstream response. Their cause
remains open. This source change needs CI and another monitored production
rollout before availability acceptance.

## Readiness deadline hierarchy (November 4 follow-up)

The live proxy used a 3-second health-check deadline, while the web runtime's
background observation allowed 5 seconds followed by a shorter 1.5-second
confirmation. At 11:49-11:50 UTC the proxy returned nineteen 503s without an
origin response; the web logged two background probe timeouts and withdrawal.
The first proxy failure preceded the worker-state change, so worker-state
withdrawal alone does not explain the entire window.

`server/config/readinessBudgets.json` now defines a 5-second initial observation,
a confirmation of up to 5 seconds, and a 15-second proxy health deadline.
There is still only one confirmation, only for a previously ready serving web
replica. Initial startup, explicit unhealthy responses, failed confirmation,
database checks, shutdown and readiness status semantics remain strict.
Successful readiness results are not cached. The existing public GET/HEAD-only
retry policy is unchanged and writes are not replayed.

`node scripts/configure-web-readiness.cjs --check` previews the desired proxy
deadline. After source verification, `--apply` stores it in managed Coolify
labels for the next verified rolling replacement; it does not modify the
running container. Do not treat saving labels as proof the live deadline changed.
The new configuration uses the `health5` service and router namespace. Reusing
`health4` with a different deadline would give the Docker provider conflicting
definitions while old and new containers overlap. New normal routers have one
more priority point; exact readiness routers use 5001. Existing TLS and security
middleware references are retained, and repeated configuration is idempotent.

`node scripts/rehearse-readiness-deadlines.cjs --image <existing-node-image>`
uses the installed Traefik image and an internal disposable network. Its slow
but healthy backend answers readiness in 3.5 seconds while serving other
requests promptly. The observed run recorded 24 legacy-deadline failures and
zero aligned-deadline failures across 41 samples. Explicit unhealthy status
withdrew routing in 2.48 seconds; an unresponsive health request withdrew it
in 15.9 seconds. A synthetic write arrived exactly once. No production data,
credentials, volumes, deployments or network settings were used by the fixture.

The extended run also exercised overlapping versioned file-provider routers
and removed the old route after takeover: 37 rollover samples had zero failures.
That run observed 22 legacy failures and zero aligned failures across 40 slow
readiness samples; explicit failure withdrew traffic in 2.865 seconds and an
unresponsive probe in 16.14 seconds. These rehearsals reproduce the deadline
failure mode, but do not prove it was the only cause of the production incident.

Focused validation passed 21 Jest cases, 18 deployment/configuration cases,
and five footer cases. The footer browser expectation was corrected for the
latest default branch's intentional unlaunched Media state; the enabled Media
case remains covered in the navigation model tests. PR CI, configuration
installation, schema catch-up and a monitored live rollout remain required.
