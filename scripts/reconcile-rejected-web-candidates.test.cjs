'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileRejectedWebCandidates, collectReceipts, routeRules } = require('./reconcile-rejected-web-candidates.cjs');

function fixture({ onlyCandidate = false, candidateHealth = 'starting', decision = 'cancelled-by-user', background = false, changedDecision = false, changedImage = false, removalRace = false, stopFailure = false } = {}) {
  const applicationUuid = 'web123';
  const oldId = 'a'.repeat(64), candidateId = 'b'.repeat(64), backgroundId = 'c'.repeat(64);
  const make = (id, suffix, deployment) => ({ containerId: id, name: `/web123-${suffix}`, service: `web123-${suffix}`, running: true,
    project: applicationUuid, runtimeRole: 'web', imageId: 'sha256:' + 'd'.repeat(64), configFiles: `/artifacts/${deployment}/docker-compose.yaml` });
  const containers = new Map([[candidateId, make(candidateId, '20261028T120100', 'candidate-deployment')]]);
  if (!onlyCandidate) containers.set(oldId, make(oldId, '20261028T120000', 'old-deployment'));
  const calls = [];
  let receiptCalls = 0, candidateInspections = 0;
  const receipts = () => {
    receiptCalls++;
    return [{ deploymentId: 'old-deployment', status: 'finished' },
      { deploymentId: 'candidate-deployment', status: changedDecision && receiptCalls > 1 ? 'finished' : decision }];
  };
  const docker = args => {
    calls.push(args);
    if (args[0] === 'ps') {
      const idFilter = args.find(arg => arg.startsWith('id='));
      if (idFilter) return containers.has(idFilter.slice(3)) ? idFilter.slice(3) : '';
      if (args.includes('label=com.docker.compose.project=background123')) return backgroundId.slice(0, 12);
      return [...containers.keys()].map(id => args.includes('--no-trunc') ? id : id.slice(0, 12)).join('\n');
    }
    if (args[0] === 'inspect') {
      const id = args[1];
      if (args.at(-1).includes('.State.Health.Status')) return JSON.stringify({ running: true, health: id === candidateId ? candidateHealth : 'healthy' });
      if (backgroundId.startsWith(id)) return JSON.stringify({ containerId: backgroundId, name: '/app-background123-current', service: 'app', running: true, project: 'background123' });
      const container = [...containers.values()].find(value => value.containerId.startsWith(id));
      if (!container) throw new Error('Unknown synthetic container');
      if (container.containerId === candidateId && ++candidateInspections > 1 && changedImage) return JSON.stringify({ ...container, imageId: 'sha256:' + 'e'.repeat(64) });
      return JSON.stringify(container);
    }
    if (args[0] === 'stop') {
      if (removalRace) { containers.delete(args.at(-1)); throw new Error('Synthetic concurrent controller removal'); }
      if (stopFailure) throw new Error('Synthetic transport failure');
      return '';
    }
    if (args[0] === 'rm') { containers.delete(args[1]); return ''; }
    throw new Error('Unexpected synthetic Docker operation');
  };
  return { calls, candidateId, containers, options: { applicationUuid, backgroundApplicationUuid: background ? 'background123' : undefined, receipts, docker,
    routes: () => ['Host(`synthetic.invalid`) && PathPrefix(`/`)'] } };
}

test('cancelled startup is removed by immutable ID while the finished healthy release stays running', () => {
  const f = fixture();
  const report = reconcileRejectedWebCandidates(f.options);
  assert.deepEqual(report.removed, [{ containerId: f.candidateId, deploymentId: 'candidate-deployment', status: 'cancelled-by-user' }]);
  assert.deepEqual(f.calls.filter(args => ['stop', 'rm'].includes(args[0])), [['stop', '--time', '15', f.candidateId], ['rm', f.candidateId]]);
  assert.equal(f.containers.size, 1);
});

test('failed health candidates are removed, while a healthy release with a later bookkeeping failure is preserved', () => {
  assert.equal(reconcileRejectedWebCandidates(fixture({ decision: 'failed' }).options).removed.length, 1);
  const f = fixture({ decision: 'failed', candidateHealth: 'healthy' });
  assert.deepEqual(reconcileRejectedWebCandidates(f.options).preserved, [f.candidateId]);
  assert.ok(f.calls.every(args => !['stop', 'rm'].includes(args[0])));
});

