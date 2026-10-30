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
The package can remain private; the existing host gh login has read:packages.

```sh
gh workflow run web-image.yml --repo oxsteed/old-file --ref old-files-claude
node scripts/promote-prebuilt-web.cjs --run <successful-image-workflow-id>
```

Promotion verifies the workflow, artifact receipt, current default branch,
required CI checks, pulled image digest, ARM64 architecture and OCI revision.
Only then does it select Coolify's image buildpack and queue a rolling web
replacement. The image is loaded under the existing application's local image
name, so no registry credential is copied to Coolify and no production source
build can occur. The old release stays serving until the candidate passes
`/ready`. The script waits for the exact queue result and public runtime identity.
It refuses a conflicting deployment or an older source commit.

`--redeploy` explicitly repeats the current verified image for continuity
rehearsals. Normal invocation skips an already-current healthy release.
The old combined runtime continues owning background jobs, database/Redis,
uploads and persistent retained browser assets. Schema/background releases
remain coordinated separately; a web image cannot migrate production storage.

Independent Coolify push triggers remain disabled. Automatic promotion ownership
must use this verified-image path rather than re-enabling source compilation.
A failed remote build/pull never queues a replacement. Keep image receipts and
prior known-good images for diagnosis and recovery.

Docker documents [explicit builder selection](https://docs.docker.com/build/builders/)
and [container builder limits](https://docs.docker.com/build/builders/drivers/docker-container/).
The installed Coolify controller was also inspected to verify that the image
buildpack invokes rolling promotion without its source build method.
