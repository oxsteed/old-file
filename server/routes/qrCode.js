const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const qrCodeController = require('../controllers/qrCodeController');

router.post('/generate', generalLimiter, qrCodeController.generateQRCode);
router.get('/templates', qrCodeController.getTemplates);

router.use(authenticate);

router.post('/', qrCodeController.saveQRCode);
router.get('/', qrCodeController.getMyQRCodes);
router.get('/:id', qrCodeController.getQRCode);
router.put('/:id', qrCodeController.updateQRCode);
router.delete('/:id', qrCodeController.deleteQRCode);

module.exports = router;
