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
    // 👇 ADICIONEI 'due_today' AQUI NA LISTA
    enum: ['new_invoice', 'reminder', 'overdue', 'due_today'],
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
  error_message: { type: String },

  // ✅ NOVO: persistência do template/mensagem para auditoria e UI
  template_group: { type: String },         // "HOJE" | "FUTURO" | "ATRASO"
  template_index: { type: Number },         // índice do template escolhido
  message_text: { type: String },           // texto final enviado (com variáveis resolvidas)
  message_preview: { type: String },        // preview curto para lista (ex: 140 chars)

  // ✅ NOVO: erro amigável + código
  error_code: { type: String },             // ex: PHONE_NO_WHATSAPP, WHATSAPP_DISCONNECTED, NETWORK_TIMEOUT...
  error_http_status: { type: Number },      // status HTTP se existir
  error_raw: { type: String }               // payload/stack curta para debug (limitado no service)
}, {
  timestamps: true
});

module.exports = mongoose.model('NotificationLog', NotificationLogSchema);