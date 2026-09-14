const fs = require('fs');
const path = require('path');

const repositoryRoot = path.resolve(__dirname, '../..');
const workflowPath = path.join(repositoryRoot, '.github/workflows/ci.yml');

describe('deployment release identity wiring', () => {
  test('passes Sentry release and commit SHA through both Docker build stages', () => {
    const dockerfile = fs.readFileSync(path.join(repositoryRoot, 'Dockerfile'), 'utf8');

    expect(dockerfile).toContain('ARG SENTRY_RELEASE');
    expect(dockerfile).toContain('ARG COMMIT_SHA');
    expect(dockerfile).toContain('ARG SOURCE_COMMIT');
    expect(dockerfile).toContain('RUN release="${SENTRY_RELEASE:-${COMMIT_SHA:-$SOURCE_COMMIT}}";');
    expect(dockerfile).toContain('VITE_SENTRY_RELEASE="$release"');
    expect(dockerfile).toContain('ENV COMMIT_SHA=${COMMIT_SHA}');
    expect(dockerfile).toContain('ENV SOURCE_COMMIT=${SOURCE_COMMIT}');
    expect(dockerfile).toContain('org.opencontainers.image.revision="${SOURCE_COMMIT}"');
    expect(dockerfile).toContain('org.opencontainers.image.version="${SENTRY_RELEASE}"');
  });

  test('passes the release identity into the Coolify app build and runtime', () => {
    const compose = fs.readFileSync(path.join(repositoryRoot, 'docker-compose.coolify.yml'), 'utf8');

    expect(compose).toContain('SENTRY_RELEASE: ${SENTRY_RELEASE}');
    expect(compose).toContain('COMMIT_SHA: ${COMMIT_SHA}');
    expect(compose).toContain('SOURCE_COMMIT: ${SOURCE_COMMIT}');
    expect(compose).toContain('OXSTEED_CREDIT_LEDGER_HMAC_KEY_VERSION: ${OXSTEED_CREDIT_LEDGER_HMAC_KEY_VERSION:-v1}');
    expect(compose).toContain('OXSTEED_CREDIT_LEDGER_HMAC_KEYS_JSON: ${OXSTEED_CREDIT_LEDGER_HMAC_KEYS_JSON}');
    expect(compose).toContain('OXSTEED_CREDIT_SUPPORTED_CURRENCIES: ${OXSTEED_CREDIT_SUPPORTED_CURRENCIES}');
    expect(compose).toContain('OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS: ${OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS:-5000000}');
    expect(compose).toContain('OXSTEED_CREDIT_MAX_AGREEMENT_LIMIT_CENTS: ${OXSTEED_CREDIT_MAX_AGREEMENT_LIMIT_CENTS}');
    expect(compose).toContain('DB_CONNECTION_TIMEOUT_MS: ${DB_CONNECTION_TIMEOUT_MS:-5000}');
  });

  test('keeps browser and source-map Sentry releases on the same identity', () => {
    const instrument = fs.readFileSync(path.join(repositoryRoot, 'client/src/instrument.jsx'), 'utf8');
    const viteConfig = fs.readFileSync(path.join(repositoryRoot, 'client/vite.config.js'), 'utf8');

    expect(instrument).toContain('import.meta.env.VITE_SENTRY_RELEASE || import.meta.env.VITE_APP_VERSION');
    expect(viteConfig).toContain('process.env.SENTRY_RELEASE || process.env.COMMIT_SHA || process.env.SOURCE_COMMIT');
  });

  test('keeps development tooling out of the production image and build context', () => {
    const dockerfile = fs.readFileSync(path.join(repositoryRoot, 'Dockerfile'), 'utf8');
    const dockerignore = fs.readFileSync(path.join(repositoryRoot, '.dockerignore'), 'utf8');

    expect(dockerfile).toContain('RUN npm ci --omit=dev');
    expect(dockerignore).toContain('**/node_modules');
  });

  test('runs the post-deploy validator from the production branch checkout', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('branches: [old-files-claude]');
    expect(workflow).toContain('if: github.ref == \'refs/heads/old-files-claude\' && github.event_name == \'push\'');
    expect(workflow).toContain('uses: actions/checkout@v4');
    expect(workflow).toContain('Validate Coolify deployment secrets');
    expect(workflow).toContain('COOLIFY_WEBHOOK_URL must use HTTPS.');
    expect(workflow).toContain('printf \'%s\' "$ready_payload" | node server/scripts/verify-readiness-payload.js');
  });

  test('keeps the isolated restore verifier in the production repository', () => {
    const restoreVerifier = path.join(repositoryRoot, 'scripts/verify-production-restore.sh');
    const runbook = fs.readFileSync(path.join(repositoryRoot, 'docs/oxsteed-credit-production-runbook.md'), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'server/package.json'), 'utf8'));
    const restoreScript = fs.readFileSync(restoreVerifier, 'utf8');

    expect(fs.statSync(restoreVerifier).mode & 0o111).toBeTruthy();
    expect(restoreScript).toContain('--exit-on-error');
    expect(restoreScript).toContain('TEMP_DB');
    expect(restoreScript).toContain('== "10"');
    expect(restoreScript).toContain('== "4"');
    expect(restoreScript).toContain('credit_integrity_trigger_count');
    expect(runbook).toContain('npm --prefix server run verify:restore');
    expect(packageJson.scripts['verify:restore']).toBe('bash ../scripts/verify-production-restore.sh');
  });
});
