const mongoose = require('mongoose');

const studentNoteSchema = new mongoose.Schema({
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['PRIVATE', 'ATTENTION', 'WARNING'], // Privado (Só Prof), Atenção (Secretaria), Advertência (Pais/Secretaria)
    default: 'PRIVATE'
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  isResolved: {
    type: Boolean,
    default: false // Útil para a secretaria marcar como "Resolvido" depois de falar com os pais
  }
}, { timestamps: true });

// Índice para busca rápida de anotações de um aluno específico
studentNoteSchema.index({ studentId: 1, createdAt: -1 });

module.exports = mongoose.model('StudentNote', studentNoteSchema);