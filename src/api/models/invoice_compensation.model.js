const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const invoiceCompensationSchema = new Schema(
  {
    school_id: {
      type: Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true
    },
    student: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      index: true
    },

    // Invoice que está pendente, mas NÃO deve ser cobrada (ex: Fevereiro)
    target_invoice: {
      type: Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
      index: true
    },

    // Invoice que foi paga por engano e “compensa” a target (ex: Julho)
    source_invoice: {
      type: Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
      index: true
    },

    reason: { type: String, required: true, trim: true },
    notes: { type: String, trim: true },

    created_by: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    status: {
      type: String,
      enum: ['active', 'resolved', 'canceled'],
      default: 'active',
      index: true
    },

    resolved_at: { type: Date },
    resolved_by: { type: Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

// Evita 2 compensações ativas na mesma invoice target
invoiceCompensationSchema.index(
  { school_id: 1, target_invoice: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);

module.exports = mongoose.model('InvoiceCompensation', invoiceCompensationSchema);