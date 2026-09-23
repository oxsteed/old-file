# GitHub Actions and Coolify deployment

## Current production target

Read-only inspection on 2026-09-21 identified:

- Repository: `oxsteed/old-file`; branch: `old-files-claude`.
- Coolify application: `OxSteed Website GitHub`.
- Application UUID: `tdrapz1vvcoftfwsk7fcdq0h`.
- Runtime: the MacBook's Colima Docker context, with Coolify at local port 8000.
- Coolify automatic GitHub deployment is enabled. The live instance currently
  has no registered API tokens. A working Actions deployment connection has not
  been verified against this instance.

These are dated observations. Recheck them before changing production settings.

## Two distinct failures

Actions run 1411 passed verification but received HTTP 404 / `No resources found.`
from its deployment webhook. Run 1413 failed client localization because
`dashboards.businessOwner.draft` was absent from es/fr/ht/ar and skipped deployment.
Coolify independently finished deploying commit `3a7c8ad2` despite that CI failure.
Its automatic GitHub hook is therefore not currently gated by Actions checks.

The missing translations are repaired in this change. The previous secret URL
and token cannot be read back from GitHub, so their exact stale target is unknown.
Do not treat a green build or an already-healthy website as proof this webhook is
fixed.

## Prebuilt image deployment

The production workflow now uses a two-stage release path:

1. GitHub-hosted Ubuntu runs the verification job.
2. GitHub-hosted Ubuntu builds the production Docker image and publishes
   `ghcr.io/oxsteed/old-file:<commit-sha>` to GitHub Container Registry.
3. The image deployment job verifies the Coolify Docker Image application,
   updates its tag to the exact commit SHA, and triggers one deployment.
4. Coolify pulls the image and starts the runtime container without cloning the
   repository or running `npm ci` or Vite on the production server.

The workflow uses the commit SHA as the image tag rather than `latest`. This
keeps each deployment immutable and lets the Coolify application identify the
exact image that passed CI.

## One-time Coolify cutover

The existing `OxSteed Website GitHub` application is source-based. Create a
separate **Docker Image** application in the same Coolify project, environment,
and production server before enabling this workflow:

1. Set the image name to `ghcr.io/oxsteed/old-file` and use any temporary tag.
2. Preserve the production domains, runtime environment variables, port `5000`,
   the `/ready` health check, the uploads volume mounted at
   `/app/server/runtime/uploads`, and the production Docker network used by the
   database and Redis services.
3. Configure Coolify's Docker Registry credentials so the deployment server can
   pull the private GHCR package. Use a narrowly scoped GitHub token with
   `read:packages`; do not put that token in the repository or a webhook URL.
4. Add the new Docker Image application's UUID as the
   `COOLIFY_IMAGE_APPLICATION_UUID` repository variable. The workflow reuses
   the existing `COOLIFY_WEBHOOK_URL` secret and replaces only its application
   UUID, so no second webhook secret is required. Keep `COOLIFY_TOKEN` or
   replace it with a token that can read the image application and deploy it.
5. Add the client build values that were previously supplied to Coolify as
   GitHub Actions repository secrets/variables: `VITE_SENTRY_DSN` when used,
   `VITE_AWS_LOCATION_API_KEY` when maps are enabled, and
   `VITE_AWS_LOCATION_REGION` when it differs from `us-east-1`.
6. Verify the image application manually, then disable Coolify's independent
   GitHub push deployment for the old source-based application. Leaving both
   active would cause duplicate deployments and could bypass CI.

The workflow fails closed if the Coolify webhook points at a different
application or if the application is configured for a different GHCR image.
Run this read-only image preflight after the Coolify application and token are
ready:

