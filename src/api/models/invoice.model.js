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
            required: false 
        },
        schoolYear: {
            type: Schema.Types.ObjectId,
            ref: 'SchoolYear',
        },
        school_id: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: [true, 'A referência da escola (school_id) é obrigatória.'],
            index: true
        },
        description: { type: String, required: true },
        value: { type: Number, required: true }, // Em CENTAVOS
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
        
        // [MODIFICADO] Suporte a múltiplos gateways
        gateway: { 
            type: String, 
            enum: ['mercadopago', 'cora', 'manual'], // Adicionado 'cora'
            default: 'mercadopago' 
        },

        // --- Campos Genéricos (Padronização para Front-end) ---
        // ID da transação no Gateway (seja MP ID ou Cora ID)
        external_id: { type: String, index: true, sparse: true }, 
        
        // Dados para Boleto (Universal)
        boleto_url: { type: String },       // Link do PDF do boleto
        boleto_barcode: { type: String },   // Linha digitável / Código de barras

        // Dados para PIX (Universal)
        pix_code: { type: String },         // Código Copia e Cola
        pix_qr_base64: { type: String },    // Imagem QR (se disponível)

        // --- Campos Legados (Mantidos para histórico do Mercado Pago) ---
        mp_payment_id: { type: String, unique: true, sparse: true, index: true },
        mp_pix_copia_e_cola: { type: String },
        mp_pix_qr_base64: { type: String },
        mp_ticket_url: { type: String },
    },
    { timestamps: true }
);

const Invoice = mongoose.model('Invoice', invoiceSchema);
module.exports = Invoice;