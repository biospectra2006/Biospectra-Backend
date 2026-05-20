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

const sourceBase = path.join(__dirname, '../../frontend/public/assets/Pdf Biospectra/13 march');
const CATEGORY_MAP = {
  'animal': 'Animal Science',
  'environmental': 'Environmental Science',
  'plant': 'Plant Science',
};
const SECTION_NAMES = Object.values(CATEGORY_MAP);

function normalizeLine(l) {
  return l.replace(/[\s\xa0\u00a0]+/g, ' ').replace(/[\xad\u00ad\u2013\u2014]+/g, '-').trim();
}

async function cleanCloudinary() {
  try {
    let hasMore = true;
    let nextCursor = null;
    let count = 0;
    while (hasMore) {
      const result = await cloudinary.api.resources({
        type: 'upload', prefix: 'spectra_articles', max_results: 100, next_cursor: nextCursor
      });
      if (result.resources.length > 0) {
        const ids = result.resources.map(r => r.public_id);
        await cloudinary.api.delete_resources(ids);
        count += ids.length;
      }
      nextCursor = result.next_cursor;
      hasMore = !!nextCursor;
    }
    console.log(`Cleaned ${count} Cloudinary files`);
  } catch (e) {
    console.log('Cloudinary clean note:', e.message);
  }
}

async function cleanDatabase() {
  await Article.deleteMany({});
  await Category.deleteMany({});
  await Issue.deleteMany({});
  await Year.deleteMany({});
  console.log('Database cleared');
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

  const affKeywords = ['department', 'dept', 'university', 'laboratory', 'lab', 'college',
    'institute', 'school', 'research', 'centre', 'center', 'trust', 'academy',
    'india', 'bihar', 'jharkhand', 'patna', 'ranchi', 'jaipur', 'rajasthan',
    'road', 'hazaribagh', 'muzaffarpur', 'bhagalpur', 'lucknow', 'delhi'];

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
    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'spectra_articles',
      resource_type: 'raw',
      public_id: path.basename(filePath, '.pdf') + '_' + Date.now(),
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
    issueDoc = await Issue.create({ year: yearDoc._id, title: 'Issue 1 (Jan-Jun)', order: issueOrder });
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
    console.log('Connected.');

    console.log('\n1. Cleaning database...');
    await cleanDatabase();
    console.log('2. Cleaning Cloudinary...');
    await cleanCloudinary();

    console.log('\n3. Processing 13 March folder...');
    if (!fs.existsSync(sourceBase)) {
      console.error(`Source not found: ${sourceBase}`);
      process.exit(1);
    }

    const sectionFolders = fs.readdirSync(sourceBase).filter(f => fs.statSync(path.join(sourceBase, f)).isDirectory());
    console.log(`Sections found: ${sectionFolders.join(', ')}`);

    let totalSuccess = 0, totalFailed = 0;

    for (const section of sectionFolders) {
      const sectionPath = path.join(sourceBase, section);
      const categoryName = CATEGORY_MAP[section.toLowerCase()] || 'Research Articles';
      const pdfs = fs.readdirSync(sectionPath).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
      if (pdfs.length === 0) continue;

      console.log(`\n📂 ${section} → ${categoryName} (${pdfs.length} PDFs)`);

      const { categoryDoc } = await ensureHierarchy(2013, 1, categoryName);

      for (const pdfFile of pdfs) {
        const pdfPath = path.join(sectionPath, pdfFile);
        try {
          const stats = fs.statSync(pdfPath);
          if (stats.size < 1024) { totalFailed++; continue; }

          const info = await extractPdfInfo(pdfPath);
          if (!info) { console.log(`   ❌ ${pdfFile} (parse failed)`); totalFailed++; continue; }

          console.log(`   📄 ${pdfFile} → uploading...`);
          const { url, id } = await uploadToCloudinary(pdfPath);

          await Article.create({
            category: categoryDoc._id,
            title: info.title,
            authors: info.authors,
            affiliation: info.affiliation,
            doi: info.doi,
            abstract: info.abstract,
            keywords: info.keywords,
            pages: info.pages,
            pdfUrl: url,
            cloudinaryId: id,
            content: info.content,
          });

          console.log(`      ✅ ${info.title.slice(0, 60)}...`);
          totalSuccess++;
        } catch (err) {
          console.log(`   ❌ ${pdfFile} (${err.message.slice(0, 100)})`);
          totalFailed++;
        }
      }
    }

    console.log(`\n=== IMPORT COMPLETE ===`);
    console.log(`✅ Success: ${totalSuccess}`);
    console.log(`❌ Failed:  ${totalFailed}`);

    process.exit(0);
  } catch (error) {
    console.error('Fatal:', error);
    process.exit(1);
  }
}

run();
