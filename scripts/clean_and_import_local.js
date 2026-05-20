require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const { cloudinary } = require('../config/cloudinary');
const Article = require('../models/Article');
const Year = require('../models/Year');
const Issue = require('../models/Issue');
const Category = require('../models/Category');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { PDFDocument } = require('pdf-lib');

const sourceDir = path.join(__dirname, '../../frontend/public/assets/Pdf Biospectra');
const targetDir = path.join(__dirname, '../../frontend/public/pdf biospectra');

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

async function cleanCloudinaryFolder(folderName) {
    try {
        let hasMore = true;
        let nextCursor = null;
        let count = 0;
        
        while (hasMore) {
            const result = await cloudinary.api.resources({
                type: 'upload',
                prefix: folderName,
                max_results: 100,
                next_cursor: nextCursor
            });
            
            if (result.resources.length > 0) {
                const publicIds = result.resources.map(r => r.public_id);
                await cloudinary.api.delete_resources(publicIds);
                count += publicIds.length;
                console.log(`Deleted ${count} files from ${folderName}...`);
            }
            
            nextCursor = result.next_cursor;
            hasMore = !!nextCursor;
        }
        console.log(`Finished cleaning ${folderName}`);
    } catch (error) {
        console.log(`Folder ${folderName} might not exist or error:`, error.message);
    }
}

async function cleanDatabase() {
    await Article.deleteMany({});
    await Category.deleteMany({});
    await Issue.deleteMany({});
    await Year.deleteMany({});
    console.log('Database collections cleared.');
}

async function prepareTargetDir() {
    if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
        console.log('Cleared existing target directory.');
    }
    fs.mkdirSync(targetDir, { recursive: true });
}

function normalizeLine(l) {
    return l
        .replace(/[\s\xa0\u00a0]+/g, ' ')
        .replace(/[\xad\u00ad\u2013\u2014]+/g, '-')
        .trim();
}

