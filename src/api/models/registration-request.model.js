const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const registrationRequestSchema = new Schema({
    // ... campos padrão (school_id, status, type) ...
    school_id: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING', index: true },
    registrationType: { type: String, enum: ['ADULT_STUDENT', 'MINOR_STUDENT'], required: true },
    
    // --- DADOS COMPLETOS DO ALUNO ---
    studentData: {
        fullName: { type: String, required: true },
        
        // [NOVO] Série/Turma Pretendida (Informada pelo pai)
        intendedGrade: { type: String, required: false }, 

        birthDate: { type: Date, required: true },
        gender: String,
        race: String,
        nationality: String,
        phoneNumber: String,
        email: String,
        cpf: String,
        rg: String,
        
        // Endereço Completo
        address: {
            street: String,
            number: String,
            neighborhood: String,
            city: String,
            state: String,
            zipCode: String,
            complement: String,
            block: String,
            lot: String
        },

        // Ficha de Saúde (inalterada)
        healthInfo: {
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
        },
        
        // Pessoas Autorizadas
        authorizedPickups: [{
            fullName: String,
            relationship: String,
            phoneNumber: String
        }]
    },

    // --- DADOS DO TUTOR ---
    tutorData: {
        fullName: String,
        
        // [NOVO] Profissão do Tutor (opcional aqui também para refletir o schema do Tutor)
        profession: { type: String },

        birthDate: Date,
        cpf: String,
        rg: String,
        gender: String,
        nationality: String,
        phoneNumber: String,
        email: String,
        relationship: String,
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

    rejectionReason: { type: String },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, {
    timestamps: true
});

module.exports = mongoose.model('RegistrationRequest', registrationRequestSchema);