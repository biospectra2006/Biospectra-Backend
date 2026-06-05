const Article = require('../models/Article');
const Year = require('../models/Year');
const Issue = require('../models/Issue');
const Category = require('../models/Category');
const { cloudinary } = require('../config/cloudinary');
const { validateFileContent, PDF_MAGIC } = require('../config/multerTemp');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

const deleteArticleFile = async (article) => {
    try {
        if (article.pdfUrl && article.pdfUrl.startsWith('/pdf biospectra/')) {
            const localPath = path.join(__dirname, '../../frontend/public', article.pdfUrl);
            if (fs.existsSync(localPath)) {
                fs.unlinkSync(localPath);
                console.log('Deleted local article file:', localPath);
            }
        } else if (article.cloudinaryId) {
            await cloudinary.uploader.destroy(article.cloudinaryId);
            console.log('Deleted Cloudinary file:', article.cloudinaryId);
        }
    } catch (err) {
        console.error('Failed to delete file for article:', article._id, err.message);
    }
};

exports.uploadArticle = async (req, res) => {
    try {
        const { categoryId, title, authors, affiliation, abstract, keywords, pages, doi } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        // Validate PDF magic bytes
        if (!validateFileContent(req.file.path, [{ magic: PDF_MAGIC }])) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ message: 'File is not a valid PDF' });
        }

        let finalPages = pages;
        if (!finalPages && req.file) {
            try {
                // First try to extract from filename (e.g. "57-66.pdf" or "Article 57-66.pdf")
                const originalName = req.file.originalname || '';
                const pageMatch = originalName.match(/(\d+)\s*-\s*(\d+)/);
                
                if (pageMatch) {
                    finalPages = `${pageMatch[1]}-${pageMatch[2]}`;
                } else {
                    const pdfBytes = fs.readFileSync(req.file.path);
                    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
                    const numPages = pdfDoc.getPageCount();
                
                const category = await Category.findById(categoryId);
                if (category) {
                    const allCategoriesInIssue = await Category.find({ issue: category.issue });
                    const categoryIds = allCategoriesInIssue.map(c => c._id);
                    const existingArticles = await Article.find({ category: { $in: categoryIds } });
                    
                    let maxEndPage = 0;
                    existingArticles.forEach(art => {
                        if (art.pages) {
                            const parts = art.pages.split('-');
                            const endPageStr = parts[parts.length - 1];
                            const endPage = parseInt(endPageStr.trim());
                            if (!isNaN(endPage) && endPage > maxEndPage) {
                                maxEndPage = endPage;
                            }
                        }
                    });
                    
                    
                    const startPage = maxEndPage + 1;
                    const endPage = startPage + numPages - 1;
                    finalPages = startPage === endPage ? `${startPage}` : `${startPage}-${endPage}`;
                }
                } // Close else block
            } catch (err) {
                console.error("Failed to auto-generate pages:", err.message);
            }
        }


        let pdfUrl = '';
        let cloudinaryId = '';

        try {
            console.log('Attempting Cloudinary upload for article:', req.file.filename);
            const result = await cloudinary.uploader.upload(req.file.path, {
                folder: 'spectra_articles',
                resource_type: 'raw'
            });
            pdfUrl = result.secure_url;
            cloudinaryId = result.public_id;
            
            // Delete temp file asynchronously
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Failed to delete temp file:', err);
            });
        } catch (cloudinaryError) {
            console.warn('Cloudinary upload failed, falling back to local storage:', cloudinaryError.message);
            
            // Fallback: move file to permanent local storage
            const targetDir = path.join(__dirname, '../../frontend/public/pdf biospectra');
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
            
            const targetPath = path.join(targetDir, req.file.filename);
            fs.renameSync(req.file.path, targetPath);
            
            pdfUrl = `/pdf biospectra/${req.file.filename}`;
            cloudinaryId = '';
        }

        const newArticle = new Article({
            category: categoryId,
            title,
            authors,
            affiliation,
            abstract,
            keywords: keywords ? keywords.split(',').map(k => k.trim()) : [],
            pages: finalPages,
            doi,
            pdfUrl,
            cloudinaryId
        });

        await newArticle.save();
        res.status(201).json(newArticle);
    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(400).json({ message: error.message });
    }
};

