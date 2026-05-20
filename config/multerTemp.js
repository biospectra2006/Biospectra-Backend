const multer = require('multer');
const path = require('path');
const fs = require('fs');

const tempDir = path.join(__dirname, '../temp_uploads');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, tempDir);
    },
    filename: (req, file, cb) => {
        const sanitized = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const nameWithoutExt = sanitized.substring(0, sanitized.lastIndexOf('.')) || sanitized;
        const ext = path.extname(file.originalname);
        cb(null, `${nameWithoutExt}_${Date.now()}${ext}`);
    }
});

const articleUpload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed for article uploads'), false);
        }
    }
});

const galleryUpload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed for gallery uploads'), false);
        }
    }
});

module.exports = { articleUpload, galleryUpload };
