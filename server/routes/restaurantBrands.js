'use strict';

// F-02 phase 2: brand HQ console routes (mounted at /api/restaurant-brands).
// Every route is authenticated; brand visibility is derived per request from
// the restaurants the caller can already access (see restaurantBrandController).

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { authenticatedLimiter } = require('../middleware/rateLimiter');
const { scopeExempt } = require('../middleware/scopeGates');
const brand = require('../controllers/restaurantBrandController');

router.use(authenticate, rejectImpersonated, authenticatedLimiter);

router.get('/', brand.listBrands);
router.get('/:brandId/overview', brand.getOverview);
router.get('/:brandId/store-comparison', brand.getStoreComparison);
router.get('/:brandId/compliance', brand.getCompliance);
router.post('/:brandId/menu/publish', brand.publishMenu);
router.post('/:brandId/restaurants', brand.attachRestaurant);
router.delete('/:brandId/restaurants/:restaurantId', scopeExempt('resource-scoped'), brand.detachRestaurant);

module.exports = router;
