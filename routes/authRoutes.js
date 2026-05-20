const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const authController = require('../controllers/authController');
const passport = require('../config/passport');

router.post('/login', authController.login);
router.post('/login-mfa', authController.loginMfa);
router.post('/refresh-token', authController.refreshToken);

// Google OAuth with CSRF protection (state parameter)
router.get('/google', (req, res, next) => {
    const state = crypto.randomBytes(32).toString('hex');
    res.cookie('oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: 10 * 60 * 1000
    });
    passport.authenticate('google', { scope: ['profile', 'email'], state })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
    const storedState = req.cookies.oauth_state;
    const returnedState = req.query.state;
    res.clearCookie('oauth_state');
    if (!storedState || !returnedState || storedState !== returnedState) {
        console.warn('OAuth state mismatch - possible CSRF attack');
        return res.redirect(`${process.env.ADMIN_URL || 'http://localhost:5173'}?error=csrf`);
    }
    passport.authenticate('google', { session: false, failureRedirect: `${process.env.ADMIN_URL || 'http://localhost:5173'}?error=auth_failed` })(req, res, next);
}, authController.googleCallback);

router.get('/me', authController.protect, authController.getMe);
router.post('/verify-mfa-stepup', authController.protect, authController.verifyMfaStepup);

// Protected routes (require login first)
router.get('/mfa-setup', authController.protect, authController.setupMfa);
router.post('/mfa-verify', authController.protect, authController.verifyMfaSetup);

// Session Management (Audit Log)
router.get('/sessions', authController.protect, authController.getSessions);
router.delete('/sessions/:sessionId', authController.protect, authController.terminateSession);
router.post('/logout', authController.protect, authController.logout);

module.exports = router;
