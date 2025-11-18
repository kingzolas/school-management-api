const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const NegotiationSchema = new Schema({
    // --- LIGAÇÃO COM ALUNO/FATURAS ---
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    invoices: [{ type: Schema.Types.ObjectId, ref: 'Invoice' }], 

    // --- [NOVO] LIGAÇÃO MULTI-TENANCY E AUDITORIA ---
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School',
        required: [true, 'A referência da escola (school_id) é obrigatória.'],
        index: true
    },
    createdByUserId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'O usuário que criou a negociação é obrigatório.'],
    },
    
    // --- DETALHES DA NEGOCIAÇÃO ---
    token: { type: String, unique: true, required: true },
    rules: {
        allowPixDiscount: { type: Boolean, default: false },
        pixDiscountValue: { type: Number, default: 0 },
        // [NOVO] Adicionado para o cálculo no Service
        pixDiscountType: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' }, 
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