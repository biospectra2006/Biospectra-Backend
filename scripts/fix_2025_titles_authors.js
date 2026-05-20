/**
 * fix_2025_titles_authors.js
 * Fixes 2025 Biospectra articles that have:
 *  - Wrong title (ISSN-format header stored as title)
 *  - Wrong authors (comma-prefix, Phone: prefix, Orchid suffix, affiliation appended)
 *
 * Run: node scripts/fix_2025_titles_authors.js [--dry-run]
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

const Year     = require('../models/Year');
const Issue    = require('../models/Issue');
const Category = require('../models/Category');
const Article  = require('../models/Article');

const isDryRun = process.argv.includes('--dry-run');

// ── helpers ───────────────────────────────────────────────────────────────────

function norm(l) {
    return l.replace(/[\s\xa0\u00a0]+/g, ' ')
            .replace(/[\xad\u00ad\u2013\u2014]+/g, '-')
            .trim();
}

const SECTION_NAMES = [
    'animal science', 'plant science', 'environmental science',
    'interdisciplinary science', 'transdisciplinary science', 'medical sciences'
];

const AFFIL_KW = [
    'department', 'dept', 'university', 'laboratory', 'college',
    'institute', 'school', 'research', 'centre', 'center', 'trust', 'academy',
    'india', 'bihar', 'jharkhand', 'patna', 'ranchi', 'jaipur', 'rajasthan',
    'road', 'hazaribagh', 'muzaffarpur', 'bhagalpur', 'lucknow', 'delhi',
    'gorakhpur', 'nashik', 'kolkata', 'bangalore', 'karnataka', 'prayagraj',
    'uttar pradesh', 'bengal', 'manipur', 'assam', 'odisha', 'rajasthan',
    'bilaspur', 'chhattisgarh', 'jharkhand', 'gaya', 'jharkhand',
    'bokaro', 'dumka', 'ranchi', 'jamshedpur', 'garhwa',
    'madhepura', 'saharsa', 'chapra', 'sonpur', 'saran', 'vaishali',
    'muzaffarpur', 'bhagalpur', 'darbhanga', 'motihari', 'gaya', 'bodh',
    'barasat', 'brainware', 'svyasa', 'swami vivekananda', 'jawaharlal',
    'new delhi', 'udaipur', 'mohanlal', 'sukhadia', 'rajasthan'
];

// ── title detection ───────────────────────────────────────────────────────────

function isBadTitle(title) {
    if (!title) return true;
    return /ISSN/i.test(title) && /Vol\./i.test(title) && /pp\./i.test(title);
}

// ── author detection ──────────────────────────────────────────────────────────

function isBadAuthors(authors) {
    if (!authors) return true;
    if (authors.trim().startsWith(',')) return true;
    if (/^Phone\s*:/i.test(authors.trim())) return true;
    if (/Orchid\s*(Number)?/i.test(authors)) return true;
    if (/0000-\d{4}-\d{4}-\d{4}/i.test(authors)) return true;  // ORCID pattern
    // affiliation city/state appended to authors
    if (AFFIL_KW.some(k => {
        const idx = authors.toLowerCase().indexOf(k);
        if (idx === -1) return false;
        // if the keyword is near the end, it's appended affiliation
        return idx > authors.length * 0.5;
    })) return true;
    return false;
}

// ── title extraction ──────────────────────────────────────────────────────────

function extractTitle(lines) {
    // Strategy 1: Standard layout — title between ISSN header and Abstract
    for (let i = 0; i < Math.min(lines.length, 25); i++) {
        const lower = lines[i].toLowerCase();
        // Stop when we hit abstract/keywords/introduction
        if (lower.startsWith('abstract') || lower.startsWith('key word') || lower.startsWith('introduction')) break;
        // Skip junk lines
        if (/^\d+$/.test(lines[i]) && parseInt(lines[i]) < 500) continue;
        if (lower.includes('biospectra') || lower.includes('issn') ||
            lower.includes('vol.') || lower.includes('pp.')) continue;
        if (SECTION_NAMES.some(s => lower.includes(s))) continue;
        if (lower.includes('received') || lower.includes('revised') || lower.includes('accepted')) continue;
        if (lower.includes('@') || lower.startsWith('phone') || lower.startsWith('doi')) continue;

        let title = lines[i].replace(/^[\d\s\.]+/, '').trim();
        // Try to grab a second line if it continues the title
        if (i + 1 < lines.length) {
            const next = lines[i + 1];
            const nextL = next.toLowerCase();
            if (!nextL.startsWith('abstract') && !nextL.startsWith('key word') &&
                !nextL.startsWith('introduction') && !nextL.includes('issn') &&
                !nextL.includes('biospectra') && next.length > 5 && next.length < 150 &&
                !SECTION_NAMES.some(s => nextL.includes(s))) {
                const nextClean = next.replace(/^[\d\s\.]+/, '').trim();
                if (nextClean.length > 3) title += ' ' + nextClean;
            }
        }
        if (title.length >= 10) return title;
    }

    // Strategy 2: Look for title immediately after DOI line
    const doiIdx = lines.findIndex(l => /DOI[-:]?\s*https?:\/\//i.test(l) || /doi\.org\//i.test(l));
    if (doiIdx !== -1) {
        let titleParts = [];
        for (let i = doiIdx + 1; i < Math.min(doiIdx + 6, lines.length); i++) {
            const l = lines[i];
            const lo = l.toLowerCase();
            if (lo.startsWith('introduction') || lo.startsWith('abstract') ||
                lo.startsWith('background') || lo.startsWith('material') ||
                lo.startsWith('result') || /^\d+$/.test(l)) break;
            if (lo.includes('biospectra') || lo.includes('issn') || lo.includes('vol.')) break;
            if (l.length > 8) {
                titleParts.push(l);
                if (titleParts.length >= 3) break;
            }
        }
        if (titleParts.length > 0) {
            const candidate = titleParts.join(' ');
            if (candidate.length >= 10) return candidate;
        }
    }

    // Strategy 3: Search for "et al.-" running footer throughout document
    const etAlRe = /^.{1,40}\s+et\s+al[.\-–]+\s*[-–]?\s*(.{20,})/i;
    for (const line of lines) {
        const m = line.match(etAlRe);
        if (m && !m[1].toLowerCase().includes('biospectra')) {
            return m[1].trim().replace(/\.$/, '').trim();
        }
    }

    // Strategy 4: Surname pattern "Author.- Title text"
    const singleRe = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s*[.\-–]+\s*[-–]?\s*(.{20,})/;
    for (const line of lines) {
        const m = line.match(singleRe);
        if (m && !m[1].toLowerCase().includes('biospectra') &&
            !m[1].toLowerCase().includes('issn')) {
            return m[1].trim();
        }
    }

    return '';
}

// ── author extraction ─────────────────────────────────────────────────────────

function cleanAuthors(raw) {
    return raw
        .replace(/[\d\*†‡§¶#]+/g, '')         // remove superscripts/stars
        .replace(/\bOrchid\b.*$/i, '')          // remove Orchid suffix
        .replace(/\bORCID\b.*$/i, '')
        .replace(/0000-\d{4}-\d{4}-\d{4}/g, '') // ORCID numbers
        .replace(/\b[a-z]\b/g, '')              // lone lowercase letters (superscript artefacts)
        .replace(/\s+,\s*/g, ', ')
        .replace(/,\s*,/g, ',')
        .replace(/^[,\s\&\*]+|[,\s\&\*]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractAuthors(lines) {
    // Find "* Corresponding author :" block
    let searchStart = lines.findIndex(l => /\*?\s*Corresponding author\s*:/i.test(l));

    // Fallback: find Phone line
    let phoneIdx = lines.findIndex(l => /^Phone\s*[:\s]/i.test(l));
    if (searchStart === -1 && phoneIdx !== -1) searchStart = phoneIdx;
    if (searchStart === -1) return '';

    // Find Email line (at or after searchStart)
    let emailIdx = -1;
    for (let i = searchStart; i < Math.min(searchStart + 6, lines.length); i++) {
        if (/^E-mail\s*:/i.test(lines[i]) || (lines[i].includes('@') && lines[i].length < 80)) {
            emailIdx = i;
            break;
        }
    }
    if (emailIdx === -1) {
        // Try phone line + 1
        emailIdx = (phoneIdx !== -1) ? phoneIdx + 1 : searchStart + 2;
    }

    // Collect author lines AFTER email, BEFORE affiliation keywords / Received
    let authorLines = [];
    for (let i = emailIdx + 1; i < Math.min(emailIdx + 12, lines.length); i++) {
        const l = lines[i];
        const lo = l.toLowerCase();
        if (lo.startsWith('received') || lo.startsWith('revised') || lo.startsWith('accepted')) break;
        if (/^DOI/i.test(l)) break;
        if (AFFIL_KW.some(w => lo.includes(w))) break;
        if (/^\d+$/.test(l.trim())) continue;      // lone page numbers
        if (/^[a-zA-Z\*]$/.test(l.trim())) continue; // single char superscripts
        if (/^th$|^st$|^nd$|^rd$/i.test(l.trim())) continue;
        if (/Orchid|ORCID|0000-/i.test(l)) continue;
        if (l.trim().length > 2) authorLines.push(l.trim());
        if (authorLines.length >= 4) break; // rarely more than 2-3 author lines
    }

    if (authorLines.length > 0) {
        return cleanAuthors(authorLines.join(' '));
    }
    return '';
}

// ── main ──────────────────────────────────────────────────────────────────────

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');
    if (isDryRun) console.log('*** DRY-RUN MODE — no changes will be saved ***\n');

    const year2025 = await Year.findOne({ year: 2025 });
    if (!year2025) { console.log('No 2025 year doc found.'); process.exit(0); }

    const issues     = await Issue.find({ year: year2025._id });
    const issueIds   = issues.map(i => i._id);
    const categories = await Category.find({ issue: { $in: issueIds } });
    const catIds     = categories.map(c => c._id);
    const articles   = await Article.find({ category: { $in: catIds } });

    console.log(`Found ${articles.length} articles for 2025.\n`);

    let checked = 0, fixed = 0, skipped = 0, errors = 0;

    for (const art of articles) {
        const needsTitle  = isBadTitle(art.title);
        const needsAuthor = isBadAuthors(art.authors);
        if (!needsTitle && !needsAuthor) continue;

        checked++;
        console.log(`\n[${checked}] Article: ${art._id}`);
        if (needsTitle)  console.log(`  Title  (BAD): "${art.title}"`);
        if (needsAuthor) console.log(`  Authors(BAD): "${art.authors}"`);
        console.log(`  PDF: ${art.pdfUrl}`);

        const pdfAbsPath = path.join(__dirname, '../../frontend/public', art.pdfUrl);
        if (!fs.existsSync(pdfAbsPath)) {
            console.log(`  ❌ PDF file not found – skipping.`);
            skipped++;
            continue;
        }

        let lines;
        try {
            const buf  = fs.readFileSync(pdfAbsPath);
            const data = await pdfParse(buf);
            lines = data.text.split('\n').map(norm).filter(l => l.length > 0);
        } catch (err) {
            console.log(`  ❌ PDF parse error: ${err.message}`);
            errors++;
            continue;
        }

        const updates = {};

        // ── title fix ──
        if (needsTitle) {
            const newTitle = extractTitle(lines);
            if (newTitle && newTitle.length >= 10) {
                console.log(`  ✅ New Title : "${newTitle}"`);
                updates.title = newTitle;
            } else {
                console.log(`  ⚠️  Could not extract title – leaving unchanged.`);
            }
        }

        // ── author fix ──
        if (needsAuthor) {
            const newAuthors = extractAuthors(lines);
            if (newAuthors && newAuthors.length >= 3) {
                console.log(`  ✅ New Authors: "${newAuthors}"`);
                updates.authors = newAuthors;
            } else {
                console.log(`  ⚠️  Could not extract authors – leaving unchanged.`);
            }
        }

        if (Object.keys(updates).length === 0) {
            skipped++;
            continue;
        }

        if (!isDryRun) {
            try {
                await Article.findByIdAndUpdate(art._id, updates);
                fixed++;
                console.log(`  💾 Saved.`);
            } catch (err) {
                console.log(`  ❌ DB update error: ${err.message}`);
                errors++;
            }
        } else {
            fixed++;
            console.log(`  📝 [Dry-run] Would save updates.`);
        }
    }

    console.log('\n══════════════════════════════════════════');
    console.log(`  Articles checked : ${checked}`);
    console.log(`  Fixed            : ${fixed}`);
    console.log(`  Skipped          : ${skipped}`);
    console.log(`  Errors           : ${errors}`);
    console.log('══════════════════════════════════════════');
    process.exit(0);
}

run().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
