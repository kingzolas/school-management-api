const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
    schoolId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'School',
        required: true,
        index: true // Facilita a busca por escola
    },
    // --- NOVO CAMPO: Vínculo com Funcionário ---
    relatedStaff: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', // Ou 'StaffProfile', dependendo de como você quer buscar. Geralmente vinculamos ao User ID.
        required: false // Só é obrigatório se category for Vale, validaremos no front/controller
    },
    description: {
        type: String,
        required: true,
        trim: true
    },
    amount: {
        type: Number,
        required: true
    },
    date: {
        type: Date,
        required: true,
        default: Date.now
    },
   category: {
        type: String,
        required: true,
        // ADICIONADO 'Vale/Adiantamento' na lista
        enum: ['Aluguel', 'Energia', 'Água', 'Internet', 'Pessoal', 'Manutenção', 'Marketing', 'Impostos', 'Vale/Adiantamento', 'Outros'],
        default: 'Outros'
    },
    status: {
        type: String,
        enum: ['pending', 'paid', 'late'], // Pendente, Pago, Atrasado
        default: 'pending'
    },
    paymentMethod: {
        type: String, // Pix, Boleto, Cartão, Dinheiro
        default: 'Outros'
    },
    recipient: {
        type: String, // Nome do fornecedor ou funcionário
        default: ''
    },
    isRecurring: {
        type: Boolean,
        default: false
    },
    attachmentUrl: {
        type: String, // URL para foto do comprovante (se houver upload)
        default: ''
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true // Cria createdAt e updatedAt automaticamente
});

module.exports = mongoose.model('Expense', expenseSchema);