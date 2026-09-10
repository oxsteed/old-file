// OxSteed v2 - Express server entry point
require('dotenv').config();

// Sentry must be initialized before routes/controllers are loaded so that
// its OpenTelemetry hooks can instrument pg, http, and other modules.
// dotenv must come first so SENTRY_DSN is available from .env in development.
require('./instrument');
const Sentry = require('@sentry/node');

// Validate required env vars before anything else loads
require('./utils/validateEnv')();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const http = require('http');

const pool = require('./db');
const { poolMonitor } = require('./db');
const redis = require('./utils/redis');
const { errorHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const { reloadFeeConfig } = require('./services/feeService');

// ── MIDDLEWARE ────────────────────────────────────────────────
const securityHeaders = require('./middleware/securityHeaders');
const correlationId = require('./middleware/correlationId');
const { otelRequestContext } = require('./middleware/otelRequestContext');
const { attachCsrfToken, validateCsrfToken } = require('./middleware/csrf');
const sanitizeInputs = require('./middleware/sanitize');
const { generalLimiter, authenticatedLimiter, authLimiter, strictLimiter } = require('./middleware/rateLimiter');
const { authenticate, requireRole } = require('./middleware/auth');
const { requireAdmin } = require('./middleware/adminAuth');
const prerenderHelperProfile = require('./middleware/prerenderHelperProfile');

// ── ROUTES ───────────────────────────────────────────────────
const sitemapRoutes = require('./routes/sitemap');
const robotsRoutes = require('./routes/robots');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const subscriptionRoutes = require('./routes/subscription');
const webhookRoutes = require('./routes/webhook');
const jobRoutes = require('./routes/jobs');
const bidRoutes = require('./routes/bids');
const paymentRoutes = require('./routes/payments');
const disputeRoutes = require('./routes/disputes');
const reviewRoutes = require('./routes/reviews');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const consentRoutes = require('./routes/consent');
const privacyRoutes = require('./routes/privacy');
const configRoutes = require('./routes/config');
const twoFactorRoutes = require('./routes/twoFactor');
const helperRegistrationRoutes = require('./routes/helperRegistration');
const feeConfigRoutes = require('./routes/feeConfig');
const pricingOverridesRoutes = require('./routes/pricingOverrides');
const oneTruthRoutes        = require('./routes/oneTruth');
const verificationRoutes = require('./routes/verification');
const messageRoutes = require('./routes/messages');
const lifeDashboardRoutes = require('./routes/lifeDashboard');
const diditRoutes = require('./routes/didit');
const businessRoutes                = require('./routes/businesses');
const businessOperationsRoutes      = require('./routes/businessOperations');
const businessProductsRoutes        = require('./routes/businessProducts');
const businessProductPricingRoutes  = require('./routes/businessProductPricing');
const pricingRulesAdminRoutes       = require('./routes/pricingRulesAdmin');
const businessProfileImagesRoutes   = require('./routes/businessProfileImages');
const businessFinanceRoutes         = require('./routes/businessFinance');
const businessRecurringBillingRoutes = require('./routes/businessRecurringBilling');
const businessStaffRoutes           = require('./routes/businessStaff');
const staffSchedulingRoutes         = require('./routes/staffScheduling');
const businessReviewMgmtRoutes      = require('./routes/businessReviewMgmt');
const businessMarketingRoutes       = require('./routes/businessMarketing');
const businessWaitlistRoutes        = require('./routes/businessWaitlist');
const businessPackagesRoutes        = require('./routes/businessPackages');
const businessHealthAlertsRoutes    = require('./routes/businessHealthAlerts');
const businessLeadsRoutes           = require('./routes/businessLeads');
const businessLeadPipelineRoutes    = require('./routes/businessLeadPipeline');
const businessMsgTemplatesRoutes    = require('./routes/businessMsgTemplates');
const businessIntegrationsRoutes    = require('./routes/businessIntegrations');
const restaurantSupportRoutes       = require('./routes/restaurantSupport');
const adminRestaurantSupportRoutes  = require('./routes/adminRestaurantSupport');
const supportRoutes = require('./routes/support');
const supportChatRoutes = require('./routes/supportChat');
const supportRoutingRoutes = require('./routes/supportRouting');
const supportAgentsRoutes = require('./routes/supportAgents');
const chatRoutes    = require('./routes/chat');
const guestChatRoutes = require('./routes/guestChat');
const geoRoutes     = require('./routes/geo');
const helperRoutes      = require('./routes/helpers');
const userSkillsRoutes  = require('./routes/userSkills');
const toolRentalsRoutes = require('./routes/toolRentals');
const referralRoutes       = require('./routes/referrals');
const plannedNeedsRoutes   = require('./routes/plannedNeeds');
const vehicleRoutes         = require('./routes/vehicles');
const houseRoutes           = require('./routes/house');
const helperProfileRoutes  = require('./routes/helperProfile');
const helperProductsRoutes = require('./routes/helperProducts');
const leadRoutes = require('./routes/leads');
const businessReviewsRoutes = require('./routes/businessReviews');
const translateRoutes      = require('./routes/translate');
const learnRoutes          = require('./routes/learn');
const recommendationRoutes = require('./routes/recommendations');
const investorRoutes       = require('./routes/investor');
const settingsRoutes       = require('./routes/settings');
const discoverRoutes       = require('./routes/discover');
const growthRoutes         = require('./routes/growth');
const qrCodesRoutes        = require('./routes/qrCodes');
const consultingRoutes     = require('./routes/consulting');
const quoteRequestsRoutes  = require('./routes/quoteRequests');
const consultingAllPhasesRoutes = require('./routes/consultingAllPhases');
const consultingAdminRoutes = require('./routes/consultingAdmin');
const consultingPaymentRoutes = require('./routes/consultingPayment');
const invoiceRoutes = require('./routes/invoices');
const businessLaunchRoutes = require('./routes/businessLaunch');
const franchiseRoutes = require('./routes/franchise');
const safetyRoutes    = require('./routes/safety');
const consultingFeedbackRoutes = require('./routes/consultingFeedback');
const consultantSchedulingRoutes = require('./routes/consultantScheduling');
const consultingAnalyticsRoutes = require('./routes/consultingAnalytics');
const consultingActionItemsRoutes = require('./routes/consultingActionItems');
const consultantNetworkRoutes = require('./routes/consultantNetwork');
const calendarRoutes = require('./routes/calendar');
const bookingsRoutes = require('./routes/bookings');
const maintenanceRequestsRoutes = require('./routes/maintenanceRequests');
const propertyOperationsRoutes = require('./routes/propertyOperations');
const tradesOperationsRoutes = require('./routes/tradesOperations');
const beautyOperationsRoutes = require('./routes/beautyOperations');
const creativeOperationsRoutes = require('./routes/creativeOperations');
const professionalOperationsRoutes = require('./routes/professionalOperations');
const continuityOperationsRoutes = require('./routes/continuityOperations');
const cancellationStatsRoutes = require('./routes/cancellationStats');
const reputationRoutes = require('./routes/reputation');
const enforcementPolicyRoutes = require('./routes/enforcementPolicy');
const enforcementRoutes = require('./routes/enforcement');
const reportingRoutes = require('./routes/reporting');
const legalDocumentsRoutes = require('./routes/legalDocuments');
const reviewModerationRoutes = require('./routes/reviewModeration');
const helperCancellationPoliciesRoutes = require('./routes/helperCancellationPolicies');
const marketplaceProductsRoutes = require('./routes/marketplaceProducts');
const shoppingCartsRoutes = require('./routes/shoppingCarts');
const sharedCartsRoutes = require('./routes/sharedCarts');
const mobileRoutes = require('./routes/mobile');
const uploadRoutes = require('./routes/upload');
const storageRoutes = require('./routes/storage');
const moderationRoutes = require('./routes/moderation');
const foodRoutes = require('./routes/food');
const mainAppRoutes = require('./routes/mainApp');
const directRoutes = require('./routes/direct');
const { sendDirectServiceAreaPage } = require('./routes/directServiceAreaPage');
// OxSteed Restaurants — canonical ops surface (Phase 2: checklists + SOPs, migration 306)
const restaurantRoutes = require('./routes/restaurants');
// Team / role / Vortex (per OxSteed team-role spec, migration 245)
const businessTeamRoutes   = require('./routes/businessTeam');
const vortexAccessRoutes   = require('./routes/vortex');
const meWorkspaceRoutes    = require('./routes/meWorkspace');
const runnerWorkspaceRoutes = require('./routes/runner');
// OxSteed corporate hierarchy (migration 246)
const corporateRolesRoutes = require('./routes/corporateRoles');
const internalWorkspaceRoutes = require('./routes/internalWorkspaces');
// OxSteed Logistics branch (migration 247)
const logisticsRoutes      = require('./routes/logistics');
const logisticsAdminRoutes = require('./routes/logisticsAdmin');
// Per-mode platform approval gates (migration 272)
const modePlatformApprovalRoutes = require('./routes/modePlatformApprovals');
// roleToggleRoutes removed - use POST /api/auth/switch-role instead (authController.switchRole)
// The old /api/role-toggle endpoint had no session invalidation, no helper_profiles row
// creation, and no fresh JWT issuance, causing inconsistent auth state.

const app = express();
const httpServer = http.createServer(app);
// SECURITY (H-34): trust proxy = 1
// We trust only the first hop (the Render reverse proxy or AWS load balancer).
// This ensures req.ip represents the real client IP (needed for rate limiting) 
// and cannot be spoofed by sending a fake X-Forwarded-For header.
app.set('trust proxy', 1); // Required for Render reverse proxy
const PORT = process.env.PORT || 5000;
const canonicalHostRedirect = require('./middleware/canonicalHost');
app.use(canonicalHostRedirect);

// ── ALLOWED ORIGINS (shared by Express CORS and Socket.IO) ────
const rawAllowedOrigins = (process.env.CORS_ORIGINS || process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',').map(o => o.trim()).filter(Boolean);

// Safety: strip localhost origins in production to avoid accidental exposure.
const isProduction = (process.env.NODE_ENV || 'production') === 'production';
const allowedOrigins = isProduction
  ? rawAllowedOrigins.filter((origin) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin))
  : rawAllowedOrigins;

