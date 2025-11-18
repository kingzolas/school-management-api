// src/api/models/student.model.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const addressSchema = require('./address.model');

// --- SUB-SCHEMA PARA FICHA DE SAÚDE --- (Inalterado)
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

// --- SUB-SCHEMA PARA PESSOAS AUTORIZADAS --- (Inalterado)
const authorizedPickupSchema = new Schema({
    fullName: { type: String, required: true },
    relationship: { type: String, required: true },
    phoneNumber: { type: String, required: true },
}, { _id: false });

// --- SUB-SCHEMA PARA NOTAS --- (Inalterado)
const gradeSchema = new Schema({
    subjectName: {
        type: String,
        required: true,
        trim: true
    },
    gradeValue: {
        type: String, 
        required: true,
        trim: true
    }
}, { _id: false });

// --- SUB-SCHEMA PARA REGISTRO ACADÊMICO --- (Inalterado)
const academicRecordSchema = new Schema({
    gradeLevel: { 
        type: String,
        required: true,
        trim: true
    },
    schoolYear: { 
        type: Number,
        required: true
    },
    schoolName: {
        type: String,
        required: true,
        trim: true,
        default: 'Escola Sossego da Mamãe' 
    },
    city: {
        type: String,
        required: true,
        trim: true,
        default: 'Parauapebas'
    },
    state: { 
        type: String,
        required: true,
        trim: true,
        default: 'PA'
    },
    grades: {
        type: [gradeSchema],
        default: []
    },
    annualWorkload: { 
        type: String, 
        trim: true
    },
    finalResult: { 
        type: String,
        required: true,
        trim: true
    }
});


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
    tutors: {
        type: [
            {
                _id: false, 
                tutorId: { 
                    type: Schema.Types.ObjectId,
                    ref: 'Tutor', 
                    required: true
                },
                relationship: {
                    type: String,
                    required: [true, 'O parentesco é obrigatório.'],
                    enum: ['Mãe', 'Pai', 'Avó/Avô', 'Tio/Tia', 'Outro']
                }
            }
        ],
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
    },
    
    // --- [NOVO] LIGAÇÃO MULTI-TENANCY ---
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School', // Referencia o modelo 'School'
        required: [true, 'A referência da escola (school_id) é obrigatória.'],
        index: true // Melhora a performance de buscas por escola
    },
    // ------------------------------------

    academicHistory: {
        type: [academicRecordSchema],
        default: []
    }
}, {
    timestamps: true 
});

// Hook (inalterado)
studentSchema.pre('save', function(next) {
    if (this.rg === '') { this.rg = null; }
    if (this.cpf === '') { this.cpf = null; }
    if (this.email === '') { this.email = null; }
    next();
});

const Student = mongoose.model('Student', studentSchema);

module.exports = Student;