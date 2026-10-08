'use strict';

// OxSteed Media routes.

const router = require('express').Router();
const { requireAuth, optionalAuth } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/mediaController');
const assetCtrl = require('../controllers/mediaAssetController');
const verificationCtrl = require('../controllers/mediaVerificationController');
const creatorCtrl = require('../controllers/mediaCreatorController');

const mediaUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many Media uploads. Please try again later.', code: 'media_upload_rate_limited' },
});

// Public feed (guests can view).
// Resolve a valid session without requiring one: personal action state and
// two-way blocks must apply on public reads too.
router.use(optionalAuth);
router.get('/capabilities', (_req, res) => {
  const safety = require('../services/mediaSafetyPolicy');
  res.set('Cache-Control', 'no-store');
  res.json({
    video_safety_mode: safety.mode(),
    video_policy_allows_publication: safety.videoAllowed(),
    upload_identity_required: true,
    malware_scan_required: true,
    transcode_required: true,
  });
});
router.get('/verification', requireAuth, verificationCtrl.getCenter);
router.post('/verification/requests', requireAuth, verificationCtrl.createRequest);
router.get('/feed', ctrl.getFeed);
router.get('/posts/drafts', requireAuth, ctrl.getDrafts);
router.get('/posts/bookmarks', requireAuth, ctrl.getBookmarks);
router.get('/search', ctrl.searchMedia);
router.get('/entities', ctrl.searchMediaEntities);
router.get('/communities', ctrl.getCommunities);
router.get('/communities/:slug', ctrl.getCommunity);
router.post('/communities/:id/join', requireAuth, ctrl.joinCommunity);
router.delete('/communities/:id/join', requireAuth, ctrl.leaveCommunity);
router.get('/business/:businessId/posts', ctrl.getBusinessPosts);
router.get('/posts/:id/draft', requireAuth, ctrl.getDraft);
router.get('/posts/:id', ctrl.getPost);
router.get('/posts/:id/replies', ctrl.getReplies);
router.get('/posts/:id/quotes', ctrl.getQuotes);
router.get('/actors/:handle', ctrl.getActor);
router.post('/actors/:actorId/follow', requireAuth, ctrl.toggleFollow);

// Combined v3 creator marketplace surfaces. Monetary rows are held in
// pending_credit until the guarded OxSteed Credit transfer is authorized.
router.get('/creator/gigs', creatorCtrl.listGigs);
router.post('/creator/gigs', requireAuth, creatorCtrl.createGig);
router.post('/creator/gigs/:gigId/applications', requireAuth, creatorCtrl.applyToGig);
router.get('/creator/gigs/:gigId/applications', requireAuth, creatorCtrl.listApplications);
router.get('/creator/applications', requireAuth, creatorCtrl.listMyApplications);
router.post('/creator/applications/:applicationId/award', requireAuth, creatorCtrl.awardApplication);
router.post('/creator/applications/:applicationId/deliverables', requireAuth, creatorCtrl.submitDeliverable);
router.patch('/creator/deliverables/:deliverableId', requireAuth, creatorCtrl.reviewDeliverable);
router.post('/creator/tips', requireAuth, creatorCtrl.createTip);
router.post('/creator/tips/:tipId/settle', requireAuth, creatorCtrl.settleTip);
router.post('/creator/sponsorships', requireAuth, creatorCtrl.createSponsorship);
router.get('/creator/sponsorships', requireAuth, creatorCtrl.listSponsorships);
router.post('/creator/sponsorships/:sponsorshipId/accept', requireAuth, creatorCtrl.acceptSponsorship);
router.post('/creator/sponsorships/:sponsorshipId/settle', requireAuth, creatorCtrl.settleSponsorship);
router.post('/creator/sponsorships/:sponsorshipId/cancel', requireAuth, creatorCtrl.cancelSponsorship);
router.post('/posts/:postId/boosts', requireAuth, creatorCtrl.createBoost);
router.post('/creator/boosts/:boostId/settle', requireAuth, creatorCtrl.settleBoost);
router.post('/creator/boosts/:boostId/cancel', requireAuth, creatorCtrl.cancelBoost);
router.post('/creator/disputes/:kind/:id', requireAuth, creatorCtrl.openCreatorDispute);

// Authenticated actions.
router.post('/posts', requireAuth, ctrl.createPost);
router.patch('/posts/:id/draft', requireAuth, ctrl.updateDraft);
router.post('/posts/:id/publish', requireAuth, ctrl.publishPost);
router.patch('/posts/:id', requireAuth, ctrl.updatePost);
router.delete('/posts/:id', requireAuth, ctrl.deletePost);
router.put('/posts/:id/links', requireAuth, ctrl.replacePostLinks);
router.post('/posts/:id/like', requireAuth, ctrl.toggleLike);
router.post('/posts/:id/bookmark', requireAuth, ctrl.toggleBookmark);
router.post('/posts/:id/repost', requireAuth, ctrl.toggleRepost);
router.post('/posts/:id/share', ctrl.recordShare);
router.post('/posts/:id/view', ctrl.recordView);
router.post('/posts/:id/flags', requireAuth, ctrl.flagPost);

// Asset uploads.
router.post('/assets/photo-uploads', requireAuth, mediaUploadLimiter, assetCtrl.mediaPhotoUploadHandler, assetCtrl.uploadPhoto);
router.post('/assets/video-uploads', requireAuth, mediaUploadLimiter, assetCtrl.requireVideoIdentity, assetCtrl.mediaVideoUploadHandler, assetCtrl.videoUpload);
router.post('/assets/link', requireAuth, assetCtrl.linkAsset);

module.exports = router;
