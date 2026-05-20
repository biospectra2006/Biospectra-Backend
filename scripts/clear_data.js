require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Article = require('../models/Article');
const Category = require('../models/Category');
const Issue = require('../models/Issue');
const Year = require('../models/Year');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Deleting all data...');
  const a = await Article.deleteMany({});
  const c = await Category.deleteMany({});
  const i = await Issue.deleteMany({});
  const y = await Year.deleteMany({});
  console.log(`Deleted: ${a.deletedCount} articles, ${c.deletedCount} categories, ${i.deletedCount} issues, ${y.deletedCount} years`);
  await mongoose.disconnect();
  console.log('Done.');
})();
