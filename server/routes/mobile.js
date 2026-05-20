const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const mobileController = require('../controllers/mobileController');

router.post('/push-token', authenticate, mobileController.registerPushToken);
router.delete('/push-token', authenticate, mobileController.unregisterPushToken);
router.get('/feed', authenticate, mobileController.getFeed);
router.get('/nearby', authenticate, mobileController.getNearby);
router.post('/offline-sync', authenticate, mobileController.offlineSync);
router.get('/business/:businessId/workspace/mobile-summary', authenticate, mobileController.getBusinessMobileSummary);
router.get('/payment-config', authenticate, mobileController.getPaymentConfig);
router.post('/invoices/:invoiceId/payment-intent', authenticate, mobileController.createInvoicePaymentIntent);
router.post('/invoices/:invoiceId/confirm-payment', authenticate, mobileController.confirmInvoicePayment);
router.post('/bookings/:bookingId/payment-intent', authenticate, mobileController.createBookingPaymentIntent);
router.post('/bookings/:bookingId/confirm-payment', authenticate, mobileController.confirmBookingPayment);
router.post('/helper/gallery', authenticate, upload.single('file'), validateFileUpload, mobileController.uploadHelperGallery);

module.exports = router;
