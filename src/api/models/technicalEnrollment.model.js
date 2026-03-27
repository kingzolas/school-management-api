const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const technicalEnrollmentSchema = new Schema({
    studentId: {
        type: Schema.Types.ObjectId,
        ref: 'Student',
        required: [true, 'A referÃªncia do participante Ã© obrigatÃ³ria.'],
        index: true
    },
    companyId: {
        type: Schema.Types.ObjectId,
        ref: 'Company',
        required: [true, 'A referÃªncia da empresa Ã© obrigatÃ³ria.'],
        index: true
    },
    technicalProgramId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalProgram',
        required: [true, 'A referÃªncia do programa tÃ©cnico Ã© obrigatÃ³ria.'],
        index: true
    },
    currentTechnicalProgramOfferingId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalProgramOffering',
        default: null,
        index: true
    },
    currentClassId: {
        type: Schema.Types.ObjectId,
        ref: 'Class',
        default: null,
        index: true
    },
    enrollmentDate: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['Pendente', 'Ativa', 'ConcluÃ­da', 'Cancelada'],
        default: 'Pendente',
        index: true
    },
    notes: {
        type: String,
        trim: true
    },
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School',
        required: [true, 'A referÃªncia da escola (school_id) Ã© obrigatÃ³ria.'],
        index: true
    }
}, {
    timestamps: true
});

technicalEnrollmentSchema.index(
    { studentId: 1, technicalProgramId: 1, school_id: 1 },
    { unique: true }
);

module.exports = mongoose.model('TechnicalEnrollment', technicalEnrollmentSchema);
