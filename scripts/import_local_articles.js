require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const Article = require('../models/Article');
const Year = require('../models/Year');
const Issue = require('../models/Issue');
const Category = require('../models/Category');

const CATEGORY_MAP = {
    'animal': 'Animal Science',
    'plant': 'Plant Science',
    'environmental': 'Environmental Science',
    'medical': 'Medical Sciences',
    'interdisciplinary': 'Interdisciplinary Science',
    'transdisciplinary': 'Transdisciplinary Science'
};

const BASE_DIR = 'C:/Users/Asus/Desktop/spectra/frontend/public/assets/Pdf Biospectra';

function extractMetadata(lines) {
    let title = '';
    let authors = '';
    let abstract = '';
    
    // Find Title
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
        const lower = lines[i].toLowerCase();
        if (lower.startsWith('abstract') || lower.startsWith('key word') || lower.startsWith('introduction')) break;
        if (/^\d+$/.test(lines[i]) && parseInt(lines[i]) < 500) continue;
        if (lower.includes('biospectra') || lower.includes('issn') || lower.includes('vol.')) continue;
        if (lower.includes('received') || lower.includes('revised') || lower.includes('accepted')) continue;
        
        let t = lines[i];
        if (i + 1 < lines.length) {
            const next = lines[i + 1].toLowerCase();
            if (!next.startsWith('abstract') && !next.startsWith('key word') && lines[i+1].length > 10) {
                t += ' ' + lines[i + 1];
            }
        }
        t = t.replace(/^[\d\s\.]+/, '').trim();
        if (t.length >= 10) {
            title = t;
            break;
        }
    }
    
    // Find Authors
    const receivedIdx = lines.findIndex(l => l.toLowerCase().includes('received') || l.toLowerCase().includes('revised') || l.toLowerCase().includes('accepted'));
    if (receivedIdx !== -1) {
        let authorLines = [];
        for (let i = receivedIdx - 1; i >= 0; i--) {
            const line = lines[i];
            const lower = line.toLowerCase();
            if (lower.includes('department') || lower.includes('university') || lower.includes('college') || line.length <= 3) continue;
            if (lower.startsWith('abstract') || lower.startsWith('key word')) break;
            if (lower.includes('corresponding') || lower.includes('@')) break;
            if (line.length > 4 && !/[A-Z]/.test(line)) break;
            authorLines.unshift(line);
            if (authorLines.length >= 3) break;
        }
        if (authorLines.length > 0) {
            authors = authorLines.join(' ').replace(/[\d\*†‡§¶#]+/g, '').trim();
        }
    }
    
    // Find Abstract
    const full = lines.join(' ');
    const ai = full.toLowerCase().indexOf('abstract');
    if (ai !== -1) {
        let start = ai + 8;
        while (start < full.length && [':', '-', '.', ' '].includes(full[start])) start++;
        let end = full.toLowerCase().indexOf('key words', start);
        if (end === -1) end = full.toLowerCase().indexOf('keywords', start);
        if (end === -1) end = start + 1000;
        abstract = full.substring(start, end).trim();
    }
    
    return { title, authors, abstract };
}

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB');

    const issueDirs = fs.readdirSync(BASE_DIR);
    
    for (const issueDir of issueDirs) {
        const fullIssueDir = path.join(BASE_DIR, issueDir);
        if (!fs.statSync(fullIssueDir).isDirectory()) continue;
        
        // Parse "13 march", "14 September", etc.
        const parts = issueDir.toLowerCase().split(' ');
        if (parts.length < 2) continue;
        
        const yearVal = parseInt(parts[0], 10);
        if (isNaN(yearVal)) continue;
        const realYear = 2000 + yearVal; // e.g., 13 -> 2013
        
        const monthPart = parts.slice(1).join(' ').trim();
        const order = monthPart.includes('sep') || monthPart.includes('dec') ? 2 : 1;
        const titleIssue = order === 1 ? 'Issue 1 (Jan-Jun)' : 'Issue 2 (Jul-Dec)';
        
        let yearDoc = await Year.findOne({ year: realYear });
        if (!yearDoc) {
            yearDoc = new Year({ year: realYear });
            await yearDoc.save();
        }
        
        let issueDoc = await Issue.findOne({ year: yearDoc._id, order: order });
        if (!issueDoc) {
            issueDoc = new Issue({
                year: yearDoc._id,
                title: `${titleIssue} ${realYear}`,
                order: order,
                pdfs: []
            });
            await issueDoc.save();
        }
        
        console.log(`\nProcessing ${realYear} Issue ${order} (${issueDir})...`);
        
        const catDirs = fs.readdirSync(fullIssueDir);
        for (const catDir of catDirs) {
            const fullCatDir = path.join(fullIssueDir, catDir);
            if (!fs.statSync(fullCatDir).isDirectory()) continue;
            
            const catNameKey = Object.keys(CATEGORY_MAP).find(k => catDir.toLowerCase().includes(k));
            const categoryTitle = catNameKey ? CATEGORY_MAP[catNameKey] : (catDir.charAt(0).toUpperCase() + catDir.slice(1));
            
            let categoryDoc = await Category.findOne({ title: categoryTitle, issue: issueDoc._id });
            if (!categoryDoc) {
                categoryDoc = new Category({ title: categoryTitle, issue: issueDoc._id });
                await categoryDoc.save();
            }
            
            const pdfs = fs.readdirSync(fullCatDir).filter(f => f.endsWith('.pdf'));
            console.log(`  Found ${pdfs.length} PDFs in ${categoryTitle}...`);
            
            for (const pdfFile of pdfs) {
                const pdfPath = path.join(fullCatDir, pdfFile);
                const pageRangeMatch = pdfFile.match(/^(\d+)-(\d+)\.pdf$/i);
                const pageRange = pageRangeMatch ? `${pageRangeMatch[1]}-${pageRangeMatch[2]}` : pdfFile.replace('.pdf', '');
                
                let title = 'Research Article';
                let authors = '';
                let abstract = '';
                
                try {
                    const data = await pdfParse(fs.readFileSync(pdfPath), { max: 1 });
                    const lines = data.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    const meta = extractMetadata(lines);
                    if (meta.title.length > 10) title = meta.title;
                    if (meta.authors.length > 3) authors = meta.authors;
                    abstract = meta.abstract;
                } catch (e) {
                    console.warn(`    Failed to parse ${pdfFile}: ${e.message}`);
                }
                
                // e.g. /assets/Pdf Biospectra/13 march/animal/1-10.pdf
                const frontendUrl = `/assets/Pdf Biospectra/${issueDir}/${catDir}/${pdfFile}`;
                
                const existing = await Article.findOne({ title, year: yearDoc._id, category: categoryDoc._id });
                if (existing) {
                    await Article.findByIdAndUpdate(existing._id, {
                        authors,
                        abstract,
                        pdfUrl: frontendUrl,
                        pageRange
                    });
                } else {
                    const newArt = new Article({
                        title: title || 'Research Article',
                        authors: authors || 'Biospectra Authors',
                        abstract: abstract || '',
                        pdfUrl: frontendUrl,
                        pageRange,
                        category: categoryDoc._id,
                        year: yearDoc._id,
                        issue: issueDoc._id
                    });
                    await newArt.save();
                }
            }
        }
    }
    
    console.log('✅ Done importing local articles!');
    process.exit(0);
}

run().catch(console.error);
