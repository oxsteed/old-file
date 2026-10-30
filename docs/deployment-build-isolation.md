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
Only then does it select Coolify's image buildpack, pin the registry manifest
digest and queue a rolling web replacement. Coolify pulls that immutable public
digest directly; no production source build can occur. The old release stays serving until the candidate passes
`/ready`. The script waits for the exact queue result and public runtime identity.
It refuses a conflicting deployment or an older source commit.

`--redeploy` explicitly repeats the current verified image for continuity
rehearsals. Normal invocation skips an already-current healthy release.
The old combined runtime continues owning background jobs, database/Redis,
uploads and persistent retained browser assets. Schema/background releases
remain coordinated separately; a web image cannot migrate production storage.

After one verified manual promotion, install the single automatic controller:

```sh
node scripts/install-web-release-observer.cjs --install
```

The user LaunchAgent checks for successful image receipts once a minute, locks
against overlapping releases, and records each attempted run. A failed run is
not repeatedly promoted; inspect it before an explicit retry/new image run. Its
installed bundle and state live under `~/Library/Application Support/OxSteed/web-release`.
Independent Coolify push triggers remain disabled; this observer owns promotion.
A failed remote build/pull never queues a replacement. Keep image receipts and
prior known-good images for diagnosis and recovery.

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
