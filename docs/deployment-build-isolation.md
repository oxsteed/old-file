# Build isolation for the production Colima VM

The web app staying healthy in Docker did not guarantee availability: building
its replacement on the same 5.8 GiB VM caused readiness connection timeouts and
proxy 503s. Deployment `2bquy7ey4jv83myydwjivi1t` was cancelled during its full
image build after the public probe recorded failures. The working container was
retained. This failed observation is preserved in the deployment evidence.

Coolify's Dockerfile build now uses `BUILDX_BUILDER=oxsteed-web-bounded` as a
build-only variable. The docker-container builder has a 2,300 MiB memory limit,
no extra swap, one CPU quota, low CPU shares, and one concurrent build step.
Default image loading leaves the result in the existing Colima engine for
Coolify to promote after readiness succeeds. Production runtime variables,
worker ownership, app volumes and source/CI gates retain their existing roles.

Docker documents the explicit builder selection and container resource controls:
[builder selection](https://docs.docker.com/build/builders/),
[container driver](https://docs.docker.com/build/builders/drivers/docker-container/).

Read-only verification:

```sh
node scripts/provision-coolify-build-isolation.cjs --check
```

Idempotent provisioning for this exact web resource:

```sh
node scripts/provision-coolify-build-isolation.cjs --provision
```

The provisioner refuses conflicting limits or application settings. It uses the
installed helper image and the controller's existing `/root/.docker/buildx`
metadata mount, adding a separate BuildKit cache volume. Preserve that builder
metadata/cache across host maintenance. It never recreates application storage.
The current controller source was checked to export build-only variables before
invoking `docker build`; recheck that behavior after a Coolify upgrade.

Build limits may cause a large candidate to fail rather than consuming all VM
resources. Such failure must retain the current release. Increase capacity or
move builds to a separate builder if the bounded build cannot succeed; disabling
the limits is not an acceptance fix. Measured production success/rejection
verification is still required after enabling this configuration.
