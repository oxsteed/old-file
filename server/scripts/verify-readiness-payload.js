#!/usr/bin/env node

function validateReadinessPayload(payload) {
  const failures = [];
  const checks = payload && typeof payload === 'object' ? payload.checks : null;
  const requireHealthy = (name) => {
    // Keep the missing top-level release error actionable instead of duplicating it.
    if (name === 'release' && (typeof payload?.release !== 'string' || payload.release.trim() === '')) return;
    if (checks?.[name]?.ok !== true) failures.push(`${name} readiness check is not healthy`);
  };

  if (payload?.status !== 'ready') failures.push(`status=${payload?.status}`);
  if (typeof payload?.release !== 'string' || payload.release.trim() === '') {
    failures.push('release identifier is missing');
  }

  ['release', 'productionConfiguration', 'database', 'redis', 'creditLedger', 'creditRail', 'realtime', 'workers', 'traffic', 'shutdown']
    .forEach(requireHealthy);

  if (checks?.redis?.configured !== true) failures.push('shared Redis is not configured');
  if (checks?.creditLedger?.configured !== true) failures.push('Credit ledger is not configured');
  if (checks?.creditLedger?.dedicatedSecret !== true) failures.push('dedicated Credit ledger secret is not configured');
  if (typeof checks?.creditLedger?.keyVersion !== 'string' || checks.creditLedger.keyVersion.trim() === '') {
    failures.push('Credit ledger key version is missing');
  }
  if (checks?.migrations?.ok !== true || checks.migrations.pendingCount !== 0) {
    failures.push('pending migrations are not zero');
  }

  return { ok: failures.length === 0, failures };
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const result = validateReadinessPayload(JSON.parse(input));
      if (!result.ok) {
        console.error(`Post-deploy readiness validation failed: ${result.failures.join('; ')}`);
        process.exitCode = 1;
        return;
      }
      console.log('Post-deploy readiness payload validated.');
    } catch (error) {
      console.error(`Post-deploy readiness payload is invalid JSON: ${error.message}`);
      process.exitCode = 1;
    }
  });
}

module.exports = { validateReadinessPayload };
