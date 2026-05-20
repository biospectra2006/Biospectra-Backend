require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const { cloudinary } = require('../config/cloudinary');
const Article = require('../models/Article');
const Year = require('../models/Year');
const Issue = require('../models/Issue');
const Category = require('../models/Category');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const pdfParse = require('pdf-parse');

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

// Metadata extraction helpers
function cleanTitle(title) {
    // Drop any garbage text accumulated before the first article index
    const indexMatch = title.match(/\b1(\([A-Z]+\))?\./);
    if (indexMatch) {
        title = title.substring(indexMatch.index);
    }
    
    return title
        .replace(/^\d+(\([A-Z]+\))?[\.\s]+/, '') // Precise match for 1. or 16(PS).
        .replace(/[\s\xa0\u00a0]+/g, ' ')
        .trim();
}

function cleanAuthors(authors) {
    return authors
        .replace(/[\d\*†‡§¶#\s&,]+$/, '') // Remove trailing digits, stars, symbols
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeLine(l) {
    return l
        .replace(/[\s\xa0\u00a0]+/g, ' ')
        .replace(/[\xad\u00ad\u2013\u2014]+/g, '-')
        .trim();
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
    return '';
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
    let authors = '';
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
        affiliation = affLines.join(', ').replace(/\s+/g, ' ').trim();
    }

    return { authors, affiliation };
}

// Download helper
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: Status Code ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(destPath, () => reject(err));
        });
    });
}

// TOC parser
function parseTocText(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const articles = [];
    let currentCategory = 'Research Article';
    let currentTitleBuffer = [];
    
    let hasStarted = false;

    const categoryKeywords = {
        'ANIMAL SCIENCES': 'Animal Science',
        'ANIMAL SCIENCE': 'Animal Science',
        'PLANT SCIENCES': 'Plant Science',
        'PLANT SCIENCE': 'Plant Science',
        'ENVIRONMENTAL SCIENCES': 'Environmental Science',
        'ENVIRONMENTAL SCIENCE': 'Environmental Science',
        'INTERDISCIPLINARY SCIENCES': 'Interdisciplinary Science',
        'INTERDISCIPLINARY SCIENCE': 'Interdisciplinary Science',
        'TRANSDISCIPLINARY SCIENCES': 'Transdisciplinary Science',
        'TRANSDISCIPLINARY SCIENCE': 'Transdisciplinary Science',
        'MEDICAL SCIENCES': 'Medical Sciences',
        'MEDICAL SCIENCE': 'Medical Sciences'
    };

    const categoryCodes = {
        'AS': 'Animal Science',
        'PS': 'Plant Science',
        'IS': 'Interdisciplinary Science',
        'ES': 'Environmental Science',
        'MS': 'Medical Sciences',
        'PA': 'Animal Science'
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lowerLine = line.toLowerCase();
        const upperLine = line.toUpperCase();

        if (
            lowerLine.includes('from the editor desk') || 
            lowerLine.includes('membership form') || 
            lowerLine.includes('award form') ||
            lowerLine.includes('this issue of biospectra') ||
            lowerLine.includes('from the editor\'s desk')
        ) {
            break;
        }

        // Match first article index to start parsing (e.g. 1. or 1(AS).)
        if (!hasStarted) {
            if (/^\d+(\([A-Z]+\))?\./.test(line)) {
                hasStarted = true;
            } else {
                continue;
            }
        }

        // Check if line is a category header
        let foundCategory = false;
        for (const [kw, cat] of Object.entries(categoryKeywords)) {
            if (upperLine.includes(kw)) {
                currentCategory = cat;
                foundCategory = true;
                break;
            }
        }
        if (foundCategory) {
            currentTitleBuffer = [];
            continue;
        }

        // Check if line ends with a page range like "1-4"
        const pageRangeRegex = /(\d+)\s*-\s*(\d+)\s*$/;
        const match = line.match(pageRangeRegex);

        if (match) {
            const startPage = parseInt(match[1]);
            const endPage = parseInt(match[2]);
            
            if (startPage > 500 || endPage > 500 || startPage >= endPage) {
                continue;
            }

            let authorPart = line.substring(0, match.index).trim();
            authorPart = authorPart.replace(/\d+$/, '').trim();
            const authors = cleanAuthors(authorPart);

            // Clean title and extract category code from index number
            let rawTitle = currentTitleBuffer.join(' ');
            let articleCategory = currentCategory;

            // Detect category from index code (e.g. "1(AS).")
            const indexCodeMatch = rawTitle.match(/\b\d+\(([A-Z]+)\)\./);
            if (indexCodeMatch) {
                const code = indexCodeMatch[1];
                if (categoryCodes[code]) {
                    articleCategory = categoryCodes[code];
                }
            }

            const title = cleanTitle(rawTitle);

            articles.push({
                title: title || 'Research Article',
                authors,
                startPage,
                endPage,
                category: articleCategory
            });

            currentTitleBuffer = [];
        } else {
            if (
                lowerLine.includes('biospectra') || 
                lowerLine.includes('issn') || 
                lowerLine.includes('vol.') ||
                lowerLine.includes('contd') ||
                lowerLine.includes('contents') ||
                /^\(?[i|v|x|I|V|X]+\)?$/.test(line) ||
                lowerLine.includes('international biannual') ||
                lowerLine.includes('refereed journal') ||
                lowerLine.includes('number') ||
                lowerLine.includes('published every')
            ) {
                continue;
            }
            
            currentTitleBuffer.push(line);
        }
    }

    return articles;
}

