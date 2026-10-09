const fs = require('fs');
const path = require('path');

const repositoryRoot = path.resolve(__dirname, '../..');
const workflowPath = path.join(repositoryRoot, '.github/workflows/ci.yml');

function repositoryFileIsExecutable(file) {
  if (process.platform !== 'win32') return Boolean(fs.statSync(file).mode & 0o111);
  // NTFS checkout modes do not preserve Git's executable bit. Read the index
  // so the contract is still enforced on Windows without weakening CI.
  const relative = path.relative(repositoryRoot, file).split(path.sep).join('/');
  try {
    const indexEntry = require('child_process').execFileSync('git', ['ls-files', '--stage', '--', relative], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).trim().split(/\s+/)[0];
    return indexEntry === '100755';
  } catch {
    return false;
  }
}

// The Credit admin UI was split from a single monolith page into one page
// per working area under client/src/admin/pages/super/oxsteedCredit/.
// Tests that assert on admin UI source read the concatenated pages so the
// wiring assertions keep covering every section.
function readCreditAdminSources() {
  const dir = path.join(repositoryRoot, 'client/src/admin/pages/super/oxsteedCredit');
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.jsx'))
    .sort()
    .map((file) => fs.readFileSync(path.join(dir, file), 'utf8'))
    .join('\n');
}

