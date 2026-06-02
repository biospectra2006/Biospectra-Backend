require('dotenv').config({path: __dirname + '/.env'});
const mongoose = require('mongoose');
const Article = require('./models/Article');
const Issue = require('./models/Issue');
const Year = require('./models/Year');

(async() => {
    await mongoose.connect(process.env.MONGODB_URI);
    
    // Find 2022 Issue 2
    const year = await Year.findOne({ year: 2022 });
    const issue = await Issue.findOne({ year: year._id, order: 2 });
    
    // Find skipped pages in that issue
    const skipped = await Article.find({ 
        issue: issue._id,
        pages: { $in: ['13-16', '17-20', '47-50', '43-46'] } 
    }).select('title authors pages pdfUrl');
    
    console.log('\n--- Skipped ones ---');
    console.log(skipped);
    
    // Also log the ID of Article 26 & 39 for reference
    const art26 = await Article.findOne({ title: /Eco-ornithological/i }).select('title authors pages');
    console.log('\n--- Article 26 ---');
    console.log(art26);
    
    const art39 = await Article.findOne({ authors: /Vineeta Kumari/i }).select('title authors pages');
    console.log('\n--- Article 39 ---');
    console.log(art39);
    
    process.exit(0);
})();