// Issue configurations mapping
const ISSUES_CONFIG = [
    {
        name: "19 March",
        year: 2019,
        month: "march",
        issueOrder: 1,
        volume: "14(1)",
        mergedPdfUrl: "https://res.cloudinary.com/dyzvvmpsq/raw/upload/v1779278876/spectra_issues/19_March_1779278870495.pdf",
        tocPdfUrl: "https://res.cloudinary.com/dyzvvmpsq/raw/upload/v1779278877/spectra_issues/CONTENT___EDITORIAL_1779278874549.pdf"
    },
    {
        name: "20 March Part 1",
        year: 2020,
        month: "march",
        issueOrder: 1,
        volume: "15(1)",
        mergedPdfUrl: "https://res.cloudinary.com/dyzvvmpsq/raw/upload/v1779278907/spectra_issues/20_March_part_1_1779278902949.pdf",
        tocPdfUrl: "https://res.cloudinary.com/dyzvvmpsq/raw/upload/v1779278941/spectra_issues/content_march_part_I_2020_1779278937607.pdf"
    },
    {
        name: "20 March Part 2",
        year: 2020,
        month: "march",
        issueOrder: 1,
        volume: "15(1)",
        mergedPdfUrl: "https://res.cloudinary.com/dyzvvmpsq/raw/upload/v1779278939/spectra_issues/20_March_part_2_1779278931777.pdf",
        tocPdfUrl: "https://res.cloudinary.com/dyzvvmpsq/raw/upload/v1779278943/spectra_issues/content_march_part_II_2020_1779278939703.pdf"
    },
    {
        name: "20 September",
        year: 2020,
        month: "september",
        issueOrder: 2,
        volume: "15(2)",
        mergedPdfUrl: "https://res.cloudinary.com/dyzvvmpsq/raw/upload/v1779278982/spectra_issues/Biosepctra_sept._2020_1779278967276.pdf",
        tocPdfUrl: "https://res.cloudinary.com/dyzvvmpsq/raw/upload/v1779278992/spectra_issues/2_1779278986545.pdf"
    },
    {
        name: "21 March",
        year: 2021,
        month: "march",
        issueOrder: 1,
        volume: "16(1)",
        mergedPdfUrl: "https://res.cloudinary.com/dyzvvmpsq/raw/upload/v1779279030/spectra_issues/BIOSPECTRA_MARCH_2021_VOL_16_1__1779279012548.pdf",
        tocPdfUrl: null
    },
    {
        name: "21 September",
        year: 2021,
        month: "september",
        issueOrder: 2,
        volume: "16(2)",
        mergedPdfUrl: "https://res.cloudinary.com/dyzvvmpsq/raw/upload/v1779279043/spectra_issues/BIOSPECTRA_SEPT_2021_VOL_16_2__1779279037078.pdf",
        tocPdfUrl: null
    },
    {
        name: "22 March",
        year: 2022,
        month: "march",
        issueOrder: 1,
        volume: "17(1)",
        mergedPdfUrl: "https://res.cloudinary.com/dyzvvmpsq/raw/upload/v1779279061/spectra_issues/BIOSPECTRA_MARCH_2022_VOL_17_1__1779279052702.pdf",
        tocPdfUrl: null
    },
    {
        name: "23 March",
        year: 2023,
        month: "march",
        issueOrder: 1,
        volume: "18(1)",
        mergedPdfUrl: null,
        tocPdfUrl: null,
        localPath: path.join(__dirname, '../../frontend/public/assets/2nd-merger-pdf/23 March/Biospectra March 2023 18 (1).pdf')
    }
];

