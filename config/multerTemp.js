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

const checkMagicBytes = (filePath, magic) => {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(magic.length);
        fs.readSync(fd, buf, 0, magic.length, 0);
        fs.closeSync(fd);
        return buf.equals(magic);
    } catch {
        return false;
    }
};

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
const JPEG_MAGIC = Buffer.from([0xFF, 0xD8, 0xFF]);

const validateFileContent = (filePath, allowedTypes) => {
    for (const t of allowedTypes) {
        if (checkMagicBytes(filePath, t.magic)) return true;
    }
    return false;
};

const articleFilter = (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
        return cb(new Error('Only PDF files are allowed for article uploads'), false);
    }
    cb(null, true);
};

const galleryFilter = (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
        return cb(new Error('Only image files are allowed for gallery uploads'), false);
    }
    cb(null, true);
};

const articleUpload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: articleFilter
});

const galleryUpload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: galleryFilter
});

module.exports = { articleUpload, galleryUpload, validateFileContent, PDF_MAGIC, JPEG_MAGIC };
