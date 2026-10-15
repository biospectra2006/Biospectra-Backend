const express = require('express');
const router = express.Router();
const aboutController = require('../controllers/aboutController');
const { protect, requireElevatedSession } = require('../controllers/authController');
const { galleryUpload } = require('../config/multerTemp');

// Public
router.get('/', aboutController.getAllSections);

// Protected (admin only + MFA Elevation)
router.post('/', protect, requireElevatedSession, galleryUpload.single('image'), aboutController.createSection);
router.put('/:id', protect, requireElevatedSession, galleryUpload.single('image'), aboutController.updateSection);
router.delete('/:id', protect, requireElevatedSession, aboutController.deleteSection);
router.post('/bulk', protect, requireElevatedSession, aboutController.bulkCreate);

module.exports = router;
