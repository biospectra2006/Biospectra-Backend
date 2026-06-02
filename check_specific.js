require('dotenv').config({path: __dirname + '/.env'});
const mongoose = require('mongoose');
const Article = require('./models/Article');

(async() => {
    await mongoose.connect(process.env.MONGODB_URI);
    
    // Find the Pelican one
    const art26 = await Article.findOne({ title: /Eco-ornithological/i }).select('title authors pages');
    console.log('\n--- Article 26 ---');
    console.log(art26);
    
    // Find the Plant Science weird one
    const art39 = await Article.findOne({ authors: /Vineeta Kumari/i }).select('title authors pages');
    console.log('\n--- Article 39 ---');
    console.log(art39);
    
    // Find the skipped "Research Article"s from 2022 Issue 2
    // I know from my log they have pages: "13-16", "17-20", "47-50", "43-46"
    const skipped = await Article.find({ pages: { $in: ["13-16", "17-20", "47-50", "43-46"] }, title: /Research Article/i }).select('title authors pages');
    console.log('\n--- Skipped ones ---');
    console.log(skipped);
    
    process.exit(0);
})();
