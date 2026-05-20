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

function normalizeLine(l) {
    return l
        .replace(/[\s\xa0\u00a0]+/g, ' ')
        .replace(/[\xad\u00ad\u2013\u2014]+/g, '-')
        .trim();
}

function normalizeCategory(folderName) {
    const key = folderName.toLowerCase().trim().replace(/\s+/g, ' ');
    return CATEGORY_MAP[key] || 'Research Articles';
}

async function cleanDatabase() {
    await Article.deleteMany({});
    await Category.deleteMany({});
    await Issue.deleteMany({});
    await Year.deleteMany({});
    console.log('Database collections cleared.');
}

async function cleanCloudinary() {
    try {
        let hasMore = true;
        let nextCursor = null;
        let count = 0;
        console.log('Cleaning Cloudinary folder "spectra_articles"...');
        while (hasMore) {
            const result = await cloudinary.api.resources({
                type: 'upload',
                prefix: 'spectra_articles',
                max_results: 100,
                next_cursor: nextCursor
            });
            if (result.resources.length > 0) {
                const publicIds = result.resources.map(r => r.public_id);
                await cloudinary.api.delete_resources(publicIds);
                count += publicIds.length;
                console.log(`  Deleted ${count} files from Cloudinary...`);
            }
            nextCursor = result.next_cursor;
            hasMore = !!nextCursor;
        }
        console.log('Cloudinary folder cleaned.');
    } catch (error) {
        console.log('Cloudinary clean note:', error.message);
    }
}

function extractTitle(lines) {
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
        const lower = lines[i].toLowerCase();
        if (lower.startsWith('abstract') || lower.startsWith('key word') || lower.startsWith('introduction')) break;
        if (/^\d+$/.test(lines[i]) && parseInt(lines[i]) < 500) continue;
        if (lower.includes('biospectra') || lower.includes('issn') || lower.includes('vol.') || lower.includes('pp.')) continue;
        if (SECTION_NAMES.some(s => lower.includes(s.toLowerCase()))) continue;
        if (lower.includes('received') || lower.includes('revised') || lower.includes('accepted')) continue;
        
        let title = lines[i];
        if (i + 1 < lines.length) {
            const next = lines[i + 1].toLowerCase();
            if (!next.startsWith('abstract') && !next.startsWith('key word') && !next.includes('received') && lines[i + 1].length > 10) {
                title += ' ' + lines[i + 1];
            }
        }
        title = title.replace(/^[\d\s\.]+/, '').trim();
        if (title.length >= 10) return title;
    }
    return 'Research Article';
}

function extractAbstract(lines) {
    const full = lines.join(' ');
    const lower = full.toLowerCase();
    const ai = lower.indexOf('abstract');
    if (ai === -1) return '';
    let start = ai + 8;
    while (start < full.length && [':', '-', '.', ' '].includes(full[start])) start++;
    let end = lower.indexOf('key words', start);
    if (end === -1) end = lower.indexOf('keywords', start);
    if (end === -1) end = lower.indexOf('introduction', start);
    if (end === -1) end = start + 2000;
    const abs = full.substring(start, end).trim();
    return abs.length > 50 ? abs : '';
}

function extractKeywords(lines) {
    const kwLine = lines.find(l => /key\s*words?\s*:/i.test(l));
    if (!kwLine) return [];
    let kw = kwLine.replace(/Key\s*words?\s*:\s*/i, '').replace(/Keywords?\s*:\s*/i, '').trim();
    const stops = ['corresponding author', 'phone :', 'e-mail :', 'introduction'];
    for (const s of stops) {
        const idx = kw.toLowerCase().indexOf(s);
        if (idx !== -1) kw = kw.substring(0, idx).trim();
    }
    return kw.split(/,|\.\s|;/).map(k => k.replace(/[\[\]\(\)\*\s]+/g, ' ').trim()).filter(k => k.length > 2 && k.length < 80);
}

