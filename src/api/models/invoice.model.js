const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const cancellationSchema = new Schema(
  {
    reason: { type: String },
    note: { type: String },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    requestedAt: { type: Date },
  },
  { _id: false }
);

const gatewaySyncSchema = new Schema(
  {
    provider: { type: String },
    externalId: { type: String },
    status: { type: String },
    cancelStatus: {
      type: String,
      enum: ['not_needed', 'pending', 'success', 'failed'],
    },
    cancelReason: { type: String },
    lastSyncAt: { type: Date },
    lastError: { type: String },
  },
  { _id: false }
);

const manualPaymentSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    method: {
      type: String,
      enum: ['pix', 'bank_transfer', 'cash', 'card_machine', 'other'],
    },
    paidAt: { type: Date },
    amount: { type: Number },
    note: { type: String },
    receiptUrl: { type: String },
    receiptFileName: { type: String },
    receiptMimeType: { type: String },
    receiptSize: { type: Number },
    receiptData: { type: Buffer, select: false },
    registeredBy: { type: Schema.Types.ObjectId, ref: 'User' },
    registeredAt: { type: Date },
  },
  { _id: false }
);

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
    paidAmount: { type: Number },
    paymentMethod: {
      type: String,
      enum: ['pix', 'boleto', 'credit_card', 'manual', 'bank_transfer', 'cash', 'card_machine', 'other'],
    },

    gateway: {
      type: String,
      enum: ['mercadopago', 'cora', 'manual'],
      default: 'mercadopago',
    },

    // ID da transacao no gateway (Mercado Pago ou Cora)
    external_id: { type: String, index: true, sparse: true },

    cancellation: cancellationSchema,
    gatewaySync: gatewaySyncSchema,
    manualPayment: manualPaymentSchema,

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
