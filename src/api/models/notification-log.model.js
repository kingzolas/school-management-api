const mongoose = require('mongoose');

const InvoiceSnapshotSchema = new mongoose.Schema(
  {
    description: { type: String, default: null },
    value: { type: Number, default: null }, // centavos
    dueDate: { type: Date, default: null },

    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null },
    tutor: { type: mongoose.Schema.Types.ObjectId, ref: 'Tutor', default: null },

    gateway: { type: String, default: null },
    external_id: { type: String, default: null },
  },
  { _id: false }
);

const NotificationLogSchema = new mongoose.Schema(
  {
    school_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true
    },
    invoice_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
      index: true // ✅ ajuda auditoria/queries por invoice
    },
    student_name: { type: String, required: true },
    tutor_name: { type: String, required: true },
    target_phone: { type: String, required: true },

    // Tipo da mensagem (para o template)
    type: {
      type: String,
      enum: ['new_invoice', 'reminder', 'overdue', 'due_today', 'manual'],
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

    // ✅ persistência do template/mensagem para auditoria e UI
    template_group: { type: String },   // "HOJE" | "FUTURO" | "ATRASO"
    template_index: { type: Number },   // índice do template escolhido
    message_text: { type: String },     // texto final enviado
    message_preview: { type: String },  // preview curto (ex: 140 chars)

    // ✅ erro amigável + código
    error_code: { type: String },        // PHONE_NO_WHATSAPP, WHATSAPP_DISCONNECTED, NETWORK_TIMEOUT...
    error_http_status: { type: Number }, // status HTTP se existir
    error_raw: { type: String },         // payload/stack curta para debug

    // =========================================================
    // ✅ NOVO: Snapshot do envio (para auditoria e prova)
    // =========================================================
    sent_boleto_url: { type: String, default: null },
    sent_barcode: { type: String, default: null },
    sent_gateway: { type: String, default: null },

    // Para Cora, normalmente é o external_id; se no futuro existir chargeId separado, use ele aqui
    sent_gateway_charge_id: { type: String, default: null },

    // Snapshot da invoice no momento do envio
    invoice_snapshot: { type: InvoiceSnapshotSchema, default: null },
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('NotificationLog', NotificationLogSchema);