if (isProduction && rawAllowedOrigins.length !== allowedOrigins.length) {
  logger.warn('CORS: stripped localhost origins in production', { rawAllowedOrigins, allowedOrigins });
}

if (allowedOrigins.length === 0) {
  logger.error('CORS: no allowed origins configured', { rawAllowedOrigins, allowedOrigins });
}

// ── REALTIME BOOTSTRAP ─────────────────────────────────────────
// One Engine.IO transport owns HTTP upgrades. Feature boundaries are Socket.IO
// namespaces, never independent Socket.IO servers attached to httpServer.
const { createRealtimeServer } = require('./bootstrap/realtime');
const realtime = createRealtimeServer({
  httpServer,
  allowedOrigins,
  pool,
  jwtSecret: process.env.JWT_SECRET,
});
// ── INCIDENT ALERTING ─────────────────────────────────────
// Enterprise incident detection and alerting
const incidentAlertService = require('./services/incidentAlertService');
logger.info('Incident alert service initialized');

// ── REQUEST LOGGING ──────────────────────────────────────────
app.use(logger.requestMiddleware());

// ── CORRELATION ID ───────────────────────────────────────────
// Assign a unique ID to each request for tracing and audit logging
app.use(correlationId);
app.use(otelRequestContext);

// ── METRICS TRACKING ──────────────────────────────────────────
// Enterprise-grade metrics for monitoring and alerting
const { metricsMiddleware } = require('./middleware/metricsMiddleware');
app.use('/api/', metricsMiddleware);

