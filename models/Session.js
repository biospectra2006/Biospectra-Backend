const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    tokenHash: {
        type: String,
        required: true,
        index: true
    },
    ipAddress: String,
    userAgent: String,
    device: {
        browser: String,
        os: String,
        device: String
    },
    lastActive: {
        type: Date,
        default: Date.now
    },
    mfaVerifiedAt: {
        type: Date
    }
}, { timestamps: true });

// Auto-expire sessions inactive for 30 days
sessionSchema.index({ lastActive: 1 }, { expireAfterSeconds: 2592000 }); // 30 days

module.exports = mongoose.model('Session', sessionSchema);
