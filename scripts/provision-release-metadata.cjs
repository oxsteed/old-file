'use strict';

// MacBook host-side post-deploy step. --check only observes Docker metadata; --provision
// writes one container-scoped record to the dedicated Compose volume. Never
// reads container environments, credentials, or mounts the Docker socket.
// node scripts/provision-release-metadata.cjs --check|--provision --application <uuid>
// After deploying this Compose definition, use --provision as the MacBook's
// host-side post-deploy step, or enable COOLIFY_PROVISION_LOCAL_METADATA=true
// for scripts/deploy-coolify.cjs on a Colima runner. Each new container needs
// a new record; an image's build metadata alone cannot identify a deployment.
const { execFileSync } = require('node:child_process');
const { gitSha, imageDigest, deploymentId } = require('../server/utils/release');

const DIRECTORY = '/app/server/runtime/release-metadata';
const VOLUME = 'oxsteed-release-metadata';
const CONTAINER_FORMAT = '{"containerId":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"runtimeRole":{{json (index .Config.Labels "com.oxsteed.runtime")}},"imageId":{{json .Image}},"imageReference":{{json .Config.Image}},"hostname":{{json .Config.Hostname}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"configFiles":{{json (index .Config.Labels "com.docker.compose.project.config_files")}},"mounts":{{json .Mounts}}}';
const IMAGE_FORMAT = '{"imageId":{{json .Id}},"repoDigests":{{json .RepoDigests}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}';
const HOST_CHECKOUT = '/Users/oxsteed/Documents/GitHub/6';

// Coolify's local Compose image tag and OCI revision label may contain the
// abbreviated commit that appears in the image name. Resolve that short
// revision against the host checkout before writing provenance; never invent
// a full hash from the content release or image ID.
function resolveLocalGitSha(value, { cwd = process.cwd(), exec = execFileSync } = {}) {
  const direct = gitSha(value);
  if (direct) return direct;
  const short = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{7,40}$/.test(short)) return null;
  const directories = [...new Set([cwd, process.cwd(), HOST_CHECKOUT].filter(Boolean))];
  for (const directory of directories) {
    try {
      const resolved = exec('git', ['rev-parse', '--verify', `${short}^{commit}`], {
        cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
      }).trim().toLowerCase();
      if (gitSha(resolved) && resolved.startsWith(short)) return resolved;
    } catch {
      // Try the next verified local checkout; never accept an unverified value.
    }
  }
  return null;
}

