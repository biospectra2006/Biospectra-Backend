const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');
const { articleUpload } = require('../config/multerTemp');
const { protect, requireElevatedSession } = require('../controllers/authController');

// Public routes (anyone can read)
router.get('/tree', articleController.getJournalTree);
router.get('/latest', articleController.getLatestArticles);
router.get('/category/:categoryId', articleController.getArticlesByCategory);
router.get('/:id', articleController.getArticleById);

// Protected routes (admin only + MFA Elevation)
router.post('/upload', protect, requireElevatedSession, articleUpload.single('file'), articleController.uploadArticle);
router.post('/init-year', protect, requireElevatedSession, articleController.initYear);
router.post('/issue', protect, requireElevatedSession, articleController.createIssue);
router.post('/category', protect, requireElevatedSession, articleController.createCategory);
router.put('/:id', protect, requireElevatedSession, articleController.updateArticle);
router.put('/issue/:id', protect, requireElevatedSession, articleController.updateIssue);
router.delete('/:id', protect, requireElevatedSession, articleController.deleteArticle);
router.delete('/category/:id', protect, requireElevatedSession, articleController.deleteCategory);
router.delete('/issue/:id', protect, requireElevatedSession, articleController.deleteIssue);
router.delete('/year/:id', protect, requireElevatedSession, articleController.deleteYear);

module.exports = router;
