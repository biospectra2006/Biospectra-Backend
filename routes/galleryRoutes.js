const express = require('express');
const router = express.Router();
const galleryController = require('../controllers/galleryController');
const { protect, requireElevatedSession } = require('../controllers/authController');
const { galleryUpload } = require('../config/multerTemp');

// Public
router.get('/', galleryController.getGalleryImages);

// Protected (admin only + MFA Elevation)
router.post('/', protect, requireElevatedSession, galleryUpload.single('image'), galleryController.uploadGalleryImage);
router.put('/:id', protect, requireElevatedSession, galleryController.updateGalleryImage);
router.delete('/:id', protect, requireElevatedSession, galleryController.deleteGalleryImage);

module.exports = router;
