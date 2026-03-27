const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const technicalEnrollmentSchema = new Schema({
    studentId: {
        type: Schema.Types.ObjectId,
        ref: 'Student',
        required: [true, 'A referência do participante é obrigatória.'],
        index: true
    },
    companyId: {
        type: Schema.Types.ObjectId,
        ref: 'Company',
        required: [true, 'A referência da empresa é obrigatória.'],
        index: true
    },
    technicalProgramId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalProgram',
        required: [true, 'A referência do programa técnico é obrigatória.'],
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
        enum: ['Pendente', 'Ativa', 'Concluída', 'Cancelada'],
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
        required: [true, 'A referência da escola (school_id) é obrigatória.'],
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
