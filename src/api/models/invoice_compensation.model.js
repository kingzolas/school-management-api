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

    // Invoice que está pendente, mas NÃO deve ser cobrada agora (ex: Fevereiro)
    target_invoice: {
      type: Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
      index: true
    },

    // Invoice que foi paga por engano (ex: Março pago em Fevereiro)
    source_invoice: {
      type: Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
      index: true
    },

    /**
     * até quando bloquear a cobrança da TARGET
     * Regra do seu cenário: bloquear até o vencimento do boleto pago errado (SOURCE.dueDate)
     */
    hold_until: {
      type: Date,
      required: true,
      index: true
    },

    /**
     * chaves prontas para “identificação rápida” (CAIXA/COMPETÊNCIA)
     */
    cash_month: { type: String, trim: true, index: true },        // "MM/YYYY"
    competence_month: { type: String, trim: true, index: true },  // "MM/YYYY"

    reason: { type: String, required: true, trim: true },
    notes: { type: String, trim: true },

    created_by: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    status: {
      type: String,
      enum: ['active', 'expired', 'resolved', 'canceled'],
      default: 'active',
      index: true
    },

    resolved_at: { type: Date },
    resolved_by: { type: Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

// ✅ Evita 2 HOLDS ativos para a mesma invoice target
invoiceCompensationSchema.index(
  { school_id: 1, target_invoice: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);

module.exports = mongoose.model('InvoiceCompensation', invoiceCompensationSchema);