const express = require('express');
const router = express.Router();
const { generalLimiter } = require('../middleware/rateLimiter');
const controller = require('../modules/translation/translationController');

router.get('/languages', controller.handleLanguages);
router.get('/locales', controller.handleLocales);
router.post('/detect-language', generalLimiter, controller.optionalAuth, controller.handleDetectLanguage);

// Translation endpoint: rate-limited but public so guest users can translate content.
// Supports both the new single-text contract and the legacy batch `texts[]` contract.
router.post('/', generalLimiter, controller.optionalAuth, controller.handleTranslate);
router.post('/batch', generalLimiter, controller.optionalAuth, controller.handleBatch);
router.get('/jobs/:jobId', controller.optionalAuth, controller.handleGetJob);
router.get('/translations/:id', controller.optionalAuth, controller.handleGetTranslation);
router.get('/history', controller.authenticate, controller.handleHistory);
router.get('/glossaries', controller.authenticate, controller.handleListGlossaries);
router.get('/glossaries/:id', controller.authenticate, controller.handleGetGlossary);
router.post('/glossaries', controller.authenticate, controller.handleCreateGlossary);
router.patch('/glossaries/:id', controller.authenticate, controller.handleUpdateGlossary);
router.delete('/glossaries/:id', controller.authenticate, controller.handleDeleteGlossary);
router.post('/glossaries/:id/terms', controller.authenticate, controller.handleAddGlossaryTerms);
router.delete('/glossaries/:id/terms/:termId', controller.authenticate, controller.handleDeleteGlossaryTerm);

module.exports = router;
