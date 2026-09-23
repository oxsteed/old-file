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

## Actions deployment configuration

The workflow uses two GitHub Actions secrets:

- `COOLIFY_WEBHOOK_URL`: the reachable HTTPS URL for the live instance, with path
  `/api/v1/deploy?uuid=<application-uuid>`. Use the application's webhook URL, not
  a deployment UUID, old resource, tag, or local `127.0.0.1` URL.
- `COOLIFY_TOKEN`: a token created on that same instance for the application's
  team, with read and deploy permissions. Do not use a full-access token when
  read/deploy permissions suffice.

GitHub-hosted runners cannot reach the MacBook's loopback address. Establish the
approved authenticated HTTPS route or a suitable private runner before enabling
the Actions deployment path. Do not expose the administration port directly or
put tokens in URLs, source files, documentation, or command output.

With those secrets supplied through the environment, this command is read-only:

```sh
node scripts/deploy-coolify.cjs --check
```

Set `GITHUB_REPOSITORY` and `GITHUB_REF_NAME` when running locally to also verify
source identity. Actions supplies these automatically. `--deploy` verifies the
target, submits one POST, follows the returned deployment UUID, and succeeds only
when Coolify finishes the workflow's commit. Failed/cancelled deployments, bad
credentials, wrong targets, and timeouts remain explicit failures. Requests do
not follow redirects with credentials and errors omit server response bodies.

The existing public readiness, API health, and catalog checks run after successful
deployment completion. The production deployment job serializes Actions runs.

## Complete the integration

1. Confirm the live application, team, branch, and approved API access route.
2. Create the restricted token and replace the two Actions secrets with the live
   instance's values. Run the read-only preflight.
3. Coordinate deployment ownership: when Actions becomes the verified deployment
   controller, disable Coolify's independent automatic push deployment for this
   application. Keeping both causes duplicate deployments and bypasses CI gates.
4. Run a controlled deployment after CI passes; verify the queued deployment,
   commit identity, `/ready`, and the public site before calling the repair done.

The repository changes do not rotate credentials, disable the current automatic
deployment, or change the default branch. Those integration changes remain pending.

## Repository verification for this repair

Local verification on 2026-09-21:

- Reproduced the missing locale key failure before changing the four catalogs.
- `client/`: `npm run build:ci` passed (including localization, TypeScript, and
  the Vite production build); `node --test scripts/*.test.mjs` passed 37 tests.
- `server/`: `npm test` passed all 167 suites and 1,219 tests after updating the
  workflow wiring assertion for the extracted deployment command.
- `node --test scripts/deploy-coolify.test.cjs` passed 9 tests covering bad
  credentials, stale/wrong resources, source mismatch, read-only checking,
  completion, failure, timeout, and redacted errors. These use a simulated API;
  they do not establish working production credentials.
- All 20 archived source/guide files match their original Git blobs exactly.
  Scratch files removed from tracking are still present locally and ignored.
- `git diff --check -C --find-copies-harder` passed; copy detection preserves the
  archived guides' original whitespace. The existing Vite large-chunk warning remains.

No production deployment or live financial activity was performed for this repair.
