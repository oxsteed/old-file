// server/routes/businesses.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  listBusinesses,
  addBusiness,
  updateBusiness,
  setPrimary,
  deleteBusiness,
} = require('../controllers/businessController');

router.get('/',            authenticate, listBusinesses);
router.post('/',           authenticate, addBusiness);
router.put('/:id',         authenticate, updateBusiness);
router.put('/:id/primary', authenticate, setPrimary);
router.delete('/:id',      authenticate, deleteBusiness);

module.exports = router;
