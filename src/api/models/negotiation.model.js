const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const NegotiationSchema = new Schema({
  studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  invoices: [{ type: Schema.Types.ObjectId, ref: 'Invoice' }], // Ajustado para Invoice
  token: { type: String, unique: true, required: true },
  
  rules: {
    allowPixDiscount: { type: Boolean, default: false },
    pixDiscountValue: { type: Number, default: 0 },
    allowInstallments: { type: Boolean, default: false },
    maxInstallments: { type: Number, default: 1 },
    interestPayer: { type: String, enum: ['student', 'school'], default: 'student' }
  },

  totalOriginalDebt: { type: Number, required: true },
  
  status: { 
    type: String, 
    enum: ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED'], 
    default: 'PENDING' 
  },

  expiresAt: { type: Date, required: true },
  paymentExternalId: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Negotiation', NegotiationSchema);