// ── SECURITY ─────────────────────────────────────────────────
app.use(securityHeaders);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));

// ── WEBHOOK ROUTES (before rate limiting AND body parsing) ───
// Stripe needs raw body for signature verification.
// Webhooks must skip the rate limiter - Stripe/Didit IPs can burst
// during batch events and a 429 can cause Stripe to disable the endpoint.
app.use('/api/webhooks', webhookRoutes);

// Verification & Didit webhooks also need raw body for HMAC verification.
// Must be mounted before express.json() to prevent body-parser from consuming
// the request stream (same pattern as Stripe above).
const verificationCtrl = require('./controllers/verificationController');
const { handleWebhook: diditWebhook } = require('./controllers/diditController');
app.post('/api/verification/webhooks/checkr', express.raw({ type: 'application/json' }), verificationCtrl.checkrWebhook);
app.post('/api/verification/webhooks/identity', express.raw({ type: 'application/json' }), verificationCtrl.identityWebhook);
app.post('/api/didit/webhook', express.raw({ type: 'application/json' }), diditWebhook);

// ── RATE LIMITING ────────────────────────────────────────────
// Unauthenticated requests: 200 req / 15 min / IP
// Authenticated requests:   500 req / 15 min / user ID
// Each limiter skips the other's traffic so they don't double-count.
app.use('/api/', generalLimiter);
app.use('/api/', authenticatedLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/privacy/delete-account', strictLimiter);
app.use('/api/privacy/export', strictLimiter);

// ── BODY PARSING ─────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── INPUT SANITIZATION ───────────────────────────────────────
app.use(sanitizeInputs);

// ── RESPONSE SANITIZATION ────────────────────────────────────
// Remove sensitive data from error responses, prevent information disclosure
const { responseSanitizer, addAdditionalSecurityHeaders } = require('./middleware/responseSanitizer');
app.use(responseSanitizer);
app.use(addAdditionalSecurityHeaders);

// ── CSRF PROTECTION ──────────────────────────────────────────
// ── FIX #9: CSRF TOKEN PROTECTION ───────────────────────────
// Attach CSRF token to all responses (for authenticated users)
// Validate CSRF token on all state-changing requests (POST/PUT/DELETE)
// This prevents Cross-Site Request Forgery attacks where external sites
// trick authenticated users into making unintended API calls.
//
// Tokens are:
// - Generated once per session and reused
// - Validated via constant-time comparison (timing-attack resistant)
// - Cached in-memory with 24-hour expiry
// - Sent as X-CSRF-Token header (cannot be forged via form submissions)
//
app.use(attachCsrfToken);
app.use(validateCsrfToken);

// ── API VERSIONING ───────────────────────────────────────────
// Detects version from ?v=v2 or API-Version header, defaults to v1
// Enables soft versioning for gradual migration to explicit /api/v1/, /api/v2/ URLs
const { apiVersionMiddleware } = require('./middleware/apiVersioning');
app.use('/api/', apiVersionMiddleware);

// ── HEALTH CHECK ─────────────────────────────────────────────
const { checkReadiness } = require('./services/readinessService');

app.get(['/ready', '/api/ready'], async (req, res) => {
  const result = await checkReadiness({ pool, redis });
  res.status(result.status === 'ready' ? 200 : 503).json(result);
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('Health DB check failed', { message: err.message });
    res.status(503).json({ status: 'degraded', error: 'database unreachable' });
  }
});

