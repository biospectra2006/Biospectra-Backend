const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { protect, requireElevatedSession } = require('../controllers/authController');
const { galleryUpload } = require('../config/multerTemp');

// GET settings (publicly accessible)
router.get('/', settingsController.getSettings);

// PUT settings (protected)
// Allow uploading heroImage and certificateImage
router.put('/', protect, requireElevatedSession, galleryUpload.fields([
  { name: 'heroImage', maxCount: 1 },
  { name: 'certificateImage', maxCount: 1 }
]), settingsController.updateSettings);

module.exports = router;