function observeMetadata(container, image, applicationUuid, expected = {}, { resolveSha = resolveLocalGitSha } = {}) {
  if (container.project !== applicationUuid || !/^[a-f0-9]{64}$/.test(container.containerId || '') ||
      !/^[a-f0-9]{12,64}$/.test(container.hostname || '') || !container.containerId.startsWith(container.hostname) ||
      !imageDigest(container.imageId) || image.imageId !== container.imageId) {
    throw new Error('Docker container, hostname, project, or immutable image identity could not be verified.');
  }
  // Only Coolify-generated /artifacts/<deployment-uuid>/... Compose paths
  // establish deployment identity. A resource UUID or container name does not.
  const files = String(container.configFiles || '').split(',').map((file) => file.trim());
  const ids = files.map((file) => /^\/artifacts\/([a-zA-Z0-9_-]+)\//.exec(file)?.[1]);
  const observedDeployment = ids.every(Boolean) && new Set(ids).size === 1 ? deploymentId(ids[0]) : null;
  const reference = String(container.imageReference || '');
  const tag = reference.slice(reference.lastIndexOf(':') + 1);
  // Coolify's local Compose image name is <application-uuid>_<service>:<commit>.
  const taggedSha = (reference.startsWith(`${applicationUuid}_`) || reference.startsWith(`${applicationUuid}:`)) ? resolveSha(tag) : null;
  const revision = resolveSha(image.revision);
  if (revision && taggedSha && revision !== taggedSha) throw new Error('Image revision and Coolify image tag disagree.');
  const sha = revision || taggedSha;
  if (expected.gitSha && (!gitSha(expected.gitSha) || sha !== gitSha(expected.gitSha))) {
    throw new Error('Docker image does not match the completed Coolify commit.');
  }
  if (expected.deploymentId && observedDeployment !== expected.deploymentId) {
    throw new Error('Docker container does not match the completed Coolify deployment.');
  }
  const repository = reference.includes('@') ? reference.split('@')[0] : reference.replace(/:[^/:]+$/, '');
  const digests = [...new Set((image.repoDigests || [])
    .filter((entry) => entry.startsWith(`${repository}@`))
    .map((entry) => imageDigest(entry.slice(entry.lastIndexOf('@') + 1))).filter(Boolean))];
  const mounts = (container.mounts || []).filter((entry) => entry.Destination === DIRECTORY);
  const mount = mounts.length === 1 ? mounts[0] : null;
  // Coolify prefixes named Compose volumes with the verified application
  // UUID. Use the mounted volume, never create a new unprefixed substitute.
  const canProvision = mount?.Type === 'volume' && mount.RW === false
    && [VOLUME, `${applicationUuid}_${VOLUME}`].includes(mount.Name);
  return {
    metadata: {
      schemaVersion: 1,
      containerId: container.containerId,
      imageId: container.imageId,
      gitSha: sha,
      imageDigest: digests.length === 1 ? digests[0] : null,
      deploymentId: observedDeployment,
    },
    hostname: container.hostname,
    canProvision,
    metadataVolumeName: canProvision ? mount.Name : null,
  };
}

function runDocker(args, input) {
  try {
    return execFileSync('docker', ['--context', 'colima', ...args], {
      encoding: 'utf8', input, timeout: 30000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error('Colima Docker metadata operation failed; no credentials or raw Docker errors were logged.');
  }
}

function validateApplicationUuid(applicationUuid) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(applicationUuid || '') || !deploymentId(applicationUuid)) {
    throw new Error('Pass a valid Coolify application UUID.');
  }
  return applicationUuid;
}

function validateRuntime(runtime) {
  if (!['compose', 'web'].includes(runtime)) throw new Error('Runtime must be compose or web.');
  return runtime;
}

function findApplicationContainer({ applicationUuid, docker = runDocker, expectedContainerId = null, runtime = 'compose' } = {}) {
  validateApplicationUuid(applicationUuid);
  validateRuntime(runtime);
  if (expectedContainerId && !/^[a-f0-9]{64}$/.test(expectedContainerId)) {
    throw new Error('Pin an immutable full container ID, not a name or short prefix.');
  }
  const roleFilter = runtime === 'web' ? 'label=com.oxsteed.runtime=web' : 'label=com.docker.compose.service=app';
  const runningIds = docker(['ps', '--filter', `label=com.docker.compose.project=${applicationUuid}`, '--filter', roleFilter, '--format', '{{.ID}}'])
    .split(/\s+/).filter(Boolean);
  if (runningIds.some(id => !/^[a-f0-9]{12,64}$/.test(id))) throw new Error('Docker app identifiers could not be verified.');
  const ids = expectedContainerId ? runningIds.filter(id => expectedContainerId.startsWith(id)) : runningIds;
  if (ids.length !== 1) {
    if (expectedContainerId) throw new Error('The pinned app container changed or is no longer running; retry reconciliation.');
    throw new Error('Expected exactly one running Coolify app container; provisioning stopped.');
  }
  const container = JSON.parse(docker(['inspect', ids[0], '--format', CONTAINER_FORMAT]));
  const serviceMatches = runtime === 'compose' ? container.service === 'app'
    : container.runtimeRole === 'web' && container.name === `/${container.service}`
      && new RegExp(`^${applicationUuid}-[0-9]{8}T[0-9]{6}$`).test(container.service || '');
  if (container.project !== applicationUuid || !serviceMatches || container.running !== true ||
      !/^[a-f0-9]{64}$/.test(container.containerId || '') || !container.containerId.startsWith(ids[0]) ||
      !/^\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(container.name || '')) {
    throw new Error('Running app container identity could not be verified.');
  }
  if (expectedContainerId && container.containerId !== expectedContainerId) {
    throw new Error('The pinned app container changed during inspection; retry reconciliation.');
  }
  return { ...container, name: container.name.slice(1) };
}

function provisionReleaseMetadata({ applicationUuid, expected = {}, checkOnly = false, docker = runDocker,
  expectedContainerId = null, runtime = 'compose', resolveSha = resolveLocalGitSha } = {}) {
  const container = findApplicationContainer({ applicationUuid, docker, expectedContainerId, runtime });
  if (expectedContainerId && container.containerId !== expectedContainerId) {
    throw new Error('The app container changed during reconciliation; retry the next cycle.');
  }
  const image = JSON.parse(docker(['image', 'inspect', container.imageId, '--format', IMAGE_FORMAT]));
  const observed = observeMetadata(container, image, applicationUuid, expected, { resolveSha });
  let changed = false;
  if (!checkOnly) {
    if (!observed.canProvision) throw new Error('Deploy the Compose release metadata volume before provisioning.');
    const reader = "const fs=require('node:fs');try{const m=JSON.parse(fs.readFileSync('/app/server/runtime/release-metadata/'+process.argv[1]+'.json','utf8'));console.log(JSON.stringify(Object.fromEntries(['schemaVersion','containerId','imageId','gitSha','imageDigest','deploymentId'].map(k=>[k,m[k]]))));}catch{console.log('null');}";
    let existing;
    try { existing = JSON.parse(docker(['exec', container.containerId, 'node', '-e', reader, observed.hostname])); }
    catch { throw new Error('The current metadata record could not be checked; retry the next cycle.'); }
    // A short Coolify label can be temporarily unresolvable if the host
    // checkout is unavailable. Preserve a previously verified full SHA for
    // this immutable container instead of degrading public provenance.
    const existingGitSha = gitSha(existing?.gitSha);
    if (!observed.metadata.gitSha && existingGitSha) observed.metadata.gitSha = existingGitSha;
    changed = !existing || Object.entries(observed.metadata).some(([key, value]) => existing[key] !== value);
    if (changed) {
      // Use the already inspected immutable image as a networkless writer. The
      // application mounts this volume read-only. Rename makes reads atomic.
      const writer = "const fs=require('node:fs');let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const p='/metadata/'+process.argv[1]+'.json';fs.writeFileSync(p+'.tmp',input,{mode:0o644});fs.renameSync(p+'.tmp',p);});";
      docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', '--mount', `type=volume,source=${observed.metadataVolumeName},target=/metadata`,
        '--entrypoint', 'node', '-i', container.imageId, '-e', writer, observed.hostname], `${JSON.stringify(observed.metadata)}\n`);
    }
  }
  return { ...observed.metadata, provisioned: !checkOnly, changed, canProvision: observed.canProvision,
    metadataVolumeName: observed.metadataVolumeName,
    missing: ['gitSha', 'imageDigest', 'deploymentId'].filter((key) => !observed.metadata[key]) };
}

module.exports = { observeMetadata, provisionReleaseMetadata, findApplicationContainer, validateApplicationUuid, validateRuntime, resolveLocalGitSha, runDocker };

if (require.main === module) {
  const [mode, flag, applicationUuid, ...extra] = process.argv.slice(2);
  try {
    if (!['--check', '--provision'].includes(mode) || flag !== '--application' || !(extra.length === 0 || extra.length === 2 && extra[0] === '--runtime')) {
      throw new Error('Usage: node scripts/provision-release-metadata.cjs --check|--provision --application <uuid> [--runtime compose|web]');
    }
    console.log(JSON.stringify(provisionReleaseMetadata({ applicationUuid, runtime: extra[1] || 'compose', checkOnly: mode === '--check' }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
