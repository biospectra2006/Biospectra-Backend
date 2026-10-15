const About = require('../models/About');
const { cloudinary } = require('../config/cloudinary');
const fs = require('fs');

// Get all sections
exports.getAllSections = async (req, res) => {
    try {
        const sections = await About.find().sort({ order: 1 });
        res.json(sections);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Create a section
exports.createSection = async (req, res) => {
    try {
        const data = { ...req.body };
        if (req.file) {
            try {
                const result = await cloudinary.uploader.upload(req.file.path, {
                    folder: 'spectra_about',
                    transformation: [{ quality: 'auto:good', fetch_format: 'webp' }]
                });
                data.images = [result.secure_url];
                fs.unlink(req.file.path, (err) => {
                    if (err) console.error('Failed to delete temp file:', err);
                });
            } catch (err) {
                console.error('Cloudinary upload error:', err);
            }
        }
        const section = new About(data);
        const newSection = await section.save();
        res.status(201).json(newSection);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// Update a section
exports.updateSection = async (req, res) => {
    try {
        const updateData = { ...req.body };
        if (req.file) {
            try {
                const result = await cloudinary.uploader.upload(req.file.path, {
                    folder: 'spectra_about',
                    transformation: [{ quality: 'auto:good', fetch_format: 'webp' }]
                });
                updateData.images = [result.secure_url];
                fs.unlink(req.file.path, (err) => {
                    if (err) console.error('Failed to delete temp file:', err);
                });
            } catch (err) {
                console.error('Cloudinary upload error in about:', err);
            }
        }

        // If user edited metrics section, sync Settings.sjifNumber
        if (updateData.sectionType === 'metrics' && updateData.content) {
            const Settings = require('../models/Settings');
            const match = updateData.content.match(/([0-9]+\.[0-9]+)/);
            if (match) {
                await Settings.findOneAndUpdate({}, { sjifNumber: match[1] }, { upsert: true });
            }
        }

        const updatedSection = await About.findByIdAndUpdate(req.params.id, updateData, { new: true });
        res.json(updatedSection);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// Delete a section
exports.deleteSection = async (req, res) => {
    try {
        await About.findByIdAndDelete(req.params.id);
        res.json({ message: 'Section deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Bulk create (for initial migration)
exports.bulkCreate = async (req, res) => {
    try {
        if (!Array.isArray(req.body)) {
            return res.status(400).json({ message: 'Request body must be an array' });
        }
        if (req.body.length > 50) {
            return res.status(400).json({ message: 'Maximum 50 items allowed per bulk request' });
        }
        const sections = await About.insertMany(req.body);
        res.status(201).json(sections);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};
