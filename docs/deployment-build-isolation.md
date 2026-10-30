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