describe('deployment release identity wiring', () => {
  test('passes Sentry release and commit SHA through both Docker build stages', () => {
    const dockerfile = fs.readFileSync(path.join(repositoryRoot, 'Dockerfile'), 'utf8');

    expect(dockerfile).toContain('ARG SENTRY_RELEASE');
    expect(dockerfile).toContain('ARG COMMIT_SHA');
    expect(dockerfile).toContain('ARG SOURCE_COMMIT');
    expect(dockerfile).toContain('ARG GIT_SHA');
    expect(dockerfile).toContain('RUN node scripts/build-release-metadata.cjs');
    expect(dockerfile).toContain('COPY --from=release-meta /release-metadata.json /app/server/.release-metadata.json');
    expect(dockerfile).toContain('COPY --from=release-meta /release /app/server/.release');
    expect(dockerfile).toContain('VITE_SENTRY_RELEASE="$release"');
    expect(dockerfile).toContain('ENV COMMIT_SHA=${COMMIT_SHA}');
    expect(dockerfile).toContain('ENV SOURCE_COMMIT=${SOURCE_COMMIT}');
    expect(dockerfile).toContain('org.opencontainers.image.revision="${SOURCE_COMMIT}"');
    expect(dockerfile).toContain('org.opencontainers.image.version="${SENTRY_RELEASE}"');
  });

  test('provides a guarded post-deploy release identity check', () => {
    const verifier = fs.readFileSync(path.join(repositoryRoot, 'server/scripts/verify-readiness-payload.js'), 'utf8');

    expect(verifier).toContain('--expected-release=');
    expect(verifier).toContain('EXPECTED_RELEASE');
    expect(verifier).toContain('release mismatch: expected one of');
  });

  test('passes the release identity into the Coolify app build and runtime', () => {
    const compose = fs.readFileSync(path.join(repositoryRoot, 'docker-compose.coolify.yml'), 'utf8');

    expect(compose).toContain('SENTRY_RELEASE: ${SENTRY_RELEASE}');
    expect(compose).toContain('COMMIT_SHA: ${COMMIT_SHA}');
    expect(compose).toContain('SOURCE_COMMIT: ${SOURCE_COMMIT}');
    expect(compose).toContain('GIT_SHA: ${GIT_SHA:-}');
    expect(compose).toContain('IMAGE_DIGEST: ${IMAGE_DIGEST:-}');
    expect(compose).toContain('COOLIFY_DEPLOYMENT_ID: ${COOLIFY_DEPLOYMENT_ID:-${DEPLOYMENT_ID:-}}');
    expect(compose).toContain('oxsteed-release-metadata:/app/server/runtime/release-metadata:ro');
    expect(compose).toContain('OXSTEED_CREDIT_LEDGER_HMAC_KEY_VERSION: ${OXSTEED_CREDIT_LEDGER_HMAC_KEY_VERSION:-v1}');
    expect(compose).toContain('OXSTEED_CREDIT_LEDGER_HMAC_KEYS_JSON: ${OXSTEED_CREDIT_LEDGER_HMAC_KEYS_JSON}');
    expect(compose).toContain('OXSTEED_CREDIT_SUPPORTED_CURRENCIES: ${OXSTEED_CREDIT_SUPPORTED_CURRENCIES}');
    expect(compose).toContain('OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS: ${OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS:-5000000}');
    expect(compose).toContain('OXSTEED_CREDIT_MAX_AGREEMENT_LIMIT_CENTS: ${OXSTEED_CREDIT_MAX_AGREEMENT_LIMIT_CENTS}');
    expect(compose).toContain('DB_CONNECTION_TIMEOUT_MS: ${DB_CONNECTION_TIMEOUT_MS:-5000}');
    expect(compose).toContain('TRUST_PROXY_HOPS: ${TRUST_PROXY_HOPS:-2}');
  });

  test('keeps the malware scanner private and persistent in the Coolify deployment', () => {
    const compose = fs.readFileSync(path.join(repositoryRoot, 'docker-compose.coolify.yml'), 'utf8');

    expect(compose).toContain('image: clamav/clamav:1.5-debian13-slim');
    expect(compose).toContain('CLAMAV_HOST: ${CLAMAV_HOST:-clamav}');
    expect(compose).toContain('CLAMAV_PORT: ${CLAMAV_PORT:-3310}');
    expect(compose).toContain('FILE_SCAN_REQUIRE_MALWARE: ${FILE_SCAN_REQUIRE_MALWARE:-true}');
    expect(compose).toContain('oxsteed-clamav-database:/var/lib/clamav');
    expect(compose).toContain('oxsteed-clamav-database:');
    expect(compose).toContain('CLAMAV_NO_MILTERD: "true"');
    expect(compose).not.toMatch(/clamav:[\s\S]{0,900}ports:/);
  });

  test('keeps browser and source-map Sentry releases on the same identity', () => {
    const instrument = fs.readFileSync(path.join(repositoryRoot, 'client/src/instrument.jsx'), 'utf8');
    const viteConfig = fs.readFileSync(path.join(repositoryRoot, 'client/vite.config.js'), 'utf8');

    expect(instrument).toContain('import.meta.env.VITE_SENTRY_RELEASE || import.meta.env.VITE_APP_VERSION');
    expect(viteConfig).toContain('process.env.SENTRY_RELEASE || process.env.COMMIT_SHA || process.env.SOURCE_COMMIT');
  });

  test('allows isolated browser verification to target its disposable API port', () => {
    const viteConfig = fs.readFileSync(path.join(repositoryRoot, 'client/vite.config.js'), 'utf8');

    expect(viteConfig).toContain("process.env.VITE_DEV_API_PROXY_TARGET || 'http://localhost:5000'");
    expect(viteConfig).toContain("'/api': {");
  });

  test('leaves production deployment ownership with native Coolify', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('node --test scripts/deploy-coolify.test.cjs');
    expect(workflow).not.toContain('name: Deploy to Coolify');
    expect(workflow).not.toContain('COOLIFY_WEBHOOK_URL: ${{ secrets.COOLIFY_WEBHOOK_URL }}');
    expect(workflow).not.toContain('COOLIFY_TOKEN: ${{ secrets.COOLIFY_TOKEN }}');
  });

  test('runs the Direct catalog database verifier when CI has a database', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('DIRECT_CATALOG_VERIFY_LIVE=true npm run verify:direct-catalog');
    expect(workflow).toContain('set CI_DATABASE_URL secret for active-job, Credit schema, and Direct catalog checks');
  });

  test('runs the disposable Media safety and upload harness in CI', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('media-isolated:');
    expect(workflow).toContain('name: Disposable Media safety and upload harness');
    expect(workflow).toContain('docker-compose.credit-test.yml --file docker-compose.media-test.yml');
    expect(workflow).toContain('psql -v ON_ERROR_STOP=1 -U oxsteed -d oxsteed_db < scripts/credit-isolated-seed.sql');
    expect(workflow).toContain('node /app/server/scripts/verify-media-isolated.js');
    expect(workflow).toContain('down --volumes --remove-orphans');
  });

  test('does not run duplicate post-deploy checks from GitHub Actions', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    expect(workflow).not.toContain('DIRECT_CATALOG_PERFORMANCE_LIVE=true');
    expect(workflow).not.toContain('node server/scripts/verify-direct-catalog-performance.js');
    expect(workflow).not.toContain('PUBLIC_READY_URL: https://oxsteed.com/ready');
  });

  test('keeps the expanded Direct catalog browser surface bounded and request-safe', () => {
    const catalogSource = fs.readFileSync(path.join(repositoryRoot, 'client/src/pages/DirectCatalogLanding.jsx'), 'utf8');
    const adminSource = fs.readFileSync(path.join(repositoryRoot, 'client/src/admin/pages/DirectCatalog.jsx'), 'utf8');

    expect(catalogSource).toContain('const SERVICE_PAGE_SIZE = 24;');
    expect(catalogSource).toContain('getDirectCatalog(i18n.resolvedLanguage');
    expect(catalogSource).toContain('offset: (servicePage - 1) * SERVICE_PAGE_SIZE');
    expect(catalogSource).toContain('setServices((current) => servicePage === 1 ? nextServices : [...current, ...nextServices])');
    expect(catalogSource).toContain('searchServicesAria');
    expect(catalogSource).toContain('searchCategoriesAria');
    expect(catalogSource).toContain('direct/request-quote?service=${encodeURIComponent(service.name)}&serviceSlug=${encodeURIComponent(service.slug)}&serviceId=${encodeURIComponent(service.id)}');
    expect(catalogSource).toContain('toolCategory?.name || tool.categorySlug');
    const portalSource = fs.readFileSync(path.join(repositoryRoot, 'client/src/pages/DirectPortalPage.jsx'), 'utf8');
    expect(portalSource).toContain('const catalogData = await getDirectCatalog(i18n.resolvedLanguage);');
    expect(portalSource).toContain('serviceIds: selectedCatalogServices.map((service) => service.id)');
    expect(portalSource).toContain('serviceSlug: primaryCatalogService?.slug || linkedServiceSlug || undefined');
    expect(portalSource).toContain('directCatalog.selectedService');
    expect(portalSource).toContain('Choose the catalog services you want included. You can add more than one.');
    const quoteController = fs.readFileSync(path.join(repositoryRoot, 'server/controllers/quoteRequestsController.js'), 'utf8');
    expect(quoteController).toContain('INSERT INTO quote_request_services');
    expect(adminSource).toContain('directCatalogAdmin.skillCategoryLabel');
    expect(adminSource).toContain('update(\'categorySlug\', event.target.value)');
  });

  test('keeps Credit admin request guards in the client CI contract', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'client/package.json'), 'utf8'));
    const customerDetail = fs.readFileSync(path.join(repositoryRoot, 'client/src/admin/pages/super/OxsteedCreditCustomerDetail.jsx'), 'utf8');
    const partnerLedger = fs.readFileSync(path.join(repositoryRoot, 'client/src/admin/pages/super/OxsteedCreditPartnerLedger.jsx'), 'utf8');

    expect(packageJson.scripts['test:credit-request-guards']).toBe('node --test scripts/creditRequestGuards.test.mjs');
    expect(packageJson.scripts['build:ci']).toContain('npm run test:credit-request-guards');
    expect(customerDetail).toContain('isCurrentCreditRequest');
    expect(partnerLedger).toContain('isCurrentCreditRequest');
  });

  test('keeps partner ledger loading and funding controls request-safe', () => {
    const partnerLedger = fs.readFileSync(path.join(repositoryRoot, 'client/src/admin/pages/super/OxsteedCreditPartnerLedger.jsx'), 'utf8');

    expect(partnerLedger).toContain('if (isCurrentCreditRequest(loadRequestRef, requestId)) setLoading(false);');
    expect(partnerLedger).toContain('if (!partnerId || loading || saving) return;');
    expect(partnerLedger).toContain('disabled={!ledger || loading || saving || busy}');
    expect(partnerLedger).toContain('invalidateCreditRequest(loadRequestRef);');
  });

  test('binds Credit rail changes to the state observed by the operator', () => {
    const adminSource = readCreditAdminSources();
    const controllerSource = fs.readFileSync(path.join(repositoryRoot, 'server/controllers/oxsteedCreditController.js'), 'utf8');
    const serviceSource = fs.readFileSync(path.join(repositoryRoot, 'server/services/oxsteedCreditService.js'), 'utf8');

    expect(adminSource).toContain('const expectedEnabled = rail.enabled === true;');
    expect(adminSource).toContain('enabled: !expectedEnabled, expectedEnabled');
    expect(controllerSource).toContain("parseBoolean(req.body?.expectedEnabled ?? req.body?.expected_enabled, 'expectedEnabled')");
    expect(serviceSource).toContain("credit_rail_state_conflict");
    expect(serviceSource).toContain('current.is_enabled !== expectedEnabled');
  });

  test('binds settlement transitions to the status observed by the operator', () => {
    const adminSource = readCreditAdminSources();
    const controllerSource = fs.readFileSync(path.join(repositoryRoot, 'server/controllers/oxsteedCreditController.js'), 'utf8');
    const serviceSource = fs.readFileSync(path.join(repositoryRoot, 'server/services/oxsteedCreditAdminService.js'), 'utf8');

    expect(adminSource).toContain('status, expectedStatus: settlement.status');
    expect(controllerSource).toContain('expectedStatus: req.body?.expectedStatus ?? req.body?.expected_status');
    expect(serviceSource).toContain('credit_settlement_state_conflict');
    expect(serviceSource).toContain('settlement.status !== normalizedExpected');
  });

  test('binds partner and agreement transitions to observed lifecycle state', () => {
    const adminSource = readCreditAdminSources();
    const controllerSource = fs.readFileSync(path.join(repositoryRoot, 'server/controllers/oxsteedCreditController.js'), 'utf8');
    const serviceSource = fs.readFileSync(path.join(repositoryRoot, 'server/services/oxsteedCreditAdminService.js'), 'utf8');

    expect(adminSource).toContain('status, expectedStatus: partner.status');
    expect(adminSource).toContain('status, expectedStatus: agreement.status');
    expect(controllerSource).toContain('expectedStatus: req.body?.expectedStatus ?? req.body?.expected_status');
    expect(serviceSource).toContain('credit_partner_state_conflict');
    expect(serviceSource).toContain('credit_agreement_state_conflict');
    expect(serviceSource).toContain('partner.status !== normalizedExpected');
    expect(serviceSource).toContain('agreement.status !== normalizedExpected');
  });

  test('keeps Credit dialogs keyboard-contained and visibly focused', () => {
    const adminSource = readCreditAdminSources();
    const globalStyles = fs.readFileSync(path.join(repositoryRoot, 'client/src/index.css'), 'utf8');

    expect(adminSource).toContain('useCreditDialogFocusTrap');
    expect(adminSource).toContain("event.key === 'Escape'");
    expect(adminSource).toContain("event.key !== 'Tab'");
    expect(adminSource).toContain('restoreFocusRef.current?.focus?.()');
    expect(adminSource).toContain('aria-modal="true"');
    expect(globalStyles).toContain('outline: 3px solid var(--color-primary) !important;');
    expect(globalStyles).toContain('outline-offset: 3px !important;');
  });

  test('uses the selected app locale for Credit timestamps', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'client/package.json'), 'utf8'));
    const creditSources = [
      'client/src/pages/food/OxsteedCreditPage.jsx',
      'client/src/pages/food/OxsteedCreditTransactionPage.jsx',
      'client/src/pages/food/RestaurantCreditPage.jsx',
      'client/src/pages/food/RestaurantCreditManager.jsx',
      'client/src/admin/pages/super/OxsteedCreditEntitlements.jsx',
      'client/src/admin/pages/super/OxsteedCreditCustomerDetail.jsx',
      'client/src/admin/pages/super/OxsteedCreditPartnerLedger.jsx',
      'client/src/admin/pages/super/RestaurantCreditAdmin.jsx',
    ];

    expect(packageJson.scripts['test:credit-date-time']).toBe('node --test scripts/creditDateTime.test.mjs');
    expect(packageJson.scripts['build:ci']).toContain('npm run test:credit-date-time');
    for (const sourcePath of creditSources) {
      const source = fs.readFileSync(path.join(repositoryRoot, sourcePath), 'utf8');
      expect(source).toContain('formatCreditDateTime');
      expect(source).not.toContain('Intl.DateTimeFormat(undefined');
    }
    // The former admin monolith is now one page per working area; the
    // timestamp wiring lives in the shared module the pages import.
    const creditAdminSource = readCreditAdminSources();
    expect(creditAdminSource).toContain('formatCreditDateTime');
    expect(creditAdminSource).not.toContain('Intl.DateTimeFormat(undefined');

    const customerDetail = fs.readFileSync(path.join(repositoryRoot, 'client/src/admin/pages/super/OxsteedCreditCustomerDetail.jsx'), 'utf8');
    const entitlements = fs.readFileSync(path.join(repositoryRoot, 'client/src/admin/pages/super/OxsteedCreditEntitlements.jsx'), 'utf8');
    const customerCredit = fs.readFileSync(path.join(repositoryRoot, 'client/src/pages/food/OxsteedCreditPage.jsx'), 'utf8');
    const partnerManager = fs.readFileSync(path.join(repositoryRoot, 'client/src/pages/food/OxsteedCreditPartnerManager.jsx'), 'utf8');
    const admin = readCreditAdminSources();
    expect(customerDetail).toContain('const language = typeof t === \'function\' ? t.lng : undefined;');
    expect(customerDetail).toContain('formatCreditDateTime(value, fallback, language)');
    expect(entitlements).toContain("formatCreditDateTime(value, value ? t('statusUnknown') : t('notAvailable'), t.lng)");
    expect(customerCredit).toContain('localizeCreditOrderType');
    expect(customerCredit).toContain('localizeCreditTransactionType');
    expect(partnerManager).toContain('localizeCreditTransactionType');
    expect(partnerManager).toContain('localizeCreditStatus');
    expect(customerDetail).toContain('localizeCreditOrderTypes');
    expect(admin).toContain('localizeCreditOrderTypes');
    expect(entitlements).toContain('localizeCreditStatus(status, t)');
  });

  test('keeps the preserved restaurant wallet on exact currency parsing', () => {
    const source = fs.readFileSync(path.join(repositoryRoot, 'client/src/pages/food/RestaurantCreditPage.jsx'), 'utf8');

    expect(source).toContain("import { parseCreditMajorAmount } from '../../lib/creditCurrency';");
    expect(source).toContain('function parseAmountCents(value, currency)');
    expect(source).toContain('return parseCreditMajorAmount(value, currency) || 0;');
    expect(source).not.toContain('Math.round(amount * 100)');
    expect(source).toContain('parseAmountCents(amount, currency)');
  });

  test('rejects invalid optional agreement limits before the admin form submits', () => {
    const source = readCreditAdminSources();

    expect(source).toContain('parseOptionalCreditMajorAmount');
    expect(source).toContain('const maxTransaction = parseOptionalCreditMajorAmount(agreementForm.maxTransaction');
    expect(source).toContain('const dailyLimit = parseOptionalCreditMajorAmount(agreementForm.dailyLimit');
    expect(source).toContain('const lifetimeLimit = parseOptionalCreditMajorAmount(agreementForm.lifetimeLimit');
    expect(source).toContain('if (!maxTransaction.valid || !dailyLimit.valid || !lifetimeLimit.valid)');
    expect(source).toContain("t('adminInvalidLimitAmount', { currency: agreementCurrency })");
    expect(source).toContain('maxTransactionCents: maxTransaction.value');
    expect(source).toContain('dailyCustomerLimitCents: dailyLimit.value');
    expect(source).toContain('lifetimeCustomerLimitCents: lifetimeLimit.value');
  });

  test('keeps preserved restaurant-wallet retries idempotent across refresh failures', () => {
    const source = fs.readFileSync(path.join(repositoryRoot, 'client/src/pages/food/RestaurantCreditPage.jsx'), 'utf8');

    expect(source).toContain("import { createStableIdempotencyKeyStore } from '../../lib/idempotency';");
    expect(source).toContain("get('restaurant-wallet-transfer', keyPayload)");
    expect(source).toContain("get('restaurant-wallet-credit-request', keyPayload)");
    expect(source).toContain("clear('restaurant-wallet-transfer', keyPayload)");
    expect(source).toContain("clear('restaurant-wallet-credit-request', keyPayload)");
    expect(source).toContain("t('restaurantWallet.sentNotice')");
    expect(source).toContain("t('restaurantWallet.requestSent')");
    expect(source).toContain("t('restaurantWallet.refreshFailed')");
    expect(source).not.toContain("requestKey('web-wallet-transfer')");
    expect(source).not.toContain("requestKey('web-wallet-credit-request')");
  });

  test('keeps settlement controls localized and connected to guarded mutations', () => {
    const source = readCreditAdminSources();
    const requiredTranslationKeys = [
      'adminSettlementPartner', 'adminSelectPartner', 'adminSettlementAgreement',
      'adminLoadingAgreements', 'adminSelectAgreement', 'adminPeriodStarts',
      'adminPeriodEnds', 'adminPaymentReferenceOptional', 'adminCreateSnapshot',
      'adminReasonForReconciliation', 'adminReconcileLedger', 'adminSettlementPeriod',
      'adminSettlementStatusProvenance', 'adminNoSettlementSnapshots', 'adminApprove',
      'adminMarkPaid', 'adminVoid', 'adminReconciliationHistory',
      'adminLedgerCheckHistory', 'adminReconciliationStatusFilter',
      'adminReconciliationCurrencyFilter', 'adminNoReconciliationRuns',
      'adminRecordedScopeUnavailable', 'adminCreditDisputeQueue',
      'adminDisputeQueueDescription', 'adminDisputeStatusFilter',
      'adminCustomerRestaurant', 'adminOpenCustomer360', 'adminAmountUnavailable',
      'adminResolutionNotePlaceholder', 'adminReview', 'adminResolve', 'adminReject',
      'adminAuditHistory', 'adminCreditControlTrail', 'adminNoCreditAuditEvents',
      'adminChainEvidence', 'adminViewState', 'adminPayoutRecovery',
      'adminReversePaidSettlement', 'adminNoPaymentReference', 'adminReversePayout',
    ];

    expect(source).toContain('function SettlementControls({');
    expect(source).toContain('function ReconciliationHistory({');
    expect(source).toContain('function CreditDisputeQueue({');
    expect(source).toContain('function CreditAuditHistory({');
    expect(source).toContain('function CreditPayoutRecovery({');
    expect(source).toContain('settlementAgreements={settlementAgreementOptions}');
    expect(source).toContain('reconciliationRuns={reconciliationRuns}');
    expect(source).toContain('expectedStatus: settlement.status');
    for (const key of requiredTranslationKeys) expect(source).toContain(key);
    expect(source).not.toContain('>Create snapshot</button>');
    expect(source).not.toContain('>Mark paid</button>');
  });

  test('renews active payment-worker leases without reviving reclaimed jobs', () => {
    const queueSource = fs.readFileSync(path.join(repositoryRoot, 'server/services/paymentQueue.js'), 'utf8');
    const workerSource = fs.readFileSync(path.join(repositoryRoot, 'server/workerMain.js'), 'utf8');
    const verifierSource = fs.readFileSync(path.join(repositoryRoot, 'server/scripts/verify-payment-queue-recovery.js'), 'utf8');

    expect(queueSource).toContain('const RENEW_JOB_LEASE_SCRIPT');
    expect(queueSource).toContain("redis.call('LPOS'");
    expect(queueSource).toContain('const renewJobLease = async');
    expect(workerSource).toContain('startJobLeaseRenewal');
    expect(workerSource).toContain('renewJobLease(queueKey, job)');
    expect(workerSource).toContain('clearInterval(leaseTimer)');
    expect(verifierSource).toContain('Active worker lease was not renewed');
    expect(verifierSource).toContain('A reclaimed job lease was incorrectly recreated');
  });

  test('keeps development tooling out of the production image and build context', () => {
    const dockerfile = fs.readFileSync(path.join(repositoryRoot, 'Dockerfile'), 'utf8');
    const dockerignore = fs.readFileSync(path.join(repositoryRoot, '.dockerignore'), 'utf8');

    expect(dockerfile).toContain('RUN npm ci --omit=dev');
    expect(dockerignore).toContain('**/node_modules');
  });

  test('does not duplicate the native Coolify deployment from GitHub Actions', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('branches: [old-files-claude]');
    expect(workflow).toContain('uses: actions/checkout@v7');
    expect(workflow).toContain('run: node --test scripts/deploy-coolify.test.cjs');
    expect(workflow).not.toContain('run: node scripts/deploy-coolify.cjs --deploy');
    expect(workflow).not.toContain('COOLIFY_WEBHOOK_URL: ${{ secrets.COOLIFY_WEBHOOK_URL }}');
    expect(workflow).not.toContain('COOLIFY_TOKEN: ${{ secrets.COOLIFY_TOKEN }}');
  });

  test('keeps the isolated restore verifier in the production repository', () => {
    const restoreVerifier = path.join(repositoryRoot, 'scripts/verify-production-restore.sh');
    const runbook = fs.readFileSync(path.join(repositoryRoot, 'docs/oxsteed-credit-production-runbook.md'), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'server/package.json'), 'utf8'));
    const restoreScript = fs.readFileSync(restoreVerifier, 'utf8');

    expect(repositoryFileIsExecutable(restoreVerifier)).toBeTruthy();
    expect(restoreScript).toContain('--exit-on-error');
    expect(restoreScript).toContain('TEMP_DB');
    expect(restoreScript).toContain('oxsteed_credit_settlement_reversals');
    expect(restoreScript).toContain('oxsteed_credit_settlement_reversal_guard');
    expect(restoreScript).toContain('== "12"');
    expect(restoreScript).toContain('expected_migrations');
    expect(restoreScript).toContain('oxsteed_credit_cards');
    expect(restoreScript).toContain('== "5"');
    expect(restoreScript).toContain('credit_integrity_trigger_count');
    expect(restoreScript).toContain("tgenabled = 'D'");
    expect(restoreScript).toContain('Restored currency quote trigger did not reject');
    expect(restoreScript).toContain('ROLLBACK;');
    expect(runbook).toContain('npm --prefix server run verify:restore');
    expect(packageJson.scripts['verify:restore']).toBe('bash ../scripts/verify-production-restore.sh');
  });

  test('keeps automated backups fail-closed and scheduled outside the web process', () => {
    const backupRunner = path.join(repositoryRoot, 'scripts/backup-coolify-production.sh');
    const backupMonitor = path.join(repositoryRoot, 'scripts/check-production-backup.sh');
    const backupPlist = path.join(repositoryRoot, 'scripts/com.oxsteed.production-backup.plist');
    const backupMonitorPlist = path.join(repositoryRoot, 'scripts/com.oxsteed.production-backup-monitor.plist');
    const backupVerifier = path.join(repositoryRoot, 'scripts/verify-local-backup-scheduler.sh');
    const backupInstaller = path.join(repositoryRoot, 'scripts/install-production-backup-launchagents.sh');
    const runbook = fs.readFileSync(path.join(repositoryRoot, 'docs/oxsteed-credit-production-runbook.md'), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'server/package.json'), 'utf8'));
    const backupScript = fs.readFileSync(backupRunner, 'utf8');
    const monitorScript = fs.readFileSync(backupMonitor, 'utf8');
    const plist = fs.readFileSync(backupPlist, 'utf8');
    const monitorPlist = fs.readFileSync(backupMonitorPlist, 'utf8');
    const verifier = fs.readFileSync(backupVerifier, 'utf8');
    const installer = fs.readFileSync(backupInstaller, 'utf8');

    expect(repositoryFileIsExecutable(backupRunner)).toBeTruthy();
    expect(repositoryFileIsExecutable(backupMonitor)).toBeTruthy();
    expect(repositoryFileIsExecutable(backupVerifier)).toBeTruthy();
    expect(repositoryFileIsExecutable(backupInstaller)).toBeTruthy();
    expect(backupScript).toContain('coolify-config-and-storage.tgz');
    expect(backupScript).toContain('PG_RESTORE_BIN" --list');
    expect(backupScript).toContain('SHA256SUMS');
    expect(backupScript).toContain('LOCK_DIR="$BACKUP_ROOT/.backup.lock"');
    expect(backupScript).toContain('A production backup is already running');
    expect(verifier).toContain('overlap lock returned');
    expect(verifier).toContain('corrupted');
    expect(verifier).toContain('RETENTION_DAYS=1');
    expect(installer).toContain('OXSTEED_BACKUP_AGENT_ROOT');
    expect(installer).toContain('privacy controls');
    expect(backupScript).toContain('DOCKER_BIN="${DOCKER_BIN:-docker}"');
    expect(backupScript).toContain('PG_RESTORE_BIN="${PG_RESTORE_BIN:-pg_restore}"');
    expect(runbook).toContain('atomic single-run lock');
    expect(monitorScript).toContain("-name 'MANIFEST'");
    expect(monitorScript).toContain('^20[0-9]{6}T[0-9]{6}Z$');
    expect(monitorScript).toContain('DOCKER_BIN="${DOCKER_BIN:-docker}"');
    expect(monitorScript).toContain('CURL_BIN="${CURL_BIN:-curl}"');
    expect(monitorScript).toContain('backup-monitor.status');
    expect(plist).toContain('com.oxsteed.production-backup');
    expect(monitorPlist).toContain('com.oxsteed.production-backup-monitor');
    expect(plist).toContain('<string>/bin/bash</string>');
    expect(monitorPlist).toContain('<string>/bin/bash</string>');
    expect(plist).toContain('Library/Application Support/OxSteed/production-backup/backup-coolify-production.sh');
    expect(monitorPlist).toContain('Library/Application Support/OxSteed/production-backup/check-production-backup.sh');
    expect(plist).toContain('<key>StartInterval</key>');
    expect(backupScript.indexOf('export DOCKER_CONTEXT=')).toBeLessThan(backupScript.indexOf('health "$container"'));
    expect(backupScript).toContain('export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"');
    expect(monitorScript).toContain('export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"');
    expect(plist).toContain('<key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>');
    expect(monitorPlist).toContain('<key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>');
    expect(runbook).toContain('npm --prefix server run backup:production');
    expect(packageJson.scripts['backup:production']).toBe('bash ../scripts/backup-coolify-production.sh');
    expect(packageJson.scripts['verify:backup-scheduler']).toBe('bash ../scripts/verify-local-backup-scheduler.sh');
    expect(packageJson.scripts['install:backup-scheduler']).toBe('bash ../scripts/install-production-backup-launchagents.sh');
  });

  test('keeps performance fixture setup on one database connection', () => {
    const performanceVerifier = fs.readFileSync(
      path.join(repositoryRoot, 'server/scripts/verify-credit-performance.js'),
      'utf8'
    );

    expect(performanceVerifier).toContain('const client = await pool.connect();');
    expect(performanceVerifier).toContain("const execute = (text, values = []) => client.query(text, values);");
    expect(performanceVerifier).toContain('await execute(\'BEGIN\');');
    expect(performanceVerifier).toContain('await execute(\'COMMIT\');');
    expect(performanceVerifier).toContain('client.release();');
    expect(performanceVerifier).toContain('CREDIT_PERFORMANCE_READ_SAMPLES');
    expect(performanceVerifier).toContain('CREDIT_PERFORMANCE_PURCHASES');
    expect(performanceVerifier).toContain('CREDIT_PERFORMANCE_CONCURRENCY');
    expect(performanceVerifier).toContain('CREDIT_PERFORMANCE_DURATION_MS');
    expect(performanceVerifier).toContain('CREDIT_PERFORMANCE_PARTNERS');
    expect(performanceVerifier).toContain('partnerPayableRows');
    expect(performanceVerifier).toContain('partnerPurchaseCounts');
    expect(performanceVerifier).toContain('collectSamples');
    expect(performanceVerifier).toContain('runConcurrent');
    expect(performanceVerifier).toContain('sharedPartnerPayable: partnerCount === 1');
    expect(performanceVerifier).toContain('errorRatePct');
    expect(performanceVerifier).toContain('process.memoryUsage()');
    expect(performanceVerifier).toContain('process.resourceUsage()');
    expect(performanceVerifier).toContain('measuredProcess: true');
    expect(performanceVerifier).toContain('containerResourceSnapshot');
    expect(performanceVerifier).toContain('measured: containerResourcesBeforeWorkload.measured || containerResourcesAfterWorkload.measured');
    expect(performanceVerifier).toContain('console.error(JSON.stringify({ ok: false, summaries }, null, 2))');
  });

  test('keeps local monitoring capture test-only and fail-closed in production', () => {
    const instrument = fs.readFileSync(path.join(repositoryRoot, 'server/instrument.js'), 'utf8');
    const captureVerifier = fs.readFileSync(
      path.join(repositoryRoot, 'server/scripts/verify-monitoring-capture.js'),
      'utf8'
    );
    const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'server/package.json'), 'utf8'));

    expect(instrument).toContain("process.env.NODE_ENV === 'production' || !captureFile");
    expect(instrument).toContain('appendFileSync(captureFile');
    expect(instrument).toContain('transport: getLocalCaptureTransport()');
    expect(captureVerifier).toContain("MONITORING_CAPTURE_TEST_MODE !== 'true'");
    expect(captureVerifier).toContain("process.env.NODE_ENV === 'production'");
    expect(packageJson.scripts['verify:monitoring-capture']).toBe('node scripts/verify-monitoring-capture.js');
    expect(packageJson.scripts['verify:monitoring-recovery']).toBe('node scripts/verify-credit-monitoring-recovery.js');
  });

  test('keeps watchdog recovery capture isolated to the disposable harness', () => {
    const recoveryVerifier = fs.readFileSync(
      path.join(repositoryRoot, 'server/scripts/verify-credit-monitoring-recovery.js'),
      'utf8'
    );

    expect(recoveryVerifier).toContain("process.env.MONITORING_RECOVERY_TEST_MODE !== 'true'");
    expect(recoveryVerifier).toContain("/^oxsteed-credit-test-[a-z0-9-]+$/");
    expect(recoveryVerifier).toContain('runOxsteedCreditWorkerWatchdog');
    expect(recoveryVerifier).toContain('for (let attempt = 0; attempt < 5; attempt += 1)');
    expect(recoveryVerifier).toContain('recovered.recoveredIncidents.length');
    expect(recoveryVerifier).toContain('Synthetic Credit watchdog stale capture');
  });

  test('Super Admin API verifier uses the real MFA boundary and read surfaces', () => {
    const source = fs.readFileSync(
      path.join(repositoryRoot, 'server/scripts/verify-credit-admin-api.js'),
      'utf8'
    );
    const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'server/package.json'), 'utf8'));

    expect(source).toContain("process.env.CREDIT_TEST_ADMIN_MODE !== 'true'");
    expect(source).toContain("process.env.NODE_ENV === 'production'");
    expect(source).toContain("/api/auth/login/2fa");
    expect(source).toContain("authenticated.user?.role !== 'super_admin'");
    expect(source).toContain('/api/admin/super/oxsteed-credit/overview');
    expect(source).toContain('/api/admin/super/oxsteed-credit/partners/901/ledger');
    expect(source).toContain('responses.rail.rail?.enabled !== false');
    expect(packageJson.scripts['verify:credit-admin-api']).toBe('node scripts/verify-credit-admin-api.js');
  });

  test('keeps isolated startup readiness aligned with the app database path', () => {
    const compose = fs.readFileSync(path.join(repositoryRoot, 'docker-compose.credit-test.yml'), 'utf8');
    const harness = fs.readFileSync(path.join(repositoryRoot, 'scripts/credit-isolated-env.sh'), 'utf8');

    expect(compose).toContain('pg_isready -h 127.0.0.1 -U oxsteed -d oxsteed_db');
    expect(compose).toContain('host: "postgres", port: 5432');
    expect(compose).toContain('&& npm start');
    expect(harness).toContain('server/scripts/credit-isolated-readiness.js');
    expect(harness).toContain('docker compose');
    expect(harness).toContain('run_dependency_failure redis redis');
    expect(harness).toContain('run_dependency_failure postgres database');
    expect(harness).toContain('verify-isolated-app-recovery.js');
    expect(harness).toContain('CREDIT_TEST_OUTAGE_MODE=true');
    expect(harness).toContain('node "$ROOT_DIR/server/scripts/verify-isolated-app-recovery.js" "$url" stopped');
    expect(harness).toContain('node "$ROOT_DIR/server/scripts/verify-isolated-app-recovery.js" "$url" recovered');
    expect(harness).toContain('CREDIT_PERFORMANCE_TEST_MODE=true');
    expect(harness).toContain('CREDIT_PERFORMANCE_DURATION_MS');
    expect(harness).toContain('CREDIT_PERFORMANCE_PARTNERS');
    expect(harness).toContain('performance) performance');
    expect(harness).toContain('DIRECT_CATALOG_VERIFY_LIVE=true');
    expect(harness).toContain('catalog) catalog');
    expect(harness).toContain('catalog-performance) catalog_performance');
    expect(harness).toContain('for ((attempt = 1; attempt <= 60; attempt += 1))');
    expect(harness).toContain('sleep 1');
    expect(harness).toContain('The isolated app port was not published within 60 seconds.');
  });

  test('guards the isolated application outage verifier and checks a real read-only route', () => {
    const verifier = fs.readFileSync(
      path.join(repositoryRoot, 'server/scripts/verify-isolated-app-recovery.js'),
      'utf8'
    );

    expect(verifier).toContain("env.CREDIT_TEST_OUTAGE_MODE !== 'true'");
    expect(verifier).toContain("/^oxsteed-credit-test-[a-z0-9-]+$/");
    expect(verifier).toContain("target.protocol !== 'http:'");
    expect(verifier).toContain("new URL('/health', target)");
    expect(verifier).toContain("new URL('/ready', target)");
    expect(verifier).toContain("new URL('/api/direct/catalog', target)");
    expect(verifier).toContain("catalogUrl.searchParams.set('limit', '24')");
    expect(verifier).toContain('evaluateBoundedCatalogPayload');
    expect(verifier).toContain("['stopped', 'recovered']");
  });

  test('provides a guarded real HTTP Stripe test-mode delivery verifier', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'server/package.json'), 'utf8'));
    const verifier = fs.readFileSync(path.join(repositoryRoot, 'server/scripts/verify-stripe-webhook-delivery.js'), 'utf8');
    const harness = fs.readFileSync(path.join(repositoryRoot, 'scripts/credit-isolated-env.sh'), 'utf8');

    expect(verifier).toContain("process.env.CREDIT_TEST_PROVIDER_MODE !== 'true'");
    expect(verifier).toContain('stripe.webhooks.generateTestHeaderString');
    expect(verifier).toContain('/api/webhooks/stripe');
    expect(verifier).toContain('duplicateSuppressed');
    expect(verifier).toContain('staleDeliverySuppressed');
    expect(verifier).toContain('invalidSignatureRejected');
    expect(verifier).toContain('webhook_event_watermarks');
    expect(packageJson.scripts['verify:stripe-webhook-delivery']).toBe('node scripts/verify-stripe-webhook-delivery.js');
    expect(harness).toContain('provider) provider');
    expect(harness).toContain('failure-injection) failure_injection');
  });

  test('guards real Credit failure injection to the disposable harness', () => {
    const verifier = fs.readFileSync(
      path.join(repositoryRoot, 'server/scripts/verify-credit-failure-injection.js'),
      'utf8'
    );
    const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'server/package.json'), 'utf8'));

    expect(verifier).toContain("process.env.CREDIT_FAILURE_INJECTION_TEST_MODE !== 'true'");
    expect(verifier).toContain("/^oxsteed-credit-test-[a-z0-9-]+$/");
    expect(verifier).toContain('throw new Error(`synthetic ${name} failure`)');
    expect(verifier).toContain('purchaseWithCreditInTransaction');
    expect(verifier).toContain('transferCreditInTransaction');
    expect(verifier).toContain('adjustCustomerCreditInTransaction');
    expect(verifier).toContain('captureCreditHoldInTransaction');
    expect(verifier).toContain('refundCreditInTransaction');
    expect(verifier).toContain('recordPartnerFundingInTransaction');
    expect(verifier).toContain('convertCustomerCreditInTransaction');
    expect(verifier).toContain('cashOutWithCardInTransaction');
    expect(verifier).toContain('assertUnchanged');
    expect(verifier).toContain('Rolled-back purchase transaction still exists.');
    expect(verifier).toContain('Rolled-back transfer transaction still exists.');
    expect(verifier).toContain('Rolled-back adjustment transaction still exists.');
    expect(verifier).toContain('Rolled-back hold capture transaction still exists.');
    expect(verifier).toContain('Rolled-back refund transaction still exists.');
    expect(verifier).toContain('Rolled-back journal transaction still exists.');
    expect(verifier).toContain('Partner funding rollback');
    expect(verifier).toContain('partnerFundingSnapshot');
    expect(verifier).toContain('Conversion record rollback');
    expect(verifier).toContain('conversionSnapshot');
    expect(verifier).toContain('Cash-out record rollback');
    expect(verifier).toContain('cashOutSnapshot');
    expect(verifier).toContain("railRows[0]?.is_enabled !== false");
    expect(packageJson.scripts['verify:credit-failure-injection']).toBe('node scripts/verify-credit-failure-injection.js');
  });

  test('allows dynamic loopback origins only in non-production isolated environments', () => {
    const source = fs.readFileSync(path.join(repositoryRoot, 'server/index.js'), 'utf8');

    expect(source).toContain('const isTestLoopbackOrigin = (origin) =>');
    expect(source).toContain("!isProduction && /^https?:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?$/i.test(origin || '')");
    expect(source).toContain('allowedOrigins.includes(origin) || isTestLoopbackOrigin(origin)');
  });

  test('serves the built admin SPA only when production or the isolated static-test switch is enabled', () => {
    const source = fs.readFileSync(path.join(repositoryRoot, 'server/index.js'), 'utf8');
    const compose = fs.readFileSync(path.join(repositoryRoot, 'docker-compose.credit-test.yml'), 'utf8');

    expect(source).toContain("process.env.NODE_ENV === 'production' || process.env.CREDIT_TEST_SERVE_STATIC === 'true'");
    expect(compose).toContain('CREDIT_TEST_SERVE_STATIC: "true"');
  });
});
