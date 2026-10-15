const Settings = require('../models/Settings');
const { cloudinary } = require('../config/cloudinary');
const { validateFileContent, JPEG_MAGIC } = require('../config/multerTemp');
const fs = require('fs');
const path = require('path');

// GET settings (always returns a single document, creates if doesn't exist)
exports.getSettings = async (req, res) => {
    try {
        let settings = await Settings.findOne();
        if (!settings) {
            settings = await Settings.create({});
        }
        res.json(settings);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// PUT settings
exports.updateSettings = async (req, res) => {
    try {
        const { 
            sjifNumber,
            contactPhone,
            contactWhatsapp,
            contactEmail,
            contactAddress,
            workingHours
        } = req.body;
        let settings = await Settings.findOne();
        
        if (!settings) {
            settings = new Settings();
        }

        if (sjifNumber) {
            settings.sjifNumber = sjifNumber;
            // Also keep About collection metrics section in sync
            try {
                const About = require('../models/About');
                await About.findOneAndUpdate(
                    { sectionType: 'metrics' },
                    { content: `SJIF ${sjifNumber}` }
                );
            } catch (syncErr) {
                console.error('Failed to sync About metrics:', syncErr);
            }
        }

        if (contactPhone !== undefined) settings.contactPhone = contactPhone;
        if (contactWhatsapp !== undefined) settings.contactWhatsapp = contactWhatsapp;
        if (contactEmail !== undefined) settings.contactEmail = contactEmail;
        if (contactAddress !== undefined) settings.contactAddress = contactAddress;
        if (workingHours !== undefined) settings.workingHours = workingHours;

        // Process hero image if uploaded
        if (req.files && req.files.heroImage && req.files.heroImage[0]) {
            const file = req.files.heroImage[0];
            try {
                const result = await cloudinary.uploader.upload(file.path, {
                    folder: 'spectra_settings',
                    transformation: [{ quality: 'auto:good', fetch_format: 'webp' }]
                });
                settings.heroImageUrl = result.secure_url;
                
                fs.unlink(file.path, (err) => {
                    if (err) console.error('Failed to delete temp file:', err);
                });
            } catch (err) {
                console.error('Cloudinary heroImage upload error:', err);
            }
        }

        // Process certificate image if uploaded
        if (req.files && req.files.certificateImage && req.files.certificateImage[0]) {
            const file = req.files.certificateImage[0];
            try {
                const result = await cloudinary.uploader.upload(file.path, {
                    folder: 'spectra_settings',
                    transformation: [{ quality: 'auto:good', fetch_format: 'webp' }]
                });
                settings.certificateImageUrl = result.secure_url;
                
                fs.unlink(file.path, (err) => {
                    if (err) console.error('Failed to delete temp file:', err);
                });
            } catch (err) {
                console.error('Cloudinary certificateImage upload error:', err);
            }
        }

        await settings.save();
        res.json(settings);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
