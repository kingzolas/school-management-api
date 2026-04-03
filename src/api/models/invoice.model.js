const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const invoiceSchema = new Schema(
  {
    student: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      index: true,
    },
    tutor: {
      type: Schema.Types.ObjectId,
      ref: 'Tutor',
      required: false,
    },
    schoolYear: {
      type: Schema.Types.ObjectId,
      ref: 'SchoolYear',
    },
    school_id: {
      type: Schema.Types.ObjectId,
      ref: 'School',
      required: [true, 'A referencia da escola (school_id) e obrigatoria.'],
      index: true,
    },
    description: { type: String, required: true },
    value: { type: Number, required: true }, // Em centavos
    dueDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending', 'paid', 'overdue', 'canceled'],
      default: 'pending',
      index: true,
    },
    paidAt: { type: Date },
    paymentMethod: {
      type: String,
      enum: ['pix', 'boleto', 'credit_card', 'manual'],
    },

    gateway: {
      type: String,
      enum: ['mercadopago', 'cora', 'manual'],
      default: 'mercadopago',
    },

    // ID da transacao no gateway (Mercado Pago ou Cora)
    external_id: { type: String, index: true, sparse: true },

    // Boleto
    boleto_url: { type: String },                  // Link do PDF do boleto
    boleto_barcode: { type: String },              // Codigo de barras oficial (44 digitos)
    boleto_digitable_line: { type: String },       // Linha digitavel oficial (47 digitos)

    // PIX
    pix_code: { type: String },                    // Codigo copia e cola
    pix_qr_base64: { type: String },               // Imagem QR, se disponivel

    // Campos legados do Mercado Pago
    mp_payment_id: { type: String, unique: true, sparse: true, index: true },
    mp_pix_copia_e_cola: { type: String },
    mp_pix_qr_base64: { type: String },
    mp_ticket_url: { type: String },
  },
  { timestamps: true }
);

const Invoice = mongoose.model('Invoice', invoiceSchema);
module.exports = Invoice;
