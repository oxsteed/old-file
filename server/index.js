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
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const pool = require('./db');
const { poolMonitor } = require('./db');
const { errorHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const socketService = require('./services/socketService');
const { reloadFeeConfig } = require('./services/feeService');

// ── MIDDLEWARE ────────────────────────────────────────────────
const securityHeaders = require('./middleware/securityHeaders');
const correlationId = require('./middleware/correlationId');
const { otelRequestContext } = require('./middleware/otelRequestContext');
const { attachCsrfToken, validateCsrfToken } = require('./middleware/csrf');
const sanitizeInputs = require('./middleware/sanitize');
const { generalLimiter, authenticatedLimiter, authLimiter, strictLimiter } = require('./middleware/rateLimiter');
const { authenticate, requireRole } = require('./middleware/auth');
const prerenderHelperProfile = require('./middleware/prerenderHelperProfile');

// ── ROUTES ───────────────────────────────────────────────────
const sitemapRoutes = require('./routes/sitemap');
const robotsRoutes = require('./routes/robots');
const authRoutes = require('./routes/auth');
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
const businessStaffRoutes           = require('./routes/businessStaff');
const businessReviewMgmtRoutes      = require('./routes/businessReviewMgmt');
const businessMarketingRoutes       = require('./routes/businessMarketing');
const businessWaitlistRoutes        = require('./routes/businessWaitlist');
const businessPackagesRoutes        = require('./routes/businessPackages');
const businessHealthAlertsRoutes    = require('./routes/businessHealthAlerts');
const businessLeadsRoutes           = require('./routes/businessLeads');
const businessMsgTemplatesRoutes    = require('./routes/businessMsgTemplates');
const businessIntegrationsRoutes    = require('./routes/businessIntegrations');
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
const settingsRoutes       = require('./routes/settings');
const discoverRoutes       = require('./routes/discover');
const qrCodesRoutes        = require('./routes/qrCodes');
const consultingRoutes     = require('./routes/consulting');
const consultingAllPhasesRoutes = require('./routes/consultingAllPhases');
const consultingAdminRoutes = require('./routes/consultingAdmin');
const consultingPaymentRoutes = require('./routes/consultingPayment');
const invoiceRoutes = require('./routes/invoices');
const businessLaunchRoutes = require('./routes/businessLaunch');
const franchiseRoutes = require('./routes/franchise');
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
// Team / role / Vortex (per OxSteed team-role spec, migration 245)
const businessTeamRoutes   = require('./routes/businessTeam');
const vortexAccessRoutes   = require('./routes/vortex');
const meWorkspaceRoutes    = require('./routes/meWorkspace');
// OxSteed corporate hierarchy (migration 246)
const corporateRolesRoutes = require('./routes/corporateRoles');
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

// ── ALLOWED ORIGINS (shared by Express CORS and Socket.IO) ────
const allowedOrigins = (process.env.CORS_ORIGINS || process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',').map(o => o.trim());

// ── SOCKET.IO ─────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
  // Keep connections alive and detect dead sockets quickly.
  // Dead connection = detected in pingInterval + pingTimeout = 35s (was 45s).
  pingInterval:          20000,  // server pings clients every 20s (default 25s)
  pingTimeout:           15000,  // disconnect if no pong within 15s (default 20s)
  // Only allow WebSocket transport - avoids HTTP long-polling overhead and
  // the extra round-trips polling adds to message latency.
  transports:            ['websocket'],
  // Compress frames - reduces bandwidth, especially for large message histories.
  perMessageDeflate: {
    threshold: 512,      // only compress payloads > 512 bytes
  },
});

// Socket.IO authentication middleware - verify JWT before allowing connection
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.query.token;
  if (!token) {
    return next(new Error('Authentication required'));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Check if user is still active before allowing WebSocket
      pool.query('SELECT is_active, role FROM users WHERE id = $1 AND deleted_at IS NULL', [decoded.id]).then(({ rows }) => {
        if (!rows[0] || !rows[0].is_active) {
          return next(new Error('Account suspended'));
        }
        socket.userId   = decoded.id;
        socket.userRole = rows[0].role;
        next();
      }).catch(() => next(new Error('Auth check failed')));
  } catch (err) {
    return next(new Error('Invalid token'));
  }
});

