/**
 * compress_and_upload_fallbacks.js
 * Finds articles with local file URLs (pdfUrl starting with /pdf biospectra/),
 * compresses those PDFs via Ghostscript (gswin64c), uploads to Cloudinary,
 * updates the DB records, and deletes local originals.
 * Run: node scripts/compress_and_upload_fallbacks.js
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const { cloudinary } = require('../config/cloudinary');
const Article = require('../models/Article');
const Year = require('../models/Year');
const Issue = require('../models/Issue');
const Category = require('../models/Category');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PUBLIC_DIR = path.join(__dirname, '../../frontend/public');
const TEMP_DIR = path.join(__dirname, '../temp_uploads');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Function to compress PDF using Ghostscript (gswin64c)
function compressPDF(inputPath, outputPath, settings = '/ebook') {
    try {
        console.log(`      Compressing PDF with settings: ${settings}...`);
        const cmd = `gswin64c -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=${settings} -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outputPath}" "${inputPath}"`;
        execSync(cmd, { stdio: 'inherit' });
        
        const origSize = fs.statSync(inputPath).size / (1024 * 1024);
        const compSize = fs.statSync(outputPath).size / (1024 * 1024);
        console.log(`      Original Size: ${origSize.toFixed(2)} MB → Compressed Size: ${compSize.toFixed(2)} MB`);
        return compSize;
    } catch (err) {
        throw new Error(`Ghostscript compression failed: ${err.message}`);
    }
}

async function uploadToCloudinary(filePath) {
    try {
        const baseName = path.basename(filePath, '.pdf')
            .replace(/_compressed$/, '')
            .replace(/_[0-9]+$/, '') // strip timestamp
            .replace(/[^a-zA-Z0-9.\-_]/g, '_');
            
        const result = await cloudinary.uploader.upload(filePath, {
            folder: 'spectra_articles',
            resource_type: 'raw',
            public_id: `${baseName}_${Date.now()}`
        });
        return { url: result.secure_url, id: result.public_id };
    } catch (e) {
        throw new Error(`Cloudinary upload failed: ${e.message}`);
    }
}

async function run() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB.');

        // Find all articles that are stored locally
        const localArticles = await Article.find({ pdfUrl: { $regex: /^\/pdf biospectra\// } });
        console.log(`Found ${localArticles.length} articles with local storage URLs.`);

        if (localArticles.length === 0) {
            console.log('No local articles to compress and upload.');
            process.exit(0);
        }

        let successCount = 0;
        let skipCount = 0;
        let failCount = 0;

        for (let i = 0; i < localArticles.length; i++) {
            const article = localArticles[i];
            const relativePath = article.pdfUrl;
            const inputPath = path.join(PUBLIC_DIR, relativePath);
            const fileName = path.basename(relativePath);

            console.log(`\n[${i + 1}/${localArticles.length}] Processing article: "${article.title}"`);
            console.log(`   Local File: ${inputPath}`);

            if (!fs.existsSync(inputPath)) {
                console.warn(`   ⚠ Local file not found: ${inputPath}. Skipping.`);
                skipCount++;
                continue;
            }

            const tempOutputPath = path.join(TEMP_DIR, `compressed_${fileName}`);
            
            try {
                // Try /ebook settings first (150 dpi)
                let compressedSizeMB = compressPDF(inputPath, tempOutputPath, '/ebook');
                
                // If it's still too large (>= 9.8 MB), try /screen settings (72 dpi)
                if (compressedSizeMB >= 9.8) {
                    console.log(`   ⚠ /ebook size (${compressedSizeMB.toFixed(2)} MB) is still close to or above 10MB limit. Retrying with /screen...`);
                    fs.unlinkSync(tempOutputPath);
                    compressedSizeMB = compressPDF(inputPath, tempOutputPath, '/screen');
                }

                if (compressedSizeMB >= 9.8) {
                    throw new Error(`Compressed file size (${compressedSizeMB.toFixed(2)} MB) still exceeds Cloudinary 10MB limit.`);
                }

                console.log(`   ☁ Uploading compressed PDF to Cloudinary...`);
                const { url, id } = await uploadToCloudinary(tempOutputPath);

                console.log(`   ✅ Uploaded to Cloudinary successfully.`);
                console.log(`      New URL: ${url}`);
                console.log(`      New Cloudinary ID: ${id}`);

                // Update database
                article.pdfUrl = url;
                article.cloudinaryId = id;
                await article.save();
                console.log(`   💾 DB updated successfully.`);

                // Delete local file and temp compressed file
                fs.unlinkSync(inputPath);
                console.log(`   🗑 Deleted old local file: ${inputPath}`);
                
                fs.unlinkSync(tempOutputPath);
                console.log(`   🗑 Deleted temp compressed file: ${tempOutputPath}`);

                successCount++;
            } catch (err) {
                console.error(`   ❌ Failed to process: ${err.message}`);
                failCount++;
                if (fs.existsSync(tempOutputPath)) {
                    fs.unlinkSync(tempOutputPath);
                }
            }
        }

        console.log(`\n=== COMPRESSION AND CLOUDINARY UPLOAD COMPLETE ===`);
        console.log(`✅ Successfully compressed and uploaded: ${successCount}`);
        console.log(`⏩ Skipped (not found):                  ${skipCount}`);
        console.log(`❌ Failed:                              ${failCount}`);

        process.exit(0);
    } catch (err) {
        console.error('Fatal Error:', err);
        process.exit(1);
    }
}

run();
