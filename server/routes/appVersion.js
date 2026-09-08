/**
 * App version / force-update endpoint.
 * GET /api/app-version/ios
 * GET /api/app-version/android  (future)
 *
 * Returns:
 *   { platform, min_version, latest_version, update_url, message }
 *
 * min_version  — builds below this must update before proceeding.
 * latest_version — soft nudge shown on the home screen.
 *
 * Override with env vars so ops can hotfix without a deploy:
 *   IOS_MIN_VERSION, IOS_LATEST_VERSION, IOS_UPDATE_MESSAGE
 */
'use strict';

const express = require('express');
const router  = express.Router();

const IOS_APP_STORE_URL = 'https://apps.apple.com/us/app/oxsteed-marketplace/id6784977367';

router.get('/ios', (req, res) => {
  res.json({
    platform:       'ios',
    min_version:    process.env.IOS_MIN_VERSION     || '1.0.0',
    latest_version: process.env.IOS_LATEST_VERSION  || '1.0.0',
    update_url:     process.env.IOS_UPDATE_URL       || IOS_APP_STORE_URL,
    message:        process.env.IOS_UPDATE_MESSAGE   ||
                    'A required update is available. Please update OxSteed to continue.',
    force_after:    process.env.IOS_FORCE_AFTER      || null,  // ISO date — force after this date
  });
});

router.get('/android', (req, res) => {
  res.json({
    platform:       'android',
    min_version:    process.env.ANDROID_MIN_VERSION     || '1.0.0',
    latest_version: process.env.ANDROID_LATEST_VERSION  || '1.0.0',
    update_url:     process.env.ANDROID_UPDATE_URL       ||
                    'https://play.google.com/store/apps/details?id=com.oxsteed',
    message:        process.env.ANDROID_UPDATE_MESSAGE   ||
                    'A required update is available. Please update OxSteed to continue.',
    force_after:    process.env.ANDROID_FORCE_AFTER      || null,
  });
});

module.exports = router;
