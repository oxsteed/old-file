// ─── MIDDLEWARE ──────────────────────────────────────────────────────
const securityHeaders = require('./middleware/securityHeaders');
const sanitizeInputs  = require('./middleware/sanitize');
const { generalLimiter, authLimiter, strictLimiter } = require('./middleware/rateLimiter');

// Apply security headers to all requests
app.use(securityHeaders);

// Apply input sanitization to all requests
app.use(sanitizeInputs);

// Apply general rate limiter to all API routes
app.use('/api/', generalLimiter);

// Apply stricter rate limiter to auth endpoints
app.use('/api/auth', authLimiter);

// ─── ROUTES ─────────────────────────────────────────────────────────
const adminRoutes        = require('./routes/admin');
const notificationRoutes = require('./routes/notifications');
const reviewRoutes       = require('./routes/reviews');
const disputeRoutes      = require('./routes/disputes');
const consentRoutes      = require('./routes/consent');
const privacyRoutes      = require('./routes/privacy');

app.use('/api/admin',         adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reviews',       reviewRoutes);
app.use('/api/disputes',      disputeRoutes);
app.use('/api/consent',       consentRoutes);
app.use('/api/privacy',       privacyRoutes);

// Apply strict rate limiter to sensitive privacy endpoints
app.use('/api/privacy/delete-account', strictLimiter);
app.use('/api/privacy/export',         strictLimiter);