async function scanSeptember2020Articles(mainPdfPath) {
    const mainBuf = fs.readFileSync(mainPdfPath);
    const pageTexts = [];
    
    function renderPage(pageData) {
        return pageData.getTextContent().then(function(textContent) {
            let lastY, text = '';
            for (let item of textContent.items) {
                if (lastY == item.transform[5] || !lastY){
                    text += item.str;
                } else {
                    text += '\n' + item.str;
                }
                lastY = item.transform[5];
            }
            pageTexts.push({ pageNum: pageData.pageNumber, text });
            return text;
        });
    }
    
    await pdfParse(mainBuf, { pagerender: renderPage });
    pageTexts.sort((a, b) => a.pageNum - b.pageNum);
    
    const articles = [];
    pageTexts.forEach((pt) => {
        const lines = pt.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        let foundRange = null;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = line.match(/Biospectra\s*:.*pp\.\s*(\d+)\s*[-–—]\s*(\d+)/i);
            if (match) {
                foundRange = {
                    start: parseInt(match[1], 10),
                    end: parseInt(match[2], 10)
                };
                break;
            }
        }
        
        if (foundRange) {
            let category = 'Animal Science';
            for (const line of lines.slice(0, 10)) {
                const lower = line.toLowerCase();
                if (lower.includes('animal science') || lower.includes('zoology')) {
                    category = 'Animal Science';
                    break;
                } else if (lower.includes('plant science') || lower.includes('botany')) {
                    category = 'Plant Science';
                    break;
                } else if (lower.includes('interdisciplinary')) {
                    category = 'Interdisciplinary Science';
                    break;
                }
            }
            
            articles.push({
                title: 'Research Article',
                authors: '',
                startPage: foundRange.start,
                endPage: foundRange.end,
                category
            });
        }
    });
    
    const uniqueArticles = [];
    const seenStarts = new Set();
    for (const art of articles) {
        if (!seenStarts.has(art.startPage)) {
            seenStarts.add(art.startPage);
            uniqueArticles.push(art);
        }
    }
    
    uniqueArticles.sort((a, b) => a.startPage - b.startPage);
    return uniqueArticles;
}

