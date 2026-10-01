/**
 * routes/learn.js — Learn Mode API
 * Mounted at /api/learn and /api/admin/learn
 */

const express  = require('express');
const rateLimit = require('express-rate-limit');
const router   = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission }  = require('../middleware/adminAuth');

// Click tracking is a public, anonymous endpoint — give it its own tight
// bucket (60 requests per minute per IP) instead of the shared general pool.
// Route-local Redis store option, mirroring server/routes/qrPayments.js.
// Falls back to in-memory when Redis is unavailable.
const redisClient = require('../utils/redis');
let RedisStore = null;
if (redisClient) {
  try {
    RedisStore = require('rate-limit-redis').default;
  } catch { /* in-memory fallback */ }
}
function createTrackStoreOption(prefix) {
  if (redisClient && RedisStore) {
    return { store: new RedisStore({ sendCommand: (...args) => redisClient.call(...args), prefix }) };
  }
  return {};
}
const marketplaceTrackLimiter = rateLimit({
  ...createTrackStoreOption('rl:learn_track:'),
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.', retryAfter: '1 minute' },
});

const {
  getGuides,
  getGuideStats,
  recordView,
  getCompletions,
  recordCompletion,
  submitGuide,
  getMySubmissions,
  submitGuideVideo,
  getBadges,
  trackMarketplaceClick,
  adminListSubmissions,
  adminGetSubmission,
  adminReviewSubmission,
  adminListVideoSubmissions,
  adminApproveVideoSubmission,
  adminBlockVideoSubmission,
  // Admin guide catalog CRUD
  adminListGuides,
  adminCreateGuide,
  adminUpdateGuide,
  adminDeleteGuide,
  adminTagGuide,
  // Phase 2: AI tagging review queue
  adminListAiSuggestions,
  adminApproveSuggestion,
  adminRejectSuggestion,
  adminMarketplaceStats,
  // Product link overrides
  getProductLinks,
  adminListProductLinks,
  adminCreateProductLink,
  adminUpdateProductLink,
  adminDeleteProductLink,
} = require('../controllers/learnController');

// ── Public routes (no auth) ────────────────────────────────────
router.get('/guides',                getGuides);
router.get('/stats',                 getGuideStats);
router.post('/views',                recordView);          // auth optional — req.user may be null
router.post('/track',                marketplaceTrackLimiter, trackMarketplaceClick);
// Product link overrides — fetched by the iOS app on every refresh.
// Returns active rows only; fails open (empty array) if table absent.
router.get('/product-links',         getProductLinks);

// Community video submissions — tighter bucket: 20 per hour per account.
// Videos go live automatically after 24h unless an admin blocks them, so
// spam here has a direct path to the public guide page.
const videoSubmitLimiter = rateLimit({
  ...createTrackStoreOption('rl:learn_video_submit:'),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  keyGenerator: (req) => (req.user ? `u:${req.user.id}` : req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.', retryAfter: '1 hour' },
});

// ── Authenticated user routes ──────────────────────────────────
router.get('/completions',           authenticate, getCompletions);
router.post('/completions',          authenticate, recordCompletion);
router.get('/badges',                authenticate, getBadges);
router.post('/guides/submit',        authenticate, submitGuide);
router.post('/submissions',          authenticate, submitGuide);
router.get('/submissions/mine',      authenticate, getMySubmissions);
// Community video for an existing guide — 24h auto-publish unless blocked.
router.post('/guides/:id/videos',    authenticate, videoSubmitLimiter, submitGuideVideo);

// ── Admin routes ───────────────────────────────────────────────
router.get('/admin/submissions',         authenticate, requireAdmin, requirePermission('moderate_content'), adminListSubmissions);
router.get('/admin/submissions/:id',     authenticate, requireAdmin, requirePermission('moderate_content'), adminGetSubmission);
router.patch('/admin/submissions/:id',   authenticate, requireAdmin, requirePermission('moderate_content'), adminReviewSubmission);
// Community video submissions — 24h auto-publish unless blocked
router.get('/admin/video-submissions',              authenticate, requireAdmin, requirePermission('moderate_content'), adminListVideoSubmissions);
router.post('/admin/video-submissions/:id/approve', authenticate, requireAdmin, requirePermission('moderate_content'), adminApproveVideoSubmission);
router.post('/admin/video-submissions/:id/block',   authenticate, requireAdmin, requirePermission('moderate_content'), adminBlockVideoSubmission);

// Guide catalog CRUD — admin only
router.get('/admin/guides',        authenticate, requireAdmin, requirePermission('moderate_content'), adminListGuides);
router.post('/admin/guides',       authenticate, requireAdmin, requirePermission('moderate_content'), adminCreateGuide);
router.put('/admin/guides/:id',    authenticate, requireAdmin, requirePermission('moderate_content'), adminUpdateGuide);
router.delete('/admin/guides/:id', authenticate, requireAdmin, requirePermission('moderate_content'), adminDeleteGuide);
// Phase 2: AI tagging — manual re-tag, review queue, marketplace stats
router.post('/admin/guides/:id/tag',        authenticate, requireAdmin, requirePermission('moderate_content'), adminTagGuide);
router.get('/admin/ai-suggestions',         authenticate, requireAdmin, requirePermission('moderate_content'), adminListAiSuggestions);
router.post('/admin/ai-suggestions/:id/approve', authenticate, requireAdmin, requirePermission('moderate_content'), adminApproveSuggestion);
router.post('/admin/ai-suggestions/:id/reject',  authenticate, requireAdmin, requirePermission('moderate_content'), adminRejectSuggestion);
router.get('/admin/marketplace-stats',      authenticate, requireAdmin, requirePermission('moderate_content'), adminMarketplaceStats);

// Product link CRUD — admin only
router.get('/admin/product-links',        authenticate, requireAdmin, requirePermission('moderate_content'), adminListProductLinks);
router.post('/admin/product-links',       authenticate, requireAdmin, requirePermission('moderate_content'), adminCreateProductLink);
router.put('/admin/product-links/:id',    authenticate, requireAdmin, requirePermission('moderate_content'), adminUpdateProductLink);
router.delete('/admin/product-links/:id', authenticate, requireAdmin, requirePermission('moderate_content'), adminDeleteProductLink);

module.exports = router;
