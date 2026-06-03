const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const UAParser = require('ua-parser-js');
const User = require('../models/User');
const Session = require('../models/Session');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const signAccessToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '15m' });
};

const signRefreshToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
};

const getCookieOptions = (req) => {
    const secure = process.env.NODE_ENV === 'production' || req.secure;
    return {
        httpOnly: true,
        secure,
        sameSite: secure ? 'None' : 'Lax'
    };
};

const createSendToken = async (user, statusCode, req, res) => {
    const accessToken = signAccessToken(user._id);
    const refreshToken = signRefreshToken(user._id);

    const opts = getCookieOptions(req);

    res.cookie('jwt', accessToken, {
        ...opts,
        expires: new Date(Date.now() + 15 * 60 * 1000)
    });

    res.cookie('refreshToken', refreshToken, {
        ...opts,
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    // Track Session in DB using hashed Refresh Token
    const parser = new UAParser(req.headers['user-agent']);
    const ua = parser.getResult();
    
    await Session.create({
        userId: user._id,
        tokenHash: hashToken(refreshToken),
        ipAddress: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        device: {
            browser: `${ua.browser.name || 'Unknown'} ${ua.browser.version || ''}`,
            os: `${ua.os.name || 'Unknown'} ${ua.os.version || ''}`,
            device: ua.device.model || 'Desktop'
        }
    });

    // Remove password from output
    user.password = undefined;

    res.status(statusCode).json({
        status: 'success',
        token: accessToken, // Frontend can still use this for non-cookie requests if needed
        user: {
            id: user._id,
            username: user.username
        }
    });
};

exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: 'Please provide username and password' });
        }

        const user = await User.findOne({ username }).select('+password');

        if (!user || !(await user.correctPassword(password, user.password))) {
            return res.status(401).json({ message: 'Invalid credentials. Please try again.' });
        }

        if (user.role !== 'admin') {
            return res.status(403).json({ message: 'Access restricted to administrators only.' });
        }

        if (user.isMfaEnabled) {
            return res.status(200).json({
                status: 'mfa_required',
                userId: user._id,
                message: 'Please complete MFA to continue'
            });
        }

        await createSendToken(user, 200, req, res);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// MFA Setup - Generate QR Code
exports.setupMfa = async (req, res) => {
    try {
        console.log('Generating MFA for user:', req.user._id);
        const user = await User.findById(req.user._id);
        
        if (!user) {
            console.error('User not found for MFA setup');
            return res.status(404).json({ message: 'User not found' });
        }

        const secret = speakeasy.generateSecret({
            name: `Biospectra (${user.username})`
        });

        await User.updateOne({ _id: user._id }, { mfaSecret: secret.base32 });

        const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

        res.status(200).json({
            status: 'success',
            qrCode: qrCodeUrl,
            secret: secret.base32
        });
    } catch (error) {
        console.error('MFA Setup Error:', error);
        res.status(500).json({ message: error.message });
    }
};

