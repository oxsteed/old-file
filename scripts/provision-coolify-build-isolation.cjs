'use strict';

// Keep source-image builds from exhausting the Colima VM serving production.
// Only build-time metadata is changed. Runtime credentials and volumes are not copied.
const { execFileSync } = require('node:child_process');
const APPLICATION = 'sqbntzhvwhbbywhs9prfhw51';
const BUILDER = 'oxsteed-web-bounded';
const HELPER = 'coollabsio/coolify-helper:1.0.19';
const MEMORY = 2300 * 1024 * 1024;
function docker(args, input) {
  try { return execFileSync('docker', ['--context', 'colima', ...args], {
    input, encoding: 'utf8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'],
  }).trim(); } catch { throw new Error('Build isolation operation failed; no runtime settings were returned.'); }
}
function validateLimits(info) {
  const h = info.HostConfig;
  if (h.Memory !== MEMORY || h.MemorySwap !== MEMORY || h.CpuQuota !== 100000
      || h.CpuPeriod !== 100000 || h.CpuShares !== 256) {
    throw new Error('Existing builder has unexpected resource limits; refusing to replace it.');
  }
}
function application(provision, run = docker) {
  const code = String.raw`
    $a=App\Models\Application::where('uuid','sqbntzhvwhbbywhs9prfhw51')->firstOrFail();
    if($a->git_branch!=='old-files-claude'||$a->build_pack!=='dockerfile'||$a->destination->server->user!=='root')throw new RuntimeException('Unexpected source/controller');
    $v=$a->environment_variables()->where('key','BUILDX_BUILDER')->where('is_preview',false)->first();
    if($v&&($v->value!=='oxsteed-web-bounded'||!$v->is_buildtime||$v->is_runtime))throw new RuntimeException('Conflicting builder setting');
  ` + (provision ? String.raw`
    if(!$v)$v=$a->environment_variables()->create(['key'=>'BUILDX_BUILDER','value'=>'oxsteed-web-bounded','is_preview'=>false,'is_buildtime'=>true,'is_runtime'=>false,'is_literal'=>true]);
  ` : '') + String.raw`
    echo 'OXSTEED_RESULT:'.json_encode(['application'=>$a->uuid,'buildOnly'=>$v&&$v->is_buildtime&&!$v->is_runtime,'builder'=>$v?$v->value:null]);
  `;
  const encoded = Buffer.from(code).toString('base64');
  const output = run(['exec', 'coolify', 'php', 'artisan', 'tinker', '--execute', `eval(base64_decode('${encoded}'));`]);
  const match = /OXSTEED_RESULT:(.*)/.exec(output);
  if (!match) throw new Error('Controller did not return a build isolation receipt.');
  const result = JSON.parse(match[1]);
  if (result.application !== APPLICATION || !result.buildOnly || result.builder !== BUILDER) {
    throw new Error('Application is not configured to use the bounded builder.');
  }
  return result;
}
function main() {
  const provision = process.argv.length === 3 && process.argv[2] === '--provision';
  if (!provision && !(process.argv.length === 3 && process.argv[2] === '--check')) {
    throw new Error('Use --check or --provision.');
  }
  if (provision) {
    const exists = docker(['ps', '-aq', '--filter', `name=^/buildx_buildkit_${BUILDER}0$`]);
    if (!exists) {
      docker(['run', '--rm', '-i', '--entrypoint', 'sh',
        '-v', '/var/run/docker.sock:/var/run/docker.sock',
        '-v', '/root/.docker/buildx:/root/.docker/buildx', HELPER, '-c',
        `cat > /tmp/oxsteed-buildkitd.toml; docker buildx create --name ${BUILDER} --driver docker-container --driver-opt memory=2300m,memory-swap=2300m,cpu-period=100000,cpu-quota=100000,cpu-shares=256,default-load=true,network=host --buildkitd-config /tmp/oxsteed-buildkitd.toml --buildkitd-flags "--allow-insecure-entitlement network.host" --bootstrap`],
      '[worker.oci]\n  max-parallelism = 1\n');
    }
  }
  const info = JSON.parse(docker(['inspect', `buildx_buildkit_${BUILDER}0`, '--format', '{"HostConfig":{{json .HostConfig}}}']));
  validateLimits(info);
  const config = docker(['exec', `buildx_buildkit_${BUILDER}0`, 'cat', '/etc/buildkit/buildkitd.toml']);
  if (!/^\s*max-parallelism\s*=\s*1\s*$/m.test(config)) throw new Error('Builder parallelism is not bounded.');
  console.log(JSON.stringify({ ...application(provision), memoryBytes: MEMORY, cpus: 1, parallelism: 1 }));
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { validateLimits, application };
