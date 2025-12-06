const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const AttendanceSchema = new Schema({
  schoolId: {
    type: Schema.Types.ObjectId,
    ref: 'School',
    required: true,
    index: true
  },
  classId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Class', 
    required: true 
  },
  teacherId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  // Array com o status de cada aluno
  records: [{
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      required: true
    },
    status: {
      type: String,
      enum: ['PRESENT', 'ABSENT', 'EXCUSED'], // Presente, Falta, Justificado
      default: 'PRESENT'
    },
    observation: { type: String, default: '' }
  }],
  metadata: {
    device: { type: String, default: 'mobile' }, // Identifica se veio do app
    syncedAt: { type: Date, default: Date.now }
  }
}, { timestamps: true });

// Índice para evitar duplicidade e acelerar busca: Uma chamada por Turma por Dia
AttendanceSchema.index({ schoolId: 1, classId: 1, date: 1 });

module.exports = mongoose.model('Attendance', AttendanceSchema);