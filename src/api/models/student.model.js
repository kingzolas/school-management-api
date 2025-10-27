const mongoose = require('mongoose');
const Schema = mongoose.Schema;
// Importa o schema de endereço (que já está correto no seu editor)
const addressSchema = require('./address.model');
// O tutorSchema não é mais importado aqui

// --- SUB-SCHEMA PARA FICHA DE SAÚDE ---
const healthInfoSchema = new Schema({
    hasHealthProblem: { type: Boolean, default: false },
    healthProblemDetails: { type: String, default: '' },
    takesMedication: { type: Boolean, default: false },
    medicationDetails: { type: String, default: '' },
    hasDisability: { type: Boolean, default: false },
    disabilityDetails: { type: String, default: '' },
    hasAllergy: { type: Boolean, default: false },
    allergyDetails: { type: String, default: '' },
    hasMedicationAllergy: { type: Boolean, default: false },
    medicationAllergyDetails: { type: String, default: '' },
    hasVisionProblem: { type: Boolean, default: false },
    visionProblemDetails: { type: String, default: '' },
    feverMedication: { type: String, default: '' },
    foodObservations: { type: String, default: '' },
}, { _id: false });

// --- SUB-SCHEMA PARA PESSOAS AUTORIZADAS ---
const authorizedPickupSchema = new Schema({
    fullName: { type: String, required: true },
    relationship: { type: String, required: true }, // Parentesco
    phoneNumber: { type: String, required: true },
}, { _id: false });


const studentSchema = new Schema({
    fullName: {
        type: String,
        required: [true, 'O nome completo é obrigatório.'],
        trim: true
    },
    birthDate: {
        type: Date,
        required: [true, 'A data de nascimento é obrigatória.']
    },
    gender: {
        type: String,
        required: true,
        enum: ['Masculino', 'Feminino', 'Outro']
    },
    race: {
        type: String,
        required: true,
        enum: ['Branca', 'Preta', 'Parda', 'Amarela', 'Indígena', 'Prefiro não dizer']
    },
    nationality: {
        type: String,
        required: true
    },
    profilePictureUrl: { 
        type: String,
        default: null
    },
    email: { 
        type: String,
        lowercase: true,
        sparse: true, 
        trim: true
    },
    phoneNumber: {
        type: String
    },
    rg: { 
        type: String,
        sparse: true
    },
    cpf: {
        type: String,
        sparse: true
    },
    birthCertificateUrl: { 
        type: String
    },
    address: { 
        type: addressSchema,
        required: true
    },
    // --- ESTRUTURA DE TUTORES ATUALIZADA ---
    tutors: {
        type: [
            {
                _id: false, // Não cria subdocument IDs para os vínculos
                tutorId: { 
                    type: Schema.Types.ObjectId,
                    ref: 'Tutor', // Referencia a coleção 'Tutor'
                    required: true
                },
                relationship: {
                    type: String,
                    required: [true, 'O parentesco é obrigatório.'],
                    enum: ['Mãe', 'Pai', 'Avó/Avô', 'Tio/Tia', 'Outro']
                }
            }
        ],
        // Validação para garantir 1 ou 2 tutores
        validate: [
            (val) => val.length >= 1 && val.length <= 2, 
            'É necessário cadastrar pelo menos 1 (um) e no máximo 2 (dois) tutores.'
        ]
    },
    healthInfo: {
        type: healthInfoSchema,
        default: () => ({})
    },
    authorizedPickups: {
        type: [authorizedPickupSchema],
        default: []
    },
    isActive: { 
        type: Boolean,
        default: true
    },
    classId: { 
        type: Schema.Types.ObjectId,
        ref: 'Class', 
        default: null
    }
}, {
    timestamps: true 
});

// Hook para limpar dados do ALUNO
studentSchema.pre('save', function(next) {
    if (this.rg === '') { this.rg = null; }
    if (this.cpf === '') { this.cpf = null; }
    if (this.email === '') { this.email = null; }
    next();
});

const Student = mongoose.model('Student', studentSchema);

module.exports = Student;