// MFA Verification - Enable after first success
exports.verifyMfaSetup = async (req, res) => {
    try {
        const { token } = req.body;
        const user = await User.findById(req.user.id).select('+mfaSecret');

        const verified = speakeasy.totp.verify({
            secret: user.mfaSecret,
            encoding: 'base32',
            token
        });

        if (!verified) {
            return res.status(400).json({ message: 'Invalid token. Verification failed.' });
        }

        await User.updateOne({ _id: user._id }, { isMfaEnabled: true });

        res.status(200).json({
            status: 'success',
            message: 'MFA enabled successfully'
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// MFA Login - Final Step
exports.loginMfa = async (req, res) => {
    try {
        const { userId, token } = req.body;
        const user = await User.findById(userId).select('+mfaSecret');

        if (!user || !user.isMfaEnabled) {
            return res.status(400).json({ message: 'MFA not enabled for this account' });
        }

        if (user.role !== 'admin') {
            return res.status(403).json({ message: 'Access restricted to administrators only.' });
        }

        const verified = speakeasy.totp.verify({
            secret: user.mfaSecret,
            encoding: 'base32',
            token
        });

        if (!verified) {
            return res.status(401).json({ message: 'Invalid MFA token' });
        }

        // createSendToken handles token generation, session creation, and setting cookies
        await createSendToken(user, 200, req, res);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.protect = async (req, res, next) => {
    try {
        // 1. Getting token and check of it's there
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        } else if (req.cookies.jwt) {
            token = req.cookies.jwt;
        }

        if (!token) {
            return res.status(401).json({ message: 'You are not logged in. Please log in to get access.' });
        }

        // 2. Verification token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // 3. Check if session still exists and is active in database
        const rawRefreshToken = req.cookies.refreshToken;
        if (!rawRefreshToken) {
            return res.status(401).json({ message: 'Your session has expired or is invalid. Please log in again.' });
        }
        const session = await Session.findOne({ tokenHash: hashToken(rawRefreshToken), userId: decoded.id });
        
        if (!session) {
            return res.status(401).json({ message: 'Your session has been terminated. Please log in again.' });
        }

        // Update last active
        session.lastActive = Date.now();
        await session.save();

        // 4. Check if user still exists
        const currentUser = await User.findById(decoded.id);
        if (!currentUser) {
            return res.status(401).json({ message: 'The user belonging to this token no longer exists.' });
        }

        // GRANT ACCESS TO PROTECTED ROUTE
        req.user = currentUser;
        req.sessionId = session._id;
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Invalid token. Please log in again.' });
    }
};

exports.getSessions = async (req, res) => {
    try {
        console.log('Fetching sessions for user:', req.user._id);
        const sessions = await Session.find({ userId: req.user._id }).sort('-lastActive');
        console.log('Found sessions:', sessions.length);
        
        res.status(200).json({
            status: 'success',
            results: sessions.length,
            sessions: sessions.map(s => ({
                id: s._id,
                ipAddress: s.ipAddress,
                device: s.device,
                lastActive: s.lastActive,
                isCurrent: req.cookies.refreshToken ? s.tokenHash === hashToken(req.cookies.refreshToken) : false,
                mfaVerifiedAt: s.mfaVerifiedAt
            }))
        });
    } catch (error) {
        console.error('getSessions Error:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.terminateSession = async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        await Session.findOneAndDelete({ _id: sessionId, userId: req.user._id });
        
        res.status(200).json({
            status: 'success',
            message: 'Session terminated successfully'
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.logout = async (req, res) => {
    try {
        // If protected route, we have sessionId
        if (req.sessionId) {
            await Session.findByIdAndDelete(req.sessionId);
        } else {
            // Fallback for non-protected logout if token provided
            const rawToken = req.cookies.refreshToken;
            if (rawToken) {
                await Session.findOneAndDelete({ tokenHash: hashToken(rawToken) });
            }
        }

        const opts = getCookieOptions(req);
        res.cookie('jwt', 'loggedout', {
            ...opts,
            expires: new Date(Date.now() + 10 * 1000)
        });

        res.cookie('refreshToken', 'loggedout', {
            ...opts,
            expires: new Date(Date.now() + 10 * 1000)
        });

        res.status(200).json({
            status: 'success',
            message: 'Logged out successfully'
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.refreshToken = async (req, res) => {
    try {
        const rawRefreshToken = req.cookies.refreshToken;

        if (!rawRefreshToken) {
            return res.status(401).json({ message: 'No refresh token provided' });
        }

        // 1. Verify token
        const decoded = jwt.verify(rawRefreshToken, process.env.JWT_REFRESH_SECRET);

        // 2. Check if session exists in DB using hash
        const session = await Session.findOne({ tokenHash: hashToken(rawRefreshToken), userId: decoded.id });
        if (!session) {
            return res.status(401).json({ message: 'Session expired or revoked' });
        }

        // 3. Issue new Access Token
        const user = await User.findById(decoded.id);
        if (!user) {
            return res.status(401).json({ message: 'User no longer exists' });
        }

        const accessToken = signAccessToken(user._id);

        const opts = getCookieOptions(req);
        res.cookie('jwt', accessToken, {
            ...opts,
            expires: new Date(Date.now() + 15 * 60 * 1000)
        });

        res.status(200).json({
            status: 'success',
            token: accessToken
        });
    } catch (error) {
        return res.status(401).json({ message: 'Invalid refresh token' });
    }
};

exports.getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json({
            status: 'success',
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                isMfaEnabled: user.isMfaEnabled
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.googleCallback = async (req, res) => {
    try {
        const user = req.user;

        // Strictly check for Admin role
        if (user.role !== 'admin') {
            console.warn(`Unauthorized login attempt by ${user.email}`);
            return res.redirect(`${process.env.ADMIN_URL || 'http://localhost:5173'}?error=unauthorized`);
        }

        // Check if MFA is enabled
        if (user.isMfaEnabled) {
            return res.redirect(`${process.env.ADMIN_URL || 'http://localhost:5173'}?error=mfa_required&userId=${user._id}`);
        }

        // Generate tokens
        const accessToken = signAccessToken(user._id);
        const refreshToken = signRefreshToken(user._id);

        const opts = getCookieOptions(req);

        res.cookie('jwt', accessToken, {
            ...opts,
            expires: new Date(Date.now() + 15 * 60 * 1000)
        });

        res.cookie('refreshToken', refreshToken, {
            ...opts,
            expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        });

        // Track Session in DB using hashed Refresh Token
        const parser = new UAParser(req.headers['user-agent']);
        const ua = parser.getResult();
        
        await Session.create({
            userId: user._id,
            tokenHash: hashToken(refreshToken),
            ipAddress: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            userAgent: req.headers['user-agent'],
            device: {
                browser: `${ua.browser.name || 'Unknown'} ${ua.browser.version || ''}`,
                os: `${ua.os.name || 'Unknown'} ${ua.os.version || ''}`,
                device: ua.device.model || 'Desktop'
            }
        });

        // Redirect to admin - cookies are already set by the server
        res.redirect(`${process.env.ADMIN_URL || 'http://localhost:5173'}?auth=success`);
    } catch (error) {
        console.error('Google Auth Callback Error:', error);
        res.redirect(`${process.env.ADMIN_URL || 'http://localhost:5173'}?error=auth_failed`);
    }
};

// Step-up MFA Verification (Action Level)
exports.verifyMfaStepup = async (req, res) => {
    try {
        const { token } = req.body;
        const user = await User.findById(req.user.id).select('+mfaSecret');

        if (!user.isMfaEnabled) {
            return res.status(400).json({ message: 'MFA not set up. Please enable MFA in security settings first.' });
        }

        const verified = speakeasy.totp.verify({
            secret: user.mfaSecret,
            encoding: 'base32',
            token
        });

        if (!verified) {
            return res.status(401).json({ message: 'Invalid MFA token' });
        }

        // Elevate the current session
        const session = await Session.findById(req.sessionId);
        session.mfaVerifiedAt = Date.now();
        await session.save();

        res.status(200).json({
            status: 'success',
            message: 'Session elevated successfully'
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Middleware to require MFA elevation for sensitive actions
exports.requireElevatedSession = async (req, res, next) => {
    try {
        // First run regular protection
        if (!req.user) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        // Check if MFA is enabled for this admin
        if (!req.user.isMfaEnabled) {
            return res.status(403).json({ 
                status: 'mfa_setup_required',
                message: 'MFA must be enabled for this action. Please go to Security settings.' 
            });
        }

        const session = await Session.findById(req.sessionId);
        
        // Check if MFA was verified within the last 1 hour (3,600,000 ms)
        const ELEVATION_TIMEOUT = 60 * 60 * 1000;
        const now = Date.now();
        
        if (!session.mfaVerifiedAt || (now - session.mfaVerifiedAt > ELEVATION_TIMEOUT)) {
            return res.status(403).json({ 
                status: 'mfa_required',
                message: 'MFA verification required for this sensitive action.' 
            });
        }

        next();
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
