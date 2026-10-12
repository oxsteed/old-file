'use strict';

const { spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const TARGET = 'oxsteed-ci-redis:7';
// Both sources distribute Docker's official Redis 7 image. Keep the isolated
// harness independent of any one registry's shared anonymous pull quota.
const SOURCES = ['public.ecr.aws/docker/library/redis:7', 'docker.io/library/redis:7'];

async function pullRedis({ run = args => spawnSync('docker', args, { stdio: 'inherit', timeout: 120000 }), wait = delay, log = console.log } = {}) {
  for (let round = 0; round < 3; round += 1) {
    for (const source of SOURCES) {
      log(`CI Redis pull attempt ${round + 1}/3: ${source}`);
      const pull = run(['pull', source]);
      if (pull.status !== 0 || pull.error) continue;
      const tag = run(['tag', source, TARGET]);
      if (tag.status !== 0 || tag.error) throw new Error('Could not tag the downloaded CI Redis image');
      return TARGET;
    }
    if (round < 2) await wait(5000 * (round + 1));
  }
  throw new Error('CI Redis image unavailable from both public registries after three attempts each');
}

module.exports = { pullRedis, TARGET, SOURCES };
if (require.main === module) pullRedis().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
