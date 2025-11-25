const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Não importamos os sub-schemas aqui para evitar validações rígidas (required: true) 
// que podem quebrar o salvamento temporário. Guardamos como objetos simples.

const registrationRequestSchema = new Schema({
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School',
        required: true,
        index: true
    },
    status: {
        type: String,
        enum: ['PENDING', 'APPROVED', 'REJECTED'],
        default: 'PENDING',
        index: true
    },
    // Define se o formulário preenchido foi de "Aluno Adulto" ou "Aluno Menor"
    registrationType: {
        type: String,
        enum: ['ADULT_STUDENT', 'MINOR_STUDENT'],
        required: true
    },
    
    // Objeto flexível com dados do aluno
    studentData: {
        fullName: String,
        birthDate: Date,
        cpf: String,
        rg: String,
        email: String,
        phoneNumber: String,
        gender: String,
        race: String,
        nationality: String,
        address: {
            street: String,
            number: String,
            neighborhood: String,
            city: String,
            state: String,
            zipCode: String,
            complement: String
        }
    },

    // Objeto flexível com dados do tutor (pode estar vazio se for ADULT_STUDENT)
    tutorData: {
        fullName: String,
        cpf: String,
        rg: String,
        birthDate: Date,
        email: String,
        phoneNumber: String,
        gender: String,
        nationality: String,
        relationship: String, // 'Mãe', 'Pai', etc.
        address: {
            street: String,
            number: String,
            neighborhood: String,
            city: String,
            state: String,
            zipCode: String,
            complement: String
        }
    },

    // Auditoria e Controle
    rejectionReason: { type: String },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' }, // Quem aprovou/rejeitou
}, {
    timestamps: true
});

module.exports = mongoose.model('RegistrationRequest', registrationRequestSchema);