// Deep health check for uptime monitors (DB + optional Redis).
// Does not include 3rd party calls (Stripe) to keep it fast/reliable.
app.get('/api/health/deep', async (req, res) => {
  const startedAt = Date.now();
  const result = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    checks: {
      database: { ok: false },
      redis: { ok: true, enabled: false },
    },
    latencyMs: 0,
  };

  try {
    await pool.query('SELECT 1');
    result.checks.database.ok = true;
  } catch (err) {
    result.status = 'degraded';
    result.checks.database.ok = false;
    result.checks.database.error = 'database unreachable';
    logger.error('Deep health DB check failed', { message: err.message });
  }

  try {
    const redis = require('./utils/redis');
    if (redis) {
      result.checks.redis.enabled = true;
      const pong = await redis.ping();
      result.checks.redis.ok = pong === 'PONG';
      if (!result.checks.redis.ok) {
        result.status = 'degraded';
        result.checks.redis.error = 'redis ping failed';
      }
    }
  } catch (err) {
    // Redis is optional; treat ping failures as degraded but keep response.
    result.status = 'degraded';
    result.checks.redis.enabled = true;
    result.checks.redis.ok = false;
    result.checks.redis.error = 'redis exception';
    logger.warn('Deep health Redis check failed', { message: err.message });
  }

  result.latencyMs = Date.now() - startedAt;
  const statusCode = result.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(result);
});

// Apple App Site Association – Universal Links
app.get('/.well-known/apple-app-site-association', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json({
    applinks: {
      apps: [],
      details: [{ appID: 'ZBRGSDRRU7.com.oxsteed.app', paths: ['*'] }]
    },
    webcredentials: { apps: ['ZBRGSDRRU7.com.oxsteed.app'] }
  });
});

// Lightweight liveness endpoint for process monitors. Container traffic gates
// use /ready so an alive-but-unprepared process never receives requests.
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

