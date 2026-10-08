'use strict';

// OxSteed Media routes.

const router = require('express').Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/mediaController');
const assetCtrl = require('../controllers/mediaAssetController');

// Public feed (guests can view).
router.get('/feed', ctrl.getFeed);
router.get('/search', ctrl.searchMedia);
router.get('/communities', ctrl.getCommunities);
router.get('/communities/:slug', ctrl.getCommunity);
router.post('/communities/:id/join', requireAuth, ctrl.joinCommunity);
router.delete('/communities/:id/join', requireAuth, ctrl.leaveCommunity);
router.get('/business/:businessId/posts', ctrl.getBusinessPosts);
router.get('/posts/:id', ctrl.getPost);
router.get('/posts/:id/replies', ctrl.getReplies);
router.get('/posts/:id/quotes', ctrl.getQuotes);
router.get('/actors/:handle', ctrl.getActor);

// Authenticated actions.
router.post('/posts', requireAuth, ctrl.createPost);
router.post('/posts/:id/like', requireAuth, ctrl.toggleLike);
router.post('/posts/:id/bookmark', requireAuth, ctrl.toggleBookmark);
router.post('/posts/:id/repost', requireAuth, ctrl.toggleRepost);
router.post('/posts/:id/view', ctrl.recordView);
router.post('/posts/:id/flags', requireAuth, ctrl.flagPost);

// Asset uploads.
router.post('/assets/photo-uploads', requireAuth, assetCtrl.mediaPhotoUpload, assetCtrl.uploadPhoto);
router.post('/assets/video-uploads', requireAuth, assetCtrl.mediaVideoUpload, assetCtrl.videoUpload);
router.post('/assets/link', requireAuth, assetCtrl.linkAsset);

module.exports = router;
