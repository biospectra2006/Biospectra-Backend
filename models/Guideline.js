const mongoose = require('mongoose');

const GuidelineSchema = new mongoose.Schema({
    title: { 
        type: String, 
        required: true 
    },
    sectionType: { 
        type: String,
        default: 'general'
    },
    content: { 
        type: String, 
        required: true 
    },
    order: { 
        type: Number, 
        default: 0 
    }
}, { timestamps: true });

module.exports = mongoose.model('Guideline', GuidelineSchema);
