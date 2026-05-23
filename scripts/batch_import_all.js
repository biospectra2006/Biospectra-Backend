/**
 * batch_import_all.js
 * Bulk import PDFs from local folder (C:/Users/Asus/Downloads/bb/Pdf Biospectra) into MongoDB + Cloudinary.
 * Reads year/month folders → category subfolders → PDFs, extracts title/authors/abstract via pdf-parse,
 * uploads to Cloudinary, and creates Year → Issue → Category → Article hierarchy in DB.
 * Run: node scripts/batch_import_all.js
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const pdfParse = require('pdf-parse');
const https = require('https');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Year = require('../models/Year');
const Issue = require('../models/Issue');
const Category = require('../models/Category');
const Article = require('../models/Article');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const UPLOAD_PRESET = 'biospectra_upload';
const PDF_ROOT = 'C:/Users/Asus/Downloads/bb/Pdf Biospectra';
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const MONTH_MAP = {
    'march': 1,
    'september': 2,
    'december': 2
};

const CATEGORY_MAP = {
    'animal': 'Animal Science',
    'animal-scince': 'Animal Science',
    'animal scince': 'Animal Science',
    'animal science': 'Animal Science',
    'animal sciences': 'Animal Science',
    'plant': 'Plant Science',
    'plamt': 'Plant Science',
    'plant science': 'Plant Science',
    'plant sciences': 'Plant Science',
    'environmental': 'Environmental Science',
    'environmental science': 'Environmental Science',
    'environmental sciences': 'Environmental Science',
    'enviromental science': 'Environmental Science',
    'enviornmental science': 'Environmental Science',
    'interdisciplinary': 'Interdisciplinary Science',
    'interdisciplinary science': 'Interdisciplinary Science',
    'interdisciplinary sciences': 'Interdisciplinary Science',
    'transdisciplinary science': 'Transdisciplinary Science',
    'transdisciplinary sciences': 'Transdisciplinary Science',
    'medical science': 'Medical Sciences',
    'medical sciences': 'Medical Sciences',
};

const SECTION_NAMES = Object.values(CATEGORY_MAP).filter((v, i, a) => a.indexOf(v) === i);

function normalizeCategory(folderName) {
    const key = folderName.toLowerCase().trim().replace(/\s+/g, ' ');
    return CATEGORY_MAP[key] || 'Research Articles';
}

function uploadWithPreset(filePath) {
    return new Promise((resolve, reject) => {
        const boundary = '----FormBoundary' + Date.now();
        const fileBuf = fs.readFileSync(filePath);
        const fileName = path.basename(filePath);

        const parts = [
            { name: 'upload_preset', value: UPLOAD_PRESET },
            { name: 'folder', value: 'spectra_articles' },
            { name: 'resource_type', value: 'raw' },
        ];

        let bodyBuf = Buffer.alloc(0);
        for (const p of parts) {
            const header = `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`;
            bodyBuf = Buffer.concat([bodyBuf, Buffer.from(header)]);
        }

        const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/pdf\r\n\r\n`;
        bodyBuf = Buffer.concat([bodyBuf, Buffer.from(fileHeader), fileBuf, Buffer.from(`\r\n--${boundary}--\r\n`)]);

        const opts = {
            hostname: 'api.cloudinary.com',
            path: `/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/raw/upload`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': bodyBuf.length,
            }
        };

        const req = https.request(opts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(JSON.parse(data));
                } else {
                    reject(new Error(`Upload ${res.statusCode}: ${data.slice(0, 200)}`));
                }
            });
        });
        req.on('error', reject);
        req.write(bodyBuf);
        req.end();
    });
}

async function extractPdfInfo(filePath, fileName) {
    try {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        const allLines = data.text.split('\n').map(line => line.replace(/\s+/g, ' ').trim());

        const metadataLines = allLines.slice(0, 100).map(line => {
            let cleanedLine = line.replace(/Biospectra\s*:\s*Vol\.[^\n]*/i, '');
            cleanedLine = cleanedLine.replace(/Biospectra/i, '').trim();
            return cleanedLine;
        }).filter(line => {
            const lower = line.toLowerCase();
            const hasSection = SECTION_NAMES.some(s => lower.includes(s.toLowerCase()));
            if (hasSection) return true;
            return !lower.includes('vol.') &&
                !lower.includes('no.') &&
                !lower.startsWith('issn') &&
                !lower.includes('page') &&
                !lower.includes('http') &&
                !lower.includes('www.') &&
                !lower.includes('database index') &&
                !lower.includes('international biannual') &&
                line.length > 5;
        });

        let title = 'Research Article';
        let maxScore = -1;
        let bestIdx = 0;

        for (let i = 0; i < Math.min(metadataLines.length, 25); i++) {
            const line = metadataLines[i];
            const lower = line.toLowerCase();

            if (lower.startsWith('abstract')) break;
            if (lower.includes('received') || lower.includes('revised')) continue;
            if (lower.includes('department of') || lower.includes('dept.') || lower.includes('university')) continue;
            if (lower.includes('correspondent') || lower.includes('e-mail') || lower.includes('phone')) continue;
            if (lower.includes('proceedings') || lower.includes('conference') || lower.includes('organised')) continue;
            if (lower.includes('bihar') || lower.includes('india') || lower.includes('pradesh')) continue;

            let score = line.length;
            if (line.includes('*') || line.includes('&')) score -= 60;
            if (line.length < 20) score -= 40;
            if (/^[A-Z]/.test(line)) score += 20;
            if (SECTION_NAMES.some(s => lower.includes(s.toLowerCase()))) score -= 100;

            if (score > maxScore) {
                maxScore = score;
                title = line;
                bestIdx = i;
            }
        }

        if (bestIdx + 1 < metadataLines.length) {
            const nextLine = metadataLines[bestIdx + 1];
            const nextLower = nextLine.toLowerCase();
            if (nextLine.length > 25 &&
                !nextLower.includes('received') &&
                !nextLower.startsWith('abstract') &&
                !nextLine.includes('*') &&
                !nextLine.includes('&') &&
                !nextLower.includes('dept')) {
                title += ' ' + nextLine;
            }
        }

        if (!title || title.length < 10 || title.toLowerCase().startsWith('abstract')) {
            title = `Research Article (Pages ${fileName.replace('.pdf', '')})`;
        }

        const abstractIdx = allLines.findIndex(l => l.toLowerCase().startsWith('abstract'));
        let authors = 'Biospectra Contributor';
        let abstract = '';

        if (abstractIdx !== -1) {
            const fullText = allLines.slice(abstractIdx).join(' ');
            const lowerText = fullText.toLowerCase();
            let startPos = lowerText.indexOf('abstract');
            if (startPos !== -1) {
                startPos += 8;
                while ([' ', ':', '-', '.'].includes(fullText[startPos])) startPos++;
                let endPos = lowerText.indexOf('key words', startPos);
                if (endPos === -1) endPos = lowerText.indexOf('keywords', startPos);
                if (endPos === -1) endPos = lowerText.indexOf('introduction', startPos);
                if (endPos === -1) endPos = startPos + 1200;
                const extracted = fullText.substring(startPos, endPos).trim();
                if (extracted.length > 50) abstract = extracted;
            }
        }

        // Only search for authors BEFORE abstract/keywords in metadataLines
        const abstractInMeta = metadataLines.findIndex(l => l.toLowerCase().startsWith('abstract'));
        const keywordsInMeta = metadataLines.findIndex(l => l.toLowerCase().startsWith('key words'));
        const searchLimit = Math.min(
            abstractInMeta !== -1 ? abstractInMeta : Infinity,
            keywordsInMeta !== -1 ? keywordsInMeta : Infinity,
            50
        );

        const authorIdx = metadataLines.findIndex((l, idx) => {
            if (idx >= searchLimit || idx >= 50) return false;
            const lower = l.toLowerCase();
            if (title && l.includes(title)) return false;
            if (lower.includes('corresponding author') || lower.includes('correspondent author')) return false;
            if (lower.includes('phone') || lower.includes('mobile') || lower.includes('e-mail')) return false;
            if (lower.includes('method') || lower.includes('result') || lower.includes('discussion')) return false;
            if (lower.includes('department of') || lower.includes('dept.') || lower.includes('university')) return false;
            if (lower.includes('institute') || lower.includes('laboratory') || lower.includes('college')) return false;
            if (lower.includes('received') || lower.includes('revised')) return false;
            if (lower.includes('bihar') || lower.includes('india') || lower.includes('patna')) return false;
            // Only match if line looks like it contains author names
            const containsNameLike = (l.match(/[A-Z][a-z]+\b/g) || []).length >= 2;
            const hasMarker = l.includes('*') || l.includes('&');
            return hasMarker && containsNameLike;
        });
        if (authorIdx !== -1) {
            let raw = metadataLines[authorIdx];
            raw = raw.replace(/[\d\*†‡§&¶#]+/g, '').replace(/\s+/g, ' ').replace(/,\s*,/g, ',').replace(/^[,\s]+|[,\s]+$/g, '').trim();
            raw = raw.replace(/,?\s*(Department|Dept\.?|University|College|Institute|Laboratory|Lab|ICAR|Centre|Center|Road|P\.?O\.?).*/i, '').trim();
            if (raw.length > 3) authors = raw;
        }

        const pages = fileName.replace('.pdf', '').replace(/^\./, '');
        const pagesMatch = pages.match(/(\d+)\s*-?\s*(\d+)/);
        const displayPages = pagesMatch ? `${pagesMatch[1]}-${pagesMatch[2]}` : pages;

        return { title, authors, abstract, pages: displayPages, content: data.text };
    } catch (error) {
        return null;
    }
}