async function extractPdfInfo(filePath, fileName) {
    try {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        const lines = data.text.split('\n').map(normalizeLine).filter(l => l.length > 0);

        // --- KEYWORDS ---
        let keywords = [];
        const kwIdx = lines.slice(0, 100).findIndex(l => l.toLowerCase().includes('key word') || l.toLowerCase().includes('keywords'));
        if (kwIdx !== -1) {
            let kwStr = lines[kwIdx];
            if (!kwStr.endsWith('.')) {
                for (let k = kwIdx + 1; k < Math.min(kwIdx + 5, lines.length); k++) {
                    const lowerLine = lines[k].toLowerCase();
                    if (lowerLine.includes('introduction') || lowerLine.includes('corresponding') || lowerLine.includes('received') || lowerLine.includes('revised')) break;
                    const affKeywords = ['department', 'university', 'laboratory', 'college', 'school', 'institute'];
                    if (affKeywords.some(w => lowerLine.includes(w))) break;
                    kwStr += ' ' + lines[k];
                    if (lines[k].endsWith('.')) break;
                }
            }
            kwStr = kwStr.replace(/Key\s*words\s*:\s*/i, '').replace(/Keywords\s*:\s*/i, '').trim();
            const breakPoints = ['corresponding author', 'phone :', 'e-mail :', 'introduction'];
            for (const bp of breakPoints) {
                const idx = kwStr.toLowerCase().indexOf(bp);
                if (idx !== -1) kwStr = kwStr.substring(0, idx).trim();
            }
            keywords = kwStr.split(/,|\.\s|;/).map(k => k.replace(/[\*\s]+/g, ' ').trim()).filter(k => k.length > 2 && k.length < 80);
        }

        // --- ABSTRACT ---
        let abstract = '';
        const abstractLineIdx = lines.findIndex(l => l.toLowerCase().startsWith('abstract'));
        if (abstractLineIdx !== -1) {
            const fullText = lines.slice(abstractLineIdx).join(' ');
            const lowerText = fullText.toLowerCase();
            let startPos = lowerText.indexOf('abstract');
            if (startPos !== -1) {
                startPos += 8;
                while (startPos < fullText.length && [' ', ':', '-', '.'].includes(fullText[startPos])) startPos++;
                let endPos = lowerText.indexOf('key words', startPos);
                if (endPos === -1) endPos = lowerText.indexOf('keywords', startPos);
                if (endPos === -1) endPos = lowerText.indexOf('introduction', startPos);
                if (endPos === -1) endPos = startPos + 1500;
                const extracted = fullText.substring(startPos, endPos).trim();
                if (extracted.length > 50) abstract = extracted;
            }
        }

        // --- AUTHORS & AFFILIATION (backward scan from Received line) ---
        let authors = 'Biospectra Contributor';
        let affiliation = '';

        const receivedIdx = lines.slice(0, 100).findIndex(l => {
            const lower = l.toLowerCase();
            return lower.includes('received') || lower.includes('revised') || lower.includes('accepted');
        });

        if (receivedIdx !== -1) {
            const affKeywords = [
                'department', 'dept', 'university', 'laboratory', 'lab', 'college',
                'institute', 'school', 'research', 'centre', 'center', 'trust', 'academy',
                'india', 'bihar', 'jharkhand', 'patna', 'ranchi', 'jaipur', 'rajasthan',
                'road', 'hazaribagh', 'muzaffarpur', 'bhagalpur', 'lucknow', 'delhi',
                'mumbai', 'kolkata', 'chennai', 'hyderabad', 'pune', 'bengaluru'
            ];

            let affLines = [];
            let authorLines = [];
            let stage = 'affiliation';

            for (let i = receivedIdx - 1; i >= 0; i--) {
                const line = lines[i];
                const lower = line.toLowerCase();

                // Skip journal headers, page numbers, section names
                if (/^\d+$/.test(line) || lower.includes('biospectra') || lower.includes('issn') || lower.includes('vol.') || SECTION_NAMES.some(s => lower.includes(s.toLowerCase()))) continue;

                // Stop at abstract, keywords, or contact info block
                if (lower.startsWith('abstract') || lower.startsWith('key word') || lower.startsWith('keywords') || lower.startsWith('introduction')) break;
                if (lower.includes('corresponding author') || lower.includes('correspondent author') || lower.includes('phone:') || lower.includes('phone :') || lower.includes('e-mail:') || lower.includes('e-mail :') || lower.includes('@')) break;

                // Stop if line has no uppercase letters and isn't very short (skip noise)
                if (line.length > 4 && !/[A-Z]/.test(line)) break;

                if (stage === 'affiliation') {
                    const isAff = affKeywords.some(w => lower.includes(w));
                    if (isAff || line.length <= 3) {
                        affLines.unshift(line);
                    } else {
                        stage = 'authors';
                    }
                }

                if (stage === 'authors') {
                    if (authorLines.length >= 8) break;
                    authorLines.unshift(line);
                }
            }

            if (authorLines.length > 0) {
                authors = authorLines.join(' ')
                    .replace(/[\d\*†‡§¶#]+/g, '')
                    .replace(/\b[a-z]\b/g, '')
                    .replace(/\s+,\s*/g, ', ')
                    .replace(/,\s*,/g, ',')
                    .replace(/^[,\s\&\*]+|[,\s\&\*]+$/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();
                authors = authors.replace(/\s+and\s*$/i, '').trim();
            }

            if (affLines.length > 0) {
                affiliation = affLines.join(' ')
                    .replace(/[\d\*†‡§¶#]+/g, '')
                    .replace(/\b[a-z]\b/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();
            }
        }

        // --- TITLE (lines between header and abstract, skipping authors/affiliation) ---
        let title = '';
        if (abstractLineIdx !== -1) {
            const titleLines = [];
            for (let i = 0; i < Math.min(abstractLineIdx, 30); i++) {
                const line = lines[i];
                const lower = line.toLowerCase();
                if (/^\d+$/.test(line) || lower.includes('biospectra') || lower.includes('issn') || lower.includes('vol.') || lower.includes('pp.') || SECTION_NAMES.some(s => lower.includes(s.toLowerCase()))) continue;
                if (lower.includes('received') || lower.includes('revised') || lower.includes('department') || lower.includes('university') || lower.includes('corresponding author') || lower.includes('phone') || lower.includes('e-mail') || lower.includes('@')) continue;
                if (authors !== 'Biospectra Contributor' && line === authors) continue;
                if (affiliation && line.includes(affiliation)) continue;
                titleLines.push(line);
            }
            title = titleLines.join(' ').trim();
        }

        if (!title || title.length < 10) {
            const firstFew = lines.slice(0, 15).filter(line => {
                const lower = line.toLowerCase();
                return !lower.includes('biospectra') && !lower.includes('issn') && !lower.includes('vol.') && !/^\d+$/.test(line) && !SECTION_NAMES.some(s => lower.includes(s.toLowerCase()));
            });
            title = firstFew[0] || `Research Article (Pages ${fileName.replace('.pdf', '').replace(/^\./, '')})`;
        }

        // --- PAGES ---
        const pages = fileName.replace('.pdf', '').replace(/^\./, '');
        const pagesMatch = pages.match(/(\d+)\s*-?\s*(\d+)/);
        const displayPages = pagesMatch ? `${pagesMatch[1]}-${pagesMatch[2]}` : pages;

        return { title, authors, affiliation, abstract, keywords, pages: displayPages, content: data.text };
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

async function run() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected.');
        
        console.log('1. Cleaning Database...');
        await cleanDatabase();
        
        console.log('2. Preparing target directory...');
        await prepareTargetDir();
        
        console.log('3. Starting Local Import with Compression...');
        if (!fs.existsSync(sourceDir)) {
            console.log(`Source directory ${sourceDir} does not exist!`);
            return;
        }
        
        const folders = fs.readdirSync(sourceDir).filter(f => fs.statSync(path.join(sourceDir, f)).isDirectory());
        console.log(`Found ${folders.length} year folders to process`);

        let totalSuccess = 0, totalSkipped = 0, totalFailed = 0;

        for (const folderName of folders) {
            const folderPath = path.join(sourceDir, folderName);
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

            const categoryFolders = fs.readdirSync(folderPath).filter(f => fs.statSync(path.join(folderPath, f)).isDirectory());
            console.log(`\n📁 ${folderName} → ${yearFull} | ${issueOrder === 1 ? 'March' : 'September'}`);

            for (const catFolder of categoryFolders) {
                const catPath = path.join(folderPath, catFolder);
                const categoryName = normalizeCategory(catFolder);
                const pdfs = fs.readdirSync(catPath).filter(f => f.toLowerCase().endsWith('.pdf')).sort();

                if (pdfs.length === 0) continue;

                console.log(`   📂 ${catFolder} → ${categoryName} (${pdfs.length} PDFs)`);
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
                            totalSkipped++;
                            continue;
                        }

                        const info = await extractPdfInfo(pdfPath, pdfFile);
                        if (!info) {
                            console.log(`      ❌ ${pdfFile} (failed to parse)`);
                            totalFailed++;
                            continue;
                        }
                        
                        const sanitized = pdfFile.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                        const nameWithoutExt = sanitized.substring(0, sanitized.lastIndexOf('.')) || sanitized;
                        const finalFilename = `${nameWithoutExt}_${Date.now()}.pdf`;
                        const finalPath = path.join(targetDir, finalFilename);
                        
                        const sizeMB = stats.size / (1024 * 1024);
                        if (sizeMB > 10) {
                            console.log(`      Compressing large file: ${pdfFile} (${sizeMB.toFixed(2)} MB)`);
                            try {
                                const dataBuffer = fs.readFileSync(pdfPath);
                                const pdfDoc = await PDFDocument.load(dataBuffer);
                                const compressedBytes = await pdfDoc.save({ useObjectStreams: true });
                                fs.writeFileSync(finalPath, compressedBytes);
                            } catch (err) {
                                console.error(`      Compression failed for ${pdfFile}, copying instead.`, err.message);
                                fs.copyFileSync(pdfPath, finalPath);
                            }
                        } else {
                            fs.copyFileSync(pdfPath, finalPath);
                        }

                        await Article.create({
                            category: categoryDoc._id,
                            title: info.title,
                            authors: info.authors,
                            affiliation: info.affiliation || '',
                            abstract: info.abstract || '',
                            keywords: info.keywords || [],
                            pages: info.pages,
                            pdfUrl: `/pdf biospectra/${finalFilename}`,
                            content: info.content,
                        });

                        console.log(`      ✅ ${pdfFile}`);
                        totalSuccess++;
                    } catch (err) {
                        console.log(`      ❌ ${pdfFile} (${err.message})`);
                        totalFailed++;
                    }
                }
            }
        }

        console.log(`\n=== IMPORT COMPLETE ===`);
        console.log(`✅ Success: ${totalSuccess}`);
        console.log(`⏩ Skipped: ${totalSkipped}`);
        console.log(`❌ Failed:  ${totalFailed}`);
        
        process.exit(0);
    } catch (error) {
        console.error('Fatal Error:', error);
        process.exit(1);
    }
}

run();
