// src/api/models/invoice.model.js
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
        // --- [NOVO] LIGAÇÃO MULTI-TENANCY ---
        school_id: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: [true, 'A referência da escola (school_id) é obrigatória.'],
            index: true
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
        mp_payment_id: {
            type: String,
            unique: true,
            sparse: true,
            index: true,
        },
        mp_pix_copia_e_cola: {
            type: String,
        },
        mp_pix_qr_base64: {
            type: String,
        },
        mp_ticket_url: {
            type: String,
        },
    },
    {
        timestamps: true,
    }
);

const Invoice = mongoose.model('Invoice', invoiceSchema);
module.exports = Invoice;