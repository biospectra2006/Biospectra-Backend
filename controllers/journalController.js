const Year = require('../models/Year');
const Issue = require('../models/Issue');
const Category = require('../models/Category');
const Topic = require('../models/Topic');
const Article = require('../models/Article');

// Year Controllers
exports.createYear = async (req, res) => {
    try {
        const { year } = req.body;
        const newYear = new Year({ year, isPublished: false });
        await newYear.save();
        
        // Auto-create 2 issues for the year (Draft by default)
        const issue1 = new Issue({ year: newYear._id, title: `Issue 1 (Jan-Jun) ${year}`, order: 1, isPublished: false });
        const issue2 = new Issue({ year: newYear._id, title: `Issue 2 (Jul-Dec) ${year}`, order: 2, isPublished: false });
        await issue1.save();
        await issue2.save();

        res.status(201).json(newYear);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

exports.getYears = async (req, res) => {
    try {
        const isAdmin = !!(req.headers.authorization);
        const filter = isAdmin ? {} : { isPublished: { $ne: false } };
        const years = await Year.find(filter).sort({ year: -1 });
        res.json(years);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Issue Controllers
exports.getIssuesByYear = async (req, res) => {
    try {
        const isAdmin = !!(req.headers.authorization);
        const year = await Year.findById(req.params.yearId);
        if (!isAdmin && year && year.isPublished === false) {
            return res.json([]);
        }
        const filter = { year: req.params.yearId };
        if (!isAdmin) {
            filter.isPublished = { $ne: false };
        }
        const issues = await Issue.find(filter).sort({ order: 1 });
        res.json(issues);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Category (Content) Controllers
exports.createCategory = async (req, res) => {
    try {
        const { issueId, title } = req.body;
        const category = new Category({ issue: issueId, title });
        await category.save();
        res.status(201).json(category);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

exports.getCategoriesByIssue = async (req, res) => {
    try {
        const categories = await Category.find({ issue: req.params.issueId });
        res.json(categories);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Topic Controllers
exports.createTopic = async (req, res) => {
    try {
        const { categoryId, title } = req.body;
        const topic = new Topic({ category: categoryId, title });
        await topic.save();
        res.status(201).json(topic);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

exports.getTopicsByCategory = async (req, res) => {
    try {
        const topics = await Topic.find({ category: req.params.categoryId });
        res.json(topics);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Full Tree Getter — single aggregation pipeline (no N+1 loops)
exports.getFullJournalTree = async (req, res) => {
    try {
        const isAdmin = !!(req.headers.authorization);
        const pipeline = [];
        if (!isAdmin) {
            pipeline.push({ $match: { isPublished: { $ne: false } } });
        }
        pipeline.push(
            { $sort: { year: -1 } },
            {
                $lookup: {
                    from: 'issues',
                    let: { yearId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ['$year', '$$yearId'] },
                                ...(isAdmin ? {} : { isPublished: { $ne: false } })
                            }
                        },
                        { $sort: { order: 1 } }
                    ],
                    as: 'issues'
                }
            },
            { $unwind: { path: '$issues', preserveNullAndEmptyArrays: true } },
            { $sort: { year: -1, 'issues.order': 1 } }
        );

        const result = await Year.aggregate([
            ...pipeline,
            {
                $lookup: {
                    from: 'categories',
                    localField: 'issues._id',
                    foreignField: 'issue',
                    as: 'issues.categories'
                }
            },
            { $unwind: { path: '$issues.categories', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'articles',
                    localField: 'issues.categories._id',
                    foreignField: 'category',
                    as: 'issues.categories.articles'
                }
            },
            {
                $group: {
                    _id: { yearId: '$_id', issueId: '$issues._id' },
                    year: { $first: '$year' },
                    issue: { $first: '$issues' },
                    categories: { $push: '$issues.categories' }
                }
            },
            {
                $addFields: {
                    'issue.categories': {
                        $filter: {
                            input: '$categories',
                            as: 'c',
                            cond: { $ifNull: ['$$c._id', false] }
                        }
                    }
                }
            },
            {
                $group: {
                    _id: '$_id.yearId',
                    year: { $first: '$year' },
                    issues: { $push: '$issue' }
                }
            },
            { $sort: { year: -1 } },
            {
                $project: {
                    _id: 1,
                    year: 1,
                    issues: 1
                }
            }
        ]);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Single Issue Data — fetches only one issue by year number + issue order
exports.getIssueData = async (req, res) => {
    try {
        const yearNum = parseInt(req.params.year);   // e.g. 2021
        const orderNum = parseInt(req.params.order); // 1 or 2

        const isAdmin = !!(req.headers.authorization);
        const yearDoc = await Year.findOne({ year: yearNum });
        if (!yearDoc) return res.status(404).json({ message: 'Year not found' });
        if (!isAdmin && yearDoc.isPublished === false) {
            return res.status(404).json({ message: 'Volume is currently hidden or in draft' });
        }

        const issueDoc = await Issue.findOne({ year: yearDoc._id, order: orderNum });
        if (!issueDoc) return res.status(404).json({ message: 'Issue not found' });
        if (!isAdmin && issueDoc.isPublished === false) {
            return res.status(404).json({ message: 'Issue is currently hidden or in draft' });
        }

        // Fetch all categories for this issue in one query
        const categories = await Category.find({ issue: issueDoc._id }).sort({ createdAt: 1 }).lean();
        const categoryIds = categories.map(c => c._id);

        // Fetch ALL articles for every category in one single query
        const allArticles = await Article.find({ category: { $in: categoryIds } })
            .select('title authors pages category doi')
            .lean();

        // Group articles by category id
        const articlesByCategory = {};
        for (const art of allArticles) {
            const catKey = art.category.toString();
            if (!articlesByCategory[catKey]) articlesByCategory[catKey] = [];
            articlesByCategory[catKey].push(art);
        }

        // Sort articles within each category by starting page number
        const categoriesWithArticles = categories.map(c => {
            const arts = (articlesByCategory[c._id.toString()] || []).sort((a, b) => {
                const pageA = parseInt((a.pages || '').split('-')[0]) || 0;
                const pageB = parseInt((b.pages || '').split('-')[0]) || 0;
                return pageA - pageB;
            });
            return { ...c, articles: arts };
        });

        res.json({
            ...issueDoc.toObject(),
            year: yearNum,
            categories: categoriesWithArticles
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
