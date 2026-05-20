require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const { cloudinary } = require('../config/cloudinary');
const Year = require('../models/Year');
const Issue = require('../models/Issue');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SOURCE_DIR = path.join(__dirname, '../../frontend/public/assets/2nd-merger-pdf');
const TEMP_DIR = path.join(__dirname, '../temp_uploads');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const FOLDER_MAP = {
    '19 March': { year: 2019, order: 1 },
    '20 March': { year: 2020, order: 1 },
    '20 September': { year: 2020, order: 2 },
    '21 March': { year: 2021, order: 1 },
    '21 September': { year: 2021, order: 2 },
    '22 March': { year: 2022, order: 1 },
    '23 March': { year: 2023, order: 1 }
};

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
            .replace(/^compressed_/, '')
            .replace(/[^a-zA-Z0-9.\-_]/g, '_');
            
        const result = await cloudinary.uploader.upload(filePath, {
            folder: 'spectra_issues',
            resource_type: 'raw',
            public_id: `${baseName}_${Date.now()}`
        });
        return { url: result.secure_url, id: result.public_id };
    } catch (e) {
        throw new Error(`Cloudinary upload failed: ${e.message}`);
    }
}

async function ensureIssue(yearNum, issueOrder) {
    let yearDoc = await Year.findOne({ year: yearNum });
    if (!yearDoc) {
        yearDoc = await Year.create({ year: yearNum });
        console.log(`   🆕 Created Year: ${yearNum}`);
    }
    
    let issue1 = await Issue.findOne({ year: yearDoc._id, order: 1 });
    if (!issue1) {
        issue1 = await Issue.create({ year: yearDoc._id, title: `Issue 1 (Jan-Jun)`, order: 1 });
        console.log(`   🆕 Created Issue 1 for Year: ${yearNum}`);
    }
    
    let issue2 = await Issue.findOne({ year: yearDoc._id, order: 2 });
    if (!issue2) {
        issue2 = await Issue.create({ year: yearDoc._id, title: `Issue 2 (Jul-Dec)`, order: 2 });
        console.log(`   🆕 Created Issue 2 for Year: ${yearNum}`);
    }
    
    return issueOrder === 1 ? issue1 : issue2;
}

function resolvePdfTitle(fileName) {
    const lower = fileName.toLowerCase();
    let title = '';
    
    if (lower.includes('content') || lower.includes('editorial')) {
        title = 'Table of Contents & Editorial';
    } else if (lower === '2.pdf') {
        title = 'Table of Contents & Editorial';
    } else {
        title = 'Full Issue PDF';
    }
    
    if (lower.includes('part 1') || lower.includes('part i') || lower.includes('part_1') || lower.includes('part_i')) {
        title += ' (Part 1)';
    } else if (lower.includes('part 2') || lower.includes('part ii') || lower.includes('part_2') || lower.includes('part_ii')) {
        title += ' (Part 2)';
    }
    
    return title;
}

async function run() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB.');

        if (!fs.existsSync(SOURCE_DIR)) {
            console.error(`Source directory not found: ${SOURCE_DIR}`);
            process.exit(1);
        }

        const folders = fs.readdirSync(SOURCE_DIR)
            .filter(f => fs.statSync(path.join(SOURCE_DIR, f)).isDirectory());

        console.log(`Found ${folders.length} merger folders to process.`);

        let totalSuccess = 0;
        let totalFailed = 0;

        for (const folderName of folders) {
            const config = FOLDER_MAP[folderName];
            if (!config) {
                console.log(`\n⚠ Skipping unknown folder: "${folderName}"`);
                continue;
            }

            const folderPath = path.join(SOURCE_DIR, folderName);
            console.log(`\n📂 Processing merger folder: "${folderName}" (Year ${config.year}, Issue Order ${config.order})`);

            // Ensure the issue exists in DB
            const issueDoc = await ensureIssue(config.year, config.order);

            // Get all PDF files in this folder
            const pdfFiles = fs.readdirSync(folderPath)
                .filter(f => f.toLowerCase().endsWith('.pdf'));

            // Sort them so that main PDF is first, and Content/Part 2 files come next
            pdfFiles.sort((a, b) => {
                const aTitle = resolvePdfTitle(a);
                const bTitle = resolvePdfTitle(b);
                if (aTitle.includes('Full Issue') && !bTitle.includes('Full Issue')) return -1;
                if (!aTitle.includes('Full Issue') && bTitle.includes('Full Issue')) return 1;
                return a.localeCompare(b);
            });

            console.log(`   Found ${pdfFiles.length} PDFs to process.`);

            // Reset current issue pdfs array to start fresh or keep previous ones.
            // Since we want to load all files in correct order, let's start with an empty array for this run
            issueDoc.pdfs = [];

            for (const pdfFile of pdfFiles) {
                const pdfPath = path.join(folderPath, pdfFile);
                const title = resolvePdfTitle(pdfFile);
                const tempOutputPath = path.join(TEMP_DIR, `compressed_${pdfFile.replace(/\s+/g, '_')}`);

                console.log(`\n   📄 File: "${pdfFile}" -> Display Title: "${title}"`);
                try {
                    const stats = fs.statSync(pdfPath);
                    const sizeMB = stats.size / (1024 * 1024);

                    let finalUrl = '';
                    let finalCloudinaryId = '';

                    // If file is very small (< 1.5MB), don't compress, just upload directly
                    if (sizeMB < 1.5) {
                        console.log(`      Small file (${sizeMB.toFixed(2)} MB). Skipping Ghostscript compression.`);
                        console.log(`      ☁ Uploading original PDF to Cloudinary...`);
                        const { url, id } = await uploadToCloudinary(pdfPath);
                        finalUrl = url;
                        finalCloudinaryId = id;
                    } else {
                        // Compress first
                        let compressedSizeMB = compressPDF(pdfPath, tempOutputPath, '/ebook');

                        // If still too large, use /screen
                        if (compressedSizeMB >= 9.8) {
                            console.log(`      ⚠ /ebook size (${compressedSizeMB.toFixed(2)} MB) still near limit. Retrying with /screen...`);
                            if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
                            compressedSizeMB = compressPDF(pdfPath, tempOutputPath, '/screen');
                        }

                        if (compressedSizeMB >= 9.8) {
                            throw new Error(`File is too large even after /screen compression: ${compressedSizeMB.toFixed(2)} MB`);
                        }

                        console.log(`      ☁ Uploading compressed PDF to Cloudinary...`);
                        const { url, id } = await uploadToCloudinary(tempOutputPath);
                        finalUrl = url;
                        finalCloudinaryId = id;

                        // Delete temp file
                        if (fs.existsSync(tempOutputPath)) {
                            fs.unlinkSync(tempOutputPath);
                        }
                    }

                    console.log(`      ✅ Uploaded successfully. URL: ${finalUrl}`);
                    issueDoc.pdfs.push({
                        title: title,
                        pdfUrl: finalUrl,
                        cloudinaryId: finalCloudinaryId
                    });

                    // Delete original file from local public assets to free up git repository size
                    fs.unlinkSync(pdfPath);
                    console.log(`      🗑 Deleted original local file: ${pdfPath}`);

                    totalSuccess++;
                } catch (err) {
                    console.error(`      ❌ Error processing ${pdfFile}: ${err.message}`);
                    totalFailed++;
                    if (fs.existsSync(tempOutputPath)) {
                        fs.unlinkSync(tempOutputPath);
                    }
                }
            }

            // Save the updated issue document with all pdfs
            await issueDoc.save();
            console.log(`   💾 Saved issue in DB with ${issueDoc.pdfs.length} PDF links.`);
        }

        console.log(`\n=== MERGER FILES PROCESSING COMPLETE ===`);
        console.log(`✅ Success: ${totalSuccess}`);
        console.log(`❌ Failed:  ${totalFailed}`);
        process.exit(0);
    } catch (err) {
        console.error('Fatal Error:', err);
        process.exit(1);
    }
}

run();
