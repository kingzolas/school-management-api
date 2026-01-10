// src/api/models/tutor.model.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const addressSchema = require('./address.model'); 

const tutorSchema = new Schema({
    fullName: { 
        type: String, 
        required: [true, 'O nome completo do tutor é obrigatório.'] 
    },
    // [NOVO] Profissão (Opcional)
    profession: {
        type: String,
        required: false,
        trim: true
    },    birthDate: { 
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
    },
    rg: { 
        type: String,
        sparse: true 
    },
    cpf: { 
        type: String, 
        sparse: true, 
        required: [false, 'O CPF do tutor é obrigatório.']
    },
    email: { 
        type: String, 
        lowercase: true,
        sparse: true
    },
    address: { 
        type: addressSchema, 
        required: true 
    },

    // --- [NOVO] LIGAÇÃO MULTI-TENANCY ---
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School', // Referencia o modelo 'School'
        required: [true, 'A referência da escola (school_id) é obrigatória.'],
        index: true // Melhora a performance de buscas por escola
    },
    // ------------------------------------

    // Link para os alunos que este tutor é responsável
    students: [{
        type: Schema.Types.ObjectId,
        ref: 'Student'
    }]
}, {
    timestamps: true 
});

// Hook (inalterado)
tutorSchema.pre('save', function(next) {
    if (this.rg === '') { this.rg = null; }
    if (this.cpf === '') { this.cpf = null; } 
    if (this.email === '') { this.email = null; }
    // Opcional: Se profissão vier vazia, garante null ou string vazia limpa
    if (this.profession === '') { this.profession = null; }
    next();
});

const Tutor = mongoose.model('Tutor', tutorSchema);

module.exports = Tutor;