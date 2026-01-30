const mongoose = require('mongoose');

const NotificationLogSchema = new mongoose.Schema({
  school_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true,
    index: true
  },
  invoice_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    required: true
  },
  student_name: { type: String, required: true },
  tutor_name: { type: String, required: true },
  target_phone: { type: String, required: true },
  
  // Tipo da mensagem (para o template)
  type: {
    type: String,
    enum: ['new_invoice', 'reminder', 'overdue'],
    default: 'new_invoice'
  },
  
  // Status do envio
  status: {
    type: String,
    enum: ['queued', 'processing', 'sent', 'failed', 'cancelled'],
    default: 'queued',
    index: true
  },
  
  // Para controle de tentativas e agendamento
  scheduled_for: { type: Date, default: Date.now },
  sent_at: { type: Date },
  attempts: { type: Number, default: 0 },
  error_message: { type: String }
}, {
  timestamps: true
});

module.exports = mongoose.model('NotificationLog', NotificationLogSchema);