function extractAuthorsAndAffiliation(lines) {
    let authors = 'Biospectra Contributor';
    let affiliation = '';

    const receivedIdx = lines.findIndex(l => {
        const lower = l.toLowerCase();
        return lower.includes('received') || lower.includes('revised') || lower.includes('accepted');
    });
    if (receivedIdx === -1) return { authors, affiliation };

    const affKeywords = [
        'department', 'dept', 'university', 'laboratory', 'lab', 'college',
        'institute', 'school', 'research', 'centre', 'center', 'trust', 'academy',
        'india', 'bihar', 'jharkhand', 'patna', 'ranchi', 'jaipur', 'rajasthan',
        'road', 'hazaribagh', 'muzaffarpur', 'bhagalpur', 'lucknow', 'delhi'
    ];

    let affLines = [];
    let authorLines = [];
    let stage = 'affiliation';

    for (let i = receivedIdx - 1; i >= 0; i--) {
        const line = lines[i];
        const lower = line.toLowerCase();
        if (/^\d+$/.test(line) && parseInt(line) < 500) continue;
        if (lower.includes('biospectra') || lower.includes('issn') || lower.includes('vol.')) continue;
        if (SECTION_NAMES.some(s => lower.includes(s.toLowerCase()))) continue;
        if (lower.startsWith('abstract') || lower.startsWith('key word') || lower.startsWith('keywords') || lower.startsWith('introduction')) break;
        if (lower.includes('corresponding author') || lower.includes('phone:') || lower.includes('phone :') || lower.includes('e-mail:') || lower.includes('e-mail :') || lower.includes('@')) break;
        if (line.length > 4 && !/[A-Z]/.test(line)) break;

        if (stage === 'affiliation') {
            if (affKeywords.some(w => lower.includes(w)) || line.length <= 3) {
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
            .trim()
            .replace(/\s+and\s*$/i, '')
            .trim();
    }

    if (affLines.length > 0) {
        affiliation = affLines.join(' ')
            .replace(/[\d\*†‡§¶#]+/g, '')
            .replace(/\b[a-z]\b/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    return { authors, affiliation };
}

function extractDOI(lines) {
    for (const line of lines) {
        const match = line.match(/(?:doi|DOI)\s*:\s*(10\.\S+)/);
        if (match) return match[1].replace(/\.$/, '');
        const match2 = line.match(/(10\.\d{4,}\/\S+)/);
        if (match2) return match2[1].replace(/\.$/, '');
    }
    return '';
}

function extractPages(lines) {
    const line = lines.find(l => /pp?\s*\d+/i.test(l));
    if (line) {
        const m = line.match(/(\d+)\s*-{1,2}\s*(\d+)/);
        if (m) return `${m[1]}-${m[2]}`;
    }
    return '';
}

async function extractPdfInfo(filePath) {
    try {
        const buf = fs.readFileSync(filePath);
        const data = await pdfParse(buf);
        const lines = data.text.split('\n').map(normalizeLine).filter(l => l.length > 0);
        const title = extractTitle(lines);
        const abstract = extractAbstract(lines);
        const keywords = extractKeywords(lines);
        const { authors, affiliation } = extractAuthorsAndAffiliation(lines);
        const doi = extractDOI(lines);
        const pages = extractPages(lines);
        return { title, authors, affiliation, doi, abstract, keywords, pages, content: data.text };
    } catch (e) {
        return null;
    }
}

async function uploadToCloudinary(filePath) {
    try {
        const baseName = path.basename(filePath, '.pdf').replace(/[^a-zA-Z0-9.\-_]/g, '_');
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

async function ensureHierarchy(yearNum, issueOrder, categoryName) {
    let yearDoc = await Year.findOne({ year: yearNum });
    if (!yearDoc) {
        yearDoc = await Year.create({ year: yearNum });
    }
    let issueDoc = await Issue.findOne({ year: yearDoc._id, order: issueOrder });
    if (!issueDoc) {
        const title = issueOrder === 1 ? 'Issue 1 (Jan-Jun)' : 'Issue 2 (Jul-Dec)';
        issueDoc = await Issue.create({ year: yearDoc._id, title, order: issueOrder });
    }
    let categoryDoc = await Category.findOne({ issue: issueDoc._id, title: categoryName });
    if (!categoryDoc) {
        categoryDoc = await Category.create({ issue: issueDoc._id, title: categoryName });
    }
    return { yearDoc, issueDoc, categoryDoc };
}

async function run() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB.');

        console.log('\nCleaning database (Articles, Categories, Issues, Years)...');
        await cleanDatabase();

        console.log('\nCleaning existing Cloudinary raw uploads...');
        await cleanCloudinary();

        if (!fs.existsSync(sourceDir)) {
            console.error(`Source directory not found: ${sourceDir}`);
            process.exit(1);
        }

        // Prepare local target directory for large files
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const folders = fs.readdirSync(sourceDir)
            .filter(f => fs.statSync(path.join(sourceDir, f)).isDirectory());

        console.log(`Found ${folders.length} issue folders to process.`);

        // Chronological sort: year first, then issue order (March = 1, September/December = 2)
        const parsedFolders = folders.map(folderName => {
            const match = folderName.trim().replace(/\s+/g, ' ').match(/^(\d{2})\s+(.+)$/i);
            if (!match) {
                console.log(`⚠  Could not parse folder name format: "${folderName}"`);
                return null;
            }
            const yearShort = match[1];
            const monthRaw = match[2].toLowerCase().trim();
            const yearFull = 2000 + parseInt(yearShort);
            const issueOrder = MONTH_MAP[monthRaw] || 2;
            return { folderName, yearFull, issueOrder, monthRaw };
        }).filter(Boolean);

        parsedFolders.sort((a, b) => {
            if (a.yearFull !== b.yearFull) return a.yearFull - b.yearFull;
            return a.issueOrder - b.issueOrder;
        });

        let totalSuccess = 0;
        let totalFailed = 0;

        for (const { folderName, yearFull, issueOrder, monthRaw } of parsedFolders) {
            const folderPath = path.join(sourceDir, folderName);
            console.log(`\n📁 Processing Folder: ${folderName} (${yearFull} - ${monthRaw})`);

            const categoryFolders = fs.readdirSync(folderPath)
                .filter(f => fs.statSync(path.join(folderPath, f)).isDirectory());

            for (const catFolder of categoryFolders) {
                const catPath = path.join(folderPath, catFolder);
                const categoryName = normalizeCategory(catFolder);

                // Get all PDF files in this category subfolder
                const pdfs = fs.readdirSync(catPath)
                    .filter(f => f.toLowerCase().endsWith('.pdf'));

                if (pdfs.length === 0) continue;

                // Sort PDFs numerically by the starting page number to keep them in order
                pdfs.sort((a, b) => {
                    const pageA = parseInt(a.split('-')[0]) || 0;
                    const pageB = parseInt(b.split('-')[0]) || 0;
                    return pageA - pageB;
                });

                console.log(`   📂 Category Folder: ${catFolder} → database Category: "${categoryName}" (${pdfs.length} PDFs)`);

                const { categoryDoc } = await ensureHierarchy(yearFull, issueOrder, categoryName);

                for (const pdfFile of pdfs) {
                    const pdfPath = path.join(catPath, pdfFile);
                    try {
                        const stats = fs.statSync(pdfPath);
                        if (stats.size < 1024) {
                            console.log(`      ⏩ ${pdfFile} (skipped: file size < 1KB)`);
                            totalFailed++;
                            continue;
                        }

                        console.log(`      📄 Extracting metadata from ${pdfFile}...`);
                        const info = await extractPdfInfo(pdfPath);
                        if (!info) {
                            console.log(`      ❌ ${pdfFile} (parse failed)`);
                            totalFailed++;
                            continue;
                        }

                        // Determine final page range fallback
                        let pages = info.pages;
                        if (!pages || !/^\d+-\d+$/.test(pages)) {
                            const nameClean = pdfFile.replace('.pdf', '').trim();
                            const m = nameClean.match(/(\d+)\s*-\s*(\d+)/);
                            pages = m ? `${m[1]}-${m[2]}` : nameClean;
                        }

                        const sizeMB = stats.size / (1024 * 1024);
                        const isTooLargeForCloudinary = sizeMB >= 9.8; // Leave a tiny buffer below 10MB

                        let finalUrl = '';
                        let finalCloudinaryId = '';

                        if (isTooLargeForCloudinary) {
                            console.log(`      💾 File size (${sizeMB.toFixed(2)} MB) >= 10MB limit. Using local storage fallback...`);
                            const sanitized = pdfFile.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                            const nameWithoutExt = sanitized.substring(0, sanitized.lastIndexOf('.')) || sanitized;
                            const finalFilename = `${nameWithoutExt}_${Date.now()}.pdf`;
                            const finalPath = path.join(targetDir, finalFilename);
                            
                            fs.copyFileSync(pdfPath, finalPath);
                            finalUrl = `/pdf biospectra/${finalFilename}`;
                        } else {
                            try {
                                console.log(`      ☁️  Uploading to Cloudinary...`);
                                const { url, id } = await uploadToCloudinary(pdfPath);
                                finalUrl = url;
                                finalCloudinaryId = id;
                            } catch (uploadErr) {
                                console.warn(`      ⚠  Cloudinary upload failed: ${uploadErr.message}. Falling back to local storage...`);
                                const sanitized = pdfFile.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                                const nameWithoutExt = sanitized.substring(0, sanitized.lastIndexOf('.')) || sanitized;
                                const finalFilename = `${nameWithoutExt}_${Date.now()}.pdf`;
                                const finalPath = path.join(targetDir, finalFilename);
                                
                                fs.copyFileSync(pdfPath, finalPath);
                                finalUrl = `/pdf biospectra/${finalFilename}`;
                            }
                        }

                        await Article.create({
                            category: categoryDoc._id,
                            title: info.title || `Research Article (pp. ${pages})`,
                            authors: info.authors || 'Biospectra Contributor',
                            affiliation: info.affiliation || '',
                            doi: info.doi || '',
                            abstract: info.abstract || '',
                            keywords: info.keywords || [],
                            pages: pages,
                            pdfUrl: finalUrl,
                            cloudinaryId: finalCloudinaryId,
                            content: info.content,
                        });

                        const locationMsg = finalCloudinaryId ? 'Cloudinary' : 'Local Storage';
                        console.log(`      ✅ Successfully saved in DB (${locationMsg}): "${info.title.slice(0, 50)}..."`);
                        totalSuccess++;
                    } catch (err) {
                        console.log(`      ❌ Error processing ${pdfFile}: ${err.message}`);
                        totalFailed++;
                    }
                }
            }
        }

        console.log(`\n=== BATCH IMPORT TO CLOUDINARY COMPLETE ===`);
        console.log(`✅ Success: ${totalSuccess}`);
        console.log(`❌ Failed:  ${totalFailed}`);

        process.exit(0);
    } catch (error) {
        console.error('Fatal Error:', error);
        process.exit(1);
    }
}

run();