test('a sole candidate is never removed without a verified healthy fallback', () => {
  const f = fixture({ onlyCandidate: true });
  assert.deepEqual(reconcileRejectedWebCandidates(f.options).preserved, [f.candidateId]);
  assert.ok(f.calls.every(args => !['stop', 'rm'].includes(args[0])));
  const withBackground = fixture({ onlyCandidate: true, background: true });
  assert.equal(reconcileRejectedWebCandidates(withBackground.options).removed.length, 1);
  assert.ok(withBackground.calls.filter(args => args[0] === 'stop').every(args => args.at(-1) === withBackground.candidateId));
});

test('healthy private or unrelated routes cannot stand in for the route being removed', () => {
  const f = fixture({ background: true });
  const report = reconcileRejectedWebCandidates({ ...f.options, routes: id => id === f.candidateId
    ? ['Host(`public.invalid`) && PathPrefix(`/`)'] : ['Host(`private.invalid`) && PathPrefix(`/`)'] });
  assert.deepEqual(report.preserved, [f.candidateId]);
  assert.ok(f.calls.every(args => !['stop', 'rm'].includes(args[0])));
});

test('routing evidence collects only named public rule labels on an enabled proxy target', () => {
  const calls = [];
  const rules = routeRules('a'.repeat(64), args => {
    calls.push(args);
    if (args.at(-1).includes('range $key')) return 'traefik.http.routers.test.rule\ntraefik.http.middlewares.private.basicauth.users\n';
    if (args.at(-1).includes('traefik.enable')) return '"true"';
    return '"Host(`synthetic.invalid`) && PathPrefix(`/`)"';
  });
  assert.deepEqual(rules, ['Host(`synthetic.invalid`) && PathPrefix(`/`)']);
  assert.ok(calls.every(args => !args.at(-1).includes('basicauth')));
});

test('active, successful and unknown deployment decisions cannot trigger removal', () => {
  for (const decision of ['queued', 'in_progress', 'finished', 'unknown']) {
    const f = fixture({ decision });
    const report = reconcileRejectedWebCandidates(f.options);
    assert.equal(report.removed.length, 0);
    assert.ok(f.calls.every(args => !['stop', 'rm'].includes(args[0])));
  }
});

test('changed image identity or controller decision refuses cleanup before mutation', () => {
  for (const options of [{ changedDecision: true }, { changedImage: true }]) {
    const f = fixture(options);
    assert.throws(() => reconcileRejectedWebCandidates(f.options), /changed/);
    assert.ok(f.calls.every(args => !['stop', 'rm'].includes(args[0])));
  }
});

test('concurrent controller removal is accepted only after verified absence', () => {
  const concurrent = fixture({ removalRace: true });
  assert.equal(reconcileRejectedWebCandidates(concurrent.options).removed.length, 1);
  const failed = fixture({ stopFailure: true });
  assert.throws(() => reconcileRejectedWebCandidates(failed.options), /incomplete/);
  assert.equal(failed.containers.size, 2);
  assert.ok(failed.calls.every(args => args[0] !== 'rm'));
});

test('the metadata collector reads only public deployment receipts inside the existing DB container', () => {
  const calls = [];
  const rows = [{ deploymentId: 'candidate-deployment', status: 'cancelled-by-user' }];
  assert.deepEqual(collectReceipts('web123', (args, input) => { calls.push({ args, input }); return JSON.stringify(rows); }), rows);
  assert.deepEqual(calls[0].args.slice(0, 4), ['exec', '-i', 'coolify-db', 'sh']);
  assert.match(calls[0].input, /q\.deployment_uuid/);
  assert.ok(!/environment|secret|password/i.test(calls[0].input));
  assert.throws(() => collectReceipts("web'123", () => '[]'));
  assert.throws(() => collectReceipts('web123', () => JSON.stringify([{ deploymentId: 'candidate-deployment', status: 'unexpected' }])));
});
