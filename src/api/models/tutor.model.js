const mongoose = require('mongoose');
const Schema = mongoose.Schema;
// Importa o NOVO schema de endereço
const addressSchema = require('./address.model'); 

const tutorSchema = new Schema({
    fullName: { 
        type: String, 
        required: [true, 'O nome completo do tutor é obrigatório.'] 
    },
    birthDate: { 
        type: Date, 
        required: [true, 'A data de nascimento do tutor é obrigatória.'] 
    },
    gender: { 
        type: String, 
        enum: ['Masculino', 'Feminino', 'Outro'], 
        required: true 
    },
    nationality: { 
        type: String, 
        required: true 
    },
    phoneNumber: { 
        type: String, 
        // required: false 
    },
    rg: { 
        type: String,
        // unique: false, 
        sparse: true // Permite vários nulos, mas apenas um RG se preenchido
    },
    cpf: { 
        type: String, 
        // unique: false, 
        sparse: true, // Permite vários nulos, mas apenas um CPF se preenchido
        required: [false, 'O CPF do tutor é obrigatório.']
    },
    // --- CAMPO DE EMAIL ATUALIZADO ---
    email: { 
        type: String, 
        // required: false, // (default é false)
        lowercase: true,
        // unique: false, // Email não precisa ser único (ex: email da família)
        sparse: true
    },
    address: { 
        type: addressSchema, 
        required: true 
    },
    // Link para os alunos que este tutor é responsável
    students: [{
        type: Schema.Types.ObjectId,
        ref: 'Student'
    }]
}, {
    timestamps: true // Adiciona createdAt e updatedAt
});

// --- HOOK ADICIONADO ---
// Limpa dados opcionais e únicos antes de salvar para evitar erros de duplicidade
tutorSchema.pre('save', function(next) {
    if (this.rg === '') { this.rg = null; }
    // O CPF é obrigatório, mas limpamos para o caso de "" ser enviado
    if (this.cpf === '') { this.cpf = null; } 
    if (this.email === '') { this.email = null; }
    next();
});

const Tutor = mongoose.model('Tutor', tutorSchema);

module.exports = Tutor;

