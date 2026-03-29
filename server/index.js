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

const app = express();
const httpServer = http.createServer(app);
app.set('trust proxy', 1); // Required for Render reverse proxy
const PORT = process.env.PORT || 5000;

// ── SOCKET.IO ─────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
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
app.use(helmet());
app.use(securityHeaders);
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
}));

// ── RATE LIMITING ────────────────────────────────────────────
app.use('/api/', generalLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/privacy/delete-account', strictLimiter);
app.use('/api/privacy/export', strictLimiter);

// ── WEBHOOK ROUTES (before body parsing — Stripe needs raw body) ──
app.use('/api/webhooks', webhookRoutes);

// ── BODY PARSING ─────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── INPUT SANITIZATION ───────────────────────────────────────
app.use(sanitizeInputs);

// ── HEALTH CHECK ─────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
app.use('/api/fee-config', feeConfigRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/messages', messageRoutes);

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
  // Run pending database migrations on startup
  try {
    const { runAllMigrations } = require('./migrations/runOnce');
    await runAllMigrations();
  } catch (err) {
    console.error('[Startup] Migration runner error:', err.message);
  }
});

// ── CRON JOBS ────────────────────────────────────────────────
const { startWeeklySummaryJob } = require('./jobs/weeklySummary');
startWeeklySummaryJob();