```sh
COOLIFY_IMAGE_WEBHOOK_URL='https://coolify.example/api/v1/deploy?uuid=<existing-application-uuid>' \
COOLIFY_IMAGE_APPLICATION_UUID='<image-application-uuid>' \
COOLIFY_TOKEN='provided-out-of-band' \
COOLIFY_IMAGE_NAME='ghcr.io/oxsteed/old-file' \
COOLIFY_IMAGE_TAG='<commit-sha>' \
node scripts/deploy-coolify.cjs --check-image
```

The command validates configuration only and does not deploy. GitHub Actions
uses the equivalent `--deploy-image` command after the image is published.

## Actions deployment configuration

The image workflow uses these GitHub Actions secrets and variables:

- `COOLIFY_WEBHOOK_URL`: the existing reachable HTTPS Coolify deployment URL.
  The workflow replaces its `uuid` query parameter with the image application
  UUID before deploying. Do not use a local `127.0.0.1` URL.
- `COOLIFY_IMAGE_APPLICATION_UUID`: the new Docker Image application's UUID.
- `COOLIFY_TOKEN`: a token created on that same instance for the application's
  team, with read and deploy permissions. Do not use a full-access token when
  read/deploy permissions suffice.

The image name is intentionally non-secret and is fixed in the workflow as
`ghcr.io/oxsteed/old-file`. GitHub's automatically provided `GITHUB_TOKEN` is
used only to publish the image and is limited to `packages: write` for that job.

GitHub-hosted runners cannot reach the MacBook's loopback address. Establish the
approved authenticated HTTPS route or a suitable private runner before enabling
the Actions deployment path. Do not expose the administration port directly or
put tokens in URLs, source files, documentation, or command output.

For the old source application, the legacy source preflight remains available:

```sh
node scripts/deploy-coolify.cjs --check
```

Set `GITHUB_REPOSITORY` and `GITHUB_REF_NAME` when running locally to also verify
source identity. Actions supplies these automatically. The image `--deploy-image`
path verifies the registry image, patches only the requested commit tag, submits
one POST, follows the returned deployment UUID, and succeeds only when Coolify
finishes. Failed/cancelled deployments, bad credentials, wrong targets, image
mismatches, and timeouts remain explicit failures. Requests do not follow
redirects with credentials and errors omit server response bodies.

The existing public readiness, API health, and catalog checks run after successful
deployment completion. The production deployment job serializes Actions runs.

## Complete the integration

1. Create and configure the Docker Image application and private GHCR pull access.
2. Add `COOLIFY_IMAGE_APPLICATION_UUID`, client build variables, and any required
   GitHub Actions secrets.
3. Run `--check-image` and confirm the application points at the expected image.
4. Disable the old source application's independent automatic deployment.
5. Run a controlled push after CI passes; verify the queued image deployment,
   image tag, `/ready`, API health, and the public site.

The repository changes do not create the Coolify Docker Image application,
rotate credentials, or disable the current source deployment. Those one-time
integration steps require access to the Coolify console or a scoped Coolify API
token and remain pending until completed.

## Repository verification for this repair

Local verification on 2026-09-21:

- Reproduced the missing locale key failure before changing the four catalogs.
- `client/`: `npm run build:ci` passed (including localization, TypeScript, and
  the Vite production build); `node --test scripts/*.test.mjs` passed 37 tests.
- `server/`: `npm test` passed all 167 suites and 1,219 tests after updating the
  workflow wiring assertion for the extracted deployment command.
- `node --test scripts/deploy-coolify.test.cjs` passed 12 tests covering bad
  credentials, stale/wrong resources, source mismatch, image mismatch,
  read-only checking, image tag updates, completion, failure, timeout, and
  redacted errors. These use a simulated API; they do not establish working
  production credentials or Coolify registry access.
- All 20 archived source/guide files match their original Git blobs exactly.
  Scratch files removed from tracking are still present locally and ignored.
- `git diff --check -C --find-copies-harder` passed; copy detection preserves the
  archived guides' original whitespace. The existing Vite large-chunk warning remains.

No production deployment or live financial activity was performed for this repair.
