// fix_year_titles_authors.js
// Usage: node scripts/fix_year_titles_authors.js [YEAR]
// Example for 2020: node scripts/fix_year_titles_authors.js 2020

require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

const Year = require('../models/Year');
const Issue = require('../models/Issue');
const Category = require('../models/Category');
const Article = require('../models/Article');

const isDryRun = process.argv.includes('--dry-run');
// Parse year argument (defaults to 2025 if not provided)
let targetYear = 2025;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (!isNaN(parseInt(arg))) {
    targetYear = parseInt(arg);
    break;
  }
}

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
  'bilaspur', 'chhattisgarh', 'gaya', 'bokaro', 'dumka', 'jamshedpur', 'garhwa',
  'madhepura', 'saharsa', 'chapra', 'sonpur', 'saran', 'vaishali',
  'darbhanga', 'motihari', 'bodh', 'barasat', 'brainware', 'svyasa',
  'swami vivekananda', 'jawaharlal', 'new delhi', 'udaipur', 'mohanlal',
  'sukhadia', 'rajasthan'
];

function isBadTitle(title) {
  if (!title) return true;
  return /ISSN/i.test(title) && /Vol\./i.test(title) && /pp\./i.test(title);
}

function isBadAuthors(authors) {
  if (!authors) return true;
  if (authors.trim().startsWith(',')) return true;
  if (/^Phone\s*:/i.test(authors.trim())) return true;
  if (/Orchid\s*(Number)?/i.test(authors)) return true;
  if (/0000-\d{4}-\d{4}-\d{4}/i.test(authors)) return true;
  if (AFFIL_KW.some(k => {
    const idx = authors.toLowerCase().indexOf(k);
    return idx !== -1 && idx > authors.length * 0.5;
  })) return true;
  return false;
}

function extractTitle(lines) {
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    const lower = lines[i].toLowerCase();
    if (lower.startsWith('abstract') || lower.startsWith('key word') || lower.startsWith('introduction')) break;
    if (/^\d+$/.test(lines[i]) && parseInt(lines[i]) < 500) continue;
    if (lower.includes('biospectra') || lower.includes('issn') || lower.includes('vol.') || lower.includes('pp.')) continue;
    if (SECTION_NAMES.some(s => lower.includes(s))) continue;
    if (lower.includes('received') || lower.includes('revised') || lower.includes('accepted')) continue;
    if (lower.includes('@') || lower.startsWith('phone') || lower.startsWith('doi')) continue;
    let title = lines[i].replace(/^[\d\s\.]+/, '').trim();
    if (i + 1 < lines.length) {
      const next = lines[i + 1];
      const nextL = next.toLowerCase();
      if (!nextL.startsWith('abstract') && !nextL.startsWith('key word') && !nextL.startsWith('introduction') &&
          !nextL.includes('issn') && !nextL.includes('biospectra') && next.length > 5 && next.length < 150 &&
          !SECTION_NAMES.some(s => nextL.includes(s))) {
        const nextClean = next.replace(/^[\d\s\.]+/, '').trim();
        if (nextClean.length > 3) title += ' ' + nextClean;
      }
    }
    if (title.length >= 10) return title;
  }
  // fallback strategies omitted for brevity – you can reuse the ones from fix_2025_titles_authors.js if needed.
  return '';
}