async function run() {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');

    const tempDir = path.join(__dirname, '../temp_uploads/mergers');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const args = process.argv.slice(2);
    const dryRunIndex = args.indexOf('--dry-run');
    const isDryRun = dryRunIndex !== -1;
    const targetIssueName = args.find(a => !a.startsWith('--'));

    let issuesToProcess = ISSUES_CONFIG;
    if (targetIssueName && targetIssueName !== '--dry-run') {
        issuesToProcess = ISSUES_CONFIG.filter(i => i.name.toLowerCase().includes(targetIssueName.toLowerCase()));
        console.log(`Filtering to target issue(s) matching: "${targetIssueName}"`);
    } else {
        console.log(`Processing all ${ISSUES_CONFIG.length} issues.`);
    }

    for (const config of issuesToProcess) {
        console.log(`\n======================================================`);
        console.log(`📂 Processing issue: "${config.name}" (${config.year} ${config.month})`);
        console.log(`======================================================`);

        const issueDir = path.join(tempDir, config.name.replace(/\s+/g, '_'));
        if (!fs.existsSync(issueDir)) {
            fs.mkdirSync(issueDir, { recursive: true });
        }

        const mainPdfPath = path.join(issueDir, 'main.pdf');
        const tocPdfPath = path.join(issueDir, 'toc.pdf');

        // 1. Download/Copy main PDF
        if (config.mergedPdfUrl) {
            console.log(`📥 Downloading merged PDF from: ${config.mergedPdfUrl}`);
            await downloadFile(config.mergedPdfUrl, mainPdfPath);
        } else {
            console.log(`📋 Copying local merged PDF from: ${config.localPath}`);
            fs.copyFileSync(config.localPath, mainPdfPath);
        }

        // 2. Download/Copy TOC PDF if present, or extract from main PDF
        let tocText = '';
        const tocTempPath = path.join(issueDir, 'toc_temp.pdf');
        if (config.tocPdfUrl) {
            console.log(`📥 Downloading TOC PDF from: ${config.tocPdfUrl}`);
            await downloadFile(config.tocPdfUrl, tocPdfPath);
            console.log('Parsing TOC text...');
            const tocData = await pdfParse(fs.readFileSync(tocPdfPath));
            tocText = tocData.text;
        } else {
            console.log('TOC is embedded. Extracting first 15 pages using Ghostscript...');
            try {
                const gsCmd = `gswin64c -sDEVICE=pdfwrite -dNOPAUSE -dBATCH -dSAFER -dFirstPage=1 -dLastPage=15 -sOutputFile="${tocTempPath}" "${mainPdfPath}"`;
                execSync(gsCmd, { stdio: 'ignore' });
            } catch (gsErr) {
                console.error(`❌ Ghostscript TOC split failed:`, gsErr.message);
                continue;
            }
            console.log('Parsing TOC text...');
            const tocData = await pdfParse(fs.readFileSync(tocTempPath));
            tocText = tocData.text;
            if (fs.existsSync(tocTempPath)) fs.unlinkSync(tocTempPath);
        }

        // 3. Parse TOC
        let parsedArticles;
        if (config.name === "20 September") {
            console.log('20 September issue detected. Scanning page headers of main PDF directly...');
            parsedArticles = await scanSeptember2020Articles(mainPdfPath);
        } else {
            console.log('Extracting articles list from Table of Contents...');
            parsedArticles = parseTocText(tocText);
        }
        console.log(`Found ${parsedArticles.length} articles.`);

        if (parsedArticles.length === 0) {
            console.warn('⚠️ No articles parsed! Skipping.');
            continue;
        }

        // 4. Find dynamic page offset
        let offset = 0;
        const mainBuf = fs.readFileSync(mainPdfPath);

        if (config.name === "20 September") {
            console.log('Using 0 offset for directly scanned pages.');
        } else {
            console.log('Detecting page offset...');
            const firstArticle = parsedArticles[0];
            console.log(`First Article to search: "${firstArticle.title}" by "${firstArticle.authors}" (Page ${firstArticle.startPage})`);
            
            let detected = false;
            const pageTexts = [];

            function renderPageCapture(pageData) {
                return pageData.getTextContent().then(function(textContent) {
                    let lastY, text = '';
                    for (let item of textContent.items) {
                        if (lastY == item.transform[5] || !lastY){
                            text += item.str;
                        }  
                        else{
                            text += '\n' + item.str;
                        }    
                        lastY = item.transform[5];
                    }
                    pageTexts.push({ pageNum: pageData.pageNumber, text });
                    return text;
                });
            }
            await pdfParse(mainBuf, { pagerender: renderPageCapture, max: 25 }).catch((err) => {
                console.error('PDF parsing page capture error:', err.message);
            });
            pageTexts.sort((a, b) => a.pageNum - b.pageNum);

            // Match first article in the first 25 pages, skipping the TOC pages for embedded TOC
            const startScanPage = config.tocPdfUrl ? 1 : 7;
            for (let pt of pageTexts.slice(startScanPage - 1, 25)) {
                const pageLower = pt.text.toLowerCase();
                const titleLower = firstArticle.title.toLowerCase();
                const firstAuthorLower = firstArticle.authors.split(/&|,/)[0].trim().toLowerCase();

                const titleSig = titleLower.substring(0, Math.min(30, titleLower.length));
                
                if (pageLower.includes(titleSig) || (firstAuthorLower && pageLower.includes(firstAuthorLower))) {
                    offset = pt.pageNum - firstArticle.startPage;
                    console.log(`✅ Signature found on PDF Page ${pt.pageNum}! Detected Offset: ${offset}`);
                    detected = true;
                    break;
                }
            }

            if (!detected) {
                offset = config.tocPdfUrl ? 0 : 6; 
                console.warn(`⚠️ Signature not found. Defaulting to offset: ${offset}`);
            }
        }

        // Setup MongoDB Year and Issue documents
        let yearDoc = await Year.findOne({ year: config.year });
        if (!yearDoc) {
            yearDoc = new Year({ year: config.year });
            await yearDoc.save();
        }

        let issueDoc = await Issue.findOne({ year: yearDoc._id, order: config.issueOrder });
        if (!issueDoc) {
            const pdfs = [];
            if (config.mergedPdfUrl) {
                pdfs.push({ title: 'Full Issue PDF', pdfUrl: config.mergedPdfUrl, cloudinaryId: '' });
            }
            if (config.tocPdfUrl) {
                pdfs.push({ title: 'Table of Contents & Editorial', pdfUrl: config.tocPdfUrl, cloudinaryId: '' });
            }

            issueDoc = new Issue({
                year: yearDoc._id,
                title: config.month === 'march' ? 'Issue 1 (Jan-Jun)' : 'Issue 2 (Jul-Dec)',
                order: config.issueOrder,
                pdfs
            });
            await issueDoc.save();
        }

        // 5. Split, parse, and upload each article
        for (let index = 0; index < parsedArticles.length; index++) {
            const art = parsedArticles[index];
            console.log(`\n👉 [${index + 1}/${parsedArticles.length}] Article pages: ${art.startPage}-${art.endPage} (${art.category})`);

            const startPDFPage = art.startPage + offset;
            const endPDFPage = art.endPage + offset;

            let totalPages = 300; // Safe default
            try {
                const info = await pdfParse(mainBuf, { max: 1 });
                totalPages = info.numpages;
            } catch (err) {}

            if (startPDFPage < 1 || endPDFPage > totalPages || startPDFPage > endPDFPage) {
                console.error(`❌ Page range ${startPDFPage}-${endPDFPage} is out of bounds (1 to ${totalPages}). Skipping.`);
                continue;
            }

            const tempArticlePath = path.join(issueDir, `article_${index + 1}_raw.pdf`);
            const compArticlePath = path.join(issueDir, `article_${index + 1}.pdf`);

            // Extract pages using Ghostscript
            console.log(`✂️ Splitting PDF pages ${startPDFPage} to ${endPDFPage}...`);
            try {
                const gsCmd = `gswin64c -sDEVICE=pdfwrite -dNOPAUSE -dBATCH -dSAFER -dFirstPage=${startPDFPage} -dLastPage=${endPDFPage} -sOutputFile="${tempArticlePath}" "${mainPdfPath}"`;
                execSync(gsCmd, { stdio: 'ignore' });
            } catch (gsErr) {
                console.error(`❌ Ghostscript split failed:`, gsErr.message);
                continue;
            }

            if (!fs.existsSync(tempArticlePath) || fs.statSync(tempArticlePath).size === 0) {
                console.error(`❌ Split output file is empty or missing. Skipping.`);
                continue;
            }

            // Extract text from the split article to get abstract and keywords
            let abstract = '';
            let keywords = [];
            let preciseTitle = '';
            let preciseAuthors = '';
            let affiliation = '';

            try {
                const artBuf = fs.readFileSync(tempArticlePath);
                const artData = await pdfParse(artBuf);
                const artLines = artData.text.split('\n').map(l => normalizeLine(l)).filter(l => l.length > 0);

                preciseTitle = extractTitle(artLines);
                const authInfo = extractAuthorsAndAffiliation(artLines);
                preciseAuthors = authInfo.authors;
                affiliation = authInfo.affiliation;
                abstract = extractAbstract(artLines);
                keywords = extractKeywords(artLines);
            } catch (parseErr) {
                console.warn(`⚠️ Text parsing failed for split file: ${parseErr.message}`);
            }

            const finalTitle = art.title && art.title !== 'Research Article' ? art.title : (preciseTitle && preciseTitle.length >= 10 ? preciseTitle : art.title);
            const finalAuthors = art.authors && art.authors.length >= 3 ? art.authors : (preciseAuthors && preciseAuthors.length >= 3 ? preciseAuthors : art.authors);

            console.log(`   Title: "${finalTitle}"`);
            console.log(`   Authors: "${finalAuthors}"`);
            console.log(`   Abstract: ${abstract ? abstract.substring(0, 100) + '...' : '(none)'}`);
            console.log(`   Keywords: [${keywords.join(', ')}]`);

            if (isDryRun) {
                console.log(`📝 [Dry-Run] Skipping upload and database write.`);
                if (fs.existsSync(tempArticlePath)) fs.unlinkSync(tempArticlePath);
                continue;
            }

            // Upload PDF to Cloudinary
            console.log(`☁️ Uploading to Cloudinary...`);
            let uploadRes;
            try {
                uploadRes = await cloudinary.uploader.upload(tempArticlePath, {
                    resource_type: 'raw',
                    folder: 'spectra_articles',
                    public_id: `${finalTitle.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)}_${Date.now()}`
                });
                console.log(`✅ Uploaded successfully. URL: ${uploadRes.secure_url}`);
            } catch (uploadErr) {
                console.error(`❌ Cloudinary upload failed:`, uploadErr.message);
                if (fs.existsSync(tempArticlePath)) fs.unlinkSync(tempArticlePath);
                continue;
            }

            // Save to database
            let categoryDoc = await Category.findOne({ title: art.category, issue: issueDoc._id });
            if (!categoryDoc) {
                categoryDoc = new Category({ title: art.category, issue: issueDoc._id });
                await categoryDoc.save();
            }

            const articleData = {
                title: finalTitle,
                authors: finalAuthors,
                affiliation: affiliation || '',
                abstract: abstract || '',
                keywords: keywords || [],
                pdfUrl: uploadRes.secure_url,
                cloudinaryId: uploadRes.public_id,
                pageRange: `${art.startPage}-${art.endPage}`,
                category: categoryDoc._id,
                year: yearDoc._id,
                issue: issueDoc._id
            };

            const existingArt = await Article.findOne({ title: finalTitle, year: yearDoc._id });
            if (existingArt) {
                await Article.findByIdAndUpdate(existingArt._id, articleData);
                console.log(`💾 Updated existing article record in MongoDB.`);
            } else {
                const newArt = new Article(articleData);
                await newArt.save();
                console.log(`💾 Saved new article record in MongoDB.`);
            }

            if (fs.existsSync(tempArticlePath)) fs.unlinkSync(tempArticlePath);
            if (fs.existsSync(compArticlePath)) fs.unlinkSync(compArticlePath);
        }

        // Clean up temporary issue directories
        console.log(`🗑 Cleaning up temporary issue folder...`);
        if (fs.existsSync(mainPdfPath)) fs.unlinkSync(mainPdfPath);
        if (fs.existsSync(tocPdfPath)) fs.unlinkSync(tocPdfPath);
        fs.rmdirSync(issueDir);
        console.log(`Done.`);
    }

    console.log('\n✅ Extraction and Import Complete!');
    process.exit(0);
}

run().catch(err => {
    console.error('Fatal execution error:', err);
    process.exit(1);
});
