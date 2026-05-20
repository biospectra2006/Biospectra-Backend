const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure destination folder exists
const destDir = path.join(__dirname, '../../frontend/public/pdf biospectra');
if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, destDir);
    },
    filename: (req, file, cb) => {
        // Safe filename: sanitize original name and append timestamp to avoid collisions
        const sanitized = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const nameWithoutExt = sanitized.substring(0, sanitized.lastIndexOf('.')) || sanitized;
        const ext = '.pdf'; // We enforce PDF anyway
        cb(null, `${nameWithoutExt}_${Date.now()}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max upload size before compression
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed for article uploads'), false);
        }
    }
});

module.exports = { upload };
