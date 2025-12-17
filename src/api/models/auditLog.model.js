const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  school: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true,
    index: true // Importante para filtrar logs por escola rapidamente
  },
  actor: { // Quem fez a ação
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  entity: { // Qual "tabela" foi mexida (Ex: Class, Student, Grade)
    type: String,
    required: true
  },
  entityId: { // O ID do item mexido
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  action: { // CREATE, UPDATE, DELETE
    type: String,
    enum: ['CREATE', 'UPDATE', 'DELETE'],
    required: true
  },
  changes: { // O coração da auditoria: Antes e Depois
    previous: { type: Object }, // Como era
    current: { type: Object }   // Como ficou
  },
  reason: { // A justificativa (obrigatória p/ calendário, opcional p/ outros)
    type: String
  },
  metadata: { // IP, Browser (opcional)
    ip: String,
    userAgent: String
  }
}, {
  timestamps: true // Cria createdAt (O "Quando") automaticamente
});

module.exports = mongoose.model('AuditLog', AuditLogSchema);