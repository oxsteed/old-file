// OxSteed v2 - Express server entry point
require('dotenv').config();

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
const { errorHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const socketService = require('./services/socketService');
const { reloadFeeConfig } = require('./services/feeService');

// ── MIDDLEWARE ────────────────────────────────────────────────
const securityHeaders = require('./middleware/securityHeaders');
const sanitizeInputs = require('./middleware/sanitize');
const { generalLimiter, authLimiter, strictLimiter } = require('./middleware/rateLimiter');
const prerenderHelperProfile = require('./middleware/prerenderHelperProfile');

// ── ROUTES ───────────────────────────────────────────────────
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
const verificationRoutes = require('./routes/verification');
const messageRoutes = require('./routes/messages');
const lifeDashboardRoutes = require('./routes/lifeDashboard');
const diditRoutes = require('./routes/didit');
const businessRoutes = require('./routes/businesses');
const supportRoutes = require('./routes/support');
const chatRoutes    = require('./routes/chat');
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
const roleToggleRoutes     = require('./routes/roleToggle');

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
      pool.query('SELECT is_active, role FROM users WHERE id = $1', [decoded.id]).then(({ rows }) => {
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

io.on('connection', (socket) => {
  const userId = socket.userId;
  socket.join(`user_${userId}`);
  // Admins join a shared room so support tickets can be broadcast to all staff
  if (['admin', 'super_admin'].includes(socket.userRole)) {
    socket.join('admins');
  }

  // SECURITY (H-28): Explicitly drop 'join' events from clients.
  // Room membership is determined strictly server-side through authentication
  // hooks above. We do not allow arbitrary clients to join rooms like 'admins'.
  socket.on('join', () => {});

  // ── CONVERSATION ROOMS ────────────────────────────────────────
  // Clients join a per-conversation room to receive typing indicators and
  // real-time message delivery scoped to that thread.  Membership is
  // verified server-side; clients cannot join arbitrary rooms.
  socket.on('conversation:join', async (conversationId) => {
    if (!conversationId) return;
    try {
      const { rows } = await pool.query(
        'SELECT id FROM conversations WHERE id = $1 AND (customer_id = $2 OR helper_id = $2)',
        [conversationId, userId]
      );
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
  // Forwarded only to the conv room (excluding sender) — no DB writes.
  socket.on('typing:start', (conversationId) => {
    if (conversationId) {
      socket.to(`conv_${conversationId}`).emit('user:typing', {
        conversationId,
        userId,
      });
    }
  });

  socket.on('typing:stop', (conversationId) => {
    if (conversationId) {
      socket.to(`conv_${conversationId}`).emit('user:stopped_typing', {
        conversationId,
        userId,
      });
    }
  });

  socketService.trackConnect(userId, socket.id);
  logger.debug('Socket connected', { userId, role: socket.userRole, socketId: socket.id });

  socket.on('disconnect', () => {
    socketService.trackDisconnect(userId, socket.id);
    logger.debug('Socket disconnected', { socketId: socket.id });
  });
});

// Wire socket service so notificationService can broadcast
socketService.init(io);

// ── REQUEST LOGGING ──────────────────────────────────────────
app.use(logger.requestMiddleware());

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
// Webhooks must skip the rate limiter — Stripe/Didit IPs can burst
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
app.use('/api/', generalLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/privacy/delete-account', strictLimiter);
app.use('/api/privacy/export', strictLimiter);

// ── BODY PARSING ─────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── INPUT SANITIZATION ───────────────────────────────────────
app.use(sanitizeInputs);

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
app.use('/api/verification', verificationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/life', lifeDashboardRoutes);
app.use('/api/didit', diditRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/support', supportRoutes);
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
app.use('/api/role-toggle',     roleToggleRoutes);

// ── INLINE ROUTES ──────────────────────────────────────
const { getPublicProfile } = require('./controllers/authController');
app.use('/api/chat', chatRoutes);
app.get('/api/users/:id/profile', getPublicProfile);

// ── PRODUCTION STATIC SERVING ────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));

  // Admin SPA - serve admin.html for all /admin/* routes
  app.get('/admin/*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/admin.html'));
  });

  // Pre-render helper profile pages with SEO shell + JSON-LD (Issue #35)
  app.get('/helpers/*', prerenderHelperProfile);
  // Main SPA - catch-all for everything else
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// ── ERROR HANDLER ────────────────────────────────────────────
// Standardized Error Handler (L-02) to prevent leaking stack traces or internal details.
app.use(errorHandler);

httpServer.listen(PORT, async () => {
  logger.info(`OxSteed v2 server running on port ${PORT}`, { env: process.env.NODE_ENV || 'development' });
  // Load fee config after DB is reachable
  try { await reloadFeeConfig(); } catch (e) { logger.warn('FeeService initial load failed', { message: e.message }); }
});

// ── CRON JOBS ────────────────────────────────────────────────
const { startWeeklySummaryJob }      = require('./jobs/weeklySummary');
const { startPlannedNeedsScheduler } = require('./jobs/plannedNeedsScheduler');
startWeeklySummaryJob();
startPlannedNeedsScheduler();

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
    console.error('[Shutdown] Forced exit after timeout');
    process.exit(1);
  }, 15000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