function cleanAuthors(raw) {
  return raw
    .replace(/[\d\*†‡§¶#]+/g, '')
    .replace(/\bOrchid\b.*$/i, '')
    .replace(/\bORCID\b.*$/i, '')
    .replace(/0000-\d{4}-\d{4}-\d{4}/g, '')
    .replace(/\b[a-z]\b/g, '')
    .replace(/\s+,\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/^[,\s\&\*]+|[,\s\&\*]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAuthors(lines) {
  let searchStart = lines.findIndex(l => /\*?\s*Corresponding author\s*:/i.test(l));
  let phoneIdx = lines.findIndex(l => /^Phone\s*[:\s]/i.test(l));
  if (searchStart === -1 && phoneIdx !== -1) searchStart = phoneIdx;
  if (searchStart === -1) return '';
  let emailIdx = -1;
  for (let i = searchStart; i < Math.min(searchStart + 6, lines.length); i++) {
    if (/^E-mail\s*:/i.test(lines[i]) || (lines[i].includes('@') && lines[i].length < 80)) {
      emailIdx = i;
      break;
    }
  }
  if (emailIdx === -1) emailIdx = (phoneIdx !== -1) ? phoneIdx + 1 : searchStart + 2;
  const authorLines = [];
  for (let i = emailIdx + 1; i < Math.min(emailIdx + 12, lines.length); i++) {
    const l = lines[i];
    const lo = l.toLowerCase();
    if (lo.startsWith('received') || lo.startsWith('revised') || lo.startsWith('accepted')) break;
    if (/^DOI/i.test(l)) break;
    if (AFFIL_KW.some(w => lo.includes(w))) break;
    if (/^\d+$/.test(l.trim())) continue;
    if (/^[a-zA-Z\*]$/.test(l.trim())) continue;
    if (/^th$|^st$|^nd$|^rd$/i.test(l.trim())) continue;
    if (/Orchid|ORCID|0000-/i.test(l)) continue;
    if (l.trim().length > 2) authorLines.push(l.trim());
    if (authorLines.length >= 4) break;
  }
  if (authorLines.length > 0) return cleanAuthors(authorLines.join(' '));
  return '';
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.');
  if (isDryRun) console.log('*** DRY‑RUN MODE — no changes will be saved ***\n');

  const yearDoc = await Year.findOne({ year: targetYear });
  if (!yearDoc) { console.log(`No year ${targetYear} document found.`); process.exit(0); }

  // Find Issue 2 for the target year
  const issueDoc = await Issue.findOne({ year: yearDoc._id, order: 2 });
  if (!issueDoc) { console.log(`Year ${targetYear} Issue 2 not found.`); process.exit(0); }

  const categories = await Category.find({ issue: issueDoc._id });
  const catIds = categories.map(c => c._id);
  const articles = await Article.find({ category: { $in: catIds } });

  console.log(`Found ${articles.length} articles for ${targetYear} Issue 2.\n`);

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

    // Determine PDF source – local file or remote URL
    let pdfBuffer;
    if (art.pdfUrl.startsWith('http') || art.pdfUrl.startsWith('https')) {
      // Remote URL – download directly
      try {
        const https = require('https');
        const url = art.pdfUrl;
        pdfBuffer = await new Promise((resolve, reject) => {
          https.get(url, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', err => reject(err));
          });
        });
      } catch (err) {
        console.log('  ❌ Could not download PDF – skipping.');
        skipped++;
        continue;
      }
    } else {
      // Assume local path relative to frontend/public
      const pdfAbsPath = path.join(__dirname, '../../frontend/public', art.pdfUrl);
      if (fs.existsSync(pdfAbsPath)) {
        pdfBuffer = fs.readFileSync(pdfAbsPath);
      } else {
        console.log('  ❌ PDF file not found – skipping.');
        skipped++;
        continue;
      }
    }

    let lines;
    try {
      const data = await pdfParse(pdfBuffer);
      lines = data.text.split('\n').map(norm).filter(l => l.length > 0);
    } catch (err) {
      console.log(`  ❌ PDF parse error: ${err.message}`);
      errors++;
      continue;
    }

    const updates = {};
    if (needsTitle) {
      const newTitle = extractTitle(lines);
      if (newTitle && newTitle.length >= 10) {
        console.log(`  ✅ New Title : "${newTitle}"`);
        updates.title = newTitle;
      } else {
        console.log('  ⚠️  Could not extract title – leaving unchanged.');
      }
    }
    if (needsAuthor) {
      const newAuthors = extractAuthors(lines);
      if (newAuthors && newAuthors.length >= 3) {
        console.log(`  ✅ New Authors: "${newAuthors}"`);
        updates.authors = newAuthors;
      } else {
        console.log('  ⚠️  Could not extract authors – leaving unchanged.');
      }
    }
    if (Object.keys(updates).length === 0) { skipped++; continue; }
    if (!isDryRun) {
      try {
        await Article.findByIdAndUpdate(art._id, updates);
        fixed++;
        console.log('  💾 Saved.');
      } catch (err) {
        console.log(`  ❌ DB update error: ${err.message}`);
        errors++;
      }
    } else {
      fixed++;
      console.log('  📝 [Dry‑run] Would save updates.');
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

run().catch(err => { console.error('Fatal error:', err); process.exit(1); });
