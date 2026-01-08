const mongoose = require('mongoose');

const GradeSchema = new mongoose.Schema({
  // Vínculo Hierárquico
  evaluation: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Evaluation', 
    required: true 
  },
  
  // Dados do Aluno
  student: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Student', 
    required: true 
  },
  enrollment: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Enrollment',
    required: true // Necessário para filtrar alunos ativos/transferidos
  },

  // O Valor (Pode ser nulo se o aluno faltou, mas geralmente é 0)
  value: { 
    type: Number, 
    required: true, 
    min: 0 
  },
  
  // Feedback individual (Ex: "Faltou desenvolvimento na questão 2")
  feedback: { type: String },

  updatedAt: { type: Date, default: Date.now }
});

// TRAVA DE SEGURANÇA: Um aluno só pode ter UMA nota por Avaliação.
GradeSchema.index({ evaluation: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('Grade', GradeSchema);