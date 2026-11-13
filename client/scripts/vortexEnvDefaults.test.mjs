// Mobile/PWA M21: both Vortex example env files still ship
// VITE_VORTEX_ENABLED=false while the code default is now on
// (launchScope.js, Nov 5 all-launch flip). A build copied from either
// example still disables Vortex UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

test('M21: example env files enable Vortex, matching the code default', () => {
  for (const file of ['../.env.example', '../.env.production.example']) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(src, /^VITE_VORTEX_ENABLED=true$/m, `${file} must set VITE_VORTEX_ENABLED=true`);
    assert.doesNotMatch(src, /^VITE_VORTEX_ENABLED=false$/m, `${file} must not disable Vortex`);
  }
  const launch = fs.readFileSync(path.join(root, '../src/utils/launchScope.js'), 'utf8');
  assert.match(
    launch,
    /VORTEX_CLIENT_ENABLED = !\['0', 'false', 'no', 'n', 'off'\]/,
    'client default must stay on unless explicitly disabled',
  );
});

test('M21: no deploy-time setting contradicts the example files', () => {
  for (const file of ['../../Dockerfile', '../../docker-compose.coolify.yml', '../../docker-compose.yml']) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');
    assert.doesNotMatch(src, /VITE_VORTEX_ENABLED\s*=\s*false/, `${file} must not disable Vortex at deploy time`);
  }
  const gate = fs.readFileSync(path.join(root, '../../server/middleware/launchGate.js'), 'utf8');
  assert.match(gate, /VORTEX_ENABLED', true/, 'server launch gate must also default Vortex on');
});