// Detailed pool metrics are operational telemetry and must not be public.
// Use /health or /ready for unauthenticated process/load-balancer checks.
app.get('/api/health/pool', requireAdmin, (req, res) => {
  res.json(poolMonitor.getMetrics());
});

// ── MOBILE APP ASSOCIATION ───────────────────────────────────
// Universal Links require this JSON to be served without a file extension.
// Set APPLE_TEAM_ID in production to the Team ID from Apple Developer.
app.get(['/.well-known/apple-app-site-association', '/apple-app-site-association'], (req, res) => {
  const appleTeamId = process.env.APPLE_TEAM_ID || 'ZBRGSDRRU7';
  res.type('application/json').send({
    applinks: {
      apps: [],
      details: [
        {
          appID: `${appleTeamId}.com.oxsteed.app`,
          paths: ['*'],
        },
      ],
    },
  });
});


// ── API ROUTES ───────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/runner', runnerWorkspaceRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/bids', bidRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/consent', consentRoutes);
app.use('/api/privacy', privacyRoutes);
app.use('/api/config', configRoutes);
app.use('/api/2fa', twoFactorRoutes);
app.use('/api/helper-registration', helperRegistrationRoutes);
app.use('/api/auth/helper/register', helperRegistrationRoutes); // alias for frontend
app.use('/api/subscription/background-check', verificationRoutes);
app.use('/api/subscription/identity', verificationRoutes);
app.use('/api/fee-config', feeConfigRoutes);
app.use('/api/admin/pricing-overrides', pricingOverridesRoutes);
app.use('/api/admin/one-truth',        oneTruthRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/life', lifeDashboardRoutes);
app.use('/api/didit', diditRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/businesses', businessOperationsRoutes);
app.use('/api/businesses', businessProductsRoutes);
app.use('/api/businesses', pricingRulesAdminRoutes);
app.use('/api/businesses', businessFinanceRoutes);
app.use('/api/businesses', businessRecurringBillingRoutes);
app.use('/api/businesses', businessStaffRoutes);
app.use('/api/businesses', staffSchedulingRoutes);
app.use('/api/businesses', businessReviewMgmtRoutes);
app.use('/api/businesses', businessMarketingRoutes);
app.use('/api/businesses', businessWaitlistRoutes);
app.use('/api/businesses', businessPackagesRoutes);
app.use('/api/businesses', businessHealthAlertsRoutes);
app.use('/api/businesses', businessLeadsRoutes);
// Backward-compatible alias used by older mobile/web clients.
app.use('/api/businesses', businessLeadPipelineRoutes);
app.use('/api/businesses', businessMsgTemplatesRoutes);
app.use('/api/businesses', businessIntegrationsRoutes);
app.use('/api/businesses', businessProductPricingRoutes);
app.use('/api/businesses', businessTeamRoutes);
app.use('/api/vortex',     vortexAccessRoutes);
app.use('/api/me',         meWorkspaceRoutes);
app.use('/api/admin/corporate', corporateRolesRoutes);
app.use('/api/internal/workspaces', internalWorkspaceRoutes);
// OxSteed Logistics branch
app.use('/api/logistics',       logisticsRoutes);
app.use('/api/admin/logistics', authenticate, logisticsAdminRoutes);
// Per-mode platform approval gates — user-facing + admin queues.
app.use('/api/mode-approvals', modePlatformApprovalRoutes.userRouter);
app.use('/api/admin',          modePlatformApprovalRoutes.adminRouter);
app.use('/api/business-profile', businessProfileImagesRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/reviews/business', businessReviewsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/guest-chat', guestChatRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/support-chat', supportChatRoutes);
app.use('/api/support-routing', supportRoutingRoutes);
app.use('/api/support/agents', supportAgentsRoutes);
app.use('/api/geo',          geoRoutes);
app.use('/api/helpers',      helperRoutes);
app.use('/api/user-skills',  userSkillsRoutes);
app.use('/api/tool-rentals', toolRentalsRoutes);
app.use('/api/referrals',    referralRoutes);
app.use('/api/planned-needs', plannedNeedsRoutes);
app.use('/api/vehicles',      vehicleRoutes);
app.use('/api/house',         houseRoutes);
app.use('/api/helper-profile', helperProfileRoutes);
app.use('/api/helper-products', helperProductsRoutes);
app.use('/api/translate',      translateRoutes);
app.use('/api/learn',            learnRoutes);
app.use('/api/recommendations',  recommendationRoutes);
app.use('/api/investor',         investorRoutes);
app.use('/api/settings',     settingsRoutes);
app.use('/api/discover',     discoverRoutes);
app.use('/api/growth',       growthRoutes);
const appVersionRoutes   = require('./routes/appVersion');
app.use('/api/app-version', appVersionRoutes);
const taxRoutes          = require('./routes/tax');
app.use('/api/tax',          taxRoutes);
const helperQuotesRoutes  = require('./routes/helperQuotes');
app.use('/api/helper-quotes', helperQuotesRoutes);
const savedSearchesRoutes = require('./routes/savedSearches');
app.use('/api/saved-searches', savedSearchesRoutes);
app.use('/api/qr-codes',     qrCodesRoutes);
app.use('/api/consulting',   consultingRoutes);
app.use('/api/quote-requests', quoteRequestsRoutes);
app.use('/api/consulting',   consultingAllPhasesRoutes);
app.use('/api/consulting/admin', consultingAdminRoutes);
app.use('/api/consulting',   consultingPaymentRoutes);
app.use('/api/invoices',     invoiceRoutes);
app.use('/api/consulting/feedback', consultingFeedbackRoutes);
app.use('/api/consulting/business-launch', businessLaunchRoutes);
app.use('/api/franchise', franchiseRoutes);
app.use('/api/safety',   safetyRoutes);
app.use('/api/consulting/analytics', consultingAnalyticsRoutes);
app.use('/api/consulting', consultingActionItemsRoutes);
app.use('/api/consulting/contractor', consultantNetworkRoutes);
app.use('/api/scheduling', consultantSchedulingRoutes);
app.use('/api/helper-settings', helperCancellationPoliciesRoutes);
// NOTE: /api/role-toggle intentionally removed - see comment near top of file

// Sentry wizard "Verify" route - development/staging only (omit in production)
if (process.env.NODE_ENV !== 'production') {
  app.get('/debug-sentry', function mainHandler(req, res) {
    throw new Error('My first Sentry error!');
  });
}

// ── INLINE ROUTES ──────────────────────────────────────
const { getPublicProfile } = require('./controllers/authController');
const cartCheckoutRoutes = require('./routes/cartCheckout');
const ordersRoutes = require('./routes/orders');
const adminOrdersRoutes = require('./routes/adminOrders');
const adminProductsRoutes = require('./routes/adminProducts');
const apiProductsRoutes = require('./routes/apiProducts');
const affiliatePayoutsRoutes = require('./routes/affiliatePayouts');
const abTestRoutes = require('./routes/abTestRoutes');
const payoutRoutes = require('./routes/payoutRoutes');
const discountCodesRoutes = require('./routes/discountCodes');
const emailPreferencesRoutes = require('./routes/emailPreferences');
const smsNotificationsRoutes = require('./routes/smsNotifications');
const templateRoutes = require('./routes/templates');
const monitoringRoutes = require('./routes/monitoring');
const countryConfigRoutes = require('./routes/countryConfig');
app.use('/api/calendar', calendarRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/maintenance-requests', maintenanceRequestsRoutes);
app.use('/api/property-operations', propertyOperationsRoutes);
app.use('/api/trades-operations', tradesOperationsRoutes);
app.use('/api/beauty-operations', beautyOperationsRoutes);
app.use('/api/creative-operations', creativeOperationsRoutes);
app.use('/api/professional-operations', professionalOperationsRoutes);
app.use('/api/continuity-operations', continuityOperationsRoutes);
app.use('/api/cancellation-stats', cancellationStatsRoutes);
app.use('/api/reputation', reputationRoutes);
app.use('/api/enforcement-policy', enforcementPolicyRoutes);
app.use('/api/enforcement', enforcementRoutes);
app.use('/api/reports', reportingRoutes);
app.use('/api/legal', legalDocumentsRoutes);
app.use('/api/admin/legal', legalDocumentsRoutes);
app.use('/api', reviewModerationRoutes);
app.use('/api/marketplace/products', marketplaceProductsRoutes);
app.use('/api/carts', shoppingCartsRoutes);
app.use('/api/carts', cartCheckoutRoutes);
app.use('/api/shared-carts', sharedCartsRoutes);
app.use('/api/mobile', mobileRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/moderation', moderationRoutes);
app.use('/api/main-app', mainAppRoutes);
app.use('/api/direct', directRoutes);
app.use('/api/food', foodRoutes);
app.use('/api/restaurants', restaurantSupportRoutes);
app.use('/api/admin/restaurants/support', adminRestaurantSupportRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.get('/api/business/:businessId/workspace/mobile-summary', require('./middleware/auth').authenticate, require('./controllers/mobileController').getBusinessMobileSummary);
app.use('/api/orders', ordersRoutes);
app.use('/api/admin/orders', adminOrdersRoutes);
app.use('/api/admin/products', adminProductsRoutes);
app.use('/api/admin/discount-codes', discountCodesRoutes);
app.use('/api/api-products', apiProductsRoutes);
app.use('/api/affiliate', affiliatePayoutsRoutes);
app.use('/api/ab-tests', abTestRoutes);
app.use('/api/payouts', payoutRoutes);
app.use('/api/notifications/email', emailPreferencesRoutes);
app.use('/api/notifications/sms', smsNotificationsRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/country-config', countryConfigRoutes);
app.get('/api/users/:id/profile', getPublicProfile);

// Enterprise monitoring - admin only
app.use('/api/monitoring', monitoringRoutes);

app.use('/direct/service-area-assets', express.static(path.join(__dirname, 'public/direct-service-area')));
app.get('/direct/service-area', sendDirectServiceAreaPage);

// Sitemap + robots - works in all environments, no auth required
app.use('/robots.txt', robotsRoutes);
app.use('/sitemap.xml', sitemapRoutes);

// ── PRODUCTION STATIC SERVING ────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  // Prerender SEO shell for /, /helpers, /helpers/:id before express.static
  // (express.static would serve bare index.html for / without structured data)
  app.use(prerenderHelperProfile);

  app.use(express.static(path.join(__dirname, '../client/dist')));

  // Admin SPA - serve admin.html for all /admin/* routes
  app.get('/admin/*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/admin.html'));
  });

  // Main SPA - catch-all for everything else
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// ── ERROR HANDLER ────────────────────────────────────────────
// Sentry error handler must come after all routes and before the generic handler.
Sentry.setupExpressErrorHandler(app);

// Standardized Error Handler (L-02) to prevent leaking stack traces or internal details.
app.use(errorHandler);

// ── APPLICATION LIFECYCLE ─────────────────────────────────────
const { ApplicationRuntime } = require('./bootstrap/applicationRuntime');
const runtime = new ApplicationRuntime({ httpServer, realtime, pool, redis });

async function listen() {
  await new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    httpServer.once('error', onError);
    httpServer.listen(PORT, () => {
      httpServer.off('error', onError);
      resolve();
    });
  });
}

async function startServer() {
  await runtime.prepare();
  try {
    await reloadFeeConfig();
  } catch (err) {
    logger.warn('FeeService initial load failed; using safe defaults', { message: err.message });
  }
  await listen();
  runtime.markListening();
  logger.info(`OxSteed v2 server running on port ${PORT}`, {
    env: process.env.NODE_ENV || 'development',
    realtimeNamespaces: ['/chat', '/support', '/restaurant-display'],
  });
  return httpServer;
}

let terminating = false;
async function terminate(signal, exitCode = 0, cause) {
  if (terminating) return;
  terminating = true;
  if (cause) logger.error('Fatal server error', { signal, error: cause.message, stack: cause.stack });

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out', { signal });
    process.exit(1);
  }, 15000);
  forceExit.unref();

  try {
    await runtime.shutdown(signal);
    clearTimeout(forceExit);
    process.exit(exitCode);
  } catch (err) {
    logger.error('Graceful shutdown failed', { signal, error: err.message });
    process.exit(1);
  }
}

if (require.main === module) {
  startServer().catch((err) => terminate('startup_failure', 1, err));
  process.once('SIGTERM', () => terminate('SIGTERM'));
  process.once('SIGINT', () => terminate('SIGINT'));
  process.once('uncaughtException', (err) => terminate('uncaughtException', 1, err));
  process.once('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    terminate('unhandledRejection', 1, err);
  });
}

module.exports = { app, httpServer, realtime, runtime, startServer };