exports.getArticlesByCategory = async (req, res) => {
    try {
        const articles = await Article.find({ category: req.params.categoryId });
        res.json(articles);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getArticleById = async (req, res) => {
    try {
        const article = await Article.findById(req.params.id).populate({
            path: 'category',
            populate: {
                path: 'issue',
                populate: {
                    path: 'year'
                }
            }
        });
        if (!article) return res.status(404).json({ message: 'Article not found' });
        res.json(article);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.deleteArticle = async (req, res) => {
    try {
        const article = await Article.findById(req.params.id);
        if (!article) return res.status(404).json({ message: 'Article not found' });

        // Delete associated file (local or Cloudinary)
        await deleteArticleFile(article);
        
        // Delete from DB
        await Article.findByIdAndDelete(req.params.id);
        
        res.json({ message: 'Article deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
 
 exports.getLatestArticles = async (req, res) => {
     try {
         const limit = parseInt(req.query.limit) || 10;
         const articles = await Article.find()
             .sort({ createdAt: -1 })
             .limit(limit)
             .populate({
                 path: 'category',
                 populate: {
                     path: 'issue',
                     populate: {
                         path: 'year'
                     }
                 }
             });
         res.json(articles);
     } catch (error) {
         res.status(500).json({ message: error.message });
     }
 };

// --- HIERARCHY LOGIC ---

exports.getJournalTree = async (req, res) => {
    try {
        const years = await Year.find().sort({ year: -1 });
        const tree = await Promise.all(years.map(async (year) => {
            const issues = await Issue.find({ year: year._id }).sort({ order: 1 });
            const populatedIssues = await Promise.all(issues.map(async (issue) => {
                const categories = await Category.find({ issue: issue._id }).sort({ createdAt: 1 });
                const populatedCategories = await Promise.all(categories.map(async (cat) => {
                    const articles = await Article.find({ category: cat._id });
                    
                    // Sort articles by page number numerically
                    articles.sort((a, b) => {
                        const getStartPage = (pagesStr) => {
                            if (!pagesStr) return 999999;
                            const match = pagesStr.match(/^(\d+)/);
                            return match ? parseInt(match[1], 10) : 999999;
                        };
                        return getStartPage(a.pages) - getStartPage(b.pages);
                    });
                    
                    return { ...cat.toObject(), articles };
                }));
                return { ...issue.toObject(), categories: populatedCategories };
            }));
            return { ...year.toObject(), issues: populatedIssues };
        }));
        res.json(tree);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.initYear = async (req, res) => {
    try {
        const { year } = req.body;
        // Check if year exists
        let yearDoc = await Year.findOne({ year });
        if (yearDoc) return res.status(400).json({ message: 'Year already initialized' });
        
        yearDoc = new Year({ year });
        await yearDoc.save();

        // Auto-create 2 issues for the year
        const issue1 = new Issue({ year: yearDoc._id, title: `Issue 1 (Jan-Jun)`, order: 1 });
        const issue2 = new Issue({ year: yearDoc._id, title: `Issue 2 (Jul-Dec)`, order: 2 });
        await Promise.all([issue1.save(), issue2.save()]);

        res.status(201).json(yearDoc);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

exports.updateArticle = async (req, res) => {
    try {
        const { title, authors, affiliation, abstract, keywords, pages, doi, categoryId } = req.body;
        const updateData = {
            title,
            authors,
            affiliation,
            abstract,
            pages,
            doi
        };

        if (keywords) {
            updateData.keywords = Array.isArray(keywords) ? keywords : keywords.split(',').map(k => k.trim());
        }

        if (categoryId) {
            updateData.category = categoryId;
        }

        const article = await Article.findByIdAndUpdate(req.params.id, updateData, { new: true });
        if (!article) return res.status(404).json({ message: 'Article not found' });
        
        res.json(article);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

exports.deleteCategory = async (req, res) => {
    try {
        const { id } = req.params;
        
        // 1. Find all articles in this category to get their files
        const articles = await Article.find({ category: id });
        
        // 2. Delete all files (local or Cloudinary)
        const deletePromises = articles.map(article => deleteArticleFile(article));
        await Promise.all(deletePromises);

        // 3. Delete all articles in this category from DB
        await Article.deleteMany({ category: id });

        // 4. Delete the category itself
        await Category.findByIdAndDelete(id);
        
        res.json({ message: 'Section and all its articles (including files) deleted successfully' });
    } catch (error) {
        console.error('Delete Category Error:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.createIssue = async (req, res) => {
    try {
        const { yearId, title } = req.body;
        if (!yearId || !title) {
            return res.status(400).json({ message: 'Year ID and Title are required' });
        }
        const existingIssues = await Issue.find({ year: yearId });
        const maxOrder = existingIssues.reduce((max, issue) => Math.max(max, issue.order), 0);
        const issue = new Issue({ year: yearId, title, order: maxOrder + 1 });
        await issue.save();
        res.status(201).json(issue);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

exports.createCategory = async (req, res) => {
    try {
        const { issueId, title } = req.body;
        if (!issueId || !title) {
            return res.status(400).json({ message: 'Issue ID and Title are required' });
        }
        const category = new Category({ issue: issueId, title });
        await category.save();
        res.status(201).json(category);
    } catch (error) {
        console.error('Create Category Error:', error);
        res.status(400).json({ message: error.message });
    }
};

exports.deleteYear = async (req, res) => {
    try {
        const { id } = req.params;
        
        // 1. Find all issues for this year
        const issues = await Issue.find({ year: id });
        const issueIds = issues.map(i => i._id);

        // 2. Find all categories for these issues
        const categories = await Category.find({ issue: { $in: issueIds } });
        const categoryIds = categories.map(c => c._id);

        // 3. Find all articles for these categories
        const articles = await Article.find({ category: { $in: categoryIds } });
        
        // 4. Delete all article files (local or Cloudinary)
        const deletePromises = articles.map(article => deleteArticleFile(article));
        await Promise.all(deletePromises);

        // 5. Recursive DB Deletion
        await Article.deleteMany({ category: { $in: categoryIds } });
        await Category.deleteMany({ issue: { $in: issueIds } });
        await Issue.deleteMany({ year: id });
        await Year.findByIdAndDelete(id);

        res.json({ message: 'Volume and all associated content deleted successfully' });
    } catch (error) {
        console.error('Delete Year Error:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.deleteIssue = async (req, res) => {
    try {
        const { id } = req.params;
        
        // 1. Find all categories for this issue
        const categories = await Category.find({ issue: id });
        const categoryIds = categories.map(c => c._id);

        // 2. Find all articles for these categories
        const articles = await Article.find({ category: { $in: categoryIds } });
        
        // 3. Delete all article files (local or Cloudinary)
        const deletePromises = articles.map(article => deleteArticleFile(article));
        await Promise.all(deletePromises);

        // 4. Recursive DB Deletion
        await Article.deleteMany({ category: { $in: categoryIds } });
        await Category.deleteMany({ issue: id });
        await Issue.findByIdAndDelete(id);

        res.json({ message: 'Issue and all associated content deleted successfully' });
    } catch (error) {
        console.error('Delete Issue Error:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.updateIssue = async (req, res) => {
    try {
        const { id } = req.params;
        const { title } = req.body;
        if (!title) {
            return res.status(400).json({ message: 'Title is required' });
        }
        const issue = await Issue.findByIdAndUpdate(id, { title }, { new: true });
        if (!issue) return res.status(404).json({ message: 'Issue not found' });
        res.json(issue);
    } catch (error) {
        console.error('Update Issue Error:', error);
        res.status(500).json({ message: error.message });
    }
};

const pdfParse = require('pdf-parse');

exports.extractPdfMetadata = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        // Validate PDF magic bytes
        if (!validateFileContent(req.file.path, [{ magic: PDF_MAGIC }])) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ message: 'File is not a valid PDF' });
        }

        // Read and parse PDF
        const buffer = fs.readFileSync(req.file.path);
        const parsed = await pdfParse(buffer);
        
        // Remove temp file
        fs.unlink(req.file.path, (err) => {
            if (err) console.error('Failed to delete temp file:', err);
        });

        // ─── METADATA EXTRACTION LOGIC ───
        const lines = parsed.text.split('\n').map(l => l.replace(/[\s\xa0\u00a0]+/g, ' ').trim()).filter(l => l.length > 0);
        const snippet = parsed.text.substring(0, 6000);
        const flat    = snippet.replace(/[ \t]+/g, ' ').replace(/\r/g, '');

        const result = { title: '', authors: '', abstract: '', keywords: '', doi: '', pages: '' };

        // Pages from header "pp. 1-4"
        const pagesMatch = flat.match(/pp\.\s*(\d+\s*[-–]\s*\d+)/i);
        if (pagesMatch) result.pages = pagesMatch[1].replace(/\s/g, '').replace('–', '-');

        // DOI
        const doiMatch = flat.match(/DOI\s*[:\-]?\s*-?\s*(10\.\d{4,}\/\S+)/i);
        if (doiMatch) result.doi = doiMatch[1].replace(/[.,]$/, '');

        // Abstract
        const absMatch = flat.match(/Abstract\s*[-–:]\s*([\s\S]+?)(?=\nKeywords?[\s:.–]|\nKey\s*words?[\s:.–])/i);
        if (absMatch) result.abstract = absMatch[1].replace(/\s+/g, ' ').trim();
        if (!result.abstract) {
            const m2 = flat.match(/Abstract[^a-z]{0,5}([\s\S]+?)Keywords?\s*[:.–]/i);
            if (m2) result.abstract = m2[1].replace(/\s+/g, ' ').trim();
        }

        // Keywords
        const kwMatch = flat.match(/Key\s*words?\s*[:.–]\s*([\s\S]+?)(?:\n[A-Z]|INTRODUCTION|Received\s*:|$)/i);
        if (kwMatch) {
            const kwArray = kwMatch[1]
                .replace(/\s+/g, ' ').replace(/\.\s*$/, '')
                .split(/[,;]/).map(k => k.trim()).filter(Boolean);
            result.keywords = kwArray.join(', ');
        }

        // ── AUTHORS & AFFILIATION (Scan backward from Received line) ──
        const receivedIdx = lines.slice(0, 100).findIndex(l => {
            const lower = l.toLowerCase();
            return lower.includes('received') || lower.includes('revised') || lower.includes('accepted');
        });

        let authors = '';
        let affiliation = '';

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

                // Skip journal headers, page numbers
                if (/^\d+$/.test(line) || lower.includes('biospectra') || lower.includes('issn') || lower.includes('vol.') || lower.includes('science') && lower.length < 25) continue;

                // Stop at abstract or keywords
                if (lower.startsWith('abstract') || lower.startsWith('key word') || lower.startsWith('keywords') || lower.startsWith('introduction')) break;
                if (lower.includes('corresponding author') || lower.includes('correspondent author') || lower.includes('phone:') || lower.includes('e-mail:') || lower.includes('@')) break;

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

            // If trailing author superscripts (e.g. 'c' for Sahay^c) got pushed into the top of affLines
            // because they are short lines, shift them back to authorLines.
            // Rule: If there are multiple short lines at the top of affLines, all but the last one 
            // belong to the authors block.
            while (affLines.length >= 2 && affLines[0].length <= 3 && affLines[1].length <= 3) {
                authorLines.push(affLines.shift());
            }

            if (authorLines.length > 0) {
                // Step 1: Join raw lines
                let rawAuthors = authorLines.join(' ');
                
                // Step 2: Convert superscript patterns to ^notation BEFORE stripping
                // Pattern: "Name {a,b}" where space separates name from letters
                //   e.g. "Jha a," or "Jha a b," — space then single/double letter superscripts before comma/&
                rawAuthors = rawAuthors
                    .replace(/([A-Z][a-z]+)\s+([a-z]{1,2})(?=[,\s&*†‡§]|$)/g, (match, name, sup) => {
                        return `${name}^${sup}`;
                    })
                    // Unicode superscripts → ^a ^b ^1 etc.
                    .replace(/[\u1D43\u1D47\u1D9C\u1D48\u1D49\u1DA0\u1D4D\u02B0\u2071\u02B2\u1D4F\u02E1\u1D50\u207F\u1D52\u1D56\u02B3\u02E2\u1D57\u1D58\u1D5B\u02B7\u02E3\u02B8\u1DBB]/g, s => {
                        const keys = '\u1D43\u1D47\u1D9C\u1D48\u1D49\u1DA0\u1D4D\u02B0\u2071\u02B2\u1D4F\u02E1\u1D50\u207F\u1D52\u1D56\u02B3\u02E2\u1D57\u1D58\u1D5B\u02B7\u02E3\u02B8\u1DBB';
                        const vals = 'abcdefghijklmnoprstuvwxyz';
                        const idx = keys.indexOf(s);
                        return `^${idx >= 0 ? vals[idx] : s}`;
                    })
                    .replace(/[\u00B9\u00B2\u00B3\u2074\u2075\u2076\u2077\u2078\u2079\u2070]/g, s => {
                        const keys = '\u00B9\u00B2\u00B3\u2074\u2075\u2076\u2077\u2078\u2079\u2070';
                        const vals = '1234567890';
                        const idx = keys.indexOf(s);
                        return `^${idx >= 0 ? vals[idx] : s}`;
                    });

                // Step 3: Clean up — but preserve ^notation and *
                authors = rawAuthors
                    .replace(/[†‡§¶#]/g, '')          // strip special footnote chars (not * which = corresponding)
                    .replace(/\s+,\s*/g, ', ')
                    .replace(/,\s*,/g, ',')
                    .replace(/^[,\s&]+|[,\s&]+$/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();
                authors = authors.replace(/\s+and\s*$/i, '').trim();
            }

            if (affLines.length > 0) {
                // Group standalone letters (like 'a', 'b') as prefixes for the following line
                let mergedAff = [];
                let prefix = '';
                for (let i = 0; i < affLines.length; i++) {
                    const line = affLines[i].trim();
                    if (/^[a-z]{1,3}\*?$/.test(line)) {
                        prefix += (prefix ? ',' : '') + line;
                    } else {
                        mergedAff.push((prefix ? prefix + ' ' : '') + line);
                        prefix = '';
                    }
                }
                
                let rawAff = mergedAff.join(' | ');
                
                // Convert affiliation superscript prefixes:
                // "aDept. of Zoology" → "^a Dept. of Zoology"
                // "a*Dept." or "a,bDept." → "^a,b Dept."
                rawAff = rawAff
                    // Leading superscript letter(s) before a capital word/asterisk in an affiliation segment
                    .replace(/(^|\|\s*)([a-z]{1,3}(?:,[a-z]{1,3})*)\s*(\*?)\s*([A-Z])/g, (match, sep, sup, star, cap) => {
                        return `${sep}^${sup}${star} ${cap}`;
                    })
                    // Unicode superscripts in affiliations
                    .replace(/[\u1D43\u1D47\u1D9C\u1D48\u1D49\u1DA0\u1D4D\u02B0\u2071\u02B2\u1D4F\u02E1\u1D50\u207F\u1D52\u1D56\u02B3\u02E2\u1D57\u1D58\u1D5B\u02B7\u02E3\u02B8\u1DBB]/g, s => {
                        const keys = '\u1D43\u1D47\u1D9C\u1D48\u1D49\u1DA0\u1D4D\u02B0\u2071\u02B2\u1D4F\u02E1\u1D50\u207F\u1D52\u1D56\u02B3\u02E2\u1D57\u1D58\u1D5B\u02B7\u02E3\u02B8\u1DBB';
                        const vals = 'abcdefghijklmnoprstuvwxyz';
                        const idx = keys.indexOf(s);
                        return `^${idx >= 0 ? vals[idx] : s}`;
                    })
                    .replace(/[\u00B9\u00B2\u00B3\u2074\u2075\u2076\u2077\u2078\u2079\u2070]/g, s => {
                        const keys = '\u00B9\u00B2\u00B3\u2074\u2075\u2076\u2077\u2078\u2079\u2070';
                        const vals = '1234567890';
                        const idx = keys.indexOf(s);
                        return `^${idx >= 0 ? vals[idx] : s}`;
                    });

                affiliation = rawAff
                    .replace(/[†‡§¶#]/g, '')
                    .replace(/\s+/g, ' ')
                    .replace(/\s*\|\s*/g, ' | ')
                    .trim();
            }
        }

        result.authors = authors;
        result.affiliation = affiliation;

        // ── TITLE (Lines between header/page number and Abstract/Authors block) ──
        const abstractLineIdx = lines.findIndex(l => l.toLowerCase().startsWith('abstract'));
        let title = '';
        if (abstractLineIdx !== -1) {
            const titleLines = [];
            for (let i = 0; i < Math.min(abstractLineIdx, 30); i++) {
                const line = lines[i];
                const lower = line.toLowerCase();
                
                if (/^\d+$/.test(line) || lower.includes('biospectra') || lower.includes('issn') || lower.includes('vol.') || lower.includes('pp.')) continue;
                if (lower.includes('received') || lower.includes('revised') || lower.includes('department') || lower.includes('university') || lower.includes('corresponding author')) continue;
                if (authors && line.includes(authors)) continue;
                if (affiliation && line.includes(affiliation)) continue;
                
                titleLines.push(line);
            }
            title = titleLines.join(' ').trim();
        }

        if (!title || title.length < 10) {
            const firstFew = lines.slice(0, 15).filter(line => {
                const lower = line.toLowerCase();
                return !lower.includes('biospectra') && !lower.includes('issn') && !lower.includes('vol.') && !/^\d+$/.test(line);
            });
            title = firstFew[0] || '';
        }

        result.title = title;

        // Basic cleanups for placeholder check
        const badKeywords = ['biospectra', 'contributor', 'india', 'university', 'jharkhand', 'department', 'college', 'institute', 'hazards', 'science'];
        if (result.keywords && badKeywords.some(bad => result.keywords.toLowerCase().includes(bad))) {
            result.keywords = '';
        }
        const badAuthors = ['biospectra', 'contributor', 'india', 'university', 'jharkhand', 'department', 'college', 'institute', 'hazards', 'science'];
        if (result.authors && badAuthors.some(bad => result.authors.toLowerCase().includes(bad))) {
            result.authors = '';
        }
        const badTitles = ['biospectra', 'issn', '0973-7057', 'research article', 'vol.', 'pp.'];
        if (result.title && badTitles.some(bad => result.title.toLowerCase().includes(bad))) {
            result.title = '';
        }

        // ── AUTO-ITALICIZE SCIENTIFIC NAMES IN TITLE ──
        // Heuristic: If any extracted keyword (>4 chars) appears in the title, wrap it in <i> tags
        if (result.title && result.keywords) {
            // Sort by length descending to replace longer phrases first (avoids nested <i> tags)
            const kwArray = result.keywords.split(',')
                .map(k => k.trim())
                .filter(k => k.length > 4)
                .sort((a, b) => b.length - a.length);
                
            kwArray.forEach(kw => {
                const safeKw = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
                // \b = word boundary, (?!([^<]+)?>) = negative lookahead to prevent double-wrapping inside existing <i> tags
                const regex = new RegExp(`\\b(${safeKw})\\b(?!([^<]+)?>)`, 'gi');
                result.title = result.title.replace(regex, '<i>$1</i>');
            });
        }

        return res.status(200).json({ status: 'success', data: result });
    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        console.error('Extract PDF Metadata Error:', error);
        res.status(500).json({ message: error.message });
    }
};


