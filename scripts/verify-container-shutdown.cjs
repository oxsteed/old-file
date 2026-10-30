'use strict';

// Exercise the image's real ENTRYPOINT and CMD. Only the three application
// boundaries are replaced with fixtures. No network, secrets, database or
// production volumes are available to these disposable containers.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function verify(image, context) {
  const directory = fs.mkdtempSync(path.join(os.homedir(), '.oxsteed-signal-test-'));
  const base = context ? ['--context', context] : [];
  const docker = args => execFileSync('docker', [...base, ...args], {
    encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const fixtures = {
    'prepare-runtime-schema.cjs': "console.log('schema-checked');if(process.env.FAIL_STAGE==='schema')process.exit(17);",
    'sync-web-assets.cjs': "console.log('assets-synced');if(process.env.FAIL_STAGE==='assets')process.exit(18);",
    'index.js': `console.log('app-ready');setInterval(()=>{},1000);process.once('SIGTERM',()=>{console.log('drain-started');setTimeout(()=>{console.log('drain-completed');process.exit(0)},2000)});`,
  };
  for (const [name, contents] of Object.entries(fixtures)) fs.writeFileSync(path.join(directory, name), contents);
  const results = [];
  try {
    for (const stage of ['none', 'schema', 'assets']) {
      const name = `oxsteed-signal-test-${process.pid}-${stage}`;
      try {
        const mounts = Object.keys(fixtures).flatMap(file => ['--mount',
          `type=bind,src=${path.join(directory, file)},dst=/app/server/${file === 'index.js' ? file : 'scripts/' + file},readonly`]);
        docker(['run', '-d', '--name', name, '--network', 'none', '--read-only',
          '--env', `FAIL_STAGE=${stage}`, ...mounts, image]);
        let logs = '';
        for (let attempt = 0; attempt < 100; attempt++) {
          logs = docker(['logs', name]);
          const state = docker(['inspect', name, '--format', '{{.State.Running}}']);
          if (stage === 'none' ? logs.includes('app-ready') : state === 'false') break;
          await delay(100);
        }
        if (stage === 'none') {
          assert.match(logs, /schema-checked\nassets-synced\napp-ready/);
          const start = Date.now();
          docker(['stop', '--time', '10', name]);
          const elapsedMs = Date.now() - start;
          logs = docker(['logs', name]);
          assert.match(logs, /drain-started\ndrain-completed/, 'SIGTERM must reach Node and permit its drain to finish');
          assert.ok(elapsedMs >= 1900 && elapsedMs < 10000, `drain elapsed ${elapsedMs} ms`);
          assert.equal(docker(['inspect', name, '--format', '{{.State.ExitCode}}']), '0');
          results.push({ stage, elapsedMs, drained: true });
        } else {
          assert.equal(docker(['inspect', name, '--format', '{{.State.ExitCode}}']), stage === 'schema' ? '17' : '18');
          assert.ok(!logs.includes('app-ready'), 'failed preparation must never start the app');
          if (stage === 'schema') assert.ok(!logs.includes('assets-synced'));
          results.push({ stage, startupRefused: true });
        }
      } finally { try { docker(['rm', '-f', name]); } catch {} }
    }
    return { image, results };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] !== '--image' || !args[1] || ![2, 4].includes(args.length) || (args.length === 4 && args[2] !== '--context')) {
    console.error('Use --image <built-image> [--context <docker-context>]'); process.exitCode = 1;
  } else verify(args[1], args[3]).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error instanceof assert.AssertionError ? error.message : 'Container shutdown verification failed; no release receipt should be published.'); process.exitCode = 1; });
}
module.exports = { verify };