// ── WEBSOCKET SERVICE (Support Routing) ────────────────────────
const WebSocketService = require('./services/websocketService');
WebSocketService.initialize(httpServer);

io.on('connection', (socket) => {
  const userId = socket.userId;
  socket.join(`user_${userId}`);
  // Admins join a shared room so support tickets can be broadcast to all staff
  if (['admin', 'super_admin'].includes(socket.userRole)) {
    socket.join('admins');
  }

  // SECURITY (H-28): Explicitly drop 'join' events from clients.
  // This is a critical security design choice:
  //
  // THREAT PREVENTED: A malicious client could try to forge Socket.IO 'join'
  // events to subscribe to arbitrary rooms (e.g., 'admins', 'conv_12345'),
  // allowing them to intercept broadcasts intended for other users.
  //
  // MITIGATION: Room membership is determined ONLY by server-side logic:
  // - Authenticated users auto-join 'user_{userId}' room
  // - Admins auto-join 'admins' room
  // - Users can join 'conv_{conversationId}' ONLY via verified
  //   'conversation:join' handler (which checks DB membership)
  //
  // NEVER allow arbitrary room names from client. Instead, use:
  // 1. Automatic admin/user rooms based on authentication
  // 2. Verified payload handlers that check membership before join
  // 3. Use socket.to() for server→client broadcasts (sender doesn't need to
  //    be in room)
  socket.on('join', () => {});

  // ── CONVERSATION ROOMS ────────────────────────────────────────
  // Clients join a per-conversation room to receive typing indicators and
  // real-time message delivery scoped to that thread.
  //
  // SECURITY MODEL:
  // - Clients emit 'conversation:join' with conversationId
  // - Server verifies user has permission to access the conversation:
  //   * Is customer or helper in the conversation
  //   * OR is an active member of the business associated with the conversation
  // - Only on successful verification does server call socket.join('conv_...')
  // - Typing indicators can only be sent to verified rooms (checked below)
  //
  // This prevents IDOR (Insecure Direct Object Reference) where a client
  // could spy on conversations they don't own by guessing conversation IDs.
  socket.on('conversation:join', async (conversationId) => {
    if (!conversationId) return;
    try {
      // ATTACK #7 FIX: Equalize timing to prevent information leakage
      // Use a constant-time operation to prevent attackers from distinguishing
      // between "conversation doesn't exist" vs "access denied"
      const start = Date.now();
      const MIN_QUERY_TIME = 50; // Minimum query time in ms

      const { rows } = await pool.query(
        `SELECT id FROM conversations c
         WHERE c.id = $1 AND (
           c.customer_id = $2
           OR c.helper_id = $2
           OR (c.business_id IS NOT NULL AND EXISTS(
             SELECT 1 FROM business_members bm
             WHERE bm.business_id = c.business_id AND bm.member_id = $2 AND bm.status = 'active'
           ))
         )`,
        [conversationId, userId]
      );

      // Pad response time to prevent timing attacks
      const elapsed = Date.now() - start;
      if (elapsed < MIN_QUERY_TIME) {
        await new Promise(resolve => setTimeout(resolve, MIN_QUERY_TIME - elapsed));
      }

      if (rows.length) {
        socket.join(`conv_${conversationId}`);
        logger.debug('Socket joined conversation room', { userId, conversationId });
      }
    } catch (err) {
      logger.error('socket conversation:join error', { message: err.message });
    }
  });

  socket.on('conversation:leave', (conversationId) => {
    if (conversationId) socket.leave(`conv_${conversationId}`);
  });

  // ── TYPING INDICATORS ─────────────────────────────────────────
  // SECURITY DESIGN RATIONALE:
  //
  // THREAT: A malicious authenticated user could forge typing events to
  // arbitrary conversations they're not members of (e.g., admin conversations,
  // private customer conversations they don't own).
  //
  // MITIGATION: Gate on room membership check via socket.rooms.has()
  // - socket.rooms is the ONLY authoritative list of rooms a socket has joined
  // - socket.to() does NOT enforce membership (it just broadcasts), so we
  //   must verify socket.rooms before calling it
  // - If socket hasn't successfully called conversation:join, they won't be
  //   in conv_* room, and typing events will silently fail (not broadcast)
  //
  // This ensures typing indicators leak no information to unauthorized users.
  socket.on('typing:start', (conversationId) => {
    if (conversationId && socket.rooms.has(`conv_${conversationId}`)) {
      socket.to(`conv_${conversationId}`).emit('user:typing', {
        conversationId,
        userId,
      });
    }
  });

  socket.on('typing:stop', (conversationId) => {
    if (conversationId && socket.rooms.has(`conv_${conversationId}`)) {
      socket.to(`conv_${conversationId}`).emit('user:stopped_typing', {
        conversationId,
        userId,
      });
    }
  });

  // ── GUEST CHAT ROOMS ──────────────────────────────────────────
  // Helpers join 'guest_chat_waiting' room to receive notifications about
  // new guest sessions. This allows real-time matching of guests to helpers.
  //
  // SECURITY: Only helpers (verified via socket.userRole) can join this room.
  // New guest sessions are broadcast to all connected helpers in this room.
  if (['helper', 'helper_pro', 'broker'].includes(socket.userRole)) {
    socket.join('guest_chat_waiting');
    logger.debug('Helper joined guest chat waiting room', { userId });
  }

  // Admins join 'guest_chat_admin' room to monitor all active sessions
  if (['admin', 'super_admin'].includes(socket.userRole)) {
    socket.join('guest_chat_admin');
    logger.debug('Admin joined guest chat monitoring room', { userId });
  }

  socketService.trackConnect(userId, socket.id);
  logger.debug('Socket connected', { userId, role: socket.userRole, socketId: socket.id });

  // Phase 1b: auto-join the per-business workspace rooms (inbox + calendar)
  // for every business this user owns or is an active member of.
  socketService.joinBusinessRooms(socket, userId).then(bids => {
    if (bids && bids.length) {
      logger.debug('Socket joined business workspace rooms', {
        userId, socketId: socket.id, businessIds: bids,
      });
    }
  }).catch(err => {
    logger.warn('joinBusinessRooms failed', { userId, error: err && err.message });
  });

  socket.on('disconnect', () => {
    socketService.trackDisconnect(userId, socket.id);
    logger.debug('Socket disconnected', { socketId: socket.id });
  });
});

