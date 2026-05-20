const Article = require('../models/Article');
const Year = require('../models/Year');
const Issue = require('../models/Issue');
const Category = require('../models/Category');
const { cloudinary } = require('../config/cloudinary');
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
        const { categoryId, title, authors, abstract, keywords, pages, doi } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
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
            abstract,
            keywords: keywords ? keywords.split(',').map(k => k.trim()) : [],
            pages,
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
                    const articles = await Article.find({ category: cat._id }).sort({ createdAt: -1 });
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
        const { title, authors, abstract, keywords, pages, doi, categoryId } = req.body;
        const updateData = {
            title,
            authors,
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

