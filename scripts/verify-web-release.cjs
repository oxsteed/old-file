'use strict';
const { execFileSync } = require('node:child_process');
const REPOSITORY = 'oxsteed/old-file';
const BRANCH = 'old-files-claude';
const REQUIRED = ['Server and Client Verification', 'Disposable Media safety and upload harness', 'PostgreSQL migration rehearsal', 'ClickHouse growth schema rehearsal'];
function ghJson(args) {
  try { return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch { throw new Error('GitHub verification failed; credentials and response bodies were omitted.'); }
}
function successfulChecks(data) {
  if (!Array.isArray(data.check_runs) || data.total_count > 100) return false;
  const latest = [...data.check_runs].sort((a,b) => b.id - a.id);
  return REQUIRED.every(name => {
    const check = latest.find(c => c.name === name);
    return check?.status === 'completed' && check.conclusion === 'success';
  });
}
function verifyCommit(sha, api = ghJson) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('A full Git commit is required.');
  const checks = ref => api(['api', `repos/${REPOSITORY}/commits/${ref}/check-runs?per_page=100`]);
  if (successfulChecks(checks(sha))) return { gitSha: sha, checkedCommit: sha };
  const prs = api(['api', `repos/${REPOSITORY}/commits/${sha}/pulls?per_page=100`]);
  const pr = prs.find(p => p.merged_at && p.merge_commit_sha === sha && p.base?.ref === BRANCH && p.head?.repo?.full_name === REPOSITORY);
  if (pr && /^[a-f0-9]{40}$/.test(pr.head.sha) && successfulChecks(checks(pr.head.sha))) {
    return { gitSha: sha, checkedCommit: pr.head.sha, pullRequest: pr.number };
  }
  throw new Error('All four required CI checks must pass on this commit or its merged pull request.');
}
if (require.main === module) {
  try { console.log(JSON.stringify(verifyCommit(process.argv[2]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { REPOSITORY, BRANCH, REQUIRED, ghJson, successfulChecks, verifyCommit };
