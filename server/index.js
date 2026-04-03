// OxSteed v2 - Express server entry point
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const pool = require('./db');
const socketService = require('./services/socketService');
const { reloadFeeConfig } = require('./services/feeService');

// ── MIDDLEWARE ────────────────────────────────────────────────
const securityHeaders = require('./middleware/securityHeaders');
const sanitizeInputs = require('./middleware/sanitize');
const { generalLimiter, authLimiter, strictLimiter } = require('./middleware/rateLimiter');

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

const app = express();
const httpServer = http.createServer(app);
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
    socket.userId = decoded.id;
    next();
  } catch (err) {
    return next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.userId;
  socket.join(`user_${userId}`);
  console.log(`[Socket] User ${userId} connected (socket ${socket.id})`);

  socket.on('disconnect', () => {
    console.log(`[Socket] Socket ${socket.id} disconnected`);
  });
});

// Wire socket service so notificationService can broadcast
socketService.init(io);

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
    console.error('[Health] DB check failed:', err.message);
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

// ── INLINE ROUTES ──────────────────────────────────────
const { getPublicProfile } = require('./controllers/authController');
app.get('/api/users/:id/profile', getPublicProfile);

// ── PRODUCTION STATIC SERVING ────────────────────────────────
if (process.env.NODE_ENV === 'production') {
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
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong' });
});

httpServer.listen(PORT, async () => {
  console.log(`OxSteed v2 server running on port ${PORT}`);
  // Load fee config after DB is reachable
  try { await reloadFeeConfig(); } catch (e) { console.warn('[FeeService] Initial load failed:', e.message); }
});

// ── CRON JOBS ────────────────────────────────────────────────
const { startWeeklySummaryJob } = require('./jobs/weeklySummary');
startWeeklySummaryJob();

// ── GRACEFUL SHUTDOWN ────────────────────────────────────────
function shutdown(signal) {
  console.log(`[Shutdown] ${signal} received. Closing server...`);
  httpServer.close(() => {
    console.log('[Shutdown] HTTP server closed');
    io.close(() => {
      console.log('[Shutdown] Socket.IO closed');
      pool.end(() => {
        console.log('[Shutdown] DB pool drained');
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
