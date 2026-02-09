const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const addressSchema = require('./address.model');

const auditLogPlugin = require('../../helpers/auditLog.plugin');

// --- SUB-SCHEMAS ---
const studentAuthSchema = new Schema({
    username: { type: String, sparse: true, trim: true },
    passwordHash: { type: String, select: false },
    firstAccess: { type: Boolean, default: true },
    lastLogin: { type: Date }
}, { _id: false });

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

const authorizedPickupSchema = new Schema({
    fullName: { type: String, required: true },
    relationship: { type: String, required: true },
    phoneNumber: { type: String, required: true },
}, { _id: false });

const gradeSchema = new Schema({
    subjectName: { type: String, required: true, trim: true },
    gradeValue: { type: String, required: true, trim: true }
}, { _id: false });

const academicRecordSchema = new Schema({
    gradeLevel: { type: String, required: true, trim: true },
    schoolYear: { type: Number, required: true },
    schoolName: { type: String, required: true, trim: true, default: 'Escola Sossego da Mamãe' },
    city: { type: String, required: true, trim: true, default: 'Parauapebas' },
    state: { type: String, required: true, trim: true, default: 'PA' },
    grades: { type: [gradeSchema], default: [] },
    annualWorkload: { type: String, trim: true },
    finalResult: { type: String, required: true, trim: true }
});

// --- SCHEMA PRINCIPAL ---

const studentSchema = new Schema({
    enrollmentNumber: { type: String, unique: true, trim: true, sparse: true, },
    
    intendedGrade: { type: String, trim: true },

    accessCredentials: { type: studentAuthSchema, default: () => ({}) },

    fullName: { type: String, required: [true, 'O nome completo é obrigatório.'], trim: true },
    birthDate: { type: Date, required: [true, 'A data de nascimento é obrigatória.'] },
    gender: { type: String, required: true, enum: ['Masculino', 'Feminino', 'Outro'] },
    race: { type: String, required: true, enum: ['Branca', 'Preta', 'Parda', 'Amarela', 'Indígena', 'Prefiro não dizer'] },
    nationality: { type: String, required: true },
    
    profilePicture: {
        data: Buffer,
        contentType: String
    },
    
    email: { type: String, lowercase: true, sparse: true, trim: true },
    phoneNumber: { type: String },
    
    rg: { type: String, sparse: true },
    cpf: { type: String, sparse: true }, 
    
    birthCertificateUrl: { type: String },
    address: { type: addressSchema, required: true },

    tutors: {
        type: [
            {
                _id: false, 
                tutorId: { type: Schema.Types.ObjectId, ref: 'Tutor' }, 
                // A validação de ENUM acontece aqui, mas o hook 'pre validate' vai corrigir antes
                relationship: { type: String, enum: ['Mãe', 'Pai', 'Avó/Avô', 'Tio/Tia', 'Outro', 'Cônjuge'] }
            }
        ],
        default: []
    },

    financialResp: {
        type: String,
        enum: ['STUDENT', 'TUTOR'],
        default: 'TUTOR', 
        required: true
    },

    financialTutorId: {
        type: Schema.Types.ObjectId,
        ref: 'Tutor',
        default: null
    },

    healthInfo: { type: healthInfoSchema, default: () => ({}) },
    authorizedPickups: { type: [authorizedPickupSchema], default: [] },
    isActive: { type: Boolean, default: true },
    classId: { type: Schema.Types.ObjectId, ref: 'Class', default: null },
    school_id: { type: Schema.Types.ObjectId, ref: 'School', required: [true, 'School ID obrigatório.'], index: true },
    academicHistory: { type: [academicRecordSchema], default: [] }
}, {
    timestamps: true 
});

// --- [NOVO] HOOK DE CORREÇÃO (Sanitização) ---
// Roda ANTES da validação do Mongoose. Transforma 'pai' em 'Pai', etc.
studentSchema.pre('validate', function(next) {
    if (this.tutors && this.tutors.length > 0) {
        const mapRel = {
            'pai': 'Pai',
            'mãe': 'Mãe', 'mae': 'Mãe',
            'avó': 'Avó/Avô', 'avô': 'Avó/Avô', 'avo': 'Avó/Avô', 'avó/avô': 'Avó/Avô',
            'tio': 'Tio/Tia', 'tia': 'Tio/Tia', 'tio/tia': 'Tio/Tia',
            'conjuge': 'Cônjuge', 'cônjuge': 'Cônjuge',
            'outro': 'Outro'
        };

        this.tutors.forEach(tutor => {
            if (tutor.relationship && typeof tutor.relationship === 'string') {
                const lower = tutor.relationship.toLowerCase().trim();
                // Tenta encontrar no mapa, se não, tenta Capitalizar a primeira letra
                if (mapRel[lower]) {
                    tutor.relationship = mapRel[lower];
                } else {
                    // Fallback: 'alguma coisa' -> 'Alguma coisa'
                    tutor.relationship = tutor.relationship.charAt(0).toUpperCase() + tutor.relationship.slice(1).toLowerCase();
                }
            }
        });
    }
    next();
});

// HOOKS DE VALIDAÇÃO DE NEGÓCIO
studentSchema.pre('save', function(next) {
    if (this.rg === '') { this.rg = null; }
    if (this.cpf === '') { this.cpf = null; }
    if (this.email === '') { this.email = null; }

    const today = new Date();
    const birthDate = new Date(this.birthDate);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }

    if (age < 18) {
        if (this.tutors.length === 0) {
            return next(new Error('Alunos menores de idade precisam de pelo menos um tutor/responsável vinculado.'));
        }
        if (this.financialResp === 'STUDENT') {
            return next(new Error('Alunos menores de idade não podem ser responsáveis financeiros. Selecione um Tutor.'));
        }
    }

    if (this.financialResp === 'TUTOR') {
        if (!this.financialTutorId) {
            if (this.tutors.length > 0) {
                this.financialTutorId = this.tutors[0].tutorId;
            } else {
                return next(new Error('Responsabilidade financeira definida como Tutor, mas não há tutores cadastrados.'));
            }
        }
    } else {
        this.financialTutorId = null;
    }

    if (this.financialResp === 'STUDENT' && !this.cpf) {
         return next(new Error('Para ser o responsável financeiro, o aluno precisa ter o CPF cadastrado.'));
    }

    next();
});

studentSchema.plugin(auditLogPlugin, { entityName: 'Student' });

const Student = mongoose.model('Student', studentSchema);
module.exports = Student;