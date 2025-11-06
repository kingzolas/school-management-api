const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const invoiceSchema = new Schema(
  {
    // --- Vínculos ---
    student: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      index: true,
    },
    tutor: {
      type: Schema.Types.ObjectId,
      ref: 'Tutor',
      required: true,
    },
    schoolYear: {
      type: Schema.Types.ObjectId,
      ref: 'SchoolYear',
    },

    // --- Dados da Fatura ---
    description: {
      type: String,
      required: true,
    },
    value: {
      type: Number, // Em CENTAVOS
      required: true,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'overdue', 'canceled'],
      default: 'pending',
      index: true,
    },

    // --- Dados do Pagamento ---
    paidAt: {
      type: Date,
    },
    paymentMethod: {
      type: String,
      enum: ['pix', 'boleto', 'credit_card', 'manual'],
    },

    // --- Dados do Gateway (Mercado Pago) ---
    gateway: {
      type: String,
      default: 'mercadopago',
    },
    // ID do Pagamento no MP
    mp_payment_id: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    // O "Pix Copia e Cola"
    mp_pix_copia_e_cola: {
      type: String,
    },
    // A Imagem Base64 do QR Code
    mp_pix_qr_base64: {
      type: String,
    },
    // [NOVO CAMPO] O link para aprovação manual no Sandbox
    mp_ticket_url: {
      type: String,
    },
  },
  {
    timestamps: true, // Cria 'createdAt' e 'updatedAt'
  }
);

const Invoice = mongoose.model('Invoice', invoiceSchema);
module.exports = Invoice;