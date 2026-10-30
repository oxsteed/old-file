'use strict';

// Managed Coolify labels, not a second proxy/deployment controller. A retiring
// backend must return 503 to private health checks. Public read-only probes can
// try another ready backend without weakening readiness or replaying writes.
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const RETRY = 'oxsteed-ready-retry';
const ROUTER_PREFIX = 'oxsteed-ready-';
const retryConfig = { attempts: 3, initialInterval: '100ms', timeout: '1500ms', status: ['503'], maxRequestBodyBytes: 1024, retryNonIdempotentMethod: false };

function readinessLabels(source) {
  const labels = new Map(source.trim().split(/\r?\n/).filter(Boolean).map(line => {
    const position = line.indexOf('=');
    if (position < 1) throw Error('Invalid managed label');
    return [line.slice(0, position), line.slice(position + 1)];
  }));
  for (const key of labels.keys()) if (key.startsWith(`traefik.http.routers.${ROUTER_PREFIX}`) || key.startsWith(`traefik.http.middlewares.${RETRY}.`)) labels.delete(key);
  const rules = [...labels].filter(([key]) => /^traefik\.http\.routers\.[^.]+\.rule$/.test(key));
  if (!rules.length) throw Error('No existing routers');
  for (const [key, rule] of rules) {
    const original = key.slice(0, -5);
    if (!/^Host\(`(?:www\.|api\.|status\.)?oxsteed\.com`\) && PathPrefix\(`\/`\)$/.test(rule)) throw Error('Unexpected web router scope');
    const service = labels.get(`${original}.service`);
    if (service !== 'oxsteed-web-sqbntzhvwhbbywhs9prfhw51-health4') throw Error('Unexpected readiness service');
    const router = `traefik.http.routers.${ROUTER_PREFIX}${original.slice('traefik.http.routers.'.length)}`;
    labels.set(`${router}.rule`, `(${rule}) && Path(\`/ready\`) && (Method(\`GET\`) || Method(\`HEAD\`))`);
    labels.set(`${router}.service`, service);
    labels.set(`${router}.priority`, '5000');
    labels.set(`${router}.middlewares`, [labels.get(`${original}.middlewares`), RETRY].filter(Boolean).join(','));
    for (const [name, value] of [...labels]) if (name.startsWith(original + '.') && /\.(entrypoints|tls|tls\.[^.]+)$/.test(name.slice(original.length))) labels.set(router + name.slice(original.length), value);
  }
  for (const [key, value] of Object.entries(retryConfig)) labels.set(`traefik.http.middlewares.${RETRY}.retry.${key.toLowerCase()}`, Array.isArray(value) ? value.join(',') : String(value));
  return { labels: [...labels].map(([key, value]) => `${key}=${value}`).join('\n'), routers: rules.length };
}

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function controller(code) {
  const guard = String.raw`$a=App\Models\Application::where('uuid','sqbntzhvwhbbywhs9prfhw51')->firstOrFail();if($a->git_branch!=='old-files-claude'||$a->build_pack!=='dockerimage'||$a->health_check_path!=='/ready'||$a->settings->is_auto_deploy_enabled)throw new RuntimeException('Unexpected web resource');`;
  const encoded = Buffer.from(guard + code + `echo 'SAFE_RESULT:'.json_encode($result);`).toString('base64');
  try {
    const output = execFileSync('docker', ['--context', 'colima', 'exec', 'coolify', 'php', 'artisan', 'tinker', '--execute', `eval(base64_decode('${encoded}'));`], { encoding: 'utf8', timeout: 30000, stdio: ['ignore','pipe','pipe'] });
    return JSON.parse(output.match(/SAFE_RESULT:(.*)/)[1]);
  } catch { throw Error('Managed readiness configuration failed; response and credentials omitted.'); }
}
function configure(apply = false) {
  const version = execFileSync('docker', ['--context','colima','exec','coolify-proxy','traefik','version'], {encoding:'utf8'});
  if (!/^Version:\s+3\.(?:[7-9]|[1-9][0-9])\./m.test(version)) throw Error('Status-aware retry requires verified Traefik 3.7 or later.');
  const source = controller(String.raw`$labels=base64_decode($a->custom_labels,true);if($labels===false)throw new RuntimeException('Invalid label encoding');$result=['labels'=>$labels];`).labels;
  const result = readinessLabels(source);
  if (apply && result.labels !== source) {
    const encoded = Buffer.from(result.labels).toString('base64');
    controller(String.raw`if(App\Models\ApplicationDeploymentQueue::where('application_id',$a->id)->whereIn('status',['queued','in_progress'])->exists())throw new RuntimeException('Active deployment');if(hash('sha256',base64_decode($a->custom_labels,true))!=='${digest(source)}')throw new RuntimeException('Concurrent labels change');$a->update(['custom_labels'=>'${encoded}']);$result=['saved'=>true];`);
  }
  return { applied: apply, changed: result.labels !== source, routers: result.routers, retry: retryConfig, activeContainersUnchanged: true, next: 'Labels take effect on the next verified rolling replacement.' };
}
if (require.main === module) {
  try { if (!['--check','--apply'].includes(process.argv[2]) || process.argv.length !== 3) throw Error('Use --check or --apply'); console.log(JSON.stringify(configure(process.argv[2] === '--apply'))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { readinessLabels, retryConfig, RETRY };
