const mongoose = require('mongoose');

const evaluationSchema = new mongoose.Schema({
  school: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  },
  classInfo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // --- Novos Campos ---
  subject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject', // Referência para a coleção de Disciplinas
    required: false // Pode ser true se você quiser obrigar sempre
  },
  startTime: {
    type: String,   // Ex: "08:00"
    required: false
  },
  endTime: {
    type: String,   // Ex: "10:00"
    required: false
  },
  // --------------------
  title: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['EXAM', 'ACTIVITY', 'WORK', 'PARTICIPATION'],
    default: 'ACTIVITY'
  },
  date: {
    type: Date,
    required: true
  },
  maxScore: {
    type: Number,
    default: 10
  },
  term: {
    type: String, 
    required: true
  },
  schoolYear: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SchoolYear'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Evaluation', evaluationSchema);