# MacBook host reconciliation

The host reconciler runs once at launchd load and every 300 seconds. It handles
independent Coolify GitHub webhook deployments without an Actions API token or
a manual provisioning command for each release. No installation was performed
while implementing these files.

Each cycle discovers exactly one running `app` container for the supplied
`applicationUuid`, using the explicit `colima` Docker context. It calls
`provisionReleaseMetadata`, then invokes Boyle's existing adapter as:

```text
node scripts/sync-coolify-backup-monitor.cjs --apply --app-container NAME
```

`NAME` comes from Docker inspection, never a remembered container name. The
container ID and name are checked again before backup delivery. Ambiguous,
stopped, replaced, or unrelated containers are rejected and retried next cycle.
Metadata failure does not suppress backup synchronization. Errors omit raw
transport payloads and process environments.

The metadata reader compares the current container record with fresh Docker
provenance. Unchanged records skip the networkless writer container. New or
changed records are written atomically to the dedicated metadata volume, which
the app mounts read-only. Missing authoritative values remain null. No app
Docker socket, credentials, application restart, or existing resource deletion
is required.

## Deployment and one-time installation

First deploy the source changes, including the read-only
`oxsteed-release-metadata` Compose volume and Boyle's backup ingestion code.
Then review the following read-only commands on the MacBook:

```sh
cd /Users/oxsteed/Documents/GitHub/6
node scripts/reconcile-coolify-host.cjs --check --application tdrapz1vvcoftfwsk7fcdq0h
node scripts/install-coolify-host-reconciler.cjs --plan --application tdrapz1vvcoftfwsk7fcdq0h
```

When the reviewed installation is authorized, install once as `oxsteed`:

```sh
node scripts/install-coolify-host-reconciler.cjs --apply --application tdrapz1vvcoftfwsk7fcdq0h
```

The default Node executable is `/usr/local/bin/node`. If this Mac uses the other
allowlisted location, append `--node-path /opt/homebrew/bin/node` to both the
plan and installation commands.

The installer copies only the reviewed script/dependency allowlist under
`/Users/oxsteed/Library/Application Support/OxSteed/host-reconciliation/<uuid>`.
This avoids launchd needing access to the Documents checkout. Boyle's source
files are copied as dependencies and are not modified. The generated plist is
installed under `/Users/oxsteed/Library/LaunchAgents/` with label
`com.oxsteed.host-reconciliation.<uuid>` and a 300-second interval.

The installer validates UUIDs, executable paths, home ownership, symlink-free
destinations, file conflicts, and the plist. It creates a new LaunchAgent with
`launchctl bootstrap`; an identical loaded installation is left running. It
does not delete files, overwrite a different installed bundle, or restart an
existing job. Updates to an installed bundle therefore require a separately
reviewed update procedure; this installer fails explicitly on different files.

After installation, check the scoped `reconciliation.out.log` and
`reconciliation.err.log` under the installation directory, and confirm
`/ready.releaseMetadata` after a successful cycle. No live scheduler registration,
backup ingestion, or end-to-end installed job execution has been verified by
the source-only tests.

## Focused verification

```sh
node --test scripts/provision-release-metadata.test.cjs scripts/reconcile-coolify-host.test.cjs scripts/install-coolify-host-reconciler.test.cjs scripts/deploy-coolify.test.cjs
```

Tests use fake Docker, filesystem installation, and launchctl operations; native
`plutil` parses the generated configuration on macOS. An isolated temporary copy
also checks the installed bundle's Node dependency closure. These tests do not
install the LaunchAgent or synchronize production backup records.
