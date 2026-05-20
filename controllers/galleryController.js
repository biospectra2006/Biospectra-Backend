const Gallery = require('../models/Gallery');
const { cloudinary } = require('../config/cloudinary');
const fs = require('fs');
const path = require('path');

// GET all gallery images
exports.getGalleryImages = async (req, res) => {
    try {
        const images = await Gallery.find().sort({ order: 1, createdAt: -1 });
        res.json(images);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// POST — upload a new gallery image (compressed via Cloudinary transformations, fallback to local)
exports.uploadGalleryImage = async (req, res) => {
    try {
        const { title, description, category, order } = req.body;

        if (!req.file) {
            return res.status(400).json({ message: 'No image file uploaded' });
        }

        let imageUrl = '';
        let cloudinaryId = '';

        try {
            console.log('Attempting Cloudinary upload for gallery image:', req.file.filename);
            const result = await cloudinary.uploader.upload(req.file.path, {
                folder: 'spectra_gallery',
                transformation: [
                    { width: 1200, crop: 'limit', quality: 'auto:good', fetch_format: 'webp' }
                ]
            });
            imageUrl = result.secure_url;
            cloudinaryId = result.public_id;

            // Delete temp file asynchronously
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Failed to delete temp file:', err);
            });
        } catch (cloudinaryError) {
            console.warn('Cloudinary upload failed for gallery, falling back to local storage:', cloudinaryError.message);

            // Fallback: move file to permanent local storage
            const targetDir = path.join(__dirname, '../../frontend/public/gallery');
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            const targetPath = path.join(targetDir, req.file.filename);
            fs.renameSync(req.file.path, targetPath);

            imageUrl = `/gallery/${req.file.filename}`;
            cloudinaryId = '';
        }

        const newImage = new Gallery({
            title: title || 'Untitled',
            description: description || '',
            imageUrl,
            cloudinaryId,
            category: category || 'general',
            order: order ? parseInt(order) : 0,
        });

        await newImage.save();
        res.status(201).json(newImage);
    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(400).json({ message: error.message });
    }
};

// PUT — update gallery image metadata
exports.updateGalleryImage = async (req, res) => {
    try {
        const { title, description, category, order } = req.body;
        const image = await Gallery.findByIdAndUpdate(
            req.params.id,
            { title, description, category, order: parseInt(order) || 0 },
            { new: true }
        );
        if (!image) return res.status(404).json({ message: 'Image not found' });
        res.json(image);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// DELETE — remove image from DB and Cloudinary/local storage
exports.deleteGalleryImage = async (req, res) => {
    try {
        const image = await Gallery.findById(req.params.id);
        if (!image) return res.status(404).json({ message: 'Image not found' });

        if (image.imageUrl && image.imageUrl.startsWith('/gallery/')) {
            // Delete from local disk
            const localPath = path.join(__dirname, '../../frontend/public', image.imageUrl);
            if (fs.existsSync(localPath)) {
                fs.unlinkSync(localPath);
                console.log('Deleted local gallery image file:', localPath);
            }
        } else if (image.cloudinaryId) {
            // Delete from Cloudinary
            await cloudinary.uploader.destroy(image.cloudinaryId);
            console.log('Deleted Cloudinary gallery image:', image.cloudinaryId);
        }

        // Delete from DB
        await Gallery.findByIdAndDelete(req.params.id);

        res.json({ message: 'Image deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
