require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Year = require('../models/Year');
const Issue = require('../models/Issue');
const Category = require('../models/Category');
const Article = require('../models/Article');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const years = await Year.find().sort({ year: 1 });
  let total = 0;
  for (const y of years) {
    const issues = await Issue.find({ year: y._id }).sort({ order: 1 });
    for (const i of issues) {
      const cats = await Category.find({ issue: i._id }).sort({ title: 1 });
      for (const c of cats) {
        const cnt = await Article.countDocuments({ category: c._id });
        total += cnt;
        console.log(`${y.year} ${i.title} / ${c.title}: ${cnt}`);
      }
    }
  }
  console.log(`\nTotal: ${total} articles`);
  await mongoose.disconnect();
})();
