const mongoose = require('mongoose');

const NotificationConfigSchema = new mongoose.Schema({
  school_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true,
    unique: true, // Uma configuração por escola
    index: true
  },
  isActive: {
    type: Boolean,
    default: false // Começa desativado por segurança
  },
  // Janela de Envio (Anti-Perturbação)
  windowStart: {
    type: String,
    default: "08:00"
  },
  windowEnd: {
    type: String,
    default: "18:00"
  },
  // Regras de Disparo
  enableReminder: { // 3 dias antes, etc (Futuro)
    type: Boolean,
    default: true
  },
  enableDueToday: { // No dia
    type: Boolean,
    default: true
  },
  enableOverdue: { // Após vencimento
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('NotificationConfig', NotificationConfigSchema);