async function ensureHierarchy(yearNum, issueOrder, categoryName) {
    let yearDoc = await Year.findOne({ year: yearNum });
    if (!yearDoc) {
        yearDoc = await Year.create({ year: yearNum });
        console.log(`   Created Year: ${yearNum}`);
    }

    let issueDoc = await Issue.findOne({ year: yearDoc._id, order: issueOrder });
    if (!issueDoc) {
        const title = issueOrder === 1 ? 'Issue 1 (Jan-Jun)' : 'Issue 2 (Jul-Dec)';
        issueDoc = await Issue.create({ year: yearDoc._id, title, order: issueOrder });
        console.log(`   Created Issue: ${title}`);
    }

    let categoryDoc = await Category.findOne({ issue: issueDoc._id, title: categoryName });
    if (!categoryDoc) {
        categoryDoc = await Category.create({ issue: issueDoc._id, title: categoryName });
        console.log(`   Created Category: ${categoryName}`);
    }

    return categoryDoc;
}

function ask(question) {
    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, answer => { rl.close(); resolve(answer); });
    });
}

function askYesNo(question) {
    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, answer => {
            rl.close();
            const a = answer.toLowerCase().trim();
            resolve(a === 'y' || a === 'yes');
        });
    });
}

async function main() {
    console.log('=== BIOSPECTRA BATCH IMPORT ===\n');

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    const folders = fs.readdirSync(PDF_ROOT)
        .filter(f => fs.statSync(path.join(PDF_ROOT, f)).isDirectory());

    console.log(`Found ${folders.length} year folders to process\n`);

    let totalSuccess = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const folderName of folders) {
        const folderPath = path.join(PDF_ROOT, folderName);
        const match = folderName.trim().match(/^(\d{2})\s+(.+)$/i);

        if (!match) {
            console.log(`⚠  Skipping folder "${folderName}" - could not parse year`);
            continue;
        }

        const yearShort = match[1];
        const monthRaw = match[2].toLowerCase().trim();
        const yearFull = 2000 + parseInt(yearShort);
        const issueOrder = MONTH_MAP[monthRaw];

        if (!issueOrder) {
            console.log(`⚠  Skipping "${folderName}" - unknown month "${monthRaw}"`);
            continue;
        }

        const proceed = await askYesNo(`\n📁 Import ${folderName} → ${yearFull} | ${issueOrder === 1 ? 'March' : 'September'}? (y/n): `);
        if (!proceed) {
            console.log('   Skipped.\n');
            continue;
        }

        const categoryFolders = fs.readdirSync(folderPath)
            .filter(f => fs.statSync(path.join(folderPath, f)).isDirectory());

        console.log(`\n📁 ${folderName} → ${yearFull} | ${issueOrder === 1 ? 'March' : 'September'}`);

        for (const catFolder of categoryFolders) {
            const catPath = path.join(folderPath, catFolder);
            const categoryName = normalizeCategory(catFolder);
            const pdfs = fs.readdirSync(catPath).filter(f => f.toLowerCase().endsWith('.pdf')).sort();

            if (pdfs.length === 0) {
                console.log(`   📂 ${catFolder} → ${categoryName} (0 PDFs)`);
                continue;
            }

            console.log(`   📂 ${catFolder} → ${categoryName} (${pdfs.length} PDFs)`);

            let catSuccess = 0, catSkipped = 0, catFailed = 0;

            let categoryDoc;
            try {
                categoryDoc = await ensureHierarchy(yearFull, issueOrder, categoryName);
            } catch (err) {
                console.log(`      ❌ Failed to create hierarchy: ${err.message}`);
                totalFailed += pdfs.length;
                continue;
            }

            for (const pdfFile of pdfs) {
                const pdfPath = path.join(catPath, pdfFile);

                try {
                    const stats = fs.statSync(pdfPath);
                    if (stats.size < 1024) {
                        console.log(`      ⏩ ${pdfFile} (too small, skipping)`);
                        totalSkipped++;
                        continue;
                    }
                    if (stats.size > MAX_FILE_SIZE) {
                        console.log(`      ⏩ ${pdfFile} (too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB > 10MB)`);
                        totalSkipped++;
                        continue;
                    }

                    const pagesMatch = pdfFile.replace('.pdf', '').match(/(\d+)\s*-?\s*(\d+)/);
                    const existingPages = pagesMatch ? `${pagesMatch[1]}-${pagesMatch[2]}` : pdfFile.replace('.pdf', '');
                    const existing = await Article.findOne({ pages: existingPages, category: categoryDoc._id });
                    if (existing) {
                        console.log(`      ✅ ${pdfFile} (already exists)`);
                        totalSkipped++;
                        continue;
                    }

                    const info = await extractPdfInfo(pdfPath, pdfFile);
                    if (!info) {
                        console.log(`      ❌ ${pdfFile} (failed to parse)`);
                        totalFailed++;
                        continue;
                    }

                    let uploadResult;
                    try {
                        uploadResult = await uploadWithPreset(pdfPath);
                    } catch (uploadErr) {
                        console.log(`      ❌ ${pdfFile} (upload failed: ${uploadErr.message.slice(0, 80)})`);
                        totalFailed++;
                        continue;
                    }

                    await Article.create({
                        category: categoryDoc._id,
                        title: info.title,
                        authors: info.authors,
                        abstract: info.abstract || '',
                        keywords: [],
                        pages: info.pages,
                        pdfUrl: uploadResult.secure_url,
                        cloudinaryId: uploadResult.public_id,
                        content: info.content,
                    });

                    console.log(`      ✅ ${pdfFile}`);
                    catSuccess++;
                } catch (err) {
                    console.log(`      ❌ ${pdfFile} (${err.message.slice(0, 100)})`);
                    totalFailed++;
                }
            }

            totalSuccess += catSuccess;
            totalSkipped += catSkipped;
            totalFailed += catFailed;
            console.log(`      → ${catSuccess} imported, ${catSkipped} skipped, ${catFailed} failed`);
        }

        console.log(`   📊 Year total so far: ${totalSuccess} success, ${totalSkipped} skipped, ${totalFailed} failed`);
    }

    console.log(`\n\n=== IMPORT COMPLETE ===`);
    console.log(`   ✅ Success: ${totalSuccess}`);
    console.log(`   ⏩ Skipped: ${totalSkipped}`);
    console.log(`   ❌ Failed:  ${totalFailed}`);

    await mongoose.disconnect();
    console.log('\nDone.');
}

main().catch(err => {
    console.error('\nFatal error:', err);
    process.exit(1);
});
