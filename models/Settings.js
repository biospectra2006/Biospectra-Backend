const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  sjifNumber: {
    type: String,
    default: '8.546'
  },
  heroImageUrl: {
    type: String,
    default: ''
  },
  certificateImageUrl: {
    type: String,
    default: ''
  },
  contactPhone: {
    type: String,
    default: '+91 94313 89253'
  },
  contactWhatsapp: {
    type: String,
    default: '+91 94313 89253'
  },
  contactEmail: {
    type: String,
    default: 'biospectra@yahoo.com'
  },
  contactAddress: {
    type: String,
    default: 'Madhawi Shyam Educational Trust, Ranchi, Jharkhand, India.'
  },
  workingHours: {
    type: String,
    default: 'Mon–Sat, 10:00 AM – 4:00 PM'
  }
}, { timestamps: true });

module.exports = mongoose.model('Settings', SettingsSchema);
