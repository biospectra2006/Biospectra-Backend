const express = require('express');
const router = express.Router();
const guidelineController = require('../controllers/guidelineController');
const { protect } = require('../controllers/authController');

// Public route (anyone can read guidelines)
router.get('/', guidelineController.getGuidelines);

// Protected routes (admin only)
router.post('/', protect, guidelineController.createGuideline);
router.put('/:id', protect, guidelineController.updateGuideline);
router.delete('/:id', protect, guidelineController.deleteGuideline);

module.exports = router;
