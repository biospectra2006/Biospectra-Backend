require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const Article = require('../models/Article');

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);
    
    // Find all articles and find exact duplicates
    const all = await Article.find({});
    
    const map = {};
    const toDelete = [];
    
    for (const a of all) {
        // Create a unique key for an article based on title + year + category
        const key = (a.title||'').trim() + '-' + (a.year||'noyear').toString() + '-' + (a.category||'nocat').toString() + '-' + (a.pdfUrl||'nopdf');
        if (map[key]) {
            toDelete.push(a._id);
            console.log('Duplicate:', a.title, '->', a.pdfUrl);
        } else {
            map[key] = true;
        }
    }
    
    console.log(`Found ${toDelete.length} exactly duplicated records to delete.`);
    if (toDelete.length > 0) {
        await Article.deleteMany({ _id: { $in: toDelete } });
        console.log('Deleted duplicates.');
    }
    
    process.exit(0);
}
run();