// Wire socket service so notificationService can broadcast
socketService.init(io);

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
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('Health DB check failed', { message: err.message });
    res.status(503).json({ status: 'degraded', error: 'database unreachable' });
  }
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

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'degraded' });
  }
});

// Pool health metrics endpoint (used by monitoring systems)
app.get('/api/health/pool', (req, res) => {
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
app.use('/api/businesses', businessStaffRoutes);
app.use('/api/businesses', businessReviewMgmtRoutes);
app.use('/api/businesses', businessMarketingRoutes);
app.use('/api/businesses', businessWaitlistRoutes);
app.use('/api/businesses', businessPackagesRoutes);
app.use('/api/businesses', businessHealthAlertsRoutes);
app.use('/api/businesses', businessLeadsRoutes);
app.use('/api/businesses', businessMsgTemplatesRoutes);
app.use('/api/businesses', businessIntegrationsRoutes);
app.use('/api/businesses', businessProductPricingRoutes);
app.use('/api/businesses', businessTeamRoutes);
app.use('/api/vortex',     vortexAccessRoutes);
app.use('/api/me',         meWorkspaceRoutes);
app.use('/api/admin/corporate', corporateRolesRoutes);
// OxSteed Logistics branch
app.use('/api/logistics',       logisticsRoutes);
app.use('/api/admin/logistics', authenticate, requireRole('admin', 'super_admin'), logisticsAdminRoutes);
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
app.use('/api/settings',     settingsRoutes);
app.use('/api/discover',     discoverRoutes);
app.use('/api/qr-codes',     qrCodesRoutes);
app.use('/api/consulting',   consultingRoutes);
app.use('/api/consulting',   consultingAllPhasesRoutes);
app.use('/api/consulting/admin', consultingAdminRoutes);
app.use('/api/consulting',   consultingPaymentRoutes);
app.use('/api/invoices',     invoiceRoutes);
app.use('/api/consulting/feedback', consultingFeedbackRoutes);
app.use('/api/consulting/business-launch', businessLaunchRoutes);
app.use('/api/franchise', franchiseRoutes);
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
app.use('/api', reviewModerationRoutes);
app.use('/api/marketplace/products', marketplaceProductsRoutes);
app.use('/api/carts', shoppingCartsRoutes);
app.use('/api/carts', cartCheckoutRoutes);
app.use('/api/shared-carts', sharedCartsRoutes);
app.use('/api/mobile', mobileRoutes);
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
app.use('/api/chat', chatRoutes);
app.get('/api/users/:id/profile', getPublicProfile);

// Enterprise monitoring - admin only
app.use('/api/monitoring', monitoringRoutes);

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

httpServer.listen(PORT, async () => {
  logger.info(`OxSteed v2 server running on port ${PORT}`, { env: process.env.NODE_ENV || 'development' });
  // Load fee config after DB is reachable
  try { await reloadFeeConfig(); } catch (e) { logger.warn('FeeService initial load failed', { message: e.message }); }
});

// ── CRON JOBS ────────────────────────────────────────────────
const { startWeeklySummaryJob }         = require('./jobs/weeklySummary');
const { startPlannedNeedsScheduler }    = require('./jobs/plannedNeedsScheduler');
const { startDiscoverDigestJob }        = require('./jobs/discoverDigest');
const { startConversationRetentionCleanup } = require('./jobs/conversationRetentionCleanup');
const { startGuestChatSessionTimeoutJob } = require('./jobs/guestChatSessionTimeout');
const { startConsultingSessionReminders } = require('./jobs/consultingSessionReminders');
const { startConsultingPostSessionFollowup } = require('./jobs/consultingPostSessionFollowup');
const { startConsultingNoShowFollowup } = require('./jobs/consultingNoShowFollowup');
const { startCalendarReminderJob } = require('./jobs/calendarReminders');
const { startAffiliateCommissionBatchJob } = require('./jobs/affiliateCommissionBatch');
const cleanupOldMessagesJob = require('./jobs/cleanupOldMessages');
const { startTemplateExpiryJob } = require('./jobs/templateExpiryJob');
const { startAcceptedJobExpiryJob } = require('./jobs/acceptedJobExpiryJob');
const { startScheduledDeletionJob } = require('./jobs/scheduledDeletionJob');
const bookingController = require('./controllers/bookingController');

startWeeklySummaryJob();
startPlannedNeedsScheduler();
startDiscoverDigestJob();
startConversationRetentionCleanup();
startGuestChatSessionTimeoutJob();
startConsultingSessionReminders();
startConsultingPostSessionFollowup();
startConsultingNoShowFollowup();
startCalendarReminderJob();
startAffiliateCommissionBatchJob();
startScheduledDeletionJob();
startTemplateExpiryJob();
startAcceptedJobExpiryJob();

// Start message cleanup job (180-day auto-retention for support conversations)
const cron = require('node-cron');

cron.schedule('*/15 * * * *', async () => {
  try {
    await bookingController.expirePendingBookingRequests();
    await bookingController.releaseStaleAcceptedBookings();
  } catch (err) {
    logger.warn('Booking maintenance job failed', { error: err.message });
  }
});
logger.info('Booking maintenance job scheduled', { cronExpression: '*/15 * * * *' });

const cleanupTask = cron.schedule(cleanupOldMessagesJob.cronExpression, async () => {
  try {
    const result = await cleanupOldMessagesJob.handler();
    logger.info('Support message cleanup job completed', result);
  } catch (err) {
    logger.error('Support message cleanup job failed', { error: err.message });
  }
});
logger.info('Support message cleanup job scheduled', {
  description: cleanupOldMessagesJob.description,
  cronExpression: cleanupOldMessagesJob.cronExpression,
});

// ── GRACEFUL SHUTDOWN ────────────────────────────────────────
function shutdown(signal) {
  logger.info('Shutdown received', { signal });
  httpServer.close(() => {
    logger.info('HTTP server closed');
    io.close(() => {
      logger.info('Socket.IO closed');
      pool.end(() => {
        logger.info('DB pool drained');
        process.exit(0);
      });
    });
  });
  // Force exit after 15s if graceful shutdown stalls
  setTimeout(() => {
    process.exit(1);
  }, 